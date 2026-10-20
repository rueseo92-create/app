// 대가성 표기와 금지 표현 점검.
// 표기는 모델에게 맡기지 않고 코드가 항상 맨 앞에 붙인다. 표기 누락은 수익 몰수 사유다.

export const DISCLOSURE =
  '이 콘텐츠는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
export const SHORT_TAG = '#광고 #쿠팡파트너스';

// 근거 없이 쓰면 표시광고법·식약처 기준에 걸리기 쉬운 표현
const RISKY = [
  '최저가', '무조건', '100%', '완치', '치료', '부작용 없', '의사 추천', '1위', '역대급 할인',
  '살 빠지', '다이어트 효과', '기적', '보장',
];

export function withDisclosure(text) {
  const body = String(text ?? '').trim();
  if (body.startsWith(DISCLOSURE)) return body;
  return `${DISCLOSURE}\n${SHORT_TAG}\n\n${body}`;
}

export function findRiskyPhrases(text) {
  const t = String(text ?? '');
  return RISKY.filter(w => t.includes(w));
}

// 게시 전 사람이 볼 점검표. 문제가 있으면 issues 에 담는다.
export function review(plan) {
  const issues = [];
  const all = [
    plan.hook,
    ...(plan.scenes ?? []).map(s => s.caption + ' ' + (s.narration ?? '')),
    ...Object.values(plan.platforms ?? {}).map(p => `${p.title ?? ''} ${p.caption ?? ''}`),
  ].join('\n');

  for (const w of findRiskyPhrases(all)) issues.push(`근거 확인 필요한 표현: "${w}"`);
  for (const [name, p] of Object.entries(plan.platforms ?? {})) {
    if (!String(p.caption ?? '').startsWith(DISCLOSURE)) issues.push(`${name} 캡션 첫 줄에 대가성 문구 없음`);
  }
  // 영상 안의 "광고" 표시는 render 단계에서 처음부터 끝까지 고정으로 넣는다
  return issues;
}

// 자동으로 쓰는 글은 써 보지 않은 제품이다. 써 본 척하는 표현은 기만 광고가 된다.
const FAKE_EXPERIENCE = ['내돈내산', '써 봤', '써봤', '써 보니', '써보니', '제가 쓰는', '내가 쓰는', '직접 써', '사용해 보니', '사용해보니', '한 달 써', '쓰고 있는데'];

export function findFakeExperience(text) {
  const t = String(text ?? '');
  return FAKE_EXPERIENCE.filter(w => t.includes(w));
}

// Threads 글자 수: 이모지는 UTF-8 바이트 수만큼 센다
export function threadsLength(text) {
  let n = 0;
  for (const ch of String(text)) n += /\p{Extended_Pictographic}/u.test(ch) ? Buffer.byteLength(ch) : 1;
  return n;
}

export function reviewPost(text, { limit = 500 } = {}) {
  const issues = [];
  if (!String(text).startsWith(DISCLOSURE)) issues.push('첫 줄에 대가성 문구 없음');
  for (const w of findRiskyPhrases(text)) issues.push(`근거 확인 필요한 표현: "${w}"`);
  for (const w of findFakeExperience(text)) issues.push(`써 본 척하는 표현: "${w}"`);
  const len = threadsLength(text);
  if (len > limit) issues.push(`${len}자로 ${limit}자 제한 초과`);
  return issues;
}
