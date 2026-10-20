// 장면별 내레이션 음성. 클라우드에서는 Google Cloud TTS, 맥에서는 내장 say 를 쓴다.
// 어느 것도 없으면 무음으로 진행한다.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

export function pickProvider(env = process.env, platform = process.platform) {
  if (env.TTS_PROVIDER) return env.TTS_PROVIDER;
  if (env.GOOGLE_TTS_API_KEY) return 'google';
  if (platform === 'darwin') return 'mac';
  return 'none';
}

export function audioSeconds(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  });
  const sec = parseFloat(r.stdout);
  if (!Number.isFinite(sec)) throw new Error(`음성 길이를 읽을 수 없습니다: ${file}`);
  return sec;
}

// 성공하면 파일 경로, 무음이면 null
export async function synthesize(text, file, { provider = pickProvider(), env = process.env } = {}) {
  if (!text?.trim() || provider === 'none') return null;

  if (provider === 'google') {
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(env.GOOGLE_TTS_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'ko-KR', name: env.GOOGLE_TTS_VOICE || 'ko-KR-Neural2-A' },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1.12 },
        }),
      },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.audioContent) {
      throw new Error(`Google TTS 오류 (${res.status}): ${json?.error?.message ?? res.statusText}`);
    }
    fs.writeFileSync(file, Buffer.from(json.audioContent, 'base64'));
    return file;
  }

  if (provider === 'mac') {
    const aiff = file.replace(/\.\w+$/, '.aiff');
    const r = spawnSync('say', ['-v', env.MAC_TTS_VOICE || 'Yuna', '-r', '210', '-o', aiff, text]);
    if (r.status !== 0) throw new Error('say 실행 실패. 시스템 설정에서 한국어 음성(Yuna)을 내려받으세요.');
    return aiff;
  }

  throw new Error(`알 수 없는 TTS_PROVIDER: ${provider}`);
}
