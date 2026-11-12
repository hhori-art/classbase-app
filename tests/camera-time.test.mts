import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraOffStreak, cameraOnMinutes, cameraRate, isCameraOnSample, matchCameraCandidate, normalizeCameraMonitorRule, presentMinutes,
} from '../lib/camera-time.ts';

const at = (hhmm: string) => `2026-11-09T${hhmm}:00+09:00`;
const on = (hhmm: string) => ({ date_time: at(hhmm), video_input: { bitrate: '512 kbps', resolution: '640*360', frame_rate: '25 fps' } });
const off = (hhmm: string) => ({ date_time: at(hhmm), video_input: { bitrate: '', resolution: '', frame_rate: '' } });

test('映像を送っている1分だけカメラONとみなす', () => {
  assert.equal(isCameraOnSample(on('19:20')), true);
  assert.equal(isCameraOnSample(off('19:20')), false);
  assert.equal(isCameraOnSample({ date_time: at('19:20') }), false);
  assert.equal(isCameraOnSample({ video_input: { resolution: '1280x720' } }), true);
});

test('授業の時間の中だけ数え、入り直しの重なりは1回にする', () => {
  const start = Date.parse(at('19:20'));
  const end = Date.parse(at('20:25'));
  const samples = [on('19:10'), on('19:20'), on('19:21'), off('19:22'), on('19:21'), on('20:25')];
  assert.equal(cameraOnMinutes(samples, start, end).size, 2);
  assert.equal(presentMinutes(samples, start, end).size, 3);
});

test('ON率と、続けてオフの回数（参加が短い授業は飛ばす）', () => {
  assert.equal(cameraRate(14, 70), 20);
  assert.equal(cameraRate(5, 0), null);
  const rule = normalizeCameraMonitorRule({});
  assert.deepEqual(rule, { enabled: true, off_rate_percent: 20, streak_lessons: 3, min_present_minutes: 10 });
  const lessons = [
    { date: '2026-10-19', camera_minutes: 60, present_minutes: 70 },
    { date: '2026-10-26', camera_minutes: 0, present_minutes: 70 },
    { date: '2026-11-02', camera_minutes: 10, present_minutes: 70 },
    { date: '2026-11-05', camera_minutes: 5, present_minutes: 5 },
    { date: '2026-11-09', camera_minutes: 3, present_minutes: 65 },
  ];
  assert.deepEqual(cameraOffStreak(lessons, rule), { streak: 3, since: '2026-10-26' });
  assert.deepEqual(cameraOffStreak([...lessons, { date: '2026-11-16', camera_minutes: 40, present_minutes: 70 }], rule), { streak: 0, since: '' });
  assert.equal(normalizeCameraMonitorRule({ enabled: false, streak_lessons: 1 }).streak_lessons, 2);
});

test('Zoomの表示名から授業に入った生徒を選ぶ（あいまいなら選ばない）', () => {
  const candidates = [
    { id: 'a', name: '山田 太郎', lifetimeId: '22220000' },
    { id: 'b', name: '山田 花子', lifetimeId: '22220001' },
  ];
  assert.equal(matchCameraCandidate('22220001 やまだ', candidates)?.id, 'b');
  assert.equal(matchCameraCandidate('山田太郎', candidates)?.id, 'a');
  assert.equal(matchCameraCandidate('山田 太郎（iPad）', candidates)?.id, 'a');
  assert.equal(matchCameraCandidate('山田', candidates), null);
  assert.equal(matchCameraCandidate('iPhone', candidates), null);
});
