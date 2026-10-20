#!/usr/bin/env node
// 쿠팡 파트너스 쇼츠 파이프라인
//   search  <키워드>                 상품 검색
//   make    <키워드> --pick N        상품 하나로 기획·캡션 패키지 만들기
//   render  <번호> --media <폴더>    직접 찍은 소재로 세로 영상 만들기
//   landing                          프로필 링크 페이지 만들기
//   list                             만든 패키지 목록
//   auto                             하루 한 편 자동 제작 (키워드 → 상품 3개 → 대본 → 음성 → 영상)
//   week                             쌓인 영상의 주간 예약 체크리스트 만들기
//   done <번호...>                   예약 끝난 영상 표시
//   threads-login                    Threads 계정 연결 (처음 한 번)
//   threads                          스레드 글 하나 자동 작성·게시 (팁·질문·수익화 글 섞어서)
//   threads-stats                    스레드 성과 요약 (글 종류·첫 줄 유형별 조회수)
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { createCoupangClient } from './coupang.mjs';
import { generatePlan, templatePlan } from './plan.mjs';
import { review, DISCLOSURE } from './compliance.mjs';
import { render } from './render.mjs';
import { buildLanding } from './landing.mjs';
import { runAuto, readKeywords } from './auto.mjs';
import { buildWeek } from './week.mjs';
import { authorizeUrl, extractCode, login, freshToken, postWithLinkReply, fetchInsights } from './threads.mjs';
import { updateStats as refreshStats, statsReport } from './threadsStats.mjs';

const updateStats = (token, history, opts) => refreshStats(history, id => fetchInsights(token, id), opts);
import { runThreads } from './threadsPost.mjs';
import { createInterface } from 'node:readline/promises';

const OUT = path.resolve('out');
// 제작 이력은 저장소에 커밋해 다음 실행이 이어받는다
const INDEX = path.resolve('state/index.json');

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
  fs.mkdirSync(path.dirname(INDEX), { recursive: true });
  fs.writeFileSync(INDEX, JSON.stringify(items, null, 2) + '\n');
};
const won = n => `${Number(n).toLocaleString('ko-KR')}원`;

async function search(keyword) {
  if (opt.mock) return mockProducts(keyword);
  return createCoupangClient().searchProducts(keyword, Number(opt.limit));
}

// 키 없이 흐름을 시험할 때 쓰는 가짜 상품. 이미지는 ffmpeg 로 만든다
function mockProducts(keyword) {
  const dir = path.join(OUT, 'mock');
  fs.mkdirSync(dir, { recursive: true });
  const ids = readIndex().flatMap(it => (it.products ?? []).map(p => Number(p.id)));
  const base = Math.max(0, ...ids);
  return ['orange', 'teal', 'plum', 'gold'].map((color, i) => {
    const id = String(base + i + 1);
    const image = path.join(dir, `${id}.png`);
    if (!fs.existsSync(image)) {
      spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:size=800x800`, '-frames:v', '1', image]);
    }
    return { ...MOCK_PRODUCT, id, name: `[예시] ${keyword} ${i + 1}호`, price: 9900 + i * 5000, image };
  });
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
    console.log(`✔ site/index.html (${items.length}편). 이 폴더를 배포하고 주소를 프로필 링크에 넣으세요.`);
  },

  async auto() {
    const items = readIndex();
    const { item, plan } = await runAuto({
      search,
      outDir: OUT,
      items,
      keywordsFile: path.resolve('keywords.txt'),
      dryRun: opt['dry-run'],
      font: process.env.SUBTITLE_FONT,
    });
    fs.writeFileSync(path.join(OUT, String(item.slot), 'captions.txt'), captionsText(plan));
    items.push(item);
    writeIndex(items);
    await commands.landing();
    console.log(`✔ ${item.slot}번 영상 준비 완료. 주 1회 \`week\` 로 예약 목록을 만드세요.`);
  },

  async week() {
    const items = readIndex();
    const ready = items.filter(it => it.status === 'ready');
    if (!ready.length) return console.log('예약할 새 영상이 없습니다.');
    const captions = Object.fromEntries(
      ready.map(it => [it.slot, fs.readFileSync(path.join(OUT, String(it.slot), 'captions.txt'), 'utf8')]),
    );
    const md = buildWeek(ready, {
      captions,
      videoPath: slot => path.join(OUT, String(slot), 'video.mp4'),
      time: process.env.POST_TIME || '19:00',
      platforms: (process.env.POST_PLATFORMS || 'youtube').split(',').map(s => s.trim()),
    });
    fs.writeFileSync(path.join(OUT, 'week.md'), md);
    console.log(`✔ ${path.join(OUT, 'week.md')} (${ready.length}편). 맨 위 지시문을 Chrome의 Claude에게 붙여 넣으세요.`);
  },

  async done() {
    const slots = rest.map(Number).filter(Boolean);
    if (!slots.length) throw new Error('예) shorts done 3 4 5');
    const items = readIndex();
    for (const it of items) if (slots.includes(it.slot)) it.status = 'scheduled';
    writeIndex(items);
    console.log(`✔ 예약 완료로 표시: ${slots.join(', ')}`);
  },

  async 'threads-login'() {
    const appId = process.env.THREADS_APP_ID;
    const appSecret = process.env.THREADS_APP_SECRET;
    const redirectUri = process.env.THREADS_REDIRECT_URI || 'https://localhost/';
    if (!appId || !appSecret) throw new Error('.env 에 THREADS_APP_ID, THREADS_APP_SECRET 을 넣으세요.');
    console.log('1) 아래 주소를 브라우저에서 열고 "허용"을 누르세요.\n');
    console.log(authorizeUrl({ appId, redirectUri }));
    console.log('\n2) 이동한 페이지가 열리지 않아도 괜찮습니다. 주소창의 주소 전체를 복사하세요.');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const pasted = await rl.question('\n주소 붙여 넣기: ');
    rl.close();
    const token = await login({ appId, appSecret, redirectUri, code: extractCode(pasted) });
    console.log(`✔ 연결됨 (만료 ${token.expiresAt.slice(0, 10)}, 실행될 때마다 자동 갱신)`);
  },

  async threads() {
    const historyFile = path.resolve('state/threads.json');
    const history = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : [];
    const save = () => {
      fs.mkdirSync(path.dirname(historyFile), { recursive: true });
      fs.writeFileSync(historyFile, JSON.stringify(history, null, 2) + '\n');
    };
    const dryRun = opt['dry-run'];
    const token = dryRun ? null : await freshToken();
    // 반응 좋은 첫 줄을 다음 글에 참고시키려고 최근 글 성과를 먼저 갱신한다. 실패해도 게시는 계속한다.
    if (token && (await updateStats(token, history))) save();
    const entry = await runThreads({
      search,
      keywords: readKeywords(path.resolve('keywords.txt')),
      history,
      dryRun,
      maxPerDay: Number(process.env.THREADS_MAX_PER_DAY || 3),
      linkAfterDays: Number(process.env.THREADS_LINK_AFTER_DAYS || 7),
      persona: process.env.PERSONA,
      post: draft => postWithLinkReply(token, draft),
    });
    if (entry && !dryRun) {
      history.push(entry);
      save();
    }
  },

  async 'threads-stats'() {
    const historyFile = path.resolve('state/threads.json');
    const history = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : [];
    if (await updateStats(await freshToken(), history, { maxAgeDays: 30 })) {
      fs.writeFileSync(historyFile, JSON.stringify(history, null, 2) + '\n');
    }
    console.log(statsReport(history));
  },

  async list() {
    for (const it of readIndex()) {
      console.log(`${String(it.slot).padStart(3)}. [${it.status}] ${it.title ?? it.name}`);
    }
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
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(cmd ? 1 : 0);
}
run().catch(err => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
