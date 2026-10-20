// 상품 정보로 쇼츠 기획(촬영 컷, 자막, 채널별 캡션)을 만든다.
import Anthropic from '@anthropic-ai/sdk';
import { withDisclosure } from './compliance.mjs';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `당신은 한국 숏폼(유튜브 쇼츠·인스타 릴스·틱톡) 상품 리뷰 기획자입니다.
크리에이터가 실제 제품을 직접 써 보며 찍을 15~30초 영상의 촬영 기획을 만듭니다.

원칙:
- 상품 정보에 없는 효능, 순위, 가격 비교는 지어내지 않는다. 모르면 "직접 써 보고 확인할 점"으로 돌린다.
- "최저가", "무조건", "100%", 의학적 효과 같은 단정 표현을 쓰지 않는다.
- 첫 1.5초 훅은 시청자의 상황이나 불편을 짚는 한 문장으로 쓴다.
- 장면은 4~6개. 각 장면의 shot 에는 크리에이터가 휴대폰으로 실제로 찍을 수 있는 동작을 적는다.
- 화면 자막(caption)은 장면당 18자 이내, 말투는 친구에게 말하듯 자연스럽게.
- 채널별 캡션에는 대가성 문구를 넣지 않는다(시스템이 맨 앞에 자동으로 붙인다). 구매 링크 안내는 "프로필 링크"로만 한다.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hook', 'target', 'scenes', 'checkpoints', 'platforms', 'hashtags'],
  properties: {
    hook: { type: 'string' },
    target: { type: 'string', description: '이 영상이 겨냥하는 시청자' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['seconds', 'shot', 'caption', 'narration'],
        properties: {
          seconds: { type: 'integer' },
          shot: { type: 'string' },
          caption: { type: 'string' },
          narration: { type: 'string' },
        },
      },
    },
    checkpoints: {
      type: 'array',
      items: { type: 'string' },
      description: '촬영 전에 크리에이터가 직접 확인해야 할 사실',
    },
    platforms: {
      type: 'object',
      additionalProperties: false,
      required: ['youtube', 'instagram', 'tiktok'],
      properties: {
        youtube: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'caption'],
          properties: { title: { type: 'string' }, caption: { type: 'string' } },
        },
        instagram: {
          type: 'object',
          additionalProperties: false,
          required: ['caption'],
          properties: { caption: { type: 'string' } },
        },
        tiktok: {
          type: 'object',
          additionalProperties: false,
          required: ['caption'],
          properties: { caption: { type: 'string' } },
        },
      },
    },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
};

export async function generatePlan(product, { slot, client = new Anthropic() } = {}) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `다음 상품으로 숏폼 기획을 만들어 주세요.\n\n${JSON.stringify(
          { name: product.name, price: product.price, category: product.category, rocket: product.isRocket },
          null,
          2,
        )}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`기획 생성이 거절되었습니다: ${response.stop_details?.explanation ?? '사유 없음'}`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('기획이 길이 제한에 걸려 잘렸습니다. 다시 시도하세요.');
  }
  const text = response.content.find(b => b.type === 'text')?.text;
  if (!text) throw new Error('모델 응답에 본문이 없습니다.');
  return finalize(JSON.parse(text), { slot });
}

// 모델 없이 파이프라인을 시험할 때 쓰는 기본 기획
export function templatePlan(product, { slot } = {}) {
  return finalize(
    {
      hook: '이거 하나로 매일 하던 귀찮은 일이 줄었어요',
      target: '같은 불편을 겪는 사람',
      scenes: [
        { seconds: 3, shot: '제품 상자를 여는 손', caption: '요즘 쓰는 이거', narration: '' },
        { seconds: 5, shot: '실제로 사용하는 장면', caption: '써 보니 이게 편해요', narration: '' },
        { seconds: 5, shot: '아쉬운 점이 보이는 컷', caption: '아쉬운 점도 있어요', narration: '' },
        { seconds: 4, shot: '제품과 함께 마무리', caption: `프로필 링크 ${slot ?? ''}번`, narration: '' },
      ],
      checkpoints: ['실제 사용 시간과 소감을 직접 확인'],
      platforms: {
        youtube: { title: product.name.slice(0, 60), caption: product.name },
        instagram: { caption: product.name },
        tiktok: { caption: product.name },
      },
      hashtags: ['리뷰', '살림템'],
    },
    { slot },
  );
}

// 링크 안내와 대가성 문구는 코드가 붙인다
function finalize(plan, { slot }) {
  const linkLine = slot ? `🔗 프로필 링크에서 ${slot}번` : '🔗 프로필 링크에서 확인';
  const tags = plan.hashtags.map(t => (t.startsWith('#') ? t : `#${t}`)).join(' ');
  for (const p of Object.values(plan.platforms)) {
    p.caption = withDisclosure(`${p.caption.trim()}\n\n${linkLine}\n${tags}`);
  }
  plan.slot = slot ?? null;
  return plan;
}
