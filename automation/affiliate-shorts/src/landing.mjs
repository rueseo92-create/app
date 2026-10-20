// 프로필 링크용 페이지. 쇼츠·릴스·틱톡 캡션의 링크는 눌리지 않으므로
// "프로필 링크 → N번" 으로 이 페이지에 모아 둔다.
const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 수동 make 로 만든 항목은 상품 하나짜리라 같은 모양으로 맞춘다
const productsOf = it => it.products ?? [{ name: it.name, image: it.image, link: it.link }];

export function buildLanding(items, { title = '영상 속 그 제품', disclosure }) {
  const sorted = [...items].sort((a, b) => b.slot - a.slot);
  const groups = sorted
    .map(it => {
      const products = productsOf(it);
      const rows = products
        .map(
          (p, i) => `
        <li>
          <a href="${esc(p.link)}" rel="sponsored noopener" target="_blank">
            <img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">
            <span class="name">${products.length > 1 ? `<b>${i + 1}</b> ` : ''}${esc(p.name)}</span>
          </a>
        </li>`,
        )
        .join('');
      return `
    <section id="n${it.slot}">
      <h2><span class="no">${it.slot}</span>${esc(it.title ?? it.keyword ?? '')}</h2>
      <ul>${rows}
      </ul>
    </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  :root { --bg:#faf7f2; --fg:#1d1b18; --muted:#6b645a; --card:#fff; --line:#e7e1d7; --accent:#c8752a; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141210; --fg:#f2eee8; --muted:#a39b90; --card:#1f1c19; --line:#2e2a25; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
  main { max-width:560px; margin:0 auto; padding:20px 16px 48px; }
  .notice { font-size:13px; color:var(--muted); background:var(--card); border:1px solid var(--line); border-radius:12px; padding:10px 12px; }
  h1 { font-size:22px; margin:20px 0 4px; }
  form { display:flex; gap:8px; margin:12px 0 20px; }
  input { flex:1; min-width:0; font:inherit; padding:12px; border-radius:12px; border:1px solid var(--line); background:var(--card); color:var(--fg); }
  button { font:inherit; padding:12px 16px; border-radius:12px; border:0; background:var(--accent); color:#fff; }
  section { margin:0 0 18px; scroll-margin-top:12px; }
  section:target h2 .no { background:var(--accent); color:#fff; }
  h2 { display:flex; align-items:center; gap:10px; font-size:16px; margin:0 0 8px; }
  .no { min-width:36px; height:36px; padding:0 8px; border-radius:18px; display:inline-grid; place-items:center; background:var(--card); border:1px solid var(--line); font-size:16px; }
  ul { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
  li a { display:grid; grid-template-columns:64px 1fr; align-items:center; gap:12px; padding:10px; background:var(--card); border:1px solid var(--line); border-radius:14px; color:inherit; text-decoration:none; }
  img { width:64px; height:64px; object-fit:cover; border-radius:10px; background:var(--line); }
  .name { font-size:15px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .name b { color:var(--accent); }
</style>
</head>
<body>
<main>
  <p class="notice">${esc(disclosure)}</p>
  <h1>${esc(title)}</h1>
  <form onsubmit="event.preventDefault(); location.hash = 'n' + this.q.value.trim();">
    <input name="q" inputmode="numeric" placeholder="영상에서 본 번호">
    <button>찾기</button>
  </form>${groups}
</main>
</body>
</html>
`;
}
