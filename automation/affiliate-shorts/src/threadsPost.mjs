// 스레드 자동 게시: 키워드 → 상품 검색 → Claude가 하나 골라 글 작성 → 점검 → 게시 + 첫 댓글 링크
import Anthropic from '@anthropic-ai/sdk';
import { DISCLOSURE, reviewPost } from './compliance.mjs';
import { nextKeyword } from './auto.mjs';

const MODEL = 'claude-opus-5-5';
const DEFAULT_PERSONA = '살림과 주방템 찾아보는 걸 좋아하는 자취 생활자. 담백하고 친근한 반말체.';

const system = persona => `당신은 스레드(Threads) 계정의 글쓴이입니다.
계정 콘셉트: ${persona}

쿠팡 검색 결과에서 상품 하나를 골라 스레드 글 하나를 씁니다. 글은 자동으로 올라가며, 계정 주인은 그 제품을 써 보지 않았습니다.

원칙:
- 써 본 척하지 않는다. "내돈내산", "써 봤는데", "써 보니", "제가 쓰는" 같은 표현 금지. 대신 "이런 사람한테 맞겠다", "찾아보다 발견한" 같은 큐레이터 시점으로 쓴다.
- 주어진 정보(상품명, 가격, 로켓배송, 무료배송, 카테고리)에 없는 효능·후기·순위·할인율을 지어내지 않는다.
- "최저가", "무조건", "100%", "1위", "보장", 의학적 효과 같은 단정 표현 금지.
- 스레드 말투: 짧은 줄 여러 개, 첫 줄은 공감되는 상황 한 줄. 끝은 가벼운 질문으로 댓글을 유도한다.
- 본문은 280자 이내. 해시태그 쓰지 않는다. 링크·대가성 문구·"링크는 댓글에" 안내는 쓰지 않는다(시스템이 붙인다).
- 최근 글과 첫 문장 패턴이 겹치지 않게 쓴다.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pick', 'body', 'linkLabel'],
  properties: {
    pick: { type: 'integer', description: '고른 상품 번호(1부터)' },
    body: { type: 'string' },
    linkLabel: { type: 'string', description: '댓글 링크 앞에 붙일 짧은 상품 이름, 20자 이내' },
  },
};

export function composePost(body) {
  return `${DISCLOSURE}\n\n${body.trim()}\n\n👇 링크는 댓글에`;
}

export function composeReply(label, link) {
  return `🔗 ${label.trim()}\n${link}\n(쿠팡 파트너스 링크)`;
}

export async function writePost(keyword, products, { recent = [], note, persona, client = new Anthropic() } = {}) {
  const list = products.map((p, i) => ({
    index: i + 1, name: p.name, price: p.price, rocket: p.isRocket, freeShipping: p.isFreeShipping, category: p.category,
  }));
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: system(persona || DEFAULT_PERSONA),
    messages: [
      {
        role: 'user',
        content:
          `키워드: ${keyword}\n\n검색 결과:\n${JSON.stringify(list, null, 2)}` +
          (recent.length ? `\n\n최근 글 첫 줄들(겹치지 않게):\n${recent.map(r => `- ${r}`).join('\n')}` : '') +
          (note ? `\n\n지난 초안에서 고칠 점: ${note}` : ''),
      },
    ],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error(`글 생성이 거절되었습니다: ${response.stop_details?.explanation ?? '사유 없음'}`);
  }
  if (response.stop_reason === 'max_tokens') throw new Error('글이 길이 제한에 걸려 잘렸습니다.');
  const text = response.content.find(b => b.type === 'text')?.text;
  if (!text) throw new Error('모델 응답에 본문이 없습니다.');
  const draft = JSON.parse(text);
  const product = products[draft.pick - 1];
  if (!product) throw new Error(`모델이 없는 상품 번호를 골랐습니다: ${draft.pick}`);
  return { product, body: draft.body, linkLabel: draft.linkLabel };
}

export function templatePost(keyword, products) {
  const product = products[0];
  return {
    product,
    body: [`${keyword} 찾다가 눈에 띈 거`, product.name.slice(0, 40), product.isRocket ? '로켓배송 상품이고' : '', '이런 거 다들 어떤 기준으로 골라?']
      .filter(Boolean)
      .join('\n'),
    linkLabel: product.name.slice(0, 20),
  };
}

const kstDate = d => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

export function postedToday(history, now = new Date()) {
  const today = kstDate(now);
  return history.filter(h => h.postedAt && kstDate(h.postedAt) === today).length;
}

export async function runThreads({ search, keywords, history, post, dryRun, maxPerDay = 3, persona, write = writePost, log = console.log }) {
  if (!dryRun && postedToday(history) >= maxPerDay) {
    log(`오늘은 이미 ${maxPerDay}개를 올렸습니다. 건너뜁니다.`);
    return null;
  }

  const keyword = nextKeyword(keywords, history);
  const used = new Set(history.map(h => h.productId));
  const products = (await search(keyword)).filter(p => !used.has(p.id) && p.url);
  if (!products.length) throw new Error(`"${keyword}" 에서 새 상품이 없습니다. 키워드를 늘려 주세요.`);

  const recent = history.slice(-5).map(h => h.firstLine).filter(Boolean);
  const compose = d => ({ ...d, text: composePost(d.body) });

  // 점검에 걸리면 한 번 고쳐 쓰게 하고, 그래도 걸리면 올리지 않는다
  let draft = compose(dryRun ? templatePost(keyword, products) : await write(keyword, products, { recent, persona }));
  let issues = reviewPost(draft.text);
  if (issues.length && !dryRun) {
    draft = compose(await write(keyword, products, { recent, persona, note: issues.join(' / ') }));
    issues = reviewPost(draft.text);
  }
  if (issues.length) throw new Error(`글 점검을 통과하지 못해 올리지 않습니다:\n- ${issues.join('\n- ')}`);

  const replyText = composeReply(draft.linkLabel, draft.product.url);
  log(`\n----- 본문 (${keyword}) -----\n${draft.text}\n----- 첫 댓글 -----\n${replyText}\n`);

  const entry = {
    keyword,
    productId: draft.product.id,
    productName: draft.product.name,
    firstLine: draft.body.trim().split('\n')[0],
  };
  if (dryRun) return { ...entry, dryRun: true };

  const result = await post({ text: draft.text, imageUrl: draft.product.image, replyText, link: draft.product.url });
  log(`✔ 게시: ${result.permalink ?? result.postId}`);
  return { ...entry, ...result, postedAt: new Date().toISOString() };
}
