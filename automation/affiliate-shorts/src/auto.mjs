// 사람 손 없이 하루 한 편 제작: 키워드 고르기 → 상품 검색 → 대본 → 음성 → 영상 → 캡션
// 게시는 하지 않는다. 쌓인 영상은 주 1회 각 플랫폼의 예약 게시 기능으로 올린다.
import fs from 'node:fs';
import path from 'node:path';
import { generateListPlan, templateListPlan } from './plan.mjs';
import { review } from './compliance.mjs';
import { synthesize, audioSeconds } from './tts.mjs';
import { renderScenes } from './render.mjs';

export function readKeywords(file) {
  if (!fs.existsSync(file)) throw new Error(`${file} 이 없습니다. 한 줄에 하나씩 키워드를 적어 두세요.`);
  const words = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
  if (!words.length) throw new Error(`${file} 에 키워드가 없습니다.`);
  return words;
}

// 가장 적게 쓴 키워드부터, 같으면 파일 순서대로
export function nextKeyword(keywords, items) {
  const used = new Map(keywords.map(k => [k, 0]));
  for (const it of items) if (used.has(it.keyword)) used.set(it.keyword, used.get(it.keyword) + 1);
  return keywords.reduce((best, k) => (used.get(k) < used.get(best) ? k : best), keywords[0]);
}

export function usedProductIds(items) {
  return new Set(items.flatMap(it => (it.products ?? []).map(p => p.id)));
}

async function download(url, file) {
  if (!/^https?:/.test(url)) return fs.copyFileSync(url, file), file;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`상품 이미지를 받을 수 없습니다 (${res.status}): ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

export async function runAuto({ search, outDir, items, keywordsFile, dryRun, font, env = process.env, log = console.log }) {
  const keyword = nextKeyword(readKeywords(keywordsFile), items);
  const used = usedProductIds(items);
  const products = (await search(keyword)).filter(p => !used.has(p.id));
  if (products.length < 3) throw new Error(`"${keyword}" 에서 새 상품이 3개 미만입니다. 키워드를 늘려 주세요.`);
  log(`키워드: ${keyword} (새 상품 ${products.length}개)`);

  const slot = items.reduce((n, it) => Math.max(n, it.slot), 0) + 1;

  // 점검에 걸리면 한 번 고쳐 쓰게 하고, 그래도 걸리면 게시하지 않는다
  let plan = dryRun ? templateListPlan(keyword, products, { slot }) : await generateListPlan(keyword, products, { slot });
  let issues = review(plan);
  if (issues.length && !dryRun) {
    plan = await generateListPlan(keyword, products, { slot, note: issues.join(' / ') });
    issues = review(plan);
  }
  if (issues.length) throw new Error(`표현 점검을 통과하지 못해 게시하지 않습니다:\n- ${issues.join('\n- ')}`);

  const dir = path.join(outDir, String(slot));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2));

  const images = new Map();
  for (const p of plan.picks.map(p => p.product)) {
    images.set(p.id, p.image ? await download(p.image, path.join(dir, `p${p.id}.jpg`)) : null);
  }

  const scenes = [];
  for (const [i, s] of plan.scenes.entries()) {
    const audio = await synthesize(s.narration, path.join(dir, `n${i}.mp3`), { env });
    const seconds = audio ? Math.max(2.5, audioSeconds(audio) + 0.35) : 3.5;
    const file = images.get(s.product.id);
    if (!file) throw new Error(`이미지가 없는 상품입니다: ${s.product.name}`);
    scenes.push({ file, seconds: Math.round(seconds * 100) / 100, caption: s.caption, audio });
  }
  const video = renderScenes(scenes, { outDir: dir, font });
  log(`영상: ${video}`);

  const item = {
    slot,
    keyword,
    title: plan.title,
    createdAt: new Date().toISOString(),
    products: plan.picks.map(p => ({ id: p.product.id, name: p.product.name, image: p.product.image, link: p.product.url })),
    status: 'ready',
  };
  return { item, plan };
}
