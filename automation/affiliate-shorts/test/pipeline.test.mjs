import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signedDate, authorization, normalizeProduct } from '../src/coupang.mjs';
import { DISCLOSURE, withDisclosure, review } from '../src/compliance.mjs';
import { templatePlan } from '../src/plan.mjs';
import { buildAss, ffmpegArgs } from '../src/render.mjs';
import { buildLanding } from '../src/landing.mjs';

const product = normalizeProduct({ productId: 7, productName: '테스트 상품', productPrice: 1000, productUrl: 'https://link.coupang.com/x' });

test('서명 시각은 UTC yyMMddTHHmmssZ', () => {
  assert.equal(signedDate(new Date(Date.UTC(2026, 9, 20, 3, 4, 5))), '261020T030405Z');
});

test('서명은 시각+메서드+경로+쿼리의 HMAC', () => {
  const now = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
  const h = authorization({ method: 'GET', path: '/p', query: 'a=1', accessKey: 'AK', secretKey: 'SK', now });
  const sig = crypto.createHmac('sha256', 'SK').update('260102T030405ZGET/pa=1').digest('hex');
  assert.equal(h, `CEA algorithm=HmacSHA256, access-key=AK, signed-date=260102T030405Z, signature=${sig}`);
});

test('대가성 문구는 한 번만 맨 앞에', () => {
  const once = withDisclosure('본문');
  assert.ok(once.startsWith(DISCLOSURE));
  assert.equal(withDisclosure(once), once);
});

test('모든 채널 캡션이 문구로 시작하고 링크 번호를 담는다', () => {
  const plan = templatePlan(product, { slot: 12 });
  for (const p of Object.values(plan.platforms)) {
    assert.ok(p.caption.startsWith(DISCLOSURE));
    assert.match(p.caption, /12번/);
  }
  assert.deepEqual(review(plan), []);
});

test('단정 표현은 점검에 걸린다', () => {
  const plan = templatePlan(product, { slot: 1 });
  plan.hook = '무조건 최저가';
  assert.equal(review(plan).length, 2);
});

test('자막에는 전체 길이의 광고 표시가 들어간다', () => {
  const plan = templatePlan(product, { slot: 1 });
  const ass = buildAss(plan);
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:00:17\.00,Label,,0,0,0,,광고 · 쿠팡 파트너스/);
  assert.equal((ass.match(/,Caption,/g) ?? []).length, plan.scenes.length);
});

test('소재가 모자라면 돌려 쓴다', () => {
  const plan = templatePlan(product, { slot: 1 });
  const args = ffmpegArgs(plan, ['/a.jpg', '/b.mp4']);
  assert.deepEqual(args.filter((_, i) => args[i - 1] === '-i'), ['/a.jpg', '/b.mp4', '/a.jpg', '/b.mp4']);
});

test('랜딩 페이지는 링크를 sponsored 로 표시하고 이스케이프한다', () => {
  const html = buildLanding([{ slot: 1, name: '<b>', link: 'https://x', image: '' }], { disclosure: DISCLOSURE });
  assert.match(html, /rel="sponsored noopener"/);
  assert.match(html, /&lt;b&gt;/);
  assert.ok(html.indexOf(DISCLOSURE) < html.indexOf('<ul>'));
});
