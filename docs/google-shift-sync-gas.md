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
- GAS と同名で管理する場合: `CLASSBASE_SYNC_SECRET`
- 代替: 既存の `SECRET_KEY`

## GAS 設定値

Apps Script の「プロジェクトの設定」→「スクリプト プロパティ」に以下を設定してください。

| key | value |
| --- | --- |
| `CLASSBASE_SYNC_ENDPOINT` | `https://classbase-app.vercel.app/api/admin/shifts/sync` |
| `CLASSBASE_SYNC_SECRET` | Vercel の `SHIFT_SYNC_SECRET` / `CLASSBASE_SYNC_SECRET` / `SECRET_KEY` のいずれかと同じ値 |
| `CLASSBASE_SYNC_YEAR` | `2026` |

`{"ok":false,"error":"missing-token"}` が出る場合は、GASの `CLASSBASE_SYNC_SECRET` が空、またはVercel側に同期用シークレットが設定されていない可能性が高いです。

## Firebase 直接同期版について

GAS から Next.js API を経由せず、Firestore REST API へ直接同期する形式にもできます。

この場合は Firebase Admin SDK ではなく、GAS 側でサービスアカウントの JWT を作成して、Google OAuth のアクセストークンを取得し、Firestore REST API に書き込みます。

アクセスキー類はここでは空欄にしています。実運用時だけ Apps Script の「スクリプト プロパティ」に設定してください。

| key | value |
| --- | --- |
| `FIREBASE_PROJECT_ID` |  |
| `FIREBASE_CLIENT_EMAIL` |  |
| `FIREBASE_PRIVATE_KEY` |  |
| `CLASSBASE_SYNC_YEAR` | `2026` |

必要な Google Cloud IAM:

- サービスアカウントに `Cloud Datastore User` または Firestore 書き込み可能な権限を付与
- GAS 側に外部リクエスト権限を許可

Firestore rules は Admin/サービスアカウント経由の REST 書き込みには適用されません。したがって、キーはスクリプトプロパティにのみ保存し、シート本文や共有ドキュメントには置かないでください。

### 複合インデックス

`Firebaseから反映` では `shift_assignments` を次の条件で検索します。

- `source_spreadsheet_id`
- `source_sheet_name`
- `target_date`

そのため Firestore の複合インデックスが必要です。リポジトリには `firestore.indexes.json` を追加済みです。

Firebase CLI で反映する場合:

```bash
npx firebase-tools deploy --only firestore:indexes --project class-base-app
```

Firebase Console のエラーに表示されたリンクから作成しても問題ありません。作成後、インデックスが有効になるまで数分かかります。

## Firebase 直接同期版 Apps Script

以下は `シート → Firestore` と `Firestore → シート` の同期を行う版です。アクセスキーは空欄のままです。

```javascript
const FIREBASE_LESSON_COLUMN_START = 3; // C列
const FIREBASE_LESSON_COLUMN_END = 10; // J列
const FIREBASE_GENERAL_SUPPORT_COLUMN_START = 11; // K列

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Classbase同期')
    .addItem('Firebaseへ同期', 'syncSheetToFirebase')
    .addItem('Firebaseから反映', 'syncFirebaseToSheet')
    .addToUi();
}

function firebaseConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    projectId: props.getProperty('FIREBASE_PROJECT_ID') || '',
    clientEmail: props.getProperty('FIREBASE_CLIENT_EMAIL') || '',
    privateKey: (props.getProperty('FIREBASE_PRIVATE_KEY') || '').replace(/\\n/g, '\n'),
    year: Number(props.getProperty('CLASSBASE_SYNC_YEAR') || '2026'),
  };
}

function firebaseDisplay_(value) {
  return String(value || '').replace(/\r/g, '\n').trim();
}

function firebaseDateKey_(displayValue, year) {
  const raw = firebaseDisplay_(displayValue);
  const match = raw.match(/(\d{1,2})[\/月](\d{1,2})/);
  if (!match) return '';
  const month = Number(match[1]);
  const day = Number(match[2]);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function firebasePeriod_(label) {
  const text = firebaseDisplay_(label);
  if (text.includes('２') || text.includes('2')) return 2;
  if (text.includes('１') || text.includes('1')) return 1;
  return 0;
}

function firebaseSplitNames_(value) {
  return firebaseDisplay_(value)
    .split(/\n|、|,|\/|　{2,}/)
    .map(v => firebaseDisplay_(v))
    .filter(v => v && v !== '未' && v !== '―' && v !== '-');
}

function base64Url_(input) {
  const bytes = typeof input === 'string' ? Utilities.newBlob(input).getBytes() : input;
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function firestoreToken_() {
  const cfg = firebaseConfig_();
  if (!cfg.projectId || !cfg.clientEmail || !cfg.privateKey) {
    throw new Error('FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY をスクリプトプロパティに設定してください。');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: cfg.clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const unsignedJwt = `${base64Url_(JSON.stringify(header))}.${base64Url_(JSON.stringify(claim))}`;
  const signature = Utilities.computeRsaSha256Signature(unsignedJwt, cfg.privateKey);
  const jwt = `${unsignedJwt}.${base64Url_(signature)}`;

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText() || '{}');
  if (!data.access_token) throw new Error(res.getContentText());
  return data.access_token;
}

function firestoreBaseUrl_() {
  const cfg = firebaseConfig_();
  return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;
}

function firestoreDocumentResourceName_(collectionName, docId) {
  const cfg = firebaseConfig_();
  return `projects/${cfg.projectId}/databases/(default)/documents/${collectionName}/${encodeURIComponent(docId)}`;
}

function firestoreValue_(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  return { stringValue: String(value) };
}

function firestoreFields_(obj) {
  const fields = {};
  Object.keys(obj).forEach(key => fields[key] = firestoreValue_(obj[key]));
  return fields;
}

function firestoreCommit_(writes) {
  if (!writes.length) return;
  const cfg = firebaseConfig_();
  const token = firestoreToken_();
  const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents:commit`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify({ writes }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
}

function firestoreRunQuery_(structuredQuery) {
  const cfg = firebaseConfig_();
  const token = firestoreToken_();
  const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents:runQuery`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify({ structuredQuery }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
  return JSON.parse(res.getContentText() || '[]');
}

function firestoreString_(fields, key) {
  const value = fields && fields[key];
  return value ? String(value.stringValue || value.integerValue || value.doubleValue || '') : '';
}

function parseSheetForFirebase_() {
  const cfg = firebaseConfig_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const values = sheet.getDataRange().getDisplayValues();
  const spreadsheetId = ss.getId();
  const sheetName = sheet.getName();
  const shifts = [];

  let currentDate = '';
  let currentWeek = '';

  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    const possibleDate = firebaseDateKey_(row[0], cfg.year);
    if (possibleDate && firebaseDisplay_(row[1]).includes('曜日')) {
      currentDate = possibleDate;
      currentWeek = firebaseDisplay_(row[2]);
      continue;
    }

    const period = firebasePeriod_(row[0]);
    if (!period || !currentDate) continue;

    const subjectRow = values[r] || [];
    const classRow = values[r + 1] || [];
    const unitRow = values[r + 2] || [];
    const placeRow = values[r + 3] || [];
    const teacherRow = values[r + 4] || [];
    const supportRow = values[r + 5] || [];
    const meetingRow = values[r + 6] || [];
    const signinRow = values[r + 7] || [];

    for (let col = FIREBASE_LESSON_COLUMN_START; col <= FIREBASE_LESSON_COLUMN_END; col++) {
      const index = col - 1;
      const subject = firebaseDisplay_(subjectRow[index]);
      const detail = firebaseDisplay_(classRow[index]);
      const unit = firebaseDisplay_(unitRow[index]);
      const place = firebaseDisplay_(placeRow[index]);
      const teacher = firebaseDisplay_(teacherRow[index]);
      const support = firebaseDisplay_(supportRow[index]);
      const meetingId = firebaseDisplay_(meetingRow[index]);
      const signin = firebaseDisplay_(signinRow[index]).replace(/\n/g, '');

      if (!subject && !detail && !teacher && !support) continue;

      shifts.push({
        sync_key: `${spreadsheetId}:${sheetName}:${r + 5}:${col}:main`,
        sync_source: 'google_sheet_direct',
        source_spreadsheet_id: spreadsheetId,
        source_sheet_name: sheetName,
        source_row: r + 5,
        source_col: col,
        target_date: currentDate,
        role_type: 'main',
        teacher_name: teacher || '未定',
        target_grade: subject.replace(/理科|社会/g, ''),
        target_subject: subject,
        target_detail_subject: detail,
        target_place: place,
        target_meeting_id: meetingId,
        target_signin_address: signin,
        unit,
        note: `【${period}限】${currentWeek}`,
        synced_at_text: new Date().toISOString(),
      });

      firebaseSplitNames_(support).forEach((name, i) => {
        shifts.push({
          sync_key: `${spreadsheetId}:${sheetName}:${r + 6}:${col}:sub:${i}`,
          sync_source: 'google_sheet_direct',
          source_spreadsheet_id: spreadsheetId,
          source_sheet_name: sheetName,
          source_row: r + 6,
          source_col: col,
          target_date: currentDate,
          role_type: 'sub',
          teacher_name: name,
          target_grade: subject.replace(/理科|社会/g, ''),
          target_subject: subject,
          target_detail_subject: detail,
          target_place: place,
          unit,
          note: `【${period}限】サポート`,
          synced_at_text: new Date().toISOString(),
        });
      });
    }

    for (let col = FIREBASE_GENERAL_SUPPORT_COLUMN_START; col <= row.length; col++) {
      const index = col - 1;
      const names = firebaseSplitNames_(teacherRow[index]).concat(firebaseSplitNames_(supportRow[index]));
      names.forEach((name, i) => {
        shifts.push({
          sync_key: `${spreadsheetId}:${sheetName}:${r + 5}:${col}:general:${i}`,
          sync_source: 'google_sheet_direct',
          source_spreadsheet_id: spreadsheetId,
          source_sheet_name: sheetName,
          source_row: r + 5,
          source_col: col,
          target_date: currentDate,
          role_type: 'general',
          teacher_name: name,
          note: `【${period}限】全体サポート`,
          synced_at_text: new Date().toISOString(),
        });
      });
    }
  }

  return { spreadsheetId, sheetName, shifts };
}

function syncSheetToFirebase() {
  const parsed = parseSheetForFirebase_();
  if (!parsed.shifts.length) {
    SpreadsheetApp.getUi().alert('同期対象の講師配置が見つかりませんでした。');
    return;
  }

  const writes = parsed.shifts.map(shift => ({
    update: {
      name: firestoreDocumentResourceName_('shift_assignments', shift.sync_key),
      fields: firestoreFields_(shift),
    },
  }));

  for (let i = 0; i < writes.length; i += 400) {
    firestoreCommit_(writes.slice(i, i + 400));
  }

  SpreadsheetApp.getUi().alert(`Firebase同期が完了しました。\n同期件数: ${parsed.shifts.length}件`);
}

function syncFirebaseToSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const parsed = parseSheetForFirebase_();
  const dates = parsed.shifts.map(s => s.target_date).sort();
  if (!dates.length) {
    SpreadsheetApp.getUi().alert('対象期間を判定できませんでした。');
    return;
  }

  const rows = firestoreRunQuery_({
    from: [{ collectionId: 'shift_assignments' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'source_spreadsheet_id' }, op: 'EQUAL', value: firestoreValue_(ss.getId()) } },
          { fieldFilter: { field: { fieldPath: 'source_sheet_name' }, op: 'EQUAL', value: firestoreValue_(sheet.getName()) } },
          { fieldFilter: { field: { fieldPath: 'target_date' }, op: 'GREATER_THAN_OR_EQUAL', value: firestoreValue_(dates[0]) } },
          { fieldFilter: { field: { fieldPath: 'target_date' }, op: 'LESS_THAN_OR_EQUAL', value: firestoreValue_(dates[dates.length - 1]) } },
        ],
      },
    },
    limit: 1000,
  });

  const mainByCell = {};
  const supportByCell = {};
  const generalByCell = {};

  rows.forEach(row => {
    if (!row.document) return;
    const fields = row.document.fields || {};
    const sourceRow = Number(firestoreString_(fields, 'source_row'));
    const sourceCol = Number(firestoreString_(fields, 'source_col'));
    if (!sourceRow || !sourceCol) return;
    const key = `${sourceRow}:${sourceCol}`;
    const shift = {
      role_type: firestoreString_(fields, 'role_type') || 'main',
      teacher_name: firestoreString_(fields, 'teacher_name'),
      subject: firestoreString_(fields, 'target_subject'),
      detail_subject: firestoreString_(fields, 'target_detail_subject'),
      unit: firestoreString_(fields, 'unit'),
      place: firestoreString_(fields, 'target_place'),
      meeting_id: firestoreString_(fields, 'target_meeting_id'),
      signin_address: firestoreString_(fields, 'target_signin_address'),
    };
    if (shift.role_type === 'main') {
      mainByCell[key] = shift;
    } else if (shift.role_type === 'sub') {
      if (!supportByCell[key]) supportByCell[key] = [];
      if (shift.teacher_name) supportByCell[key].push(shift.teacher_name);
    } else if (shift.role_type === 'general') {
      if (!generalByCell[key]) generalByCell[key] = [];
      if (shift.teacher_name) generalByCell[key].push(shift.teacher_name);
    }
  });

  const cleared = {};
  parsed.shifts.forEach(shift => {
    const row = Number(shift.source_row || 0);
    const col = Number(shift.source_col || 0);
    if (!row || !col) return;
    const role = shift.role_type || 'main';
    if (role === 'main') {
      for (let r = row - 4; r <= row + 3; r++) {
        const key = `${r}:${col}`;
        if (!cleared[key]) {
          sheet.getRange(r, col).clearContent();
          cleared[key] = true;
        }
      }
    } else {
      const key = `${row}:${col}`;
      if (!cleared[key]) {
        sheet.getRange(row, col).clearContent();
        cleared[key] = true;
      }
    }
  });

  let updated = 0;
  Object.keys(mainByCell).forEach(key => {
    const [row, col] = key.split(':').map(Number);
    const shift = mainByCell[key];
    const supportKey = `${row + 1}:${col}`;
    sheet.getRange(row - 4, col).setValue(shift.subject || '');
    sheet.getRange(row - 3, col).setValue(shift.detail_subject || '');
    sheet.getRange(row - 2, col).setValue(shift.unit || '');
    sheet.getRange(row - 1, col).setValue(shift.place || '');
    sheet.getRange(row, col).setValue(shift.teacher_name || '');
    sheet.getRange(row + 1, col).setValue((supportByCell[supportKey] || []).join('\n'));
    sheet.getRange(row + 2, col).setValue(shift.meeting_id || '');
    sheet.getRange(row + 3, col).setValue(shift.signin_address || '');
    updated += 8;
  });

  Object.keys(generalByCell).forEach(key => {
    const [row, col] = key.split(':').map(Number);
    sheet.getRange(row, col).setValue(generalByCell[key].join('\n'));
    updated++;
  });

  SpreadsheetApp.getUi().alert(`Firebaseからシートへ上書きしました。\n更新セル: ${updated}件`);
}
```

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
  const cfg = {
    endpoint: props.getProperty('CLASSBASE_SYNC_ENDPOINT') || 'https://classbase-app.vercel.app/api/admin/shifts/sync',
    secret: props.getProperty('CLASSBASE_SYNC_SECRET') || '',
    year: Number(props.getProperty('CLASSBASE_SYNC_YEAR') || '2026'),
  };
  if (!cfg.secret) {
    throw new Error('CLASSBASE_SYNC_SECRET を Apps Script のスクリプトプロパティに設定してください。');
  }
  return cfg;
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
  const mainByCell = {};
  const supportByCell = {};
  const generalByCell = {};

  data.shifts.forEach(shift => {
    const row = Number(shift.source_row || 0);
    const col = Number(shift.source_col || 0);
    if (!row || !col) return;
    const key = `${row}:${col}`;
    if (shift.role_type === 'main') {
      mainByCell[key] = shift;
    } else if (shift.role_type === 'sub') {
      if (!supportByCell[key]) supportByCell[key] = [];
      if (shift.teacher_name) supportByCell[key].push(shift.teacher_name);
    } else if (shift.role_type === 'general') {
      if (!generalByCell[key]) generalByCell[key] = [];
      if (shift.teacher_name) generalByCell[key].push(shift.teacher_name);
    }
  });

  // 先に管理対象セルを空にして、DBにない値がシートへ残らないようにします。
  const cleared = {};
  parsed.shifts.forEach(shift => {
    const row = Number(shift.source_row || 0);
    const col = Number(shift.source_col || 0);
    if (!row || !col) return;
    const role = shift.role_type || 'main';
    if (role === 'main') {
      for (let r = row - 4; r <= row + 3; r++) {
        const key = `${r}:${col}`;
        if (!cleared[key]) {
          sheet.getRange(r, col).clearContent();
          cleared[key] = true;
        }
      }
    } else {
      const key = `${row}:${col}`;
      if (!cleared[key]) {
        sheet.getRange(row, col).clearContent();
        cleared[key] = true;
      }
    }
  });

  let updated = 0;
  data.shifts.forEach(shift => {
    if (shift.role_type !== 'main') return;
    if (!shift.source_row || !shift.source_col) return;
    const row = Number(shift.source_row);
    const col = Number(shift.source_col);
    const supportKey = `${row + 1}:${col}`;
    sheet.getRange(row - 4, col).setValue(shift.subject || '');
    sheet.getRange(row - 3, col).setValue(shift.detail_subject || '');
    sheet.getRange(row - 2, col).setValue(shift.unit || '');
    sheet.getRange(row - 1, col).setValue(shift.place || '');
    sheet.getRange(row, col).setValue(shift.teacher_name || '');
    sheet.getRange(row + 1, col).setValue((supportByCell[supportKey] || []).join('\n'));
    sheet.getRange(row + 2, col).setValue(shift.meeting_id || '');
    sheet.getRange(row + 3, col).setValue(shift.signin_address || '');
    updated += 8;
  });

  Object.keys(generalByCell).forEach(key => {
    const [row, col] = key.split(':').map(Number);
    sheet.getRange(row, col).setValue(generalByCell[key].join('\n'));
    updated++;
  });

  SpreadsheetApp.getUi().alert(`アプリ → シート上書きが完了しました。\n更新セル: ${updated}件`);
}
```

## 注意

- `シート → アプリ` は `replace: true` により、同じスプレッドシート・同じシート・同じ期間のDB側データを削除してからシート内容で上書きします。
- `アプリ → シート` はDB側の講師名だけでなく、科目・クラス/講座名・単元・場所・Zoom ID・サインイン情報・サポート欄もシートへ上書きします。
- どちらの方向でも「最後に押した同期ボタン側が正」として反映されます。
- 既存の CSV 取り込みと併用できますが、同じ期間を扱う場合はどちらを正とするかを決めて運用してください。
