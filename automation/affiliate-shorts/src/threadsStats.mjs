// 게시물 성과 수집과 요약. 어떤 글 종류·첫 줄 유형이 먹히는지 보고, 잘 된 첫 줄은 다음 글 작성에 참고시킨다.
const DAY = 86400000;

// 게시 후 하루 이상 지난 글 중 maxAgeDays 안의 것만 다시 센다. 바뀐 게 있으면 true
export async function updateStats(history, fetchStats, { maxAgeDays = 7, now = Date.now(), log = console.warn } = {}) {
  let changed = false;
  for (const h of history) {
    const age = h.postedAt ? now - Date.parse(h.postedAt) : -1;
    if (!h.postId || age < DAY || age > maxAgeDays * DAY) continue;
    try {
      h.stats = { ...(await fetchStats(h.postId)), checkedAt: new Date(now).toISOString() };
      changed = true;
    } catch (err) {
      log(`성과 조회 실패(${h.postId}): ${err.message}`);
      break;
    }
  }
  return changed;
}

function average(rows, key) {
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r[key]) ?? [];
    g.push(r.stats.views ?? 0);
    groups.set(r[key], g);
  }
  return [...groups].map(([name, v]) => ({ name, count: v.length, avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }))
    .sort((a, b) => b.avg - a.avg);
}

export function statsReport(history) {
  const rows = history.filter(h => h.stats);
  if (!rows.length) return '아직 성과 데이터가 없습니다. 게시 후 하루가 지나면 쌓입니다.';
  const fmt = list => list.map(g => `  ${g.name}: 평균 조회 ${g.avg.toLocaleString('ko-KR')} (${g.count}개)`).join('\n');
  const top = [...rows].sort((a, b) => (b.stats.views ?? 0) - (a.stats.views ?? 0)).slice(0, 5);
  return [
    `성과 있는 글 ${rows.length}개`,
    '',
    '글 종류별',
    fmt(average(rows, 'type')),
    '',
    '첫 줄 유형별',
    fmt(average(rows, 'hookType')),
    '',
    '조회 상위 5',
    ...top.map(h => `  ${(h.stats.views ?? 0).toLocaleString('ko-KR')}회 · ${h.type} · ${h.firstLine}`),
  ].join('\n');
}
