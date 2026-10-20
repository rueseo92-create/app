// 쌓인 영상을 하루 한 편씩 예약하는 주간 체크리스트.
// 맨 위 지시문을 Chrome의 Claude(또는 Aside)에 붙여 넣으면, 로그인된 내 브라우저에서
// 각 플랫폼의 공식 예약 게시 기능으로 등록한다. 마지막 확인은 사람이 한다.

const STUDIO = {
  youtube: 'YouTube Studio (studio.youtube.com) → 만들기 → 동영상 업로드 → 공개 상태 "예약"',
  instagram: 'Meta Business Suite (business.facebook.com) → 릴스 만들기 → "예약"',
  tiktok: 'TikTok Studio (tiktok.com/tiktokstudio/upload) → 게시 시간 "예약" (최대 10일 뒤까지)',
};

// 오늘(한국 시간) 다음 날부터 하루씩
export function scheduleDates(count, { from = new Date() } = {}) {
  const today = from.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const base = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(base + (i + 1) * 86400000).toISOString().slice(0, 10));
}

export function buildWeek(ready, { captions, videoPath, time = '19:00', platforms = ['youtube'], from } = {}) {
  const dates = scheduleDates(ready.length, { from });
  const where = platforms.map(p => `- ${STUDIO[p] ?? p}`).join('\n');

  const prompt = `아래 체크리스트의 영상 ${ready.length}편을 내 계정에 예약 게시해 줘.

어디에:
${where}

규칙:
- 각 플랫폼의 공식 "예약" 기능만 써. 지금 바로 공개로 올리지 마.
- 영상마다 체크리스트의 파일, 제목, 캡션을 그대로 넣고 날짜·시간(한국 시간)을 맞춰.
- 캡션 첫 줄의 대가성 문구는 절대 지우거나 줄이지 마.
- 마지막 "예약" 버튼을 누르기 전에 화면을 보여 주고 내 확인을 받아.
- 로그인, 보안 확인, 예상 못 한 경고가 나오면 우회하지 말고 멈춰서 나에게 물어봐.
- 다 끝나면 예약된 번호를 알려 줘.`;

  const sections = ready.map(
    (it, i) => `## ${it.slot}번 · ${dates[i]} ${time}

- 파일: \`${videoPath(it.slot)}\`
- [ ] 예약 완료

\`\`\`
${captions[it.slot].trim()}
\`\`\``,
  );

  return `# 이번 주 예약 (${dates[0]} ~ ${dates.at(-1)})

Chrome의 Claude에게 아래 지시문을 붙여 넣으세요. 끝나면 터미널에서 \`npm run shorts -- done ${ready
    .map(it => it.slot)
    .join(' ')}\`

\`\`\`
${prompt}
\`\`\`

${sections.join('\n\n')}
`;
}
