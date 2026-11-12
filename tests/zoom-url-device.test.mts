import assert from 'node:assert/strict';
import test from 'node:test';
import { isMobileOrTabletDevice } from '../lib/zoom-url.ts';

test('スマホ・タブレットはZoomのhttps参加URLを開く（iPadはタッチ操作で見分ける）', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
  const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  assert.equal(isMobileOrTabletDevice(iphone, 5), true);
  assert.equal(isMobileOrTabletDevice(ipad, 5), true);
  assert.equal(isMobileOrTabletDevice(android, 5), true);
  assert.equal(isMobileOrTabletDevice(ipad, 0), false); // Mac のパソコン
  assert.equal(isMobileOrTabletDevice(windows, 0), false);
});

test('ホスト開始用のURL（/s/・zak=）は、生徒の参加URLに使わない', async () => {
  const { isZoomHostStartUrl, looksLikeZoomJoinUrl, buildZoomJoinUrl } = await import('../lib/zoom-url.ts');
  const host = 'https://us06web.zoom.us/s/98332455891?zak=eyJ0eXAiOiJKV1QifQ.dummy';
  const join = 'https://us06web.zoom.us/j/98332455891?pwd=abcDEF123';
  assert.equal(isZoomHostStartUrl(host), true);
  assert.equal(isZoomHostStartUrl('https://zoom.us/s/98332455891'), true);
  assert.equal(isZoomHostStartUrl('https://zoom.us/j/98332455891?zak=x'), true);
  assert.equal(isZoomHostStartUrl(join), false);
  assert.equal(isZoomHostStartUrl('https://classbase-app.vercel.app/zoom/start?room=booth-a'), false);
  assert.equal(looksLikeZoomJoinUrl(host), false);
  assert.equal(looksLikeZoomJoinUrl(join), true);
  // ホスト用URLしかないときは、会議IDから参加URLを作る（ホストのトークンを生徒に渡さない）。
  assert.equal(buildZoomJoinUrl({ meetingId: '98332455891', joinUrl: host }), 'https://zoom.us/j/98332455891');
  assert.equal(buildZoomJoinUrl({ meetingId: '98332455891', joinUrl: join }), join);
});

test('講師配置の参加URLは、ホスト開始用のURLを飛ばして参加URLを選ぶ', async () => {
  const { getShiftJoinUrl } = await import('../lib/student-course-schedule.ts');
  const shift = {
    target_meeting_id: '98332455891',
    target_url: 'https://us06web.zoom.us/s/98332455891?zak=dummy',
    zoom_url: 'https://us06web.zoom.us/j/98332455891?pwd=abc',
  };
  assert.equal(getShiftJoinUrl(shift), 'https://us06web.zoom.us/j/98332455891?pwd=abc');
  assert.equal(getShiftJoinUrl({ target_meeting_id: '98332455891', target_url: 'https://zoom.us/s/98332455891?zak=x' }), '');
});
