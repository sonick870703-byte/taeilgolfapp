// 태일골프 홈페이지 + ERP 공통 업무 로직.
// 서버(Node)와 브라우저 미리보기(데모 모드)가 이 파일 하나를 함께 씁니다.
// store: { all(col), get(col,id), put(col,doc), del(col,id) } (모두 async)
// deps:  { hash(pw,salt), randomId(n), now() }  (+ 서버: httpFetch, 미리보기: demoFlights)
import { registerFlightRoutes } from './flights.js';

export const CATEGORIES = [
  { id: 'unlimited', name: '무제한 골프' },
  { id: 'month', name: '한 달 살기' },
  { id: 'trip', name: '골프여행' },
  { id: 'membership', name: '멤버십' },
];

export const INQUIRY_TYPES = ['골프여행', '무제한 골프', '한 달 살기', '단체 골프', '항공권', '호텔', '허니문', '가족여행', '기타'];
export const INQUIRY_STATUSES = ['새 문의', '상담 중', '견적 보냄', '예약 전환', '종료'];
// 전자결재 항목. 아직 정해지지 않아 (임시)로 둡니다.
export const APPROVAL_TYPES = ['환불 (임시)', '할인 (임시)', '지출 (임시)', '예약 변경 (임시)', '기타 (임시)'];
export const STATUSES = ['접수', '예약금 대기', '예약금 입금', '완납', '출발 완료', '취소'];

export const PRICE_MARKUP = 20000; // 고객 표시가 = 기준가 + 20,000원 (1인)
export const DEPOSIT_RATE = 0.2;   // 예약금 20%
export const REFUND_DAYS = 14;     // 출발 14일 전까지만 환불

export const DEFAULT_SETTINGS = {
  id: 'site',
  companyName: '태일 골프커뮤니케이션',
  companyNameEn: 'TAEIL GOLF COMMUNICATION',
  brand: '태일골프',
  tagline: '태국 골프 여행 · 한 달 살기',
  logo: 'assets/logo.jpg',
  colors: { primary: '#0f7a43', accent: '#f47e00' },
  heroBanners: [
    { img: '', title: '태국·말레이시아 골프, 태일골프가 함께합니다', sub: '무제한 골프 · 한 달 살기 · 골프여행 · 멤버십', link: '#/c/unlimited' },
  ],
  menus: CATEGORIES.map(c => ({ ...c, visible: true })),
  bizNo: '179-20-02544',
  ceo: '최원정',
  tel: '02-737-6658',
  tel2: '010-6801-9330',
  email: 'taeilgolf@naver.com',
  address: '서울시 종로구 삼봉로 81, 736호 (두산위브파빌리온)',
  hours: '평일 09:00 ~ 18:00',
  bank: { name: '국민은행', holder: '최원정(태일골프커뮤니케이션)', account: '023501-04-292548' },
  kakaoUrl: 'http://pf.kakao.com/_MzSxiX',
  sns: {
    instagram: 'https://www.instagram.com/taeilgolf/',
    youtube: 'https://www.youtube.com/@태일골프',
    band: 'https://band.us/@taeilgolf',
    tiktok: 'https://tiktok.com/@taeilgolf',
  },
  terms: {
    privacy: '',
    service: '',
    travel: '',
    cancel: '',
  },
  // 홈페이지 '프로그램 다운로드' (#/download). 큰 설치 파일은 GitHub에 두고 주소만 겁니다.
  downloads: [
    { name: '태일골프 골프 지구본 · PC (윈도우)', desc: '윈도우 10/11 PC에 설치합니다. 설치 후에는 새 버전이 나오면 자동으로 업데이트됩니다.', url: 'https://github.com/sonick870703-byte/taeilgolfapp/raw/main/installer/Taeilgolf_Setup_v1421.exe', kind: 'pc' },
    { name: '태일골프 골프 지구본 · 안드로이드 휴대폰', desc: '안드로이드 휴대폰에서 눌러 받은 뒤 설치합니다. 설치 후에는 앱이 스스로 새 내용을 받습니다.', url: 'https://github.com/sonick870703-byte/taeilgolfapp/raw/main/android/TaeilGolfGlobe-android.apk', kind: 'android' },
  ],
  domains: [],
  dnsTarget: { a: '', cname: '' },
};

// ---------- 날짜 계산 ----------
export function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
export function todayKST(now = Date.now()) {
  return new Date(now + 9 * 3600000).toISOString().slice(0, 10);
}

// ---------- 가격 ----------
export function displayPrice(p) {
  if (!p || !p.basePrice) return 0;
  return p.basePrice + PRICE_MARKUP;
}

// 예약 금액·기한 자동 계산
export function quote(product, { pax = 2, single = false, departDate }) {
  const unit = displayPrice(product);
  pax = Math.max(1, Math.min(20, Number(pax) || 1));
  // 2인 1실 기준. 1인 예약(혼자 방 사용)은 1인 추가요금, 한 달 살기는 2인 요금
  let total = unit * pax;
  // 혼자 방을 쓰는 인원: 1인 1실 선택 시 전원, 아니면 홀수 인원 1명
  const singles = single ? pax : pax % 2;
  const surcharge = unit ? (product.category === 'month' ? unit : (product.singleSupplement || 0)) * singles : 0;
  total += surcharge;
  const deposit = Math.round(total * DEPOSIT_RATE / 1000) * 1000;
  const r = { unit, pax, surcharge, total, deposit, balance: total - deposit };
  if (departDate) {
    r.balanceDue = addMonths(departDate, -1);
    r.refundDeadline = addDays(departDate, -REFUND_DAYS);
  }
  return r;
}

export function paidAmount(b) {
  return (b.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

// 결제 내역으로 상태 자동 결정 (취소·출발 완료는 수동 상태 유지)
export function autoStatus(b, today) {
  if (b.status === '취소') return '취소';
  if (b.departDate && today > (b.returnDate || b.departDate) && paidAmount(b) >= b.total && b.total > 0) return '출발 완료';
  if (b.status === '출발 완료') return '출발 완료';
  if (b.status === '접수' && !b.confirmed) return '접수';
  const paid = paidAmount(b);
  if (b.total > 0 && paid >= b.total) return '완납';
  if (paid >= b.deposit && b.deposit > 0) return '예약금 입금';
  return '예약금 대기';
}

// 예약별 자동 알림(해야 할 일)
export function bookingAlerts(b, today) {
  const out = [];
  if (b.status === '취소' || b.status === '출발 완료') return out;
  const paid = paidAmount(b);
  if (b.status === '접수') out.push({ level: 'new', text: '새 예약 접수 · 확인 후 예약 확정' });
  if (b.confirmed && paid < b.deposit) out.push({ level: 'warn', text: `예약금 ${won(b.deposit - paid)} 입금 대기` });
  if (b.balanceDue && paid < b.total && paid >= b.deposit) {
    const d = daysBetween(today, b.balanceDue);
    if (d < 0) out.push({ level: 'danger', text: `잔금 기한 ${-d}일 지남 (${won(b.total - paid)})` });
    else if (d <= 7) out.push({ level: 'warn', text: `잔금 기한 D-${d} (${won(b.total - paid)})` });
  }
  if (b.departDate) {
    const d = daysBetween(today, b.departDate);
    if (d >= 0 && d <= 7) out.push({ level: 'info', text: `출발 D-${d}` });
  }
  return out;
}

export function won(n) {
  return (Number(n) || 0).toLocaleString('ko-KR') + '원';
}

// ---------- 엑셀 양식 ----------
// 엑셀 첫 줄(제목 줄)의 이름. 띄어쓰기와 * 표시는 무시하고 맞춥니다.
export const EXCEL_COLUMNS = [
  ['code', '상품코드*', '같은 코드가 있으면 그 상품을 고칩니다'],
  ['title', '상품명*', ''],
  ['category', '분류*', '무제한 골프 / 한 달 살기 / 골프여행 / 멤버십'],
  ['country', '나라', ''],
  ['city', '도시', ''],
  ['nights', '박수', '숫자'],
  ['basePrice', '기준가(1인)', '숫자. 비우면 "요금 상담". 고객에게는 +20,000원으로 표시'],
  ['singleSupplement', '1인1실 추가요금', '숫자'],
  ['summary', '한줄소개', ''],
  ['includes', '포함', ''],
  ['excludes', '불포함', ''],
  ['body', '상세안내', ''],
  ['priceNote', '요금없을때 문구', '예: 요금은 상담 후 안내'],
  ['visible', '노출(Y/N)', '비우면 Y'],
  ['showFrom', '노출 시작일', '2026-11-01 형식'],
  ['showTo', '노출 종료일', '2027-03-31 형식'],
  ['order', '순서', '작을수록 앞'],
  ['images', '사진 주소', '공식 사진 주소. 여러 장은 쉼표로'],
];
const normHead = h => String(h || '').replace(/[\s*]/g, '').toLowerCase();
const HEAD_MAP = Object.fromEntries(EXCEL_COLUMNS.map(([k, h]) => [normHead(h), k]));
const CAT_BY_NAME = Object.fromEntries(CATEGORIES.flatMap(c => [[c.name.replace(/\s/g, ''), c.id], [c.id, c.id]]));

// 엑셀 한 줄 → 상품. { data, errors }
export function excelRowToProduct(row) {
  const r = {};
  for (const [h, v] of Object.entries(row || {})) { const k = HEAD_MAP[normHead(h)] || (EXCEL_COLUMNS.some(c => c[0] === h) ? h : null); if (k) r[k] = v; }
  const errors = [];
  const t = v => (v == null ? '' : String(v)).trim();
  const num = v => { const n = Number(t(v).replace(/[,원\s]/g, '')); return Number.isFinite(n) ? n : NaN; };
  const date = v => {
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
    const s = t(v).replace(/[./]/g, '-');
    if (!s) return '';
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) { errors.push(`날짜 형식 확인: ${t(v)}`); return ''; }
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  };
  const data = {
    code: t(r.code), title: t(r.title), country: t(r.country), city: t(r.city),
    summary: t(r.summary), includes: t(r.includes), excludes: t(r.excludes), body: t(r.body), priceNote: t(r.priceNote),
  };
  if (!data.code) errors.push('상품코드가 비어 있습니다');
  if (!data.title) errors.push('상품명이 비어 있습니다');
  const cat = CAT_BY_NAME[t(r.category).replace(/\s/g, '')];
  if (!cat) errors.push(`분류를 확인해 주세요 (${CATEGORIES.map(c => c.name).join(', ')})`);
  data.category = cat || 'trip';
  for (const k of ['nights', 'basePrice', 'singleSupplement', 'order']) {
    if (t(r[k]) === '') { data[k] = k === 'order' ? 99 : 0; continue; }
    const n = num(r[k]);
    if (Number.isNaN(n) || n < 0) errors.push(`${EXCEL_COLUMNS.find(c => c[0] === k)[1]}은(는) 숫자로 적어 주세요`);
    data[k] = Number.isNaN(n) ? 0 : n;
  }
  const vis = t(r.visible).toUpperCase();
  data.visible = !['N', 'NO', '아니오', 'X', '숨김'].includes(vis);
  data.showFrom = date(r.showFrom);
  data.showTo = date(r.showTo);
  data.images = t(r.images).split(/[,\n]/).map(x => x.trim()).filter(x => /^https:\/\//.test(x)).slice(0, 12).map(u => ({ lg: u, md: u, sm: u }));
  return { data, errors };
}

// 양식의 예시 줄(상품코드가 "예시"로 시작)은 올리지 않습니다
export const isExampleRow = d => /^예시/.test(d.code || '');

// ---------- API ----------
function err(status, message) { const e = new Error(message); e.status = status; return e; }
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
const str = (v, max = 2000) => (v == null ? '' : String(v)).slice(0, max).trim();

export function createApi(store, deps) {
  const now = () => deps.now();
  const today = () => todayKST(now());
  // 새 비밀번호는 deps.saltPrefix(서버마다 다른 암호화 강도 표시)를 붙인 salt로 저장합니다
  const newSalt = () => (deps.saltPrefix || '') + deps.randomId(16);

  async function settings() {
    const s = await store.get('settings', 'site');
    return { ...DEFAULT_SETTINGS, ...(s || {}) };
  }

  async function userFromToken(token) {
    if (!token) return null;
    const s = await store.get('sessions', token);
    if (!s || s.exp < now()) return null;
    const u = await store.get('users', s.userId);
    return u || null;
  }
  const publicUser = u => u && pick(u, ['id', 'email', 'name', 'phone', 'role', 'createdAt']);
  const isStaff = u => u && (u.role === 'admin' || u.role === 'staff');

  async function newSession(u) {
    const token = deps.randomId(32);
    await store.put('sessions', { id: token, userId: u.id, exp: now() + 30 * 86400000 });
    return token;
  }

  async function nextBookingNo() {
    const ymd = today().replace(/-/g, '');
    const all = await store.all('bookings');
    const n = all.filter(b => (b.no || '').startsWith('TG' + ymd)).length + 1;
    return 'TG' + ymd + '-' + String(n).padStart(3, '0');
  }

  function log(b, by, action) {
    b.history = b.history || [];
    b.history.push({ at: now(), by: by ? (by.name || by.email) : '고객', action });
  }

  function recompute(b, product) {
    const q = quote(product || { basePrice: b.basePrice, category: b.category, singleSupplement: b.singleSupplement }, b);
    if (!b.manualTotal) { b.unit = q.unit; b.surcharge = q.surcharge; b.total = q.total; b.deposit = q.deposit; }
    else { b.deposit = Math.round(b.total * DEPOSIT_RATE / 1000) * 1000; }
    if (b.departDate) { b.balanceDue = addMonths(b.departDate, -1); b.refundDeadline = addDays(b.departDate, -REFUND_DAYS); }
    if (b.departDate && b.nights) b.returnDate = addDays(b.departDate, Number(b.nights));
    b.status = autoStatus(b, today());
    return b;
  }

  const routes = [];
  const on = (method, pattern, fn, guard) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, fn, guard });
  };
  const STAFF = 'staff', MEMBER = 'member', ADMIN = 'admin';

  // ----- 공개 -----
  on('GET', '/api/health', async () => ({ ok: true }));
  on('GET', '/api/site', async () => {
    const s = await settings();
    const { domains, dnsTarget, ...pub } = s;
    pub.pages = (await store.all('pages')).filter(p => p.visible !== false && p.inMenu && p.id !== 'home')
      .sort((a, b) => (a.menuOrder || 99) - (b.menuOrder || 99)).map(p => ({ slug: p.slug, title: p.menuTitle || p.title }));
    return pub;
  });
  on('GET', '/api/pages/:slug', async ({ params }) => {
    const p = (await store.all('pages')).find(x => x.slug === params.slug && x.visible !== false);
    if (!p) throw err(404, '페이지를 찾을 수 없습니다.');
    return p;
  });
  on('GET', '/api/products', async ({ query }) => {
    const t = today();
    let list = (await store.all('products')).filter(p => p.visible !== false && (!p.showFrom || p.showFrom <= t) && (!p.showTo || p.showTo >= t));
    if (query.category) list = list.filter(p => p.category === query.category);
    return list.sort((a, b) => (a.order || 99) - (b.order || 99)).map(publicProduct);
  });
  on('GET', '/api/products/:id', async ({ params }) => {
    const p = await store.get('products', params.id);
    if (!p || p.visible === false) throw err(404, '상품을 찾을 수 없습니다.');
    return publicProduct(p);
  });
  on('GET', '/api/notices', async () => (await store.all('notices')).filter(n => n.visible !== false)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt - a.createdAt));
  on('POST', '/api/quote', async ({ body }) => {
    const p = await store.get('products', str(body.productId, 64));
    if (!p) throw err(404, '상품을 찾을 수 없습니다.');
    return quote(p, { pax: body.pax, single: !!body.single, departDate: str(body.departDate, 10) });
  });

  // ----- 견적 문의 (로그인 없이) -----
  on('POST', '/api/inquiries', async ({ body, token }) => {
    if (str(body.website)) return { ok: true }; // 자동 등록 막기용 숨은 칸
    const name = str(body.name, 40), phone = str(body.phone, 30);
    if (!name || !phone) throw err(400, '이름과 연락처를 입력해 주세요.');
    if (!body.agreePrivacy) throw err(400, '개인정보 수집·이용에 동의해 주세요.');
    const user = await userFromToken(token);
    const q = {
      id: 'q_' + deps.randomId(12), createdAt: now(), status: '새 문의',
      type: INQUIRY_TYPES.includes(body.type) ? body.type : '기타',
      name, phone, email: str(body.email, 120), memberId: user ? user.id : '',
      destination: str(body.destination, 80), departDate: /^\d{4}-\d{2}-\d{2}$/.test(body.departDate || '') ? body.departDate : '',
      nights: Math.max(0, Math.min(100, Number(body.nights) || 0)), pax: Math.max(0, Math.min(200, Number(body.pax) || 0)),
      budget: str(body.budget, 40), message: str(body.message, 2000), memo: '', history: [],
    };
    await store.put('inquiries', q);
    return { ok: true };
  });

  // ----- 오늘 방문자 (이름·IP 없이, 브라우저마다 만든 익명 표시로 하루 1번만 셈) -----
  on('POST', '/api/visit', async ({ body }) => {
    const v = str(body.v, 40);
    if (!/^[a-z0-9]{8,40}$/.test(v)) return { ok: true };
    const d = today();
    const doc = (await store.get('visits', d)) || { id: d, ids: [], views: 0 };
    doc.views++;
    if (!doc.ids.includes(v)) doc.ids.push(v);
    await store.put('visits', doc);
    return { ok: true };
  });

  // ----- 1:1 실시간 문의 -----
  const chatPublic = c => ({ id: c.id, name: c.name, messages: c.messages.map(m => ({ from: m.from, text: m.text, at: m.at })) });
  on('POST', '/api/chat', async ({ body, token }) => {
    const text = str(body.text, 1000);
    if (!text) throw err(400, '내용을 입력해 주세요.');
    let c = body.id ? await store.get('chats', str(body.id, 40)) : null;
    if (c && c.key !== str(body.key, 40)) c = null;
    if (!c) {
      if (!body.agreePrivacy) throw err(400, '개인정보 수집·이용에 동의해 주세요.');
      const user = await userFromToken(token);
      c = { id: 'c_' + deps.randomId(12), key: deps.randomId(24), createdAt: now(), name: str(body.name, 40) || (user && user.name) || '방문자',
        phone: str(body.phone, 30) || (user && user.phone) || '', memberId: user ? user.id : '', messages: [], unread: 0, closed: false };
    }
    c.messages.push({ from: 'guest', text, at: now() });
    c.messages = c.messages.slice(-200);
    c.unread = (c.unread || 0) + 1; c.updatedAt = now(); c.closed = false;
    await store.put('chats', c);
    return { id: c.id, key: c.key, chat: chatPublic(c) };
  });
  on('GET', '/api/chat/:id', async ({ params, query }) => {
    const c = await store.get('chats', params.id);
    if (!c || c.key !== str(query.key, 40)) throw err(404, '대화를 찾을 수 없습니다.');
    return chatPublic(c);
  });

  // ----- 회원 -----
  on('POST', '/api/signup', async ({ body }) => {
    const email = str(body.email, 120).toLowerCase();
    const pw = String(body.password || '');
    const name = str(body.name, 40);
    const phone = str(body.phone, 30);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err(400, '이메일 형식을 확인해 주세요.');
    if (pw.length < 8) throw err(400, '비밀번호는 8자 이상으로 정해 주세요.');
    if (!name) throw err(400, '이름을 입력해 주세요.');
    if (!body.agreeTerms || !body.agreePrivacy) throw err(400, '이용약관과 개인정보 수집·이용에 동의해 주세요.');
    const exists = (await store.all('users')).find(u => u.email === email);
    if (exists) throw err(409, '이미 가입된 이메일입니다. 로그인해 주세요.');
    const salt = newSalt();
    const u = { id: 'u_' + deps.randomId(12), email, name, phone, role: 'member', salt, hash: await deps.hash(pw, salt), createdAt: now(), marketing: !!body.marketing };
    await store.put('users', u);
    return { token: await newSession(u), user: publicUser(u) };
  });
  on('POST', '/api/login', async ({ body }) => {
    const email = str(body.email, 120).toLowerCase();
    const u = (await store.all('users')).find(x => x.email === email);
    const pw = String(body.password || '');
    if (!u || u.hash !== await deps.hash(pw, u.salt)) throw err(401, '이메일 또는 비밀번호가 맞지 않습니다.');
    // 다른 서버에서 옮겨 온 비밀번호는 이 서버 방식으로 다시 저장
    if (deps.saltPrefix && !u.salt.startsWith(deps.saltPrefix)) { u.salt = newSalt(); u.hash = await deps.hash(pw, u.salt); await store.put('users', u); }
    return { token: await newSession(u), user: publicUser(u) };
  });
  on('POST', '/api/logout', async ({ token }) => { if (token) await store.del('sessions', token); return { ok: true }; });
  on('GET', '/api/me', async ({ user }) => ({ user: publicUser(user) }));
  on('POST', '/api/me/password', async ({ body, user }) => {
    const u = await store.get('users', user.id);
    if (u.hash !== await deps.hash(String(body.current || ''), u.salt)) throw err(400, '지금 비밀번호가 맞지 않습니다.');
    const pw = String(body.next || '');
    if (pw.length < 8 || !/[0-9]/.test(pw) || !/[a-zA-Z]/.test(pw)) throw err(400, '새 비밀번호는 영문과 숫자를 섞어 8자 이상으로 정해 주세요.');
    u.salt = newSalt(); u.hash = await deps.hash(pw, u.salt);
    await store.put('users', u);
    return { ok: true };
  });

  on('POST', '/api/bookings', async ({ body, user }) => {
    const p = await store.get('products', str(body.productId, 64));
    if (!p) throw err(404, '상품을 찾을 수 없습니다.');
    const departDate = str(body.departDate, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(departDate)) throw err(400, '출발일을 선택해 주세요.');
    if (departDate < today()) throw err(400, '출발일은 오늘 이후로 선택해 주세요.');
    if (!body.agreeCancel) throw err(400, '예약·취소 규정에 동의해 주세요.');
    const name = str(body.name, 40) || user.name;
    const phone = str(body.phone, 30) || user.phone;
    if (!name || !phone) throw err(400, '예약자 이름과 연락처를 입력해 주세요.');
    const b = {
      id: 'b_' + deps.randomId(12), no: await nextBookingNo(), createdAt: now(),
      memberId: user.id, memberEmail: user.email,
      productId: p.id, productTitle: p.title, category: p.category, basePrice: p.basePrice || 0, singleSupplement: p.singleSupplement || 0,
      departDate, nights: Number(body.nights) || p.nights || 0, pax: Math.max(1, Math.min(20, Number(body.pax) || 2)), single: !!body.single,
      name, phone, kakaoId: str(body.kakaoId, 40), note: str(body.note, 1000), cancelPolicyAgreedAt: now(),
      status: '접수', confirmed: false, payments: [],
    };
    recompute(b, p);
    log(b, null, '예약 신청 접수');
    await store.put('bookings', b);
    return memberBooking(b);
  }, MEMBER);
  on('GET', '/api/my/bookings', async ({ user }) => (await store.all('bookings')).filter(b => b.memberId === user.id).sort((a, b) => b.createdAt - a.createdAt).map(memberBooking), MEMBER);
  on('POST', '/api/my/bookings/:id/cancel', async ({ params, user }) => {
    const b = await store.get('bookings', params.id);
    if (!b || b.memberId !== user.id) throw err(404, '예약을 찾을 수 없습니다.');
    if (b.status === '취소') return b;
    b.cancelRequested = true;
    log(b, user, today() <= b.refundDeadline ? '고객 취소 요청 (환불 가능 기간)' : '고객 취소 요청 (환불 기한 지남)');
    await store.put('bookings', b);
    return memberBooking(b);
  }, MEMBER);

  // ----- ERP (직원) -----
  on('POST', '/api/erp/bookings/:id/notified', async ({ params, body, user }) => {
    const b = await store.get('bookings', params.id);
    if (!b) throw err(404, '예약을 찾을 수 없습니다.');
    log(b, user, '카카오톡 안내문 복사: ' + str(body.kind, 30));
    await store.put('bookings', b);
    return { ok: true };
  }, STAFF);
  on('GET', '/api/erp/inquiries', async () => (await store.all('inquiries')).sort((a, b) => b.createdAt - a.createdAt), STAFF);
  on('PATCH', '/api/erp/inquiries/:id', async ({ params, body, user }) => {
    const q = await store.get('inquiries', params.id);
    if (!q) throw err(404, '문의를 찾을 수 없습니다.');
    if (body.status && INQUIRY_STATUSES.includes(body.status) && body.status !== q.status) { q.history.push({ at: now(), by: user.name || user.email, action: q.status + ' → ' + body.status }); q.status = body.status; }
    if (body.memo !== undefined) q.memo = str(body.memo, 2000);
    if (body.bookingId) q.bookingId = str(body.bookingId, 40);
    await store.put('inquiries', q);
    return q;
  }, STAFF);
  on('DELETE', '/api/erp/inquiries/:id', async ({ params }) => { await store.del('inquiries', params.id); return { ok: true }; }, ADMIN);

  on('GET', '/api/erp/chats', async () => (await store.all('chats')).map(({ key, ...c }) => c).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)), STAFF);
  on('POST', '/api/erp/chats/:id', async ({ params, body, user }) => {
    const c = await store.get('chats', params.id);
    if (!c) throw err(404, '대화를 찾을 수 없습니다.');
    if (body.read) c.unread = 0;
    if (body.close !== undefined) c.closed = !!body.close;
    const text = str(body.text, 1000);
    if (text) { c.messages.push({ from: 'staff', by: user.name || '태일골프', text, at: now() }); c.unread = 0; c.updatedAt = now(); }
    await store.put('chats', c);
    const { key, ...out } = c;
    return out;
  }, STAFF);
  // ----- 전자결재 -----
  on('GET', '/api/erp/approvals', async () => (await store.all('approvals')).sort((a, b) => b.createdAt - a.createdAt), STAFF);
  on('POST', '/api/erp/approvals', async ({ body, user }) => {
    const title = str(body.title, 120);
    if (!title) throw err(400, '제목을 입력해 주세요.');
    const all = await store.all('approvals');
    const a = { id: 'a_' + deps.randomId(10), no: 'AP' + today().replace(/-/g, '') + '-' + String(all.filter(x => x.createdAt && todayKST(x.createdAt) === today()).length + 1).padStart(2, '0'),
      createdAt: now(), type: APPROVAL_TYPES.includes(body.type) ? body.type : APPROVAL_TYPES[APPROVAL_TYPES.length - 1],
      title, amount: Math.max(0, Number(String(body.amount || '').replace(/[,원\s]/g, '')) || 0), bookingNo: str(body.bookingNo, 30), content: str(body.content, 3000),
      requesterId: user.id, requester: user.name || user.email, status: '대기', comment: '', history: [{ at: now(), by: user.name || user.email, action: '결재 요청' }] };
    await store.put('approvals', a);
    return a;
  }, STAFF);
  on('POST', '/api/erp/approvals/:id/decide', async ({ params, body, user }) => {
    const a = await store.get('approvals', params.id);
    if (!a) throw err(404, '결재 문서를 찾을 수 없습니다.');
    if (a.status !== '대기') throw err(400, '이미 처리된 결재입니다.');
    a.status = body.approve ? '승인' : '반려'; a.comment = str(body.comment, 1000); a.decidedBy = user.name || user.email; a.decidedAt = now();
    a.history.push({ at: now(), by: a.decidedBy, action: a.status + (a.comment ? ' · ' + a.comment : '') });
    await store.put('approvals', a);
    return a;
  }, ADMIN);
  on('POST', '/api/erp/approvals/:id/cancel', async ({ params, user }) => {
    const a = await store.get('approvals', params.id);
    if (!a || a.requesterId !== user.id || a.status !== '대기') throw err(400, '요청한 사람만, 처리되기 전에 취소할 수 있습니다.');
    a.status = '취소'; a.history.push({ at: now(), by: user.name || user.email, action: '요청 취소' });
    await store.put('approvals', a);
    return a;
  }, STAFF);

  on('GET', '/api/erp/counts', async ({ user }) => {
    const [bk, inq, chats, v, ap, fl] = await Promise.all([store.all('bookings'), store.all('inquiries'), store.all('chats'), store.get('visits', today()), store.all('approvals'), store.all('flightBookings')]);
    return { approvals: user.role === 'admin' ? ap.filter(a => a.status === '대기').length : 0, waiting: bk.filter(b => b.status === '접수').length, inquiries: inq.filter(q => q.status === '새 문의').length,
      chats: chats.filter(c => !c.closed && c.unread > 0).length, flights: fl.filter(b => ['견적 요청', '결제 완료', '확인 필요'].includes(b.status)).length, visitorsToday: v ? v.ids.length : 0, viewsToday: v ? v.views : 0 };
  }, STAFF);

  on('GET', '/api/erp/dashboard', async () => {
    const t = today();
    const all = await store.all('bookings');
    const live = all.filter(b => b.status !== '취소');
    const day = ms => todayKST(ms);
    const month = t.slice(0, 7);
    const alerts = [];
    for (const b of all) for (const a of bookingAlerts(b, t)) alerts.push({ ...a, bookingId: b.id, no: b.no, name: b.name, product: b.productTitle });
    for (const b of all) if (b.cancelRequested && b.status !== '취소') alerts.push({ level: 'danger', text: '고객 취소 요청', bookingId: b.id, no: b.no, name: b.name, product: b.productTitle });
    const [inq, chats, vToday] = await Promise.all([store.all('inquiries'), store.all('chats'), store.get('visits', t)]);
    const extra = { visitorsToday: vToday ? vToday.ids.length : 0, viewsToday: vToday ? vToday.views : 0,
      newInquiries: inq.filter(q => q.status === '새 문의').length, openChats: chats.filter(c => !c.closed && c.unread > 0).length };
    const visits7 = [];
    for (let i = 6; i >= 0; i--) { const d = addDays(t, -i); const v = await store.get('visits', d); visits7.push({ date: d, visitors: v ? v.ids.length : 0 }); }
    for (const q of inq.filter(q => q.status === '새 문의')) alerts.push({ level: 'new', text: `새 견적 문의 (${q.type})`, no: q.departDate || '날짜 미정', name: q.name, product: q.destination || q.type, inquiryId: q.id });
    for (const c of chats.filter(c => !c.closed && c.unread > 0)) alerts.push({ level: 'new', text: `1:1 문의 답장 필요 (${c.unread}개)`, no: '실시간 문의', name: c.name, product: (c.messages[c.messages.length - 1] || {}).text?.slice(0, 20) || '', chatId: c.id });
    const order = { danger: 0, new: 1, warn: 2, info: 3 };
    alerts.sort((a, b) => order[a.level] - order[b.level]);
    const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
    const monthly = {};
    for (const b of live) {
      const m = (b.departDate || '').slice(0, 7);
      if (!m) continue;
      monthly[m] = monthly[m] || { month: m, count: 0, pax: 0, sales: 0, paid: 0 };
      monthly[m].count++; monthly[m].pax += b.pax; monthly[m].sales += b.total; monthly[m].paid += paidAmount(b);
    }
    return {
      today: t,
      counts: {
        newToday: all.filter(b => day(b.createdAt) === t).length,
        changedToday: all.filter(b => (b.history || []).some(h => h.by !== '고객' && day(h.at) === t && /변경/.test(h.action))).length,
        cancelledToday: all.filter(b => b.status === '취소' && b.cancelledAt && day(b.cancelledAt) === t).length,
        waiting: all.filter(b => b.status === '접수').length,
        departingThisMonth: live.filter(b => (b.departDate || '').startsWith(month)).length,
        unpaid: sum(live.filter(b => b.confirmed), b => Math.max(0, b.total - paidAmount(b))),
        ...extra,
      },
      visits7,
      alerts: alerts.slice(0, 50),
      upcoming: live.filter(b => b.departDate >= t).sort((a, b) => a.departDate.localeCompare(b.departDate)).slice(0, 10),
      monthly: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
    };
  }, STAFF);

  // ----- 여행자 여권 정보 -----
  // 여권번호는 예약 문서에 넣지 않고 'passports' 에 암호화해 따로 둡니다. 예약에는 가린 번호만 남습니다.
  // 여행이 끝나고 90일(개인정보처리방침: 3개월 이내)이 지나면 여권번호와 생년월일을 지웁니다.
  const seal = deps.seal || (v => 'demo:' + v);
  const unseal = deps.unseal || (v => String(v).replace(/^demo:/, ''));
  const maskNo = n => (n.length > 4 ? n.slice(0, 2) + '*'.repeat(n.length - 4) + n.slice(-2) : '****');
  const PASSPORT_KEEP_DAYS = 90;
  async function purgePassports(list) {
    const t = today();
    for (const b of list) {
      const end = b.returnDate || b.departDate;
      if (!end || !(b.travelers || []).some(x => x.passportMasked) || addDays(end, PASSPORT_KEEP_DAYS) >= t) continue;
      for (const x of b.travelers) { await store.del('passports', x.id); x.passportMasked = ''; x.birth = ''; x.purgedAt = now(); }
      log(b, null, `여행 종료 ${PASSPORT_KEEP_DAYS}일 경과: 여권번호·생년월일 자동 파기`);
      await store.put('bookings', b);
    }
  }
  function travelerFields(body, old = {}) {
    const up = (v, n) => str(v, n).toUpperCase();
    const x = {
      ...old,
      surname: up(body.surname, 40).replace(/[^A-Z \-]/g, ''), given: up(body.given, 60).replace(/[^A-Z \-]/g, ''),
      sex: ['M', 'F'].includes(body.sex) ? body.sex : '', nationality: up(body.nationality, 3).replace(/[^A-Z]/g, ''),
      birth: str(body.birth, 10), passportExp: str(body.passportExp, 10), korName: str(body.korName, 20),
    };
    if (!x.surname || !x.given) throw err(400, '영문 성과 이름을 입력해 주세요.');
    for (const k of ['birth', 'passportExp']) if (x[k] && !/^\d{4}-\d{2}-\d{2}$/.test(x[k])) throw err(400, '날짜 형식을 확인해 주세요.');
    return x;
  }
  async function setPassportNo(x, body) {
    const no = str(body.passportNo, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!no) return false;
    if (no.length < 6) throw err(400, '여권번호를 확인해 주세요.');
    await store.put('passports', { id: x.id, enc: await seal(no) });
    x.passportMasked = maskNo(no); x.purgedAt = null;
    return true;
  }
  const findTraveler = async (params) => {
    const b = await store.get('bookings', params.id);
    if (!b) throw err(404, '예약을 찾을 수 없습니다.');
    const x = (b.travelers || []).find(t => t.id === params.tid);
    if (!x) throw err(404, '여행자를 찾을 수 없습니다.');
    return [b, x];
  };
  on('POST', '/api/erp/bookings/:id/travelers', async ({ params, body, user }) => {
    const b = await store.get('bookings', params.id);
    if (!b) throw err(404, '예약을 찾을 수 없습니다.');
    if (body.consent !== true) throw err(400, '고객에게 여권 정보 수집·이용 동의를 받았는지 확인해 주세요.');
    b.travelers = b.travelers || [];
    if (b.travelers.length >= 40) throw err(400, '여행자는 40명까지 등록할 수 있습니다.');
    const x = travelerFields(body, { id: 't_' + deps.randomId(10), consentAt: now(), consentBy: user.name || user.email, passportMasked: '' });
    await setPassportNo(x, body);
    b.travelers.push(x);
    log(b, user, `여행자 등록: ${x.surname} ${x.given}${body.fromScan ? ' (여권 사진 자동 인식)' : ''}`);
    await store.put('bookings', b);
    return b;
  }, STAFF);
  on('PATCH', '/api/erp/bookings/:id/travelers/:tid', async ({ params, body, user }) => {
    const [b, x] = await findTraveler(params);
    Object.assign(x, travelerFields(body, x));
    const noChanged = await setPassportNo(x, body);
    log(b, user, `여행자 수정: ${x.surname} ${x.given}${noChanged ? ' (여권번호 변경)' : ''}`);
    await store.put('bookings', b);
    return b;
  }, STAFF);
  on('DELETE', '/api/erp/bookings/:id/travelers/:tid', async ({ params, user }) => {
    const [b, x] = await findTraveler(params);
    b.travelers = b.travelers.filter(t => t.id !== x.id);
    await store.del('passports', x.id);
    log(b, user, `여행자 삭제: ${x.surname} ${x.given} (여권 정보 파기)`);
    await store.put('bookings', b);
    return b;
  }, STAFF);
  // 전체 여권번호 보기는 기록이 남습니다 (항공권 발권·현지 예약 등 꼭 필요할 때만)
  on('POST', '/api/erp/bookings/:id/travelers/:tid/reveal', async ({ params, user }) => {
    const [b, x] = await findTraveler(params);
    const p = await store.get('passports', x.id);
    if (!p) throw err(404, '저장된 여권번호가 없습니다.');
    log(b, user, `여권번호 열람: ${x.surname} ${x.given}`);
    await store.put('bookings', b);
    return { passportNo: await unseal(p.enc) };
  }, STAFF);

  on('GET', '/api/erp/bookings', async ({ query }) => {
    let list = await store.all('bookings');
    await purgePassports(list);
    if (query.status) list = list.filter(b => b.status === query.status);
    if (query.month) list = list.filter(b => (b.departDate || '').startsWith(query.month));
    if (query.q) { const q = query.q.toLowerCase(); list = list.filter(b => [b.no, b.name, b.phone, b.productTitle, b.memberEmail].join(' ').toLowerCase().includes(q)); }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, STAFF);
  on('GET', '/api/erp/bookings/:id', async ({ params }) => {
    const b = await store.get('bookings', params.id);
    if (!b) throw err(404, '예약을 찾을 수 없습니다.');
    return b;
  }, STAFF);
  on('POST', '/api/erp/bookings', async ({ body, user }) => {
    // 전화·카톡으로 받은 예약을 직원이 직접 등록
    const p = await store.get('products', str(body.productId, 64));
    if (!p) throw err(404, '상품을 선택해 주세요.');
    const b = {
      id: 'b_' + deps.randomId(12), no: await nextBookingNo(), createdAt: now(), memberId: '', memberEmail: '',
      productId: p.id, productTitle: p.title, category: p.category, basePrice: p.basePrice || 0, singleSupplement: p.singleSupplement || 0,
      departDate: str(body.departDate, 10), nights: Number(body.nights) || p.nights || 0, pax: Math.max(1, Number(body.pax) || 2), single: !!body.single,
      name: str(body.name, 40), phone: str(body.phone, 30), kakaoId: str(body.kakaoId, 40), note: str(body.note, 1000),
      status: '예약금 대기', confirmed: true, payments: [],
    };
    if (!b.name || !/^\d{4}-\d{2}-\d{2}$/.test(b.departDate)) throw err(400, '예약자 이름과 출발일을 입력해 주세요.');
    recompute(b, p);
    log(b, user, '직원이 예약 등록 (전화·카톡)');
    await store.put('bookings', b);
    return b;
  }, STAFF);
  on('PATCH', '/api/erp/bookings/:id', async ({ params, body, user }) => {
    const b = await store.get('bookings', params.id);
    if (!b) throw err(404, '예약을 찾을 수 없습니다.');
    const changes = [];
    for (const k of ['departDate', 'nights', 'pax', 'single', 'name', 'phone', 'kakaoId', 'note', 'staffMemo', 'flight', 'hotel']) {
      if (body[k] !== undefined && body[k] !== b[k]) { b[k] = typeof b[k] === 'number' ? Number(body[k]) : body[k]; changes.push(k); }
    }
    if (body.total !== undefined && Number(body.total) !== b.total) { b.total = Number(body.total); b.manualTotal = true; changes.push('금액'); }
    if (body.action === 'confirm') { b.confirmed = true; log(b, user, '예약 확정 · 예약금 안내'); }
    if (body.action === 'cancel') { b.status = '취소'; b.cancelledAt = now(); b.cancelRequested = false; log(b, user, '예약 취소' + (today() <= b.refundDeadline ? ' (환불 가능 기간)' : ' (환불 기한 지남)')); }
    if (body.action === 'restore') { b.status = '예약금 대기'; b.confirmed = true; b.cancelledAt = null; log(b, user, '취소 철회'); }
    if (body.action === 'done') { b.status = '출발 완료'; log(b, user, '출발 완료 처리'); }
    if (changes.length) log(b, user, '예약 변경: ' + changes.join(', '));
    const p = await store.get('products', b.productId);
    if (b.status !== '취소' && b.status !== '출발 완료') recompute(b, p ? { ...p, basePrice: b.basePrice } : null);
    await store.put('bookings', b);
    return b;
  }, STAFF);
  on('POST', '/api/erp/bookings/:id/payments', async ({ params, body, user }) => {
    const b = await store.get('bookings', params.id);
    if (!b) throw err(404, '예약을 찾을 수 없습니다.');
    const amount = Math.round(Number(body.amount) || 0);
    if (!amount) throw err(400, '입금액을 입력해 주세요.');
    b.payments = b.payments || [];
    b.payments.push({ id: deps.randomId(8), amount, date: str(body.date, 10) || today(), method: str(body.method, 20) || '계좌이체', memo: str(body.memo, 200), by: user.name || user.email });
    b.confirmed = true;
    log(b, user, `입금 등록 ${won(amount)}`);
    if (b.status !== '취소') b.status = autoStatus(b, today());
    await store.put('bookings', b);
    return b;
  }, STAFF);
  on('DELETE', '/api/erp/bookings/:id/payments/:pid', async ({ params, user }) => {
    const b = await store.get('bookings', params.id);
    if (!b) throw err(404, '예약을 찾을 수 없습니다.');
    const p = (b.payments || []).find(x => x.id === params.pid);
    b.payments = (b.payments || []).filter(x => x.id !== params.pid);
    if (p) log(b, user, `입금 삭제 ${won(p.amount)}`);
    if (b.status !== '취소') b.status = autoStatus(b, today());
    await store.put('bookings', b);
    return b;
  }, STAFF);

  on('GET', '/api/erp/products', async () => (await store.all('products')).sort((a, b) => (a.order || 99) - (b.order || 99)), STAFF);
  function buildProduct(id, body, old) {
    return {
      ...old,
      id,
      code: str(body.code, 30), title: str(body.title, 120), category: CATEGORIES.some(c => c.id === body.category) ? body.category : 'trip',
      country: str(body.country, 40), city: str(body.city, 40), summary: str(body.summary, 300), body: str(body.body, 20000),
      basePrice: Math.max(0, Math.round(Number(body.basePrice) || 0)), singleSupplement: Math.max(0, Math.round(Number(body.singleSupplement) || 0)),
      nights: Math.max(0, Number(body.nights) || 0), priceNote: str(body.priceNote, 200),
      includes: str(body.includes, 2000), excludes: str(body.excludes, 2000),
      images: Array.isArray(body.images) ? body.images.slice(0, 12) : (old.images || []),
      visible: body.visible !== false, order: Number(body.order) || 99,
      showFrom: str(body.showFrom, 10), showTo: str(body.showTo, 10), updatedAt: now(),
    };
  }
  on('PUT', '/api/erp/products/:id', async ({ params, body }) => {
    const old = (await store.get('products', params.id)) || {};
    const p = buildProduct(params.id === 'new' ? 'p_' + deps.randomId(10) : params.id, body, old);
    if (!p.title) throw err(400, '상품명을 입력해 주세요.');
    await store.put('products', p);
    return p;
  }, STAFF);
  // 엑셀 일괄 등록: 상품코드가 같으면 수정, 없으면 새로 등록
  on('POST', '/api/erp/products/import', async ({ body }) => {
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
    const all = await store.all('products');
    let created = 0, updated = 0;
    const errors = [];
    let skipped = 0;
    for (const [i, raw] of rows.entries()) {
      const { data, errors: e } = excelRowToProduct(raw);
      if (isExampleRow(data)) { skipped++; continue; }
      if (e.length) { errors.push({ row: i + 2, errors: e }); continue; }
      const old = all.find(p => p.code && p.code === data.code);
      if (old && !data.images.length) delete data.images; // 사진 칸이 비면 기존 사진 유지
      const p = buildProduct(old ? old.id : 'p_' + deps.randomId(10), data, old || {});
      await store.put('products', p);
      if (old) updated++; else { created++; all.push(p); }
    }
    return { created, updated, skipped, errors };
  }, STAFF);
  on('DELETE', '/api/erp/products/:id', async ({ params }) => { await store.del('products', params.id); return { ok: true }; }, ADMIN);

  on('GET', '/api/erp/pages', async () => (await store.all('pages')).sort((a, b) => (a.id === 'home' ? -1 : b.id === 'home' ? 1 : (a.menuOrder || 99) - (b.menuOrder || 99))), STAFF);
  on('PUT', '/api/erp/pages/:id', async ({ params, body }) => {
    const old = (await store.get('pages', params.id)) || {};
    const id = params.id === 'new' ? 'pg_' + deps.randomId(8) : params.id;
    let slug = id === 'home' ? 'home' : str(body.slug, 40).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || id.replace('pg_', 'p-');
    const others = (await store.all('pages')).filter(p => p.id !== id);
    if (slug === 'home' && id !== 'home') slug += '-1';
    while (others.some(p => p.slug === slug)) slug += '-1';
    const blocks = Array.isArray(body.blocks) ? body.blocks.slice(0, 60).map(b => {
      const o = {};
      for (const [k, v] of Object.entries(b || {})) {
        if (k === 'img') o.img = v && typeof v === 'object' ? pick(v, ['lg', 'md', 'sm']) : (typeof v === 'string' ? v.slice(0, 3000000) : null);
        else if (typeof v === 'string') o[k] = v.slice(0, 20000);
        else if (typeof v === 'number' || typeof v === 'boolean') o[k] = v;
      }
      return o;
    }) : (old.blocks || []);
    const p = { ...old, id, slug, title: str(body.title, 80) || '새 페이지', menuTitle: str(body.menuTitle, 20), inMenu: id !== 'home' && !!body.inMenu, menuOrder: Number(body.menuOrder) || 99, visible: id === 'home' ? true : body.visible !== false, blocks, updatedAt: now() };
    await store.put('pages', p);
    return p;
  }, STAFF);
  on('DELETE', '/api/erp/pages/:id', async ({ params }) => {
    if (params.id === 'home') throw err(400, '메인 화면은 지울 수 없습니다.');
    await store.del('pages', params.id); return { ok: true };
  }, STAFF);

  on('GET', '/api/erp/notices', async () => (await store.all('notices')).sort((a, b) => b.createdAt - a.createdAt), STAFF);
  on('PUT', '/api/erp/notices/:id', async ({ params, body, user }) => {
    const old = (await store.get('notices', params.id)) || {};
    const n = { ...old, id: params.id === 'new' ? 'n_' + deps.randomId(10) : params.id, title: str(body.title, 200), body: str(body.body, 20000), pinned: !!body.pinned, visible: body.visible !== false, createdAt: old.createdAt || now(), author: old.author || user.name };
    if (!n.title) throw err(400, '제목을 입력해 주세요.');
    await store.put('notices', n);
    return n;
  }, STAFF);
  on('DELETE', '/api/erp/notices/:id', async ({ params }) => { await store.del('notices', params.id); return { ok: true }; }, STAFF);

  on('GET', '/api/erp/members', async () => (await store.all('users')).map(publicUser).sort((a, b) => b.createdAt - a.createdAt), STAFF);
  on('PATCH', '/api/erp/members/:id', async ({ params, body, user }) => {
    const u = await store.get('users', params.id);
    if (!u) throw err(404, '회원을 찾을 수 없습니다.');
    if (body.role && ['member', 'staff', 'admin'].includes(body.role)) {
      if (u.id === user.id && body.role !== 'admin') throw err(400, '본인의 관리자 권한은 해제할 수 없습니다.');
      u.role = body.role;
    }
    await store.put('users', u);
    return publicUser(u);
  }, ADMIN);

  on('GET', '/api/erp/settings', async () => settings(), STAFF);
  on('PUT', '/api/erp/settings', async ({ body }) => {
    const cur = await settings();
    const allowed = ['companyName', 'companyNameEn', 'brand', 'tagline', 'logo', 'colors', 'heroBanners', 'menus', 'bizNo', 'ceo', 'tel', 'tel2', 'email', 'address', 'hours', 'bank', 'kakaoUrl', 'sns', 'terms', 'domains', 'dnsTarget', 'travelRegNo', 'mailOrderNo', 'downloads'];
    const next = { ...cur, ...pick(body, allowed), id: 'site' };
    await store.put('settings', next);
    return next;
  }, ADMIN);

  // 사진 업로드: 브라우저가 이미 크기별로 줄인 이미지를 보냄
  on('POST', '/api/erp/upload', async ({ body }) => {
    if (!deps.saveImage) return { urls: body.files };
    const urls = {};
    for (const [size, dataUrl] of Object.entries(body.files || {})) urls[size] = await deps.saveImage(dataUrl, size);
    return { urls };
  }, STAFF);

  // 고객에게는 기준가·직원 메모·처리 기록을 보여주지 않음
  function memberBooking(b) {
    const { basePrice, singleSupplement, staffMemo, history, manualTotal, travelers, ...rest } = b;
    return { ...rest, payments: (b.payments || []).map(p => pick(p, ['amount', 'date', 'method'])) };
  }

  function publicProduct(p) {
    const { basePrice, ...rest } = p;
    return { ...rest, price: displayPrice(p) };
  }

  async function handle({ method, path, query = {}, body = {}, token }) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const user = await userFromToken(token);
      if (r.guard === MEMBER && !user) throw err(401, '로그인이 필요합니다.');
      if (r.guard === STAFF && !isStaff(user)) throw err(user ? 403 : 401, '직원 계정으로 로그인해 주세요.');
      if (r.guard === ADMIN && (!user || user.role !== 'admin')) throw err(403, '관리자만 할 수 있습니다.');
      return r.fn({ params, query, body: body || {}, user, token });
    }
    throw err(404, '없는 주소입니다.');
  }

  registerFlightRoutes({ on, store, deps, now, today, err, str, settings, roles: { STAFF, MEMBER, ADMIN } });

  return { handle };
}

// ---------- 처음 실행할 때 넣는 기본 데이터 ----------
export async function seed(store, deps, { adminEmail, adminPassword, demo }) {
  if (!(await store.get('settings', 'site'))) await store.put('settings', { ...DEFAULT_SETTINGS });
  const users = await store.all('users');
  if (adminEmail && !users.some(u => u.email === adminEmail.toLowerCase())) {
    const salt = (deps.saltPrefix || '') + deps.randomId(16);
    await store.put('users', { id: 'u_' + deps.randomId(12), email: adminEmail.toLowerCase(), name: '관리자', phone: '', role: 'admin', salt, hash: await deps.hash(adminPassword, salt), createdAt: deps.now() });
  }
  if (!(await store.get('pages', 'home'))) {
    await store.put('pages', { id: 'home', slug: 'home', title: '메인 화면', visible: true, inMenu: false, updatedAt: deps.now(), blocks: [
      { type: 'hero' }, { type: 'categories' },
      { type: 'products', title: '지금 예약할 수 있는 상품', category: '', limit: 12 },
      { type: 'notices', title: '공지사항', limit: 5 },
      { type: 'contact', title: '어떤 여행이 맞을지 고민되시나요?' },
    ] });
  }
  if ((await store.all('products')).length) return;
  const P = (id, o) => store.put('products', { id, visible: true, images: [], includes: '', excludes: '', body: '', ...o });
  const golfIncl = '그린피, 숙박(2인 1실), 호텔↔골프장 왕복 이동';
  const golfExcl = '항공권, 여행자보험, 캐디피·카트비·캐디팁(현지 지불)';
  await P('p_pattaya_sunrise', { code: 'THPT-1', order: 1, category: 'unlimited', title: '태국 파타야 차층사오 썬라이즈 & 스카이밸리 1박 골프', country: '태국', city: '파타야', nights: 1, basePrice: 0, summary: '11월 1일부터 예약 가능', includes: golfIncl, excludes: golfExcl, priceNote: '요금은 상담 후 안내' });
  await P('p_udon_royalcreek', { code: 'THUD-1', order: 2, category: 'unlimited', title: '태국 우돈타니 로얄크릭 CC 1박 골프', country: '태국', city: '우돈타니', nights: 1, basePrice: 0, includes: golfIncl, excludes: golfExcl, priceNote: '요금은 상담 후 안내' });
  await P('p_korat_luxkorat', { code: 'THKR-1', order: 3, category: 'unlimited', title: '태국 코랏 룩스코랏 CC 1박 골프', country: '태국', city: '코랏', nights: 1, basePrice: 0, includes: golfIncl, excludes: golfExcl, priceNote: '요금은 상담 후 안내' });
  await P('p_kk_month', { code: 'OMYS10-1', order: 4, category: 'month', title: '시니어 한 달 살기 · 코타키나발루 시티뷰 워터프론트 레지던스', country: '말레이시아', city: '코타키나발루', nights: 30, basePrice: 1770000, summary: '2인 1실 기준 1인 요금 · 1인 예약 시 2인 요금', includes: '숙박 30박(2인 1실)', excludes: '항공권, 여행자보험, 개인 경비' });
  await P('p_pattaya_month', { code: 'OTHA10-4', order: 5, category: 'month', title: '시니어 한 달 살기 · 파타야 잔드 모라다', country: '태국', city: '파타야', nights: 30, basePrice: 0, summary: '2인 1실 기준 1인 요금 · 1인 예약 시 2인 요금', includes: '숙박 30박(2인 1실)', excludes: '항공권, 여행자보험, 개인 경비', priceNote: '요금은 상담 후 안내' });
  await P('p_royalcreek_member', { code: 'MEM-RC', order: 6, category: 'membership', title: '우돈타니 로얄크릭 창립회원 선불권', country: '태국', city: '우돈타니', nights: 0, basePrice: 2970000, summary: '가입금 299만원으로 3년간 100일 골프', includes: '3년간 100일 라운드', excludes: '항공권, 숙박, 캐디피·카트비·캐디팁' });
  await store.put('notices', { id: 'n_1', title: '[필독] 태일골프 예약 · 결제 · 환불 안내', pinned: true, visible: true, createdAt: deps.now(), author: '관리자',
    body: '■ 요금 기준\n· 1박 골프 상품은 2인 1실 기준 1인 요금입니다.\n· 1인 예약(1인 1실 사용) 시 추가 요금이 있습니다.\n· 항공권과 여행자보험은 모든 상품에 포함되어 있지 않습니다.\n· 카트비, 캐디비, 캐디팁은 현지에서 따로 내시는 비용입니다.\n\n■ 결제 안내\n· 예약 시 예약금 20%, 잔금은 출발 1개월 전까지 입금해 주세요.\n· 모든 상품의 요금은 VAT 별도 금액입니다.\n\n■ 환불 안내\n· 환불은 출발 2주(14일) 전까지만 가능합니다.\n\n■ 상담 문의\n· 전화 02-737-6658 / 010-6801-9330\n· 카카오채널 태일골프 http://pf.kakao.com/_MzSxiX' });
  if (demo) {
    // 미리보기용 예시 그림 (직접 그린 일러스트, 실제 골프장 사진 아님)
    const base = typeof window !== 'undefined' ? new URL('../assets/sample/', import.meta.url).href : '/assets/sample/';
    const im = n => ({ lg: base + n + '.jpg', md: base + n + '.jpg', sm: base + n + '.jpg' });
    const set = await store.get('settings', 'site');
    await store.put('settings', { ...set, heroBanners: [
      { img: im('banner-1'), title: '태국·말레이시아 골프, 태일골프가 함께합니다', sub: '무제한 골프 · 한 달 살기 · 골프여행 · 멤버십', link: '#/c/unlimited' },
      { img: im('banner-2'), title: '바다 옆에서 보내는 한 달', sub: '코타키나발루 · 파타야 시니어 한 달 살기', link: '#/c/month' },
    ] });
    const pics = { p_pattaya_sunrise: 'pattaya', p_udon_royalcreek: 'udon', p_korat_luxkorat: 'korat', p_kk_month: 'kk-month', p_pattaya_month: 'pattaya-month', p_royalcreek_member: 'membership' };
    for (const [id, n] of Object.entries(pics)) { const p = await store.get('products', id); if (p) await store.put('products', { ...p, images: [im(n)] }); }
    // 미리보기용 예약 몇 건
    const t = todayKST(deps.now());
    const mk = async (o, pays = [], confirm = true) => {
      const p = await store.get('products', o.productId);
      const b = { id: 'b_' + deps.randomId(12), no: 'TG' + t.replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 900) + 100), createdAt: deps.now() - (o.ago || 0) * 86400000, memberId: '', memberEmail: '', productTitle: p.title, category: p.category, basePrice: o.basePrice ?? p.basePrice, singleSupplement: 0, nights: p.nights, single: false, kakaoId: '', note: '', status: confirm ? '예약금 대기' : '접수', confirmed: confirm, payments: pays, history: [{ at: deps.now() - (o.ago || 0) * 86400000, by: '고객', action: '예약 신청 접수' }], ...o };
      const q = quote({ ...p, basePrice: b.basePrice }, b);
      Object.assign(b, { unit: q.unit, total: q.total, deposit: q.deposit, surcharge: q.surcharge, balanceDue: addMonths(b.departDate, -1), refundDeadline: addDays(b.departDate, -14), returnDate: addDays(b.departDate, b.nights) });
      b.status = autoStatus(b, t);
      await store.put('bookings', b);
    };
    await store.put('pages', { id: 'pg_about', slug: 'about', title: '회사 소개', inMenu: true, menuOrder: 1, visible: true, updatedAt: deps.now(), blocks: [
      { type: 'heading', text: '태일골프를 소개합니다', sub: '태국 골프 여행 · 한 달 살기' },
      { type: 'imageText', img: im('about'), title: '골프 여행 전문 브랜드', text: '태일골프커뮤니케이션은 태국·말레이시아 골프 여행과 한 달 살기를 전문으로 합니다.\n현지 골프장과 직접 계약해 합리적인 요금으로 모십니다.', side: 'left' },
      { type: 'contact', title: '궁금한 점은 편하게 물어보세요' },
    ] });
    await mk({ productId: 'p_kk_month', departDate: addDays(t, 40), pax: 2, name: '김영수', phone: '010-1234-5678', ago: 0 }, [], false);
    await mk({ productId: 'p_kk_month', departDate: addDays(t, 33), pax: 2, name: '이정희', phone: '010-2222-3333', ago: 6 }, [{ id: 'x1', amount: 716000, date: addDays(t, -5), method: '계좌이체', memo: '예약금' }]);
    await mk({ productId: 'p_royalcreek_member', departDate: addDays(t, 5), pax: 1, name: '박성민', phone: '010-5555-1212', ago: 20 }, [{ id: 'x2', amount: 2990000, date: addDays(t, -18), method: '계좌이체', memo: '완납' }]);
    await mk({ productId: 'p_pattaya_month', basePrice: 1500000, departDate: addDays(t, 60), pax: 2, name: '최미경', phone: '010-7777-8888', ago: 2 });
  }
}
