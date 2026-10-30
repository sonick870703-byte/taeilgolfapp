// ERP "금액 계산기": 우리 상품 / 맞춤(골프장·숙박 직접 선택) 견적을 자동으로 계산합니다.
// 요금표(원가)는 저장소(D1)에만 둡니다. 이 파일과 저장소(GitHub)에는 요금 숫자를 넣지 않습니다.
//   골프장 원가 = TOP GOLF 등 거래처 요금(현지 통화), 고객가 = 원가 × 환율 + 마진, 올림
//   캐디팁은 현지에서 직접 주는 돈이라 계산에 넣지 않습니다. 골프장 ↔ 골프장 이동은 무료.
import { addDays, addMonths, PRICE_MARKUP, DEPOSIT_RATE, REFUND_DAYS } from './core.js';

export const CALC_DEFAULTS = {
  id: 'main',
  // 1 통화 = 원. 오늘 환율 받기(open.er-api.com)나 직접 입력으로 바뀝니다. 국제환율 프로그램이 오면 그쪽으로 연결.
  fx: { KRW: 1, THB: 39.26, USD: 1400, MYR: 320, VND: 0.055, PHP: 24, JPY: 9.2 },
  fxDate: '2026-10-25 한국수출입은행 매매기준율',
  markupGolf: 20000,        // 그린피: 1라운드 1인당 (= PRICE_MARKUP, PC·휴대폰 프로그램과 같은 규칙)
  markupHotel: 0,           // 숙박: 1실 1박당
  markupCar: 0,             // 차량: 1회(1대 또는 1인)당
  round: 1000,              // 그린피·숙박 고객가는 이 단위로 올림
  vat: 10,                  // VAT % (합 계 = 계 + VAT). 0이면 VAT 줄을 숨김
  holidays: ['12-31', '01-01'], // 주말 요금을 받는 날 (월-일)
};

export const RATE_KINDS = { golf: '골프장', hotel: '숙박', car: '차량·송영' };

const num = v => { const n = Number(String(v ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
const ceilTo = (n, u) => (n > 0 ? Math.ceil(n / u - 1e-9) * u : 0);
const yes = v => /^(예|y|yes|o|true|1|✓|v)$/i.test(String(v ?? '').trim());
const txt = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export const isWeekend = (ymd, cfg = CALC_DEFAULTS) => {
  const d = new Date(ymd + 'T00:00:00Z').getUTCDay();
  return d === 0 || d === 6 || (cfg.holidays || []).includes(ymd.slice(5));
};
export const vehicles = (pax, rate) => (pax <= 3 ? { kind: 'car', n: 1 } : { kind: 'van', n: Math.ceil(pax / (rate && rate.vanCap || 9)) });

// ---------- 엑셀 ↔ 요금표 ----------
// 시트 이름과 칸 제목 (양식 = assets/rates-template.xlsx). 칸 제목이 조금 달라도 공백을 빼고 맞춥니다.
export const RATE_SHEETS = {
  golf: { sheet: '골프장', cols: [
    ['code', '코드'], ['name', '골프장(영문)'], ['nameKo', '한글 이름'], ['country', '나라'], ['area', '지역'], ['cur', '통화'], ['season', '적용 기간'],
    ['wd18.g', '평일 그린피'], ['wd18.c', '평일 캐디피'], ['wd18.cart', '평일 카트비(1대)'],
    ['we18.g', '주말 그린피'], ['we18.c', '주말 캐디피'], ['we18.cart', '주말 카트비(1대)'],
    ['wd9.g', '9홀 평일 그린피'], ['wd9.c', '9홀 캐디피'], ['wd9.cart', '9홀 카트비(1대)'], ['we9.g', '9홀 주말 그린피'],
    ['greenIncl', '그린피 상품 포함'], ['offWd', '공식 평일(참고)'], ['offWe', '공식 주말(참고)'], ['note', '메모']] },
  hotel: { sheet: '숙박', cols: [
    ['code', '코드'], ['name', '숙박시설'], ['country', '나라'], ['area', '지역'], ['cur', '통화'],
    ['room', '1실 1박 요금'], ['cap', '1실 정원'], ['single', '1인 1실 1박 요금'], ['breakfast', '조식 포함'], ['golftel', '골프텔(차량 불필요)'], ['note', '메모']] },
  car: { sheet: '차량', cols: [
    ['code', '코드'], ['name', '이름'], ['country', '나라'], ['area', '지역'], ['cur', '통화'], ['unit', '계산 단위(차량/1인)'],
    ['car.pickup', '승용차 공항 픽업'], ['car.send', '승용차 공항 샌딩'], ['car.day', '승용차 호텔↔골프장 왕복'],
    ['van.pickup', '승합차 공항 픽업'], ['van.send', '승합차 공항 샌딩'], ['van.day', '승합차 호텔↔골프장 왕복'], ['vanCap', '승합차 정원'],
    ['p1', '1인 요금(1명)'], ['p2', '1인 요금(2명)'], ['p3', '1인 요금(3명)'], ['p4', '1인 요금(4명 이상)'], ['note', '메모']] },
};
const squash = s => String(s ?? '').replace(/\s/g, '');
const slug = s => squash(s).toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export function rowToRate(kind, row) {
  const def = RATE_SHEETS[kind];
  const byHead = {};
  for (const [k, v] of Object.entries(row)) byHead[squash(k)] = v;
  const get = h => byHead[squash(h)];
  const r = { kind };
  for (const [key, head] of def.cols) {
    const v = get(head);
    const [a, b] = key.split('.');
    if (b) { r[a] = r[a] || {}; r[a][b] = num(v); continue; }
    if (['name', 'nameKo', 'country', 'area', 'season', 'note', 'code'].includes(key)) r[key] = txt(v, key === 'note' ? 500 : 120);
    else if (key === 'cur') r.cur = txt(v, 3).toUpperCase() || 'THB';
    else if (key === 'unit') r.unit = /인|person/i.test(String(v)) ? 'person' : 'vehicle';
    else if (['breakfast', 'golftel', 'greenIncl'].includes(key)) r[key] = yes(v);
    else r[key] = num(v);
  }
  if (!r.name) return null;
  if (/^예시/.test(r.code || '') || /^예시/.test(r.name)) return null;
  r.id = `${kind[0]}_${slug(r.code || r.name)}`;
  return normRate(r);
}

export function rateToRow(r) {
  const def = RATE_SHEETS[r.kind];
  const o = {};
  for (const [key, head] of def.cols) {
    const [a, b] = key.split('.');
    let v = b ? (r[a] || {})[b] : r[key];
    if (typeof v === 'boolean') v = v ? '예' : '';
    if (key === 'unit') v = r.unit === 'person' ? '1인' : '차량';
    o[head] = v || v === 0 ? (v === 0 ? '' : v) : '';
  }
  return o;
}

export function normRate(r) {
  const out = { ...r, kind: RATE_KINDS[r.kind] ? r.kind : 'golf', name: txt(r.name, 120), cur: txt(r.cur, 3).toUpperCase() || 'THB' };
  if (out.kind === 'golf') {
    for (const k of ['wd18', 'we18', 'wd9', 'we9']) { const s = r[k] || {}; out[k] = { g: num(s.g), c: num(s.c), cart: num(s.cart) }; }
    // 주말 캐디·카트비가 비면 평일 값, 9홀 주말 캐디·카트비가 비면 9홀 평일 값
    for (const [we, wd] of [['we18', 'wd18'], ['we9', 'wd9']]) for (const f of ['c', 'cart']) if (!out[we][f]) out[we][f] = out[wd][f];
  }
  if (out.kind === 'hotel') { out.room = num(r.room); out.cap = num(r.cap) || 2; out.single = num(r.single); }
  if (out.kind === 'car') {
    out.unit = r.unit === 'person' ? 'person' : 'vehicle';
    for (const k of ['car', 'van']) { const s = r[k] || {}; out[k] = { pickup: num(s.pickup), send: num(s.send), day: num(s.day) }; }
    out.vanCap = num(r.vanCap) || 9;
    for (const k of ['p1', 'p2', 'p3', 'p4']) out[k] = num(r[k]);
  }
  return out;
}

// ---------- 계산 ----------
// input: { mode:'product'|'custom', departDate, nights, pax, singles, productId, greenIncl,
//          hotelId, rooms, carId, pickup, send, days:[{ golf, courseId, holes, weekend, caddie, cart, transfer }] }
// data:  { cfg, rates:[...], products:[...] }
export function defaultDays(input, data) {
  const n = Math.max(1, Math.min(100, Number(input.nights) || 1));
  const pax = Math.max(1, Number(input.pax) || 1);
  const golfRates = data.rates.filter(r => r.kind === 'golf');
  const course = golfRates.find(r => r.id === input.courseId) || golfRates[0];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const date = input.departDate ? addDays(input.departDate, i) : '';
    const old = (input.days || [])[i];
    if (old) { out.push({ ...old, date, weekend: old.weekendSet ? old.weekend : (date ? isWeekend(date, data.cfg) : false) }); continue; }
    out.push({ date, golf: i > 0 && !!course, courseId: course ? course.id : '', holes: 18, weekend: date ? isWeekend(date, data.cfg) : false,
      caddie: course && course.wd18.c ? pax : 0, cart: course && course.wd18.cart ? Math.ceil(pax / 2) : 0, transfer: true });
  }
  return out;
}

export function compute(input, data) {
  const cfg = { ...CALC_DEFAULTS, ...(data.cfg || {}), fx: { ...CALC_DEFAULTS.fx, ...((data.cfg || {}).fx || {}) } };
  const rates = data.rates || [];
  const byId = Object.fromEntries(rates.map(r => [r.id, r]));
  const nights = Math.max(1, Math.min(100, Number(input.nights) || 1));
  const pax = Math.max(1, Math.min(200, Number(input.pax) || 1));
  const singles = Math.max(0, Math.min(pax, Number(input.singles) || 0));
  const warn = [];
  const fx = cur => { const v = cfg.fx[cur || 'KRW']; if (!(v > 0)) { warn.push(`${cur} 환율이 없습니다. 환율·마진 설정에서 넣어 주세요.`); return 0; } return v; };
  const lines = []; // { group, label, qty, unit(원), total(원), cost(원) }
  const add = (group, label, qty, unit, cost, extra = {}) => { if (qty > 0 && unit >= 0) lines.push({ group, label, qty, unit, total: unit * qty, cost: cost * qty, ...extra }); };

  // 1) 상품 또는 숙박
  let product = null, hotel = null, car = byId[input.carId] && byId[input.carId].kind === 'car' ? byId[input.carId] : null;
  if (input.mode === 'product') {
    product = (data.products || []).find(p => p.id === input.productId) || null;
    if (!product) warn.push('상품을 골라 주세요.');
    else if (!product.basePrice) warn.push(`"${product.title}" 기준가가 비어 있어 상품 요금을 0원으로 계산했습니다. 상품 관리에서 기준가를 넣어 주세요.`);
    else {
      const perNight = product.category === 'unlimited' && Number(product.nights) === 1;
      const times = perNight ? nights : 1;
      const unit = product.basePrice + PRICE_MARKUP;
      add('상품', `${product.title}${perNight ? ` (1박 요금 × ${nights}박)` : ''}`, pax, unit * times, product.basePrice * times);
      // 2인 1실 기준. 혼자 방을 쓰는 인원 = 1인실 인원 + (나머지가 홀수면 1명)
      const solo = singles + ((pax - singles) % 2);
      if (solo) {
        const sup = product.category === 'month' ? unit : (product.singleSupplement || 0);
        const month = product.category === 'month';
        if (sup) add('상품', month ? '1인 예약 (2인 요금)' : '1인 1실 추가요금', solo, sup * (month ? 1 : times), month ? product.basePrice : sup * times);
        else warn.push('1인 1실 추가요금이 상품에 없습니다. 예약 확인 때 따로 안내해 주세요.');
      }
    }
  } else {
    hotel = byId[input.hotelId] && byId[input.hotelId].kind === 'hotel' ? byId[input.hotelId] : null;
    if (hotel) {
      const f = fx(hotel.cur);
      const pairs = Math.ceil((pax - singles) / (hotel.cap || 2));
      const rooms = Math.max(1, Number(input.rooms) || pairs + singles);
      const singleRooms = Math.min(singles, rooms);
      const sellRoom = c => ceilTo(c * f + cfg.markupHotel, cfg.round);
      if (rooms - singleRooms > 0) add('숙박', `${hotel.name} · ${hotel.cap || 2}인 1실`, (rooms - singleRooms) * nights, sellRoom(hotel.room), hotel.room * f, { note: `${rooms - singleRooms}실 × ${nights}박` });
      if (singleRooms) add('숙박', `${hotel.name} · 1인 1실`, singleRooms * nights, sellRoom(hotel.single || hotel.room), (hotel.single || hotel.room) * f, { note: `${singleRooms}실 × ${nights}박` });
      if (!hotel.room) warn.push(`${hotel.name} 1실 1박 요금이 비어 있습니다.`);
    } else if (input.hotelId !== 'none') warn.push('숙박을 고르거나 "숙박 없음 (골프만)"을 골라 주세요.');
  }

  // 2) 날짜별 골프 · 차량
  const days = (input.days && input.days.length ? input.days : defaultDays({ ...input, nights, pax }, { cfg, rates })).slice(0, nights + 1);
  const greenIncl = input.mode === 'product' && input.greenIncl !== false;
  const golftel = hotel && hotel.golftel;
  const dayRows = days.map((d, i) => {
    const row = { i, date: d.date, golf: false, items: {}, total: 0 };
    const c = d.golf && byId[d.courseId];
    if (c && c.kind === 'golf') {
      row.golf = true; row.course = c.nameKo || c.name;
      const f = fx(c.cur);
      const holes = [9, 18, 27, 36].includes(Number(d.holes)) ? Number(d.holes) : 18;
      const we = !!d.weekend;
      const r18 = we ? c.we18 : c.wd18, r9 = we ? c.we9 : c.wd9;
      // 9홀 요금이 없으면 18홀 요금의 절반으로 계산하고 알려 줍니다
      const nine = k => r9[k] || (r18[k] ? r18[k] / 2 : 0);
      if (holes === 9 && !r9.g && r18.g) warn.push(`${row.course} 9홀 요금이 없어 18홀의 절반으로 계산했습니다.`);
      const part = k => (holes === 9 ? nine(k) : holes === 18 ? r18[k] : holes === 27 ? r18[k] + nine(k) : r18[k] * 2);
      const label = `${row.course} ${holes}홀${we ? ' (주말)' : ''}`;
      if (!greenIncl && !c.greenIncl) {
        const g = part('g');
        if (!g) warn.push(`${d.date} ${row.course} ${we ? '주말' : '평일'} 그린피가 비어 있습니다.`);
        // 마진은 라운드(18홀)마다 1인 1번
        const rounds = holes >= 27 ? 2 : 1;
        const unit = ceilTo(g * f + cfg.markupGolf * rounds, cfg.round);
        add('그린피', label, pax, unit, g * f, { date: d.date }); row.items.green = unit * pax;
      }
      const cad = Math.max(0, Math.min(pax, Number(d.caddie) || 0));
      const crt = Math.max(0, Math.min(pax, Number(d.cart) || 0));
      if (cad) { const unit = ceilTo(part('c') * f, 100); if (!unit) warn.push(`${row.course} 캐디피가 비어 있습니다.`); add('캐디피', `${label} 캐디`, cad, unit, part('c') * f, { date: d.date }); row.items.caddie = unit * cad; }
      if (crt) { const unit = ceilTo(part('cart') * f, 100); if (!unit) warn.push(`${row.course} 카트비가 비어 있습니다.`); add('카트비', `${label} 카트`, crt, unit, part('cart') * f, { date: d.date }); row.items.cart = unit * crt; }
      if (car && d.transfer && !golftel && input.mode === 'custom') {
        const v = vehicles(pax, car);
        const price = car.unit === 'person' ? 0 : car[v.kind].day;
        if (car.unit === 'vehicle') {
          const unit = ceilTo(price * fx(car.cur) + cfg.markupCar, 100);
          if (price) { add('차량', `호텔↔골프장 왕복 · ${v.kind === 'car' ? '승용차' : '승합차'}`, v.n, unit, price * fx(car.cur), { date: d.date }); row.items.move = unit * v.n; }
        }
      }
    }
    row.total = Object.values(row.items).reduce((a, b) => a + b, 0);
    return row;
  });

  // 3) 공항 송영 (입국 때 픽업 · 출국 때 샌딩, 각 1회)
  if (car && (input.pickup || input.send)) {
    const f = fx(car.cur);
    for (const [on, k, name] of [[input.pickup, 'pickup', '공항 픽업 · 입국 때'], [input.send, 'send', '공항 샌딩 · 출국 때']]) {
      if (!on) continue;
      if (car.unit === 'person') {
        const p = car[`p${Math.min(4, pax)}`] || car.p4 || car.p1;
        if (!p) { warn.push(`${car.name} 1인 송영 요금이 비어 있습니다.`); continue; }
        add('공항 송영', name, pax, ceilTo(p * f + cfg.markupCar, 100), p * f);
      } else {
        const v = vehicles(pax, car);
        const p = car[v.kind][k];
        if (!p) { warn.push(`${car.name} ${v.kind === 'car' ? '승용차' : '승합차'} ${name} 요금이 비어 있습니다.`); continue; }
        add('공항 송영', `${name} · ${v.kind === 'car' ? '승용차' : '승합차'}`, v.n, ceilTo(p * f + cfg.markupCar, 100), p * f);
      }
    }
  }

  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  const cost = Math.round(lines.reduce((a, l) => a + l.cost, 0));
  const vat = cfg.vat > 0 ? Math.round(subtotal * cfg.vat / 100) : 0;
  const total = subtotal + vat;
  const deposit = Math.round(total * DEPOSIT_RATE / 1000) * 1000;
  const groups = {};
  for (const l of lines) groups[l.group] = (groups[l.group] || 0) + l.total;
  return {
    nights, pax, singles, lines, groups, days: dayRows, subtotal, vat, vatRate: cfg.vat, total, perPerson: Math.round(total / pax),
    deposit, balance: total - deposit, cost, margin: subtotal - cost,
    balanceDue: input.departDate ? addMonths(input.departDate, -1) : '', refundDeadline: input.departDate ? addDays(input.departDate, -REFUND_DAYS) : '',
    returnDate: input.departDate ? addDays(input.departDate, nights) : '',
    rounds: dayRows.reduce((a, r) => a + (r.golf ? 1 : 0), 0),
    warnings: [...new Set(warn)], fxUsed: cfg.fx, fxDate: cfg.fxDate,
  };
}

// 고객에게 보낼 안내문 (카카오톡 채널에 붙여넣기)
export function quoteText(r, input, { title, wonFmt }) {
  const w = wonFmt;
  const L = [`[태일골프] ${title || '골프 여행'} 예상 금액`, ''];
  if (input.departDate) L.push(`일정: ${input.departDate} ~ ${r.returnDate} (${r.nights}박)`);
  L.push(`인원: ${r.pax}명${r.singles ? ` (1인 1실 ${r.singles}명)` : ''}${r.rounds ? ` · 골프 ${r.rounds}일` : ''}`, '');
  for (const [g, v] of Object.entries(r.groups)) L.push(`${g}: ${w(v)}`);
  L.push('', `계: ${w(r.subtotal)}`);
  if (r.vat) L.push(`합 계 (VAT 포함): ${w(r.total)}`);
  L.push(`1인당 약 ${w(r.perPerson)}`, '', `예약금 20%: ${w(r.deposit)} (예약 확정 때)`, `잔금 80%: ${w(r.balance)}${r.balanceDue ? ` (${r.balanceDue}까지)` : ''}`);
  if (r.refundDeadline) L.push(`환불: 출발 14일 전(${r.refundDeadline})까지`);
  L.push('', '캐디팁은 현지에서 캐디에게 직접 드립니다. 항공권·여행자보험 별도.', '환율과 현지 사정에 따라 달라질 수 있어 예약 확인 때 확정해 드립니다.', '', '태일골프 ☎ 02-737-6658 · 카카오톡 채널 태일골프');
  return L.join('\n');
}

// ---------- 서버 API ----------
export function registerCalcRoutes({ on, store, deps, now, err, str, roles }) {
  const { STAFF, ADMIN } = roles;
  const http = deps.httpFetch || null;
  async function cfg() {
    const c = (await store.get('calc', 'main')) || {};
    return { ...CALC_DEFAULTS, ...c, fx: { ...CALC_DEFAULTS.fx, ...(c.fx || {}) } };
  }
  const allRates = async () => (await store.all('rates')).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));

  on('GET', '/api/erp/calc', async () => ({ cfg: await cfg(), rates: await allRates() }), STAFF);
  on('PUT', '/api/erp/calc/config', async ({ body }) => {
    const c = await cfg();
    const fx = { ...c.fx };
    for (const [k, v] of Object.entries(body.fx || {})) if (/^[A-Z]{3}$/.test(k)) { const n = Number(v); if (n > 0) fx[k] = n; else delete fx[k]; }
    fx.KRW = 1;
    const n = (v, d, max) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.min(x, max) : d; };
    const next = { ...c, id: 'main', fx, fxDate: str(body.fxDate ?? c.fxDate, 120),
      markupGolf: n(body.markupGolf, c.markupGolf, 1e6), markupHotel: n(body.markupHotel, c.markupHotel, 1e6), markupCar: n(body.markupCar, c.markupCar, 1e6),
      round: [100, 500, 1000, 5000, 10000].includes(Number(body.round)) ? Number(body.round) : c.round, vat: n(body.vat, c.vat, 50),
      holidays: Array.isArray(body.holidays) ? body.holidays.map(h => str(h, 5)).filter(h => /^\d{2}-\d{2}$/.test(h)) : c.holidays, updatedAt: now() };
    await store.put('calc', next);
    return next;
  }, ADMIN);
  // 오늘 환율 (Rates By Exchange Rate API, 하루 한 번 갱신되는 무료 자료)
  on('POST', '/api/erp/calc/fx', async () => {
    if (!http) throw err(400, '미리보기에서는 오늘 환율을 받을 수 없습니다. 직접 입력해 주세요.');
    const c = await cfg();
    let j;
    try { j = await (await http('https://open.er-api.com/v6/latest/KRW')).json(); } catch { throw err(502, '환율 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도하거나 직접 입력해 주세요.'); }
    if (!j || j.result !== 'success' || !j.rates) throw err(502, '환율을 받지 못했습니다. 직접 입력해 주세요.');
    const fx = { ...c.fx };
    for (const k of Object.keys(fx)) if (k !== 'KRW' && j.rates[k] > 0) fx[k] = Math.round(1 / j.rates[k] * 10000) / 10000;
    const day = j.time_last_update_unix ? new Date(j.time_last_update_unix * 1000 + 9 * 3600000).toISOString().slice(0, 10) : '';
    const next = { ...c, fx, fxDate: `${day} Exchange Rate API (open.er-api.com)`, updatedAt: now() };
    await store.put('calc', next);
    return next;
  }, STAFF);
  on('PUT', '/api/erp/calc/rates/:id', async ({ params, body }) => {
    const kind = RATE_KINDS[body.kind] ? body.kind : 'golf';
    const id = params.id === 'new' ? `${kind[0]}_${slug(body.code || body.name) || deps.randomId(8)}` : str(params.id, 64);
    const r = normRate({ ...body, id, kind });
    if (!r.name) throw err(400, '이름을 입력해 주세요.');
    r.updatedAt = now();
    await store.put('rates', r);
    return r;
  }, STAFF);
  on('DELETE', '/api/erp/calc/rates/:id', async ({ params }) => { await store.del('rates', params.id); return { ok: true }; }, ADMIN);
  // 엑셀로 올리기: rows = [{ kind, ...칸 제목: 값 }]. replace = true면 그 종류의 기존 요금표를 지우고 새로 넣음
  on('POST', '/api/erp/calc/import', async ({ body }) => {
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 2000) : [];
    const out = rows.map(x => (RATE_SHEETS[x.kind] ? rowToRate(x.kind, x.row || {}) : null)).filter(Boolean);
    if (!out.length) throw err(400, '올릴 요금 줄이 없습니다. 양식의 시트 이름(골프장·숙박·차량)과 첫 줄 제목을 확인해 주세요.');
    if (body.replace) {
      const kinds = new Set(out.map(r => r.kind));
      for (const r of await store.all('rates')) if (kinds.has(r.kind)) await store.del('rates', r.id);
    }
    let order = 0;
    for (const r of out) { r.order = order++; r.updatedAt = now(); await store.put('rates', r); }
    return { ok: true, count: out.length };
  }, ADMIN);

  // 저장한 견적
  on('GET', '/api/erp/quotes', async () => (await store.all('quotes')).sort((a, b) => b.createdAt - a.createdAt).slice(0, 300), STAFF);
  on('POST', '/api/erp/quotes', async ({ body, user }) => {
    const q = { id: 'q_' + deps.randomId(10), createdAt: now(), by: user.name || user.email, title: str(body.title, 120) || '견적',
      customer: str(body.customer, 60), input: body.input || {}, total: Number(body.total) || 0, perPerson: Number(body.perPerson) || 0 };
    if (JSON.stringify(q.input).length > 60000) throw err(400, '견적 내용이 너무 깁니다.');
    await store.put('quotes', q);
    return q;
  }, STAFF);
  on('DELETE', '/api/erp/quotes/:id', async ({ params }) => { await store.del('quotes', params.id); return { ok: true }; }, STAFF);
}
