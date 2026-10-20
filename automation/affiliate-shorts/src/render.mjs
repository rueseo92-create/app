// 장면(사진·클립 + 자막 + 내레이션)을 이어 1080x1920 세로 영상으로 만든다.
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

export function buildAss(scenes, { font = 'Apple SD Gothic Neo', label = '광고 · 쿠팡 파트너스' } = {}) {
  const total = scenes.reduce((n, s) => n + s.seconds, 0);
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
  for (const s of scenes) {
    lines.push(`Dialogue: 0,${assTime(t)},${assTime(t + s.seconds)},Caption,,0,0,0,,${assText(s.caption)}`);
    t += s.seconds;
  }
  return lines.join('\n') + '\n';
}

// scenes: [{ file, seconds, caption, audio? }]
// 사진은 흐린 배경 위에 가운데 배치하고, 클립은 화면을 꽉 채운다.
export function ffmpegArgs(scenes) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const filters = [];
  let input = 0;
  const pairs = [];

  scenes.forEach((s, i) => {
    const v = input++;
    if (IMAGE.test(s.file)) {
      args.push('-loop', '1', '-t', String(s.seconds), '-i', s.file);
      filters.push(
        `[${v}:v]split[bg${i}][fg${i}]`,
        `[bg${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:2,eq=brightness=-0.08[b${i}]`,
        `[fg${i}]scale=${W - 80}:-2[f${i}]`,
        `[b${i}][f${i}]overlay=(W-w)/2:(H-h)/2-120,setsar=1,fps=30,format=yuv420p[v${i}]`,
      );
    } else {
      args.push('-stream_loop', '-1', '-t', String(s.seconds), '-i', s.file);
      filters.push(
        `[${v}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p[v${i}]`,
      );
    }

    if (s.audio) {
      const a = input++;
      args.push('-i', s.audio);
      filters.push(`[${a}:a]aresample=44100,aformat=channel_layouts=stereo,apad,atrim=0:${s.seconds}[a${i}]`);
    } else {
      filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${s.seconds}[a${i}]`);
    }
    pairs.push(`[v${i}][a${i}]`);
  });

  filters.push(`${pairs.join('')}concat=n=${scenes.length}:v=1:a=1[cat][aout]`, '[cat]ass=subs.ass[out]');
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[out]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest',
    'video.mp4',
  );
  return args;
}

export function renderScenes(scenes, { outDir, font }) {
  fs.writeFileSync(path.join(outDir, 'subs.ass'), buildAss(scenes, { font }));
  // ass 필터 경로 이스케이프를 피하려고 출력 폴더에서 실행한다
  const r = spawnSync('ffmpeg', ffmpegArgs(scenes), { cwd: outDir, encoding: 'utf8' });
  if (r.error) throw new Error(`ffmpeg 를 실행할 수 없습니다: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg 실패:\n${r.stderr}`);
  return path.join(outDir, 'video.mp4');
}

// 직접 찍은 소재로 만드는 경우. 소재가 장면보다 적으면 돌려 쓴다.
export function render(plan, { mediaDir, outDir, font }) {
  const media = listMedia(mediaDir);
  if (media.length === 0) throw new Error(`${mediaDir} 에 영상이나 사진이 없습니다.`);
  const scenes = plan.scenes.map((s, i) => ({ file: media[i % media.length], seconds: s.seconds, caption: s.caption }));
  return renderScenes(scenes, { outDir, font });
}
