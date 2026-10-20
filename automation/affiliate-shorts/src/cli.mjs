#!/usr/bin/env node
// 쿠팡 파트너스 쇼츠 파이프라인
//   search  <키워드>                 상품 검색
//   make    <키워드> --pick N        상품 하나로 기획·캡션 패키지 만들기
//   render  <번호> --media <폴더>    직접 찍은 소재로 세로 영상 만들기
//   landing                          프로필 링크 페이지 만들기
//   list                             만든 패키지 목록
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createCoupangClient } from './coupang.mjs';
import { generatePlan, templatePlan } from './plan.mjs';
import { review, DISCLOSURE } from './compliance.mjs';
import { render } from './render.mjs';
import { buildLanding } from './landing.mjs';

const OUT = path.resolve('out');
const INDEX = path.join(OUT, 'index.json');

const MOCK_PRODUCT = {
  id: '0',
  name: '[예시] 접이식 실리콘 밀폐용기 4종 세트',
  price: 15900,
  image: '',
  url: 'https://www.coupang.com/',
  category: '주방용품',
  isRocket: true,
  isFreeShipping: true,
};

const { positionals, values: opt } = parseArgs({
  allowPositionals: true,
  options: {
    pick: { type: 'string', default: '1' },
    limit: { type: 'string', default: '10' },
    media: { type: 'string' },
    mock: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});
const [cmd, ...rest] = positionals;

const readIndex = () => (fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, 'utf8')) : []);
const writeIndex = items => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(INDEX, JSON.stringify(items, null, 2));
};
const won = n => `${Number(n).toLocaleString('ko-KR')}원`;

async function search(keyword) {
  if (opt.mock) return [MOCK_PRODUCT];
  return createCoupangClient().searchProducts(keyword, Number(opt.limit));
}

const commands = {
  async search() {
    const keyword = rest.join(' ');
    if (!keyword) throw new Error('키워드를 입력하세요. 예) shorts search 밀폐용기');
    const products = await search(keyword);
    products.forEach((p, i) =>
      console.log(`${String(i + 1).padStart(2)}. ${p.name}  ${won(p.price)}${p.isRocket ? '  🚀' : ''}`),
    );
  },

  async make() {
    const keyword = rest.join(' ');
    if (!keyword) throw new Error('키워드를 입력하세요. 예) shorts make 밀폐용기 --pick 2');
    const products = await search(keyword);
    const product = products[Number(opt.pick) - 1];
    if (!product) throw new Error(`${opt.pick}번 상품이 없습니다. search 로 먼저 확인하세요.`);

    const items = readIndex();
    const slot = items.reduce((n, it) => Math.max(n, it.slot), 0) + 1;
    const plan = opt['dry-run'] ? templatePlan(product, { slot }) : await generatePlan(product, { slot });
    const issues = review(plan);

    const dir = path.join(OUT, String(slot));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify(product, null, 2));
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2));
    fs.writeFileSync(path.join(dir, 'captions.txt'), captionsText(plan));
    fs.writeFileSync(path.join(dir, 'shotlist.txt'), shotlistText(product, plan, issues));

    items.push({ slot, keyword, name: product.name, image: product.image, link: product.url, status: 'planned' });
    writeIndex(items);

    console.log(`✔ ${slot}번 패키지: ${dir}`);
    console.log(`  촬영표 shotlist.txt · 캡션 captions.txt`);
    if (issues.length) console.log(`  ⚠ 확인 필요 ${issues.length}건 (shotlist.txt 맨 아래)`);
  },

  async render() {
    const slot = Number(rest[0]);
    if (!slot || !opt.media) throw new Error('예) shorts render 3 --media ~/Movies/밀폐용기');
    const dir = path.join(OUT, String(slot));
    const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
    const file = render(plan, { mediaDir: path.resolve(opt.media), outDir: dir, font: process.env.SUBTITLE_FONT });
    const items = readIndex();
    const it = items.find(i => i.slot === slot);
    if (it) it.status = 'rendered';
    writeIndex(items);
    console.log(`✔ 영상: ${file}`);
    console.log('  업로드 전에 앱에서 배경음악을 넣고, captions.txt 의 캡션을 그대로 붙여 넣으세요.');
  },

  async landing() {
    const items = readIndex();
    if (!items.length) throw new Error('아직 만든 패키지가 없습니다.');
    fs.mkdirSync('site', { recursive: true });
    fs.writeFileSync('site/index.html', buildLanding(items, { title: process.env.LANDING_TITLE, disclosure: DISCLOSURE }));
    console.log(`✔ site/index.html (${items.length}개 상품). 이 폴더를 배포하고 주소를 프로필 링크에 넣으세요.`);
  },

  async list() {
    for (const it of readIndex()) console.log(`${String(it.slot).padStart(3)}. [${it.status}] ${it.name}`);
  },
};

function captionsText(plan) {
  const { youtube, instagram, tiktok } = plan.platforms;
  return [
    '===== 유튜브 쇼츠 =====',
    `제목: ${youtube.title} #shorts`,
    '',
    youtube.caption,
    '',
    '===== 인스타그램 릴스 =====',
    instagram.caption,
    '',
    '===== 틱톡 =====',
    tiktok.caption,
    '',
  ].join('\n');
}

function shotlistText(product, plan, issues) {
  const lines = [
    `${plan.slot}번 · ${product.name} (${won(product.price)})`,
    `훅: ${plan.hook}`,
    `대상: ${plan.target}`,
    '',
    '촬영 컷',
  ];
  plan.scenes.forEach((s, i) => {
    lines.push(`${i + 1}. [${s.seconds}초] ${s.shot}`, `   자막: ${s.caption}`);
    if (s.narration) lines.push(`   말: ${s.narration}`);
  });
  lines.push('', '촬영 전에 직접 확인할 것', ...plan.checkpoints.map(c => `- ${c}`));
  if (issues.length) lines.push('', '⚠ 게시 전 확인', ...issues.map(i => `- ${i}`));
  return lines.join('\n') + '\n';
}

const run = commands[cmd];
if (!run) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 8).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(cmd ? 1 : 0);
}
run().catch(err => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
