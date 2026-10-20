import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DISCLOSURE, reviewPost, threadsLength } from '../src/compliance.mjs';
import { composePost, runThreads, postedToday, limits, chooseType, chooseHook, HOOK_TYPES } from '../src/threadsPost.mjs';
import { updateStats, statsReport } from '../src/threadsStats.mjs';

// 토큰 파일이 작업 폴더에 생기므로 임시 폴더에서 돌린다
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'threads-')));
const { extractCode, freshToken, postWithLinkReply } = await import('../src/threads.mjs');

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const params = Object.fromEntries(new URLSearchParams(init.body ?? new URL(url).search));
    calls.push({ method: init.method ?? 'GET', path: new URL(url).pathname, params });
    const body = handler(calls.at(-1), calls.length);
    return { ok: !body.error, status: body.error ? 400 : 200, statusText: '', json: async () => body };
  };
  return calls;
}

const products = [1, 2].map(i => ({ id: String(i), name: `상품${i}`, price: 1000, url: `https://link.coupang.com/${i}`, image: `https://img/${i}.jpg`, isRocket: true }));

test('code 는 주소 전체에서도, 끝의 #_ 가 붙어도 뽑힌다', () => {
  assert.equal(extractCode('https://localhost/?code=AbC#_'), 'AbC');
  assert.equal(extractCode('AbC#_'), 'AbC');
});

test('게시 순서: 사진 글 → 상태 확인 → 발행 → 링크 댓글(reply_to_id) → 발행', async () => {
  const calls = stubFetch(({ path: p, method }, n) => {
    if (method === 'POST' && p.endsWith('/threads')) return { id: `c${n}` };
    if (p.endsWith('/threads_publish')) return { id: n < 5 ? 'POST1' : 'REPLY1' };
    if (p.startsWith('/v1.0/c')) return { status: 'FINISHED' };
    return { permalink: 'https://threads.com/@me/post/1' };
  });
  const r = await postWithLinkReply(
    { userId: 'U', accessToken: 'T' },
    { text: 'body', imageUrl: 'https://img/1.jpg', replyText: 'reply', link: 'https://link.coupang.com/1' },
    { interval: 0 },
  );
  assert.deepEqual(r, { postId: 'POST1', replyId: 'REPLY1', permalink: 'https://threads.com/@me/post/1' });
  assert.equal(calls[0].params.media_type, 'IMAGE');
  const reply = calls.find(c => c.params.reply_to_id);
  assert.equal(reply.params.reply_to_id, 'POST1');
  assert.equal(reply.params.link_attachment, 'https://link.coupang.com/1');
});

test('사진 처리가 실패하면 글만 올린다', async () => {
  const calls = stubFetch(({ path: p, method, params }, n) => {
    if (method === 'POST' && p.endsWith('/threads')) return { id: params.media_type === 'IMAGE' ? 'cimg' : `c${n}` };
    if (p === '/v1.0/cimg') return { status: 'ERROR', error_message: 'bad image' };
    if (p.endsWith('/threads_publish')) return { id: `P${n}` };
    if (p.startsWith('/v1.0/c')) return { status: 'FINISHED' };
    return {};
  });
  const r = await postWithLinkReply(
    { userId: 'U', accessToken: 'T' },
    { text: 'body', imageUrl: 'https://img/x.jpg', replyText: 'r', link: 'https://l' },
    { interval: 0 },
  );
  assert.ok(calls.some(c => c.params.media_type === 'TEXT' && c.params.text === 'body'));
  assert.equal(r.permalink, null);
});

test('토큰은 7일 지나면 갱신하고, 만료되면 다시 로그인하라고 한다', async () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  const write = (refreshedAt, expiresAt) =>
    fs.writeFileSync('.threads-token.json', JSON.stringify({ accessToken: 'OLD', userId: 'U', refreshedAt, expiresAt }));

  write('2026-10-18T00:00:00Z', '2026-12-01T00:00:00Z');
  assert.equal((await freshToken({ now })).accessToken, 'OLD');

  stubFetch(() => ({ access_token: 'NEW', expires_in: 5184000 }));
  write('2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z');
  assert.equal((await freshToken({ now })).accessToken, 'NEW');

  write('2026-08-01T00:00:00Z', '2026-10-01T00:00:00Z');
  await assert.rejects(freshToken({ now }), /다시 연결/);
});

const NOW = Date.parse('2026-10-20T03:00:00Z');
const daysAgo = d => new Date(NOW - d * 86400000).toISOString();
// 계정 나이 30일, 마지막 글은 팁인 이력
const aged = [{ type: 'tip', keyword: 'a', postedAt: daysAgo(30), hookType: '자책형' }];

test('글 점검: 수익화 글은 문구 필수, 링크 없는 글에는 주소 금지, 써 본 척·단정·500자 차단', () => {
  assert.deepEqual(reviewPost(composePost('monetized', '주방 정리할 때 보는 것')), []);
  assert.deepEqual(reviewPost(composePost('tip', '물기 말리기'), { monetized: false }), []);
  assert.equal(reviewPost('문구 없음').length, 1);
  assert.equal(reviewPost('여기 https://x', { monetized: false }).length, 1);
  assert.equal(reviewPost(composePost('monetized', '샀다가 무조건 후회')).length, 2);
  assert.match(reviewPost(composePost('monetized', '가'.repeat(480)))[0], /제한 초과/);
  assert.equal(threadsLength('가🙂'), 5);
});

test('초기 계정: 첫 주는 링크 금지, 둘째 주까지 하루 2개', () => {
  assert.deepEqual(limits([], { now: NOW }), { days: 0, maxPerDay: 2, linksAllowed: false });
  assert.deepEqual(limits([{ postedAt: daysAgo(8) }], { now: NOW }), { days: 8, maxPerDay: 2, linksAllowed: true });
  assert.deepEqual(limits([{ postedAt: daysAgo(20) }], { now: NOW }), { days: 20, maxPerDay: 3, linksAllowed: true });
  assert.notEqual(chooseType([], { linksAllowed: false }), 'monetized');
});

test('글 종류는 팁 15 · 질문 5 · 수익화 10 비율로 섞고, 수익화 글을 연달아 두지 않는다', () => {
  const h = [];
  for (let i = 0; i < 30; i++) h.push({ type: chooseType(h, { linksAllowed: true }) });
  const count = t => h.filter(x => x.type === t).length;
  assert.deepEqual([count('tip'), count('question'), count('monetized')], [15, 5, 10]);
  assert.ok(h.every((x, i) => !(x.type === 'monetized' && h[i - 1]?.type === 'monetized')));
});

test('첫 줄 유형은 최근에 안 쓴 것부터 돌아간다', () => {
  const h = [];
  for (let i = 0; i < 5; i++) h.push({ hookType: chooseHook(h) });
  assert.deepEqual(h.map(x => x.hookType).sort(), [...HOOK_TYPES].sort());
});

test('하루 최대 개수를 넘기면 쓰지 않는다', async () => {
  const today = new Date(NOW).toISOString();
  const history = [...aged, ...[1, 2, 3].map(i => ({ keyword: 'a', productId: `x${i}`, postedAt: today }))];
  assert.equal(postedToday(history, new Date(NOW)), 3);
  let searched = false;
  const r = await runThreads({ search: async () => ((searched = true), products), keywords: ['a'], history, post: null, now: NOW, log() {} });
  assert.equal(r, null);
  assert.equal(searched, false);
});

test('점검에 두 번 걸리면 게시하지 않는다', async () => {
  let posted = false;
  const write = async () => ({ body: '내돈내산 최저가' });
  await assert.rejects(
    runThreads({ search: async () => products, keywords: ['a'], history: [], post: async () => (posted = true), write, now: NOW, log() {} }),
    /올리지 않습니다/,
  );
  assert.equal(posted, false);
});

test('수익화 글: 문구 맨 앞, 사진, 첫 댓글 링크, 이미 쓴 상품 제외, 이력 기록', async () => {
  // 팁 15 · 질문 5 를 채운 이력이면 다음은 수익화 차례
  const history = [
    ...aged,
    ...Array.from({ length: 14 }, () => ({ type: 'tip' })),
    ...Array.from({ length: 5 }, () => ({ type: 'question' })),
    { type: 'tip', productId: '1' },
  ];
  let draft;
  const write = async ctx => ({ product: ctx.products[0], body: '설거지 끝나고 물기 고민이면\n이건 어때?', linkLabel: '건조대' });
  const r = await runThreads({
    search: async () => products, keywords: ['a'], history, now: NOW, write, log() {},
    post: async d => ((draft = d), { postId: 'P', replyId: 'R', permalink: null }),
  });
  assert.equal(r.type, 'monetized');
  assert.ok(draft.text.startsWith(DISCLOSURE));
  assert.equal(draft.imageUrl, 'https://img/2.jpg');
  assert.match(draft.replyText, /https:\/\/link\.coupang\.com\/2/);
  assert.equal(r.productId, '2');
  assert.equal(r.firstLine, '설거지 끝나고 물기 고민이면');
});

test('팁 글: 링크·사진·댓글 없이 올린다', async () => {
  let draft;
  const r = await runThreads({
    // 직전이 수익화 글이면 다음은 링크 없는 글
    search: async () => assert.fail('팁 글은 검색하지 않는다'), keywords: ['a'], history: [...aged, { type: 'monetized' }], now: NOW,
    write: async ctx => (assert.equal(ctx.type, 'tip'), { body: '물기 먼저 말리기\n다들 어떻게 해?' }),
    post: async d => ((draft = d), { postId: 'P', replyId: null, permalink: null }), log() {},
  });
  assert.equal(r.type, 'tip');
  assert.equal(draft.replyText, undefined);
  assert.equal(draft.imageUrl, undefined);
  assert.ok(!draft.text.includes(DISCLOSURE));
});

test('성과: 하루~7일 지난 글만 갱신하고, 종류·첫 줄 유형별로 요약', async () => {
  const history = [
    { postId: 'old', postedAt: daysAgo(10), type: 'tip', hookType: '질문형', firstLine: 'a' },
    { postId: 'p1', postedAt: daysAgo(2), type: 'tip', hookType: '자책형', firstLine: '첫줄1' },
    { postId: 'p2', postedAt: daysAgo(3), type: 'monetized', hookType: '질문형', firstLine: '첫줄2' },
    { postId: 'new', postedAt: daysAgo(0.5), type: 'tip', hookType: '자책형', firstLine: 'b' },
  ];
  const seen = [];
  const changed = await updateStats(history, async id => (seen.push(id), { views: id === 'p1' ? 900 : 100 }), { now: NOW });
  assert.ok(changed);
  assert.deepEqual(seen, ['p1', 'p2']);
  const report = statsReport(history);
  assert.match(report, /자책형: 평균 조회 900/);
  assert.match(report, /900회 · tip · 첫줄1/);
});
