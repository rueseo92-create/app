// Threads 공식 API 클라이언트와 토큰 보관.
// 토큰은 60일짜리 장기 토큰을 .threads-token.json 에 두고, 7일마다 자동으로 갱신한다.
import fs from 'node:fs';
import path from 'node:path';

const HOST = process.env.THREADS_API_HOST || 'https://graph.threads.com';
const API = `${HOST}/v1.0`;
const TOKEN_FILE = path.resolve('.threads-token.json');
const REFRESH_AFTER_MS = 7 * 86400000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(method, url, params) {
  const body = params ? new URLSearchParams(params) : undefined;
  const res = await fetch(url, { method, body });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    throw new Error(`Threads API 오류 (${res.status}): ${json?.error?.message ?? res.statusText}`);
  }
  return json;
}

// ── 최초 연결: 브라우저에서 허용 → 주소창의 code 로 장기 토큰 발급 ──

export function authorizeUrl({ appId, redirectUri }) {
  const q = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: 'threads_basic,threads_content_publish,threads_manage_replies,threads_manage_insights',
    response_type: 'code',
  });
  return `https://threads.com/oauth/authorize?${q}`;
}

// 리다이렉트된 주소 전체를 붙여 넣어도, code 만 붙여 넣어도 된다
export function extractCode(input) {
  const raw = input.trim();
  const code = raw.includes('code=') ? new URL(raw).searchParams.get('code') : raw;
  return code.replace(/#_$/, '');
}

export async function login({ appId, appSecret, redirectUri, code }) {
  const short = await request('POST', `${HOST}/oauth/access_token`, {
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
  const q = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: appSecret, access_token: short.access_token });
  const long = await request('GET', `${HOST}/access_token?${q}`);
  const token = saveToken({ accessToken: long.access_token, userId: String(short.user_id), expiresIn: long.expires_in });
  return token;
}

function saveToken({ accessToken, userId, expiresIn }) {
  const token = {
    accessToken,
    userId,
    refreshedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), { mode: 0o600 });
  return token;
}

export function loadToken() {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error('Threads 연결이 안 되어 있습니다. `npm run shorts -- threads-login` 을 먼저 하세요.');
  return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
}

// 만료 전에 미리 갱신한다. 60일 안에 한 번도 실행되지 않으면 다시 로그인해야 한다.
export async function freshToken({ now = Date.now() } = {}) {
  const token = loadToken();
  if (Date.parse(token.expiresAt) <= now) {
    throw new Error('Threads 토큰이 만료되었습니다. `npm run shorts -- threads-login` 으로 다시 연결하세요.');
  }
  if (now - Date.parse(token.refreshedAt) < REFRESH_AFTER_MS) return token;
  const q = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: token.accessToken });
  const res = await request('GET', `${HOST}/refresh_access_token?${q}`);
  return saveToken({ accessToken: res.access_token, userId: token.userId, expiresIn: res.expires_in });
}

// ── 게시 ──

async function waitReady(containerId, accessToken, { tries = 10, interval = 6000 } = {}) {
  for (let i = 0; i < tries; i++) {
    await sleep(interval);
    const q = new URLSearchParams({ fields: 'status,error_message', access_token: accessToken });
    const s = await request('GET', `${API}/${containerId}?${q}`);
    if (s.status === 'FINISHED') return;
    if (s.status === 'ERROR' || s.status === 'EXPIRED') throw new Error(`컨테이너 처리 실패: ${s.error_message ?? s.status}`);
  }
  throw new Error('컨테이너 처리가 너무 오래 걸립니다.');
}

async function createAndPublish({ userId, accessToken }, params, { interval } = {}) {
  const container = await request('POST', `${API}/${userId}/threads`, { ...params, access_token: accessToken });
  await waitReady(container.id, accessToken, { interval });
  const post = await request('POST', `${API}/${userId}/threads_publish`, {
    creation_id: container.id,
    access_token: accessToken,
  });
  return post.id;
}

// 본문(+상품 사진)을 올리고, 링크가 있으면 첫 댓글에 단다.
// 사진 처리가 실패하면 글만 올린다.
export async function postWithLinkReply(token, { text, imageUrl, replyText, link }, { interval = 6000 } = {}) {
  const wait = { interval };
  let postId;
  if (imageUrl) {
    try {
      postId = await createAndPublish(token, { media_type: 'IMAGE', image_url: imageUrl, text }, wait);
    } catch (err) {
      console.warn(`사진 게시 실패, 글만 올립니다: ${err.message}`);
    }
  }
  postId ??= await createAndPublish(token, { media_type: 'TEXT', text }, wait);

  const replyId = replyText
    ? await createAndPublish(token, { media_type: 'TEXT', text: replyText, link_attachment: link, reply_to_id: postId }, wait)
    : null;

  const q = new URLSearchParams({ fields: 'permalink', access_token: token.accessToken });
  const { permalink } = await request('GET', `${API}/${postId}?${q}`).catch(() => ({}));
  return { postId, replyId, permalink: permalink ?? null };
}

// 게시물 성과 (threads_manage_insights 권한 필요)
const METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes'];

export async function fetchInsights(token, postId) {
  const q = new URLSearchParams({ metric: METRICS.join(','), access_token: token.accessToken });
  const res = await request('GET', `${API}/${postId}/insights?${q}`);
  const stats = {};
  for (const m of res.data ?? []) stats[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
  return stats;
}
