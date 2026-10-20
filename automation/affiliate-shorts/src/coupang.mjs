// 쿠팡 파트너스 오픈 API 클라이언트.
// 서명 방식(CEA HmacSHA256)은 파트너스 공식 샘플을 따른다. 첫 호출에서 응답 형태를 꼭 확인할 것.
import crypto from 'node:crypto';

const HOST = 'https://api-gateway.coupang.com';
const BASE = '/v2/providers/affiliate_open_api/apis/openapi/v1';

// 서명용 시각: UTC 기준 yyMMdd'T'HHmmss'Z'
export function signedDate(now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return (
    p(now.getUTCFullYear() % 100) + p(now.getUTCMonth() + 1) + p(now.getUTCDate()) + 'T' +
    p(now.getUTCHours()) + p(now.getUTCMinutes()) + p(now.getUTCSeconds()) + 'Z'
  );
}

// 서명 대상 문자열은 시각 + 메서드 + 경로 + 쿼리('?' 제외)
export function authorization({ method, path, query = '', accessKey, secretKey, now }) {
  const datetime = signedDate(now);
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(datetime + method + path + query)
    .digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

export function createCoupangClient({
  accessKey = process.env.COUPANG_ACCESS_KEY,
  secretKey = process.env.COUPANG_SECRET_KEY,
  subId = process.env.COUPANG_SUB_ID,
} = {}) {
  if (!accessKey || !secretKey) {
    throw new Error('COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 가 없습니다. .env 를 확인하세요.');
  }

  async function call(method, path, params, body) {
    const query = params ? new URLSearchParams(params).toString() : '';
    const res = await fetch(HOST + path + (query ? `?${query}` : ''), {
      method,
      headers: {
        Authorization: authorization({ method, path, query, accessKey, secretKey }),
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || String(json.rCode) !== '0') {
      throw new Error(`쿠팡 API 오류 (${res.status}): ${json?.rMessage ?? res.statusText}`);
    }
    return json.data;
  }

  return {
    // 검색 결과의 productUrl 은 이미 파트너스 추적 링크다
    async searchProducts(keyword, limit = 10) {
      const params = { keyword, limit: String(limit) };
      if (subId) params.subId = subId;
      const data = await call('GET', `${BASE}/products/search`, params);
      return (data?.productData ?? []).map(normalizeProduct);
    },

    // 쿠팡 상품 URL 을 파트너스 단축 링크로 바꾼다
    async deeplink(urls) {
      const body = { coupangUrls: urls };
      if (subId) body.subId = subId;
      const data = await call('POST', `${BASE}/deeplink`, null, body);
      return (data ?? []).map(d => ({ originalUrl: d.originalUrl, shortenUrl: d.shortenUrl }));
    },
  };
}

export function normalizeProduct(p) {
  return {
    id: String(p.productId),
    name: p.productName,
    price: p.productPrice,
    image: p.productImage,
    url: p.productUrl,
    category: p.categoryName ?? null,
    isRocket: Boolean(p.isRocket),
    isFreeShipping: Boolean(p.isFreeShipping),
  };
}
