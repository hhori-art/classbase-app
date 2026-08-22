/**
 * Classbase 講師配置 Google Sheets -> Firebase 自動同期 GAS
 *
 * 使い方:
 * 1. スプレッドシートの「拡張機能」->「Apps Script」に貼り付け
 * 2. スクリプトプロパティに以下を設定
 *    - CLASSBASE_SYNC_ENDPOINT: https://classbase-app.vercel.app/api/admin/shifts/sync
 *    - CLASSBASE_SYNC_SECRET: Vercel側の SHIFT_SYNC_SECRET と同じ値
 *    - CLASSBASE_SYNC_YEAR: 2026
 * 3. setupClassbaseAutoSyncTrigger() を1回だけ実行して権限を許可
 */

const CLASSBASE_LESSON_COLUMN_START = 3; // C列
const CLASSBASE_LESSON_COLUMN_END = 10; // J列
const CLASSBASE_GENERAL_SUPPORT_COLUMN_START = 11; // K列

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Classbase同期')
    .addItem('今開いているシートをFirebaseへ同期', 'syncActiveSheetToClassbase')
    .addItem('自動同期トリガーを設定', 'setupClassbaseAutoSyncTrigger')
    .addToUi();
}

function setupClassbaseAutoSyncTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'handleClassbaseSheetEdit')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('handleClassbaseSheetEdit')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  SpreadsheetApp.getUi().alert('Classbaseの自動同期トリガーを設定しました。編集後にFirebaseへ同期されます。');
}

function handleClassbaseSheetEdit(e) {
  if (!e || !e.range) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;

  try {
    const sheet = e.range.getSheet();
    if (!isClassbaseTargetSheet_(sheet)) return;

    // 連続編集・貼り付けで短時間に何度も同期しないための簡易抑制。
    const cache = CacheService.getScriptCache();
    const key = `classbase_sync_${sheet.getSheetId()}`;
    if (cache.get(key)) return;
    cache.put(key, '1', 20);

    syncSheetToClassbase_(sheet, false);
  } catch (error) {
    console.error('Classbase auto sync failed:', error);
  } finally {
    lock.releaseLock();
  }
}

function syncActiveSheetToClassbase() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const result = syncSheetToClassbase_(sheet, true);
  SpreadsheetApp.getUi().alert(
    `Firebase同期が完了しました。\n` +
    `取込: ${result.incoming}件\n` +
    `作成: ${result.created}件\n` +
    `更新: ${result.updated}件\n` +
    `削除: ${result.deleted}件\n` +
    `講師未紐付け: ${result.missing_teacher_count}件`
  );
}

function syncSheetToClassbase_(sheet, showError) {
  const cfg = classbaseConfig_();
  const parsed = parseClassbaseShiftSheet_(sheet);
  if (!parsed.shifts.length) {
    if (showError) SpreadsheetApp.getUi().alert('同期対象の講師配置が見つかりませんでした。');
    return { incoming: 0, created: 0, updated: 0, deleted: 0, missing_teacher_count: 0 };
  }

  const dates = parsed.shifts.map(shift => shift.target_date).sort();
  return postClassbaseJson_(cfg.endpoint, {
    source_spreadsheet_id: parsed.spreadsheetId,
    source_sheet_name: parsed.sheetName,
    start_date: dates[0],
    end_date: dates[dates.length - 1],
    replace: true,
    force_overwrite: true,
    shifts: parsed.shifts,
  });
}

function classbaseConfig_() {
  const props = PropertiesService.getScriptProperties();
  const cfg = {
    endpoint: props.getProperty('CLASSBASE_SYNC_ENDPOINT') || 'https://classbase-app.vercel.app/api/admin/shifts/sync',
    secret: props.getProperty('CLASSBASE_SYNC_SECRET') || '',
    year: Number(props.getProperty('CLASSBASE_SYNC_YEAR') || '2026'),
    sheetNamePattern: props.getProperty('CLASSBASE_SYNC_SHEET_PATTERN') || '',
  };
  if (!cfg.secret) throw new Error('CLASSBASE_SYNC_SECRET が未設定です。');
  return cfg;
}

function isClassbaseTargetSheet_(sheet) {
  const pattern = classbaseConfig_().sheetNamePattern;
  if (!pattern) return true;
  return new RegExp(pattern).test(sheet.getName());
}

function classbaseDisplay_(value) {
  return String(value || '').replace(/\r/g, '\n').trim();
}

function classbaseDateKey_(displayValue, year) {
  const raw = classbaseDisplay_(displayValue);
  const match = raw.match(/(\d{1,2})[\/月](\d{1,2})/);
  if (!match) return '';
  const month = Number(match[1]);
  const day = Number(match[2]);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function classbasePeriod_(label) {
  const text = classbaseDisplay_(label);
  if (text.includes('２') || text.includes('2')) return 2;
  if (text.includes('１') || text.includes('1')) return 1;
  return 0;
}

function classbaseSplitNames_(value) {
  return classbaseDisplay_(value)
    .split(/\n|、|,|\/|　{2,}/)
    .map(value => classbaseNormalizeSupportName_(value))
    .filter(value => !classbaseIsIgnorableSupportCell_(value));
}

function classbaseNormalizeSupportName_(value) {
  return classbaseDisplay_(value)
    .replace(/^【遠】/, '')
    .replace(/^遠隔[:：]?/, '')
    .replace(/^オンライン[:：]?/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function classbaseIsIgnorableSupportCell_(value) {
  const text = classbaseNormalizeSupportName_(value);
  if (!text) return true;
  if (['未', '未定', '―', '-', 'ー', '全体サポート', '枠外', 'Nan', 'nan'].includes(text)) return true;
  if (/^[\d\s]+$/.test(text)) return true;
  if (text.includes('@')) return true;
  if (text.includes('ﾐｰﾃｨﾝｸﾞID') || text.includes('ミーティングID')) return true;
  if (text.includes('ｻｲﾝｲﾝｱﾄﾞﾚｽ') || text.includes('サインインアドレス')) return true;
  return false;
}

function parseClassbaseShiftSheet_(sheet) {
  const cfg = classbaseConfig_();
  const ss = sheet.getParent();
  const values = sheet.getDataRange().getDisplayValues();
  const spreadsheetId = ss.getId();
  const sheetName = sheet.getName();
  const shifts = [];
  const classCounter = {};

  let currentDate = '';
  let currentWeek = '';

  for (let r = 0; r < values.length; r += 1) {
    const row = values[r];
    const possibleDate = classbaseDateKey_(row[0], cfg.year);
    if (possibleDate && classbaseDisplay_(row[1]).includes('曜日')) {
      currentDate = possibleDate;
      currentWeek = classbaseDisplay_(row[2]);
      continue;
    }

    const period = classbasePeriod_(row[0]);
    if (!period || !currentDate) continue;

    const subjectRow = values[r] || [];
    const classRow = values[r + 1] || [];
    const unitRow = values[r + 2] || [];
    const placeRow = values[r + 3] || [];
    const teacherRow = values[r + 4] || [];
    const supportRow = values[r + 5] || [];
    const meetingRow = values[r + 6] || [];
    const signinRow = values[r + 7] || [];

    for (let col = CLASSBASE_LESSON_COLUMN_START; col <= CLASSBASE_LESSON_COLUMN_END; col += 1) {
      const index = col - 1;
      const subject = classbaseDisplay_(subjectRow[index]);
      let detail = classbaseDisplay_(classRow[index]);
      const unit = classbaseDisplay_(unitRow[index]);
      const place = classbaseDisplay_(placeRow[index]);
      const teacher = classbaseDisplay_(teacherRow[index]);
      const support = classbaseDisplay_(supportRow[index]);
      const meetingId = classbaseDisplay_(meetingRow[index]);
      const signin = classbaseDisplay_(signinRow[index]).replace(/\n/g, '');

      if (!subject && !detail && !teacher && !support) continue;

      const grade = subject.replace(/理科|社会/g, '');
      const counterKey = `${currentDate}_${period}_${grade}_${subject}_${detail}`;
      classCounter[counterKey] = (classCounter[counterKey] || 0) + 1;
      if (classCounter[counterKey] > 1) {
        detail = `${detail}(${classCounter[counterKey]})`;
      }

      shifts.push({
        source_spreadsheet_id: spreadsheetId,
        source_sheet_name: sheetName,
        source_row: r + 5,
        source_col: col,
        sync_key: `${spreadsheetId}:${sheetName}:${r + 5}:${col}:main`,
        target_date: currentDate,
        period,
        role_type: 'main',
        teacher_name: teacher || '未定',
        grade,
        subject,
        detail_subject: detail,
        unit,
        place,
        meeting_id: meetingId,
        signin_address: signin,
        note: `【${period}限】${currentWeek}`,
      });

      classbaseSplitNames_(support).forEach((name, i) => {
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
          grade,
          subject,
          detail_subject: detail,
          unit,
          place,
          note: `【${period}限】サポート`,
        });
      });
    }

    for (let col = CLASSBASE_GENERAL_SUPPORT_COLUMN_START; col <= row.length; col += 1) {
      const index = col - 1;
      const names = classbaseSplitNames_(teacherRow[index]).concat(classbaseSplitNames_(supportRow[index]));
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

function postClassbaseJson_(url, payload) {
  const cfg = classbaseConfig_();
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
