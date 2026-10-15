import assert from 'node:assert/strict';
import test from 'node:test';
import { appendZoomRecordingPasscode, isZoomRecordingShareUrl } from '../lib/recordings';

test('Zoom公式の録画共有URLを画面内プレイヤー対象として判定する', () => {
  assert.equal(isZoomRecordingShareUrl('https://zoom.us/rec/share/example?startTime=123'), true);
  assert.equal(isZoomRecordingShareUrl('https://us02web.zoom.us/rec/play/example'), true);
  assert.equal(isZoomRecordingShareUrl('https://zoom.com/rec/share/example'), true);
});

test('偽装ホストや非HTTPS URLをZoom録画として扱わない', () => {
  assert.equal(isZoomRecordingShareUrl('https://zoom.us.attacker.example/rec/share/example'), false);
  assert.equal(isZoomRecordingShareUrl('http://zoom.us/rec/share/example'), false);
  assert.equal(isZoomRecordingShareUrl('https://zoom.us/j/123456789'), false);
  assert.equal(isZoomRecordingShareUrl('not-a-url'), false);
});

test('Zoom録画URLへパスコードを安全に付与する', () => {
  const playbackUrl = appendZoomRecordingPasscode('https://example.zoom.us/rec/share/abc?startTime=123', 'a+b/ c');
  assert.equal(new URL(playbackUrl).searchParams.get('pwd'), 'a+b/ c');
  assert.equal(appendZoomRecordingPasscode('https://zoom.us/rec/share/abc?pwd=existing', 'new'), 'https://zoom.us/rec/share/abc?pwd=existing');
  assert.throws(() => appendZoomRecordingPasscode('https://zoom.us.attacker.example/rec/share/abc', 'secret'));
});
