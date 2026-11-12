/**
 * 創造学園アプリ：メール送信用の Google Apps Script
 * onlinesupport@sozogakuen.co.jp でログインして作る（そのアカウントの Gmail から送られる）。
 * 手順は docs/password-recovery-setup.md の「メール送信の初期設定（Google Apps Script）」。
 *
 * ウェブアプリとして公開はしない。1分ごとのトリガーでアプリの待ち行列（/api/internal/mail-outbox）から
 * 送るメールを取り出し、送った結果を返す。合言葉（MAIL_SECRET）で署名し、アプリ側が確かめる。
 * 送信は1日1,500通まで（残りの通数をアプリに伝える）。
 */

const APP_URL = 'https://classbase-app.vercel.app';
const BATCH_LIMIT = 30;

/** ① 最初に1回だけ実行。合言葉を作って保存し、ログに表示する（Vercel の GAS_MAIL_SECRET に入れる）。 */
function createSecret() {
  const secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('MAIL_SECRET', secret);
  console.log('Vercel の GAS_MAIL_SECRET にこの値を入れてください: ' + secret);
}

/** ② Vercel に合言葉を入れて反映したあとに1回実行。つながるか試し、1分ごとのトリガーを作る。 */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'pollOutbox'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  pollOutbox();
  ScriptApp.newTrigger('pollOutbox').timeBased().everyMinutes(1).create();
  console.log('1分ごとの送信を始めました。今日あと送れる通数: ' + MailApp.getRemainingDailyQuota());
}

/** 1分ごとに動く。送るメールを取り出して送り、結果を返す。 */
function pollOutbox() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const remaining = MailApp.getRemainingDailyQuota();
    const claimed = call({ action: 'claim', limit: Math.min(BATCH_LIMIT, remaining), remaining: remaining });
    const mails = claimed.mails || [];
    if (!mails.length) return;
    const results = mails.map(function (mail) {
      try {
        if (!mail.to || /[,;\s]/.test(mail.to)) throw new Error('invalid-recipient');
        const options = { name: mail.name || '創造学園アプリ' };
        if (mail.html) options.htmlBody = mail.html;
        MailApp.sendEmail(mail.to, mail.subject, mail.text, options);
        return { id: mail.id, ok: true };
      } catch (err) {
        return { id: mail.id, ok: false, error: String((err && err.message) || err).slice(0, 200) };
      }
    });
    call({ action: 'report', results: results, remaining: MailApp.getRemainingDailyQuota() });
  } finally {
    lock.releaseLock();
  }
}

function call(payloadObject) {
  const secret = PropertiesService.getScriptProperties().getProperty('MAIL_SECRET');
  if (!secret) throw new Error('先に createSecret を実行してください');
  const payload = JSON.stringify(payloadObject);
  const ts = String(Date.now());
  const sig = hex(Utilities.computeHmacSha256Signature(ts + '\n' + payload, secret, Utilities.Charset.UTF_8));
  const res = UrlFetchApp.fetch(APP_URL + '/api/internal/mail-outbox', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ ts: ts, sig: sig, payload: payload }),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200 || !data.ok) throw new Error('アプリとの通信に失敗: ' + res.getResponseCode() + ' ' + (data.error || ''));
  return data;
}

function hex(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
