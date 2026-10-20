import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signedDate, authorization, normalizeProduct } from '../src/coupang.mjs';
import { DISCLOSURE, withDisclosure, review } from '../src/compliance.mjs';
import { templatePlan, templateListPlan } from '../src/plan.mjs';
import { nextKeyword } from '../src/auto.mjs';
import { buildWeek, scheduleDates } from '../src/week.mjs';
import { pickProvider } from '../src/tts.mjs';
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
  const ass = buildAss(plan.scenes);
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:00:17\.00,Label,,0,0,0,,광고 · 쿠팡 파트너스/);
  assert.equal((ass.match(/,Caption,/g) ?? []).length, plan.scenes.length);
});

test('장면마다 영상과 음성(없으면 무음)을 짝지어 잇는다', () => {
  const args = ffmpegArgs([
    { file: '/a.jpg', seconds: 3, caption: 'a', audio: '/a.mp3' },
    { file: '/b.mp4', seconds: 2, caption: 'b' },
  ]);
  assert.deepEqual(args.filter((_, i) => args[i - 1] === '-i'), ['/a.jpg', '/a.mp3', '/b.mp4']);
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /anullsrc=r=44100:cl=stereo,atrim=0:2\[a1\]/);
  assert.match(graph, /\[v0\]\[a0\]\[v1\]\[a1\]concat=n=2:v=1:a=1/);
});

const many = [1, 2, 3, 4].map(i => normalizeProduct({ productId: i, productName: `상품${i}`, productPrice: i * 1000, productUrl: `https://l/${i}` }));

test('자동 대본: 잘못된·중복 번호는 버리고 훅·3개·마무리 장면을 만든다', () => {
  const plan = templateListPlan('밀폐용기', many, { slot: 5 });
  assert.equal(plan.scenes.length, 5);
  assert.match(plan.scenes.at(-1).caption, /5번/);
  assert.deepEqual(review(plan), []);
});

test('키워드는 가장 덜 쓴 것부터 돌아간다', () => {
  assert.equal(nextKeyword(['a', 'b', 'c'], [{ keyword: 'a' }, { keyword: 'b' }]), 'c');
  assert.equal(nextKeyword(['a', 'b'], [{ keyword: 'a' }, { keyword: 'b' }]), 'a');
});

test('예약은 한국 시간 내일부터 하루씩', () => {
  // 한국 시간 10월 21일 오전 1시
  assert.deepEqual(scheduleDates(2, { from: new Date('2026-10-20T16:00:00Z') }), ['2026-10-22', '2026-10-23']);
});

test('주간 체크리스트는 예약만 쓰고 확인을 받으라고 지시한다', () => {
  const md = buildWeek([{ slot: 3 }, { slot: 4 }], {
    captions: { 3: 'c3', 4: 'c4' }, videoPath: s => `/v/${s}.mp4`, from: new Date('2026-10-20T00:00:00Z'),
  });
  assert.match(md, /공식 "예약" 기능만/);
  assert.match(md, /우회하지 말고 멈춰서/);
  assert.match(md, /done 3 4/);
  assert.match(md, /## 3번 · 2026-10-21 19:00/);
});

test('음성: 키가 있으면 Google, 맥이면 say, 아니면 무음', () => {
  assert.equal(pickProvider({ GOOGLE_TTS_API_KEY: 'k' }, 'linux'), 'google');
  assert.equal(pickProvider({}, 'darwin'), 'mac');
  assert.equal(pickProvider({}, 'linux'), 'none');
});

test('랜딩 페이지는 링크를 sponsored 로 표시하고 이스케이프한다', () => {
  const html = buildLanding(
    [{ slot: 1, name: '<b>', link: 'https://x', image: '' }, { slot: 2, title: 't', products: [{ name: 'p', link: 'https://y', image: '' }] }],
    { disclosure: DISCLOSURE },
  );
  assert.match(html, /rel="sponsored noopener"/);
  assert.match(html, /&lt;b&gt;/);
  assert.ok(html.indexOf(DISCLOSURE) < html.indexOf('<section'));
  assert.ok(html.indexOf('id="n2"') < html.indexOf('id="n1"'));
});
