// 직접 찍은 클립·사진을 기획의 장면 순서대로 이어 1080x1920 세로 영상으로 만든다.
// 화면 상단의 "광고" 표시는 영상 처음부터 끝까지 고정으로 넣는다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const W = 1080;
const H = 1920;
const MEDIA = /\.(mp4|mov|m4v|jpg|jpeg|png|webp)$/i;
const IMAGE = /\.(jpg|jpeg|png|webp)$/i;

export function listMedia(dir) {
  return fs
    .readdirSync(dir)
    .filter(f => MEDIA.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(f => path.resolve(dir, f));
}

function assTime(sec) {
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const p = n => String(n).padStart(2, '0');
  return `${h}:${p(m)}:${p(s)}.${p(cs % 100)}`;
}

const assText = t => String(t).replace(/[{}]/g, '').replace(/\r?\n/g, '\\N');

export function buildAss(plan, { font = 'Apple SD Gothic Neo', label = '광고 · 쿠팡 파트너스' } = {}) {
  const total = plan.scenes.reduce((n, s) => n + s.seconds, 0);
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV',
    `Style: Caption,${font},84,&H00FFFFFF,&H00000000,&H64000000,1,1,6,0,2,80,80,420`,
    `Style: Label,${font},40,&H00FFFFFF,&H00000000,&H96000000,1,3,2,0,7,48,48,120`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 1,${assTime(0)},${assTime(total)},Label,,0,0,0,,${assText(label)}`,
  ];
  let t = 0;
  for (const s of plan.scenes) {
    lines.push(`Dialogue: 0,${assTime(t)},${assTime(t + s.seconds)},Caption,,0,0,0,,${assText(s.caption)}`);
    t += s.seconds;
  }
  return lines.join('\n') + '\n';
}

// 장면 수보다 소재가 적으면 처음부터 다시 돌려 쓴다
export function ffmpegArgs(plan, media) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const filters = [];
  plan.scenes.forEach((s, i) => {
    const file = media[i % media.length];
    if (IMAGE.test(file)) args.push('-loop', '1', '-t', String(s.seconds), '-i', file);
    else args.push('-stream_loop', '-1', '-t', String(s.seconds), '-i', file);
    filters.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p[v${i}]`,
    );
  });
  const chain = plan.scenes.map((_, i) => `[v${i}]`).join('');
  filters.push(`${chain}concat=n=${plan.scenes.length}:v=1:a=0[cat]`, '[cat]ass=subs.ass[out]');
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[out]', '-an',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart',
    'video.mp4',
  );
  return args;
}

export function render(plan, { mediaDir, outDir, font }) {
  const media = listMedia(mediaDir);
  if (media.length === 0) throw new Error(`${mediaDir} 에 영상이나 사진이 없습니다.`);
  fs.writeFileSync(path.join(outDir, 'subs.ass'), buildAss(plan, { font }));
  // ass 필터 경로 이스케이프를 피하려고 출력 폴더에서 실행한다
  const r = spawnSync('ffmpeg', ffmpegArgs(plan, media), { cwd: outDir, encoding: 'utf8' });
  if (r.error) throw new Error(`ffmpeg 를 실행할 수 없습니다: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg 실패:\n${r.stderr}`);
  return path.join(outDir, 'video.mp4');
}
