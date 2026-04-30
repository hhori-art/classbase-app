# Google Sheets 講師配置同期

対象スプレッドシート:

- `2026_OL理社講師配置`
- Spreadsheet ID: `1L0Fu1d7onPJ6bphbBvINfQFa_Y2nqlz81vIdybu-8j8`
- 代表シート: `2026年第Ⅰ期`

## 目的

Google Sheets の講師配置表と、アプリの Firestore `shift_assignments` を手動ボタンで同期します。

- `シート → アプリ`: シートの講師配置をアプリへ取り込みます。
- `アプリ → シート`: アプリ側で変更された講師名を、元のシートのセルへ戻します。

## アプリ側 API

本実装で追加した API:

- `POST /api/admin/shifts/sync`
- `GET /api/admin/shifts/sync`

GAS から呼ぶ場合は、HTTP ヘッダー `x-shift-sync-secret` に同期用シークレットを入れてください。

Vercel では次のどちらかを設定します。

- 推奨: `SHIFT_SYNC_SECRET`
- 代替: 既存の `SECRET_KEY`

## GAS 設定値

Apps Script の「プロジェクトの設定」→「スクリプト プロパティ」に以下を設定してください。

| key | value |
| --- | --- |
| `CLASSBASE_SYNC_ENDPOINT` | `https://classbase-app.vercel.app/api/admin/shifts/sync` |
| `CLASSBASE_SYNC_SECRET` | Vercel の `SHIFT_SYNC_SECRET` または `SECRET_KEY` と同じ値 |
| `CLASSBASE_SYNC_YEAR` | `2026` |

## Apps Script

スプレッドシートの拡張機能 → Apps Script に貼り付けてください。

```javascript
const LESSON_COLUMN_START = 3; // C列
const LESSON_COLUMN_END = 10; // J列
const GENERAL_SUPPORT_COLUMN_START = 11; // K列

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Classbase同期')
    .addItem('シート → アプリへ同期', 'syncSheetToClassbase')
    .addItem('アプリ → シートへ反映', 'syncClassbaseToSheet')
    .addToUi();
}

function config_() {
  const props = PropertiesService.getScriptProperties();
  return {
    endpoint: props.getProperty('CLASSBASE_SYNC_ENDPOINT') || 'https://classbase-app.vercel.app/api/admin/shifts/sync',
    secret: props.getProperty('CLASSBASE_SYNC_SECRET') || '',
    year: Number(props.getProperty('CLASSBASE_SYNC_YEAR') || '2026'),
  };
}

function display_(value) {
  return String(value || '').replace(/\r/g, '\n').trim();
}

function dateKey_(displayValue, year) {
  const raw = display_(displayValue);
  const match = raw.match(/(\d{1,2})[\/月](\d{1,2})/);
  if (!match) return '';
  const month = Number(match[1]);
  const day = Number(match[2]);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function periodFromLabel_(label) {
  const text = display_(label);
  if (text.includes('２') || text.includes('2')) return 2;
  if (text.includes('１') || text.includes('1')) return 1;
  return 0;
}

function splitNames_(value) {
  return display_(value)
    .split(/\n|、|,|\/|　{2,}/)
    .map(v => display_(v))
    .filter(v => v && v !== '未' && v !== '―' && v !== '-');
}

function parseActiveSheet_() {
  const cfg = config_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const values = sheet.getDataRange().getDisplayValues();
  const spreadsheetId = ss.getId();
  const sheetName = sheet.getName();
  const shifts = [];

  let currentDate = '';
  let currentWeek = '';
  let currentPeriod = 0;

  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    const possibleDate = dateKey_(row[0], cfg.year);
    if (possibleDate && display_(row[1]).includes('曜日')) {
      currentDate = possibleDate;
      currentWeek = display_(row[2]);
      currentPeriod = 0;
      continue;
    }

    const period = periodFromLabel_(row[0]);
    if (!period || !currentDate) continue;

    currentPeriod = period;

    const subjectRow = values[r] || [];
    const classRow = values[r + 1] || [];
    const unitRow = values[r + 2] || [];
    const placeRow = values[r + 3] || [];
    const teacherRow = values[r + 4] || [];
    const supportRow = values[r + 5] || [];
    const meetingRow = values[r + 6] || [];
    const signinRow = values[r + 7] || [];

    for (let col = LESSON_COLUMN_START; col <= LESSON_COLUMN_END; col++) {
      const index = col - 1;
      const subject = display_(subjectRow[index]);
      const detail = display_(classRow[index]);
      const unit = display_(unitRow[index]);
      const place = display_(placeRow[index]);
      const teacher = display_(teacherRow[index]);
      const support = display_(supportRow[index]);
      const meetingId = display_(meetingRow[index]);
      const signin = display_(signinRow[index]).replace(/\n/g, '');

      if (!subject && !detail && !teacher && !support) continue;

      shifts.push({
        source_spreadsheet_id: spreadsheetId,
        source_sheet_name: sheetName,
        source_row: r + 5, // 講師行。1始まり
        source_col: col,
        sync_key: `${spreadsheetId}:${sheetName}:${r + 5}:${col}:main`,
        target_date: currentDate,
        period,
        role_type: 'main',
        teacher_name: teacher || '未定',
        grade: subject.replace(/理科|社会/g, ''),
        subject,
        detail_subject: detail,
        unit,
        place,
        meeting_id: meetingId,
        signin_address: signin,
        note: `【${period}限】${currentWeek}`,
      });

      splitNames_(support).forEach((name, i) => {
        shifts.push({
          source_spreadsheet_id: spreadsheetId,
          source_sheet_name: sheetName,
          source_row: r + 6,
          source_col: col,
          sync_key: `${spreadsheetId}:${sheetName}:${r + 6}:${col}:sub:${i}`,
          target_date: currentDate,
          period,
          role_type: 'sub',
          teacher_name: name,
          grade: subject.replace(/理科|社会/g, ''),
          subject,
          detail_subject: detail,
          unit,
          place,
          note: `【${period}限】サポート`,
        });
      });
    }

    for (let col = GENERAL_SUPPORT_COLUMN_START; col <= row.length; col++) {
      const index = col - 1;
      const names = splitNames_(teacherRow[index]).concat(splitNames_(supportRow[index]));
      names.forEach((name, i) => {
        shifts.push({
          source_spreadsheet_id: spreadsheetId,
          source_sheet_name: sheetName,
          source_row: r + 5,
          source_col: col,
          sync_key: `${spreadsheetId}:${sheetName}:${r + 5}:${col}:general:${i}`,
          target_date: currentDate,
          period,
          role_type: 'general',
          teacher_name: name,
          note: `【${period}限】全体サポート`,
        });
      });
    }
  }

  return { spreadsheetId, sheetName, shifts };
}

function postJson_(url, payload) {
  const cfg = config_();
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-shift-sync-secret': cfg.secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const text = res.getContentText();
  const data = JSON.parse(text || '{}');
  if (res.getResponseCode() >= 300 || data.ok === false) {
    throw new Error(text);
  }
  return data;
}

function getJson_(url) {
  const cfg = config_();
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'x-shift-sync-secret': cfg.secret },
    muteHttpExceptions: true,
  });
  const text = res.getContentText();
  const data = JSON.parse(text || '{}');
  if (res.getResponseCode() >= 300 || data.ok === false) {
    throw new Error(text);
  }
  return data;
}

function syncSheetToClassbase() {
  const cfg = config_();
  const parsed = parseActiveSheet_();
  if (!parsed.shifts.length) {
    SpreadsheetApp.getUi().alert('同期対象の講師配置が見つかりませんでした。');
    return;
  }

  const dates = parsed.shifts.map(s => s.target_date).sort();
  const result = postJson_(cfg.endpoint, {
    source_spreadsheet_id: parsed.spreadsheetId,
    source_sheet_name: parsed.sheetName,
    start_date: dates[0],
    end_date: dates[dates.length - 1],
    replace: true,
    shifts: parsed.shifts,
  });

  SpreadsheetApp.getUi().alert(
    `シート → アプリ同期が完了しました。\n` +
    `取込: ${result.incoming}件\n作成: ${result.created}件\n更新: ${result.updated}件\n削除: ${result.deleted}件\n講師未紐付け: ${result.missing_teacher_count}件`
  );
}

function syncClassbaseToSheet() {
  const cfg = config_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const parsed = parseActiveSheet_();
  const dates = parsed.shifts.map(s => s.target_date).sort();
  if (!dates.length) {
    SpreadsheetApp.getUi().alert('対象期間を判定できませんでした。');
    return;
  }

  const url =
    `${cfg.endpoint}?source_spreadsheet_id=${encodeURIComponent(ss.getId())}` +
    `&source_sheet_name=${encodeURIComponent(sheet.getName())}` +
    `&start_date=${encodeURIComponent(dates[0])}` +
    `&end_date=${encodeURIComponent(dates[dates.length - 1])}`;

  const data = getJson_(url);
  let updated = 0;

  data.shifts.forEach(shift => {
    if (shift.role_type !== 'main') return;
    if (!shift.source_row || !shift.source_col) return;
    sheet.getRange(Number(shift.source_row), Number(shift.source_col)).setValue(shift.teacher_name || '');
    updated++;
  });

  SpreadsheetApp.getUi().alert(`アプリ → シート反映が完了しました。\n更新セル: ${updated}件`);
}
```

## 注意

- `アプリ → シート` は講師配置の「講師」セルのみ戻し書きします。
- 生徒向けの講座名・単元・Zoom ID などはシートを正として `シート → アプリ` で同期してください。
- `replace: true` は同じスプレッドシート・同じシート・同じ期間の既存同期データを削除してから取り込みます。
- 既存の CSV 取り込みと併用できますが、同じ期間を扱う場合はどちらを正とするかを決めて運用してください。
