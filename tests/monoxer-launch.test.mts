import assert from 'node:assert/strict';
import test from 'node:test';
import { MONOXER_APP_STORE_URL, monoxerAndroidIntentUrl, monoxerPlatform } from '../lib/monoxer-launch.ts';

test('Monoxer opens the right way on each device', () => {
  assert.equal(monoxerPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5), 'ios');
  // iPadOS は Macintosh を名乗るが、タッチ対応で見分ける。
  assert.equal(monoxerPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'ios');
  assert.equal(monoxerPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'desktop');
  assert.equal(monoxerPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5), 'android');
  assert.equal(monoxerPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0), 'desktop');
  assert.equal(MONOXER_APP_STORE_URL, 'https://apps.apple.com/jp/app/id1288435689');
  const intent = monoxerAndroidIntentUrl();
  assert.match(intent, /^intent:\/\/open#Intent;scheme=monoxer;package=com\.monoxer;/);
  assert.match(intent, /S\.browser_fallback_url=https%3A%2F%2Fplay\.google\.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom\.monoxer;end$/);
});
