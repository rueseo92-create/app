// 스레드 자동 게시.
// 글 종류를 섞는다: 수익화 글(링크) 사이사이에 살림 팁·참여 질문 글을 끼워 계정이 광고판처럼 보이지 않게 한다.
//   수익화: 키워드 → 쿠팡 검색 → 상품 하나 → "물건이 아니라 상황" 4칸 글 → 첫 댓글에 링크
//   팁/질문: 키워드 주제로 링크 없는 글
import Anthropic from '@anthropic-ai/sdk';
import { DISCLOSURE, reviewPost } from './compliance.mjs';
import { nextKeyword } from './auto.mjs';

const MODEL = 'claude-opus-5-5';
const DEFAULT_PERSONA = '살림과 주방템 찾아보는 걸 좋아하는 자취 생활자. 담백하고 친근한 반말체.';

export const HOOK_TYPES = ['자책형', '일상 짜증형', '질문형', '상식 반박형', '부정 명령형'];

// 30개 기준 일상(팁) 15 · 팔로워(질문) 5 · 수익화 10
const MIX = { tip: 15, question: 5, monetized: 10 };

const kstDate = d => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const DAY = 86400000;

export function postedToday(history, now = new Date()) {
  const today = kstDate(now);
  return history.filter(h => h.postedAt && kstDate(h.postedAt) === today).length;
}

// 계정 나이: 첫 게시일부터 센다
export function accountDays(history, now = Date.now()) {
  const first = history.find(h => h.postedAt)?.postedAt;
  return first ? Math.floor((now - Date.parse(first)) / DAY) : 0;
}

// 초기 계정은 천천히: 첫 주는 링크 없이, 둘째 주까지는 하루 2개
export function limits(history, { maxPerDay = 3, linkAfterDays = 7, now = Date.now() } = {}) {
  const days = accountDays(history, now);
  return { days, maxPerDay: days < 14 ? Math.min(2, maxPerDay) : maxPerDay, linksAllowed: days >= linkAfterDays };
}

// 목표 비율에서 가장 모자란 종류를 고른다. 수익화 글은 연달아 두지 않는다.
export function chooseType(history, { linksAllowed }) {
  const recent = history.filter(h => h.type).slice(-30);
  const total = Object.values(MIX).reduce((a, b) => a + b, 0);
  const n = recent.length + 1;
  const deficit = t => (MIX[t] / total) * n - recent.filter(h => h.type === t).length;
  const lastWasMoney = recent.at(-1)?.type === 'monetized';
  const types = Object.keys(MIX).filter(t => t !== 'monetized' || (linksAllowed && !lastWasMoney));
  return types.reduce((best, t) => (deficit(t) > deficit(best) ? t : best), types[0]);
}

export function chooseHook(history) {
  const recent = history.slice(-HOOK_TYPES.length).map(h => h.hookType);
  return HOOK_TYPES.find(h => !recent.includes(h)) ?? HOOK_TYPES[history.length % HOOK_TYPES.length];
}

const COMMON = persona => `당신은 스레드(Threads) 계정의 글쓴이입니다.
계정 콘셉트: ${persona}
글은 자동으로 올라갑니다. 계정 주인은 소개하는 제품을 써 보지 않았습니다.

공통 원칙:
- 써 본 척, 사 본 척하지 않는다. "내돈내산", "써 봤는데", "샀다가 후회", "제가 쓰는" 같은 1인칭 사용·구매 경험 금지.
- 겪지 않은 일을 겪은 것처럼 지어내지 않는다. 상황은 "이런 적 있지", "보통 이렇게 된다"처럼 많은 사람이 겪는 일로 쓴다.
- 주어진 정보에 없는 효능·후기·순위·할인율·구체 금액을 지어내지 않는다. 숫자는 주어진 가격이나 누구나 아는 상식만.
- "최저가", "무조건", "100%", "1위", "보장", 의학적 효과 같은 단정 표현 금지.
- "정말, 너무, 완전, 진짜" 같은 꾸밈말을 쓰지 않는다. 예쁜 문장보다 사소하고 구체적인 문장.
- 해시태그·이모지 남발·링크 금지.
- 최근 글과 첫 줄 패턴이 겹치지 않게 쓴다.`;

const TYPE_GUIDE = {
  monetized: `이번 글: 수익화 글. 검색 결과에서 상품 하나를 골라 "물건이 아니라 상황"을 쓴다.
4칸 구조, 전체 7줄 이내:
1칸 훅: 이 물건이 필요해지는 구체적인 상황을 첫 줄에 던진다.
2칸 심화: 그 상황의 디테일(누구나 아는 사실이나 주어진 가격만).
3칸 반전: 예상 못 한 지점이나 사소한 갈등.
4칸 마무리: 댓글 달고 싶어지는 질문으로 끝낸다.
본문에 제품명을 쓰지 않는다. 물건을 칭찬하지 않는다. 광고 문구처럼 읽히면 실패다.
"링크는 댓글에" 같은 안내와 대가성 문구는 쓰지 않는다(시스템이 붙인다).`,
  tip: `이번 글: 링크 없는 살림 팁 글. 키워드 주제에서 바로 써먹을 수 있는 작은 요령이나 흔한 실수 하나를 쓴다.
전체 7줄 이내. 상품이나 브랜드를 언급하지 않는다. 마지막 줄은 가벼운 질문.`,
  question: `이번 글: 링크 없는 참여 질문 글. 키워드 주제로 사람들이 자기 경험을 댓글로 말하고 싶어지는 질문을 던진다.
3~5줄. 상품이나 브랜드를 언급하지 않는다.`,
};

const SCHEMAS = {
  monetized: {
    type: 'object',
    additionalProperties: false,
    required: ['pick', 'body', 'linkLabel'],
    properties: {
      pick: { type: 'integer', description: '고른 상품 번호(1부터)' },
      body: { type: 'string' },
      linkLabel: { type: 'string', description: '댓글 링크 앞 짧은 상품 이름, 20자 이내' },
    },
  },
  plain: {
    type: 'object',
    additionalProperties: false,
    required: ['body'],
    properties: { body: { type: 'string' } },
  },
};

export function composePost(type, body) {
  const text = body.trim();
  return type === 'monetized' ? `${DISCLOSURE}\n\n${text}\n\n👇 정확히 뭔지는 첫 댓글에` : text;
}

export function composeReply(label, link) {
  return `🔗 ${label.trim()}\n${link}\n(쿠팡 파트너스 링크)`;
}

export async function writePost({ type, hookType, keyword, products = [], recent = [], best = [], note, persona }, client = new Anthropic()) {
  const parts = [`키워드(주제): ${keyword}`, `첫 줄 유형: ${hookType}`];
  if (type === 'monetized') {
    const list = products.map((p, i) => ({
      index: i + 1, name: p.name, price: p.price, rocket: p.isRocket, freeShipping: p.isFreeShipping, category: p.category,
    }));
    parts.push(`검색 결과:\n${JSON.stringify(list, null, 2)}`);
  }
  if (best.length) parts.push(`반응이 좋았던 첫 줄(문장 말고 구조만 참고):\n${best.map(b => `- ${b}`).join('\n')}`);
  if (recent.length) parts.push(`최근 글 첫 줄(겹치지 않게):\n${recent.map(r => `- ${r}`).join('\n')}`);
  if (note) parts.push(`지난 초안에서 고칠 점: ${note}`);

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: type === 'monetized' ? SCHEMAS.monetized : SCHEMAS.plain },
    },
    system: `${COMMON(persona || DEFAULT_PERSONA)}\n\n${TYPE_GUIDE[type]}`,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error(`글 생성이 거절되었습니다: ${response.stop_details?.explanation ?? '사유 없음'}`);
  }
  if (response.stop_reason === 'max_tokens') throw new Error('글이 길이 제한에 걸려 잘렸습니다.');
  const text = response.content.find(b => b.type === 'text')?.text;
  if (!text) throw new Error('모델 응답에 본문이 없습니다.');
  const draft = JSON.parse(text);
  if (type !== 'monetized') return { body: draft.body };
  const product = products[draft.pick - 1];
  if (!product) throw new Error(`모델이 없는 상품 번호를 골랐습니다: ${draft.pick}`);
  return { product, body: draft.body, linkLabel: draft.linkLabel };
}

export function templatePost({ type, keyword, products }) {
  if (type === 'monetized') {
    const product = products[0];
    return {
      product,
      body: `${keyword} 정리할 때마다 같은 자리에서 막히지 않아?\n문제는 물건이 아니라 자리였다는 거\n다들 이거 어떻게 해결해?`,
      linkLabel: product.name.slice(0, 20),
    };
  }
  if (type === 'question') return { body: `${keyword}, 다들 뭐 기준으로 골라?\n가격? 크기? 세척?` };
  return { body: `${keyword} 쓸 때 흔한 실수 하나\n물기 남은 채로 넣어 두는 것\n다들 말리는 거 따로 해?` };
}

// 반응 좋은 글 첫 줄 상위 몇 개 (조회수 기준)
export function bestFirstLines(history, n = 3) {
  return history
    .filter(h => h.stats?.views)
    .sort((a, b) => b.stats.views - a.stats.views)
    .slice(0, n)
    .map(h => h.firstLine);
}

export async function runThreads({
  search, keywords, history, post, dryRun, maxPerDay = 3, linkAfterDays = 7, persona, write = writePost, now = Date.now(), log = console.log,
}) {
  const lim = limits(history, { maxPerDay, linkAfterDays, now });
  if (!dryRun && postedToday(history, new Date(now)) >= lim.maxPerDay) {
    log(`오늘은 이미 ${lim.maxPerDay}개를 올렸습니다(계정 ${lim.days}일 차). 건너뜁니다.`);
    return null;
  }

  const type = chooseType(history, lim);
  const hookType = chooseHook(history);
  const keyword = nextKeyword(keywords, history);
  let products = [];
  if (type === 'monetized') {
    const used = new Set(history.map(h => h.productId).filter(Boolean));
    products = (await search(keyword)).filter(p => !used.has(p.id) && p.url);
    if (!products.length) throw new Error(`"${keyword}" 에서 새 상품이 없습니다. 키워드를 늘려 주세요.`);
  }

  const ctx = {
    type, hookType, keyword, products, persona,
    recent: history.slice(-5).map(h => h.firstLine).filter(Boolean),
    best: bestFirstLines(history),
  };
  const compose = d => ({ ...d, text: composePost(type, d.body) });
  const check = d => reviewPost(d.text, { monetized: type === 'monetized' });

  // 점검에 걸리면 한 번 고쳐 쓰게 하고, 그래도 걸리면 올리지 않는다
  let draft = compose(dryRun ? templatePost(ctx) : await write(ctx));
  let issues = check(draft);
  if (issues.length && !dryRun) {
    draft = compose(await write({ ...ctx, note: issues.join(' / ') }));
    issues = check(draft);
  }
  if (issues.length) throw new Error(`글 점검을 통과하지 못해 올리지 않습니다:\n- ${issues.join('\n- ')}`);

  const reply = type === 'monetized' ? { replyText: composeReply(draft.linkLabel, draft.product.url), link: draft.product.url } : {};
  log(`\n----- ${type} · ${hookType} · ${keyword} (계정 ${lim.days}일 차) -----\n${draft.text}`);
  if (reply.replyText) log(`----- 첫 댓글 -----\n${reply.replyText}`);

  const entry = {
    type,
    hookType,
    keyword,
    productId: draft.product?.id ?? null,
    productName: draft.product?.name ?? null,
    firstLine: draft.body.trim().split('\n')[0],
  };
  if (dryRun) return { ...entry, dryRun: true };

  const result = await post({ text: draft.text, imageUrl: draft.product?.image, ...reply });
  log(`✔ 게시: ${result.permalink ?? result.postId}`);
  return { ...entry, ...result, postedAt: new Date(now).toISOString() };
}
