import assert from 'node:assert/strict';
import test from 'node:test';
import { createFamZoomStarter } from '../lib/fam-zoom-start.ts';
import { isIpRestrictedPath } from '../lib/admin-ip-restriction.ts';

// 初期データ（scripts/seed-fam-zoom-rooms.mjs と同じ）。
const ROOMS: Record<string, string> = {
  'booth-a-r4u7rff8': '98332455891',
  'booth-b-fzrm3mde': '99440551640',
  'booth-c-vhgj4sdu': '99523523516',
  'booth-d-m68ydtc3': '91399315833',
  'booth-e-wuqqc95t': '99690617768',
  'booth-f-kfeasfxg': '91265933813',
};
const ZAK = 'SECRET-ZAK-TOKEN';

function setup(options: { zoom?: (meetingId: string, token: string, call: number) => Response; rooms?: Record<string, string>; now?: () => number } = {}) {
  const calls = { token: 0, zoom: [] as { meetingId: string; token: string }[] };
  const rooms = options.rooms || ROOMS;
  const handle = createFamZoomStarter({
    lookupMeetingId: async key => rooms[key] || '',
    requestToken: async () => {
      calls.token += 1;
      return { accessToken: `access-${calls.token}`, expiresIn: 3600 };
    },
    fetchImpl: (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://api.zoom.us');
      const meetingId = decodeURIComponent(url.pathname.replace('/v2/meetings/', ''));
      const token = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '');
      calls.zoom.push({ meetingId, token });
      if (options.zoom) return options.zoom(meetingId, token, calls.zoom.length);
      return Response.json({ id: Number(meetingId), start_url: `https://zoom.us/s/${meetingId}?zak=${ZAK}` });
    }) as typeof fetch,
    now: options.now,
  });
  const get = (query: string) => handle(new Request(`https://app.example/zoom/start${query}`));
  return { handle, get, calls };
}

test('6つの教室キーそれぞれで、そのミーティングの start_url へ 302 で移る', async () => {
  const { get, calls } = setup();
  for (const [key, meetingId] of Object.entries(ROOMS)) {
    const response = await get(`?room=${key}`);
    assert.equal(response.status, 302, key);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('location') || '', new RegExp(`^https://zoom\\.us/s/${meetingId}\\?`));
  }
  // start_url は毎回 Zoom から取り直し、アクセストークンは使い回す。
  assert.equal(calls.zoom.length, 6);
  assert.equal(calls.token, 1);
});

test('同じ教室でも開くたびに Zoom から start_url を取り直す', async () => {
  let n = 0;
  const { get, calls } = setup({ zoom: id => Response.json({ start_url: `https://zoom.us/s/${id}?zak=z${++n}` }) });
  const first = await get('?room=booth-a-r4u7rff8');
  const second = await get('?room=booth-a-r4u7rff8');
  assert.notEqual(first.headers.get('location'), second.headers.get('location'));
  assert.equal(calls.zoom.length, 2);
});

test('教室キーの前後の空白と、ミーティングIDの空白は取り除く', async () => {
  const { get, calls } = setup({ rooms: { 'booth-x-abcdefgh': ' 983 3245 5891 ' } });
  const response = await get('?room=%20booth-x-abcdefgh%20');
  assert.equal(response.status, 302);
  assert.equal(calls.zoom[0].meetingId, '98332455891');
});

test('アクセストークンは期限の5分前まで使い回し、それを過ぎたら取り直す', async () => {
  let clock = 0;
  const { get, calls } = setup({ now: () => clock });
  await get('?room=booth-a-r4u7rff8');
  clock = 54 * 60_000;
  await get('?room=booth-a-r4u7rff8');
  assert.equal(calls.token, 1);
  clock = 56 * 60_000;
  await get('?room=booth-a-r4u7rff8');
  assert.equal(calls.token, 2);
});

test('Zoom が 401 を返したらトークンを取り直して1回だけやり直す', async () => {
  const { get, calls } = setup({
    zoom: (id, token) => token === 'access-1'
      ? Response.json({ code: 124, message: 'Invalid access token.' }, { status: 401 })
      : Response.json({ start_url: `https://zoom.us/s/${id}?zak=${ZAK}` }),
  });
  const response = await get('?room=booth-b-fzrm3mde');
  assert.equal(response.status, 302);
  assert.deepEqual(calls.zoom.map(call => call.token), ['access-1', 'access-2']);
});

test('やり直しても 401 なら 502（3回目は呼ばない）', async () => {
  const { get, calls } = setup({ zoom: () => Response.json({ message: 'Invalid access token.' }, { status: 401 }) });
  const response = await get('?room=booth-b-fzrm3mde');
  assert.equal(response.status, 502);
  assert.equal(calls.zoom.length, 2);
  const html = await response.text();
  assert.match(html, /Zoom API エラー \(401\)（受付番号: [0-9A-F]{8}）/);
  assert.doesNotMatch(html, /Invalid access token/);
});

test('room がないときは 400 の日本語ページ', async () => {
  const { get, calls } = setup();
  for (const query of ['', '?room=', '?room=%20%20']) {
    const response = await get(query);
    assert.equal(response.status, 400, query);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const html = await response.text();
    assert.match(html, /教室が指定されていません/);
    assert.match(html, /URLの末尾に \?room=教室キー を付けてください/);
  }
  assert.equal(calls.zoom.length, 0);
});

test('未登録の教室キーは 404 の日本語ページ（入力はエスケープする）', async () => {
  const { get, calls } = setup();
  for (const key of ['booth-z-unknown1', '<script>alert(1)</script>', '../../etc']) {
    const response = await get(`?room=${encodeURIComponent(key)}`);
    assert.equal(response.status, 404, key);
    const html = await response.text();
    assert.match(html, /教室が見つかりません/);
    assert.doesNotMatch(html, /<script>alert/);
  }
  assert.equal(calls.zoom.length, 0);
});

test('Zoom のエラーは 502 で、ステータスと受付番号だけを出す（Zoom の文言・start_url・トークンは出さない）', async () => {
  const { get } = setup({ zoom: () => Response.json({ code: 3001, message: 'Meeting does not exist: 98332455891.' }, { status: 404 }) });
  const response = await get('?room=booth-a-r4u7rff8');
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('location'), null);
  const html = await response.text();
  assert.match(html, /Zoomを開始できませんでした/);
  assert.match(html, /Zoom API エラー \(404\)（受付番号: [0-9A-F]{8}）/);
  assert.doesNotMatch(html, /Meeting does not exist/);
  assert.doesNotMatch(html, /access-1|zak=/);
});

test('start_url がない応答・接続失敗も 502', async () => {
  const empty = setup({ zoom: () => Response.json({ id: 1 }) });
  const emptyResponse = await empty.get('?room=booth-a-r4u7rff8');
  assert.equal(emptyResponse.status, 502);
  assert.match(await emptyResponse.text(), /start_url が取得できませんでした/);

  const down = setup({ zoom: () => { throw new Error('fetch failed'); } });
  const downResponse = await down.get('?room=booth-a-r4u7rff8');
  assert.equal(downResponse.status, 502);
});

test('失敗のログに start_url・トークン・教室キーを出さない', async () => {
  const logged: unknown[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { logged.push(args); };
  try {
    const { get } = setup({ zoom: () => Response.json({ message: 'boom' }, { status: 500 }) });
    await get('?room=booth-a-r4u7rff8');
  } finally {
    console.warn = original;
  }
  const text = JSON.stringify(logged);
  assert.doesNotMatch(text, /access-1|zak|booth-a-r4u7rff8/);
});

test('席URLは社外（FAMキャンパス）からも開ける', () => {
  assert.equal(isIpRestrictedPath('/zoom/start'), false);
  assert.equal(isIpRestrictedPath('/api/admin/fam-zoom-rooms'), true);
});
