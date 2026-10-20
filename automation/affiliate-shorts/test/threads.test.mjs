import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DISCLOSURE, reviewPost, threadsLength } from '../src/compliance.mjs';
import { composePost, runThreads, postedToday } from '../src/threadsPost.mjs';

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

test('글 점검: 대가성 문구 필수, 써 본 척·단정 표현·500자 초과 차단', () => {
  assert.deepEqual(reviewPost(composePost('주방 정리할 때 보는 것')), []);
  assert.equal(reviewPost('문구 없음').length, 1);
  assert.equal(reviewPost(composePost('써보니 무조건 좋아')).length, 2);
  assert.match(reviewPost(composePost('가'.repeat(480)))[0], /제한 초과/);
  assert.equal(threadsLength('가🙂'), 5);
});

test('하루 최대 개수를 넘기면 쓰지 않는다', async () => {
  const today = new Date().toISOString();
  const history = [1, 2, 3].map(i => ({ keyword: 'a', productId: `x${i}`, postedAt: today }));
  assert.equal(postedToday(history), 3);
  let searched = false;
  const r = await runThreads({ search: async () => ((searched = true), products), keywords: ['a'], history, post: null, maxPerDay: 3, log() {} });
  assert.equal(r, null);
  assert.equal(searched, false);
});

test('점검에 두 번 걸리면 게시하지 않는다', async () => {
  let posted = false;
  const write = async (_k, ps) => ({ product: ps[0], body: '내돈내산 최저가', linkLabel: 'x' });
  await assert.rejects(
    runThreads({ search: async () => products, keywords: ['a'], history: [], post: async () => (posted = true), write, log() {} }),
    /올리지 않습니다/,
  );
  assert.equal(posted, false);
});

test('통과한 글은 본문 맨 앞 문구, 첫 댓글 링크로 올리고 이력을 남긴다', async () => {
  let draft;
  const write = async (_k, ps) => ({ product: ps[1], body: '설거지 끝나고 물기 고민이면\n이건 어때?', linkLabel: '건조대' });
  const r = await runThreads({
    search: async () => products,
    keywords: ['a'],
    history: [{ keyword: 'a', productId: '9' }],
    post: async d => ((draft = d), { postId: 'P', replyId: 'R', permalink: null }),
    write,
    log() {},
  });
  assert.ok(draft.text.startsWith(DISCLOSURE));
  assert.match(draft.replyText, /https:\/\/link\.coupang\.com\/2/);
  assert.equal(r.productId, '2');
  assert.equal(r.firstLine, '설거지 끝나고 물기 고민이면');
});
