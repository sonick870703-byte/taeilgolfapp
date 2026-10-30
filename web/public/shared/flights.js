// 항공권: 실시간 요금 조회(Duffel) · 카드 결제(토스페이먼츠) · 발권 · 견적 요청
// 서버와 미리보기가 같이 씁니다. 바깥 연결(Duffel, 토스)은 서버에서만 합니다(deps.httpFetch).
// 키가 없으면 실시간 요금 대신 "견적 요청"으로 받고, 직원이 ERP에서 요금을 넣어 결제를 받습니다.

export const FLIGHT_STATUSES = ['견적 요청', '결제 대기', '결제 완료', '발권 완료', '확인 필요', '환불 완료', '취소'];

// 출발 공항 / 도착 공항 (태국은 수완나품만)
export const ORIGINS = [
  { code: 'ICN', name: '인천' }, { code: 'GMP', name: '김포' }, { code: 'PUS', name: '부산 김해' }, { code: 'CJU', name: '제주' },
];
export const DESTINATIONS = [
  { group: '태국', list: [{ code: 'BKK', name: '방콕 수완나품' }] },
  { group: '말레이시아', list: [{ code: 'KUL', name: '쿠알라룸푸르' }, { code: 'BKI', name: '코타키나발루' }, { code: 'PEN', name: '페낭' }] },
  { group: '베트남', list: [{ code: 'HAN', name: '하노이' }, { code: 'DAD', name: '다낭' }, { code: 'SGN', name: '호찌민' }, { code: 'CXR', name: '나트랑(깜라인)' }, { code: 'PQC', name: '푸꾸옥' }] },
  { group: '필리핀', list: [{ code: 'MNL', name: '마닐라' }, { code: 'CRK', name: '클라크' }, { code: 'CEB', name: '세부' }] },
  { group: '일본', list: [{ code: 'NRT', name: '도쿄 나리타' }, { code: 'HND', name: '도쿄 하네다' }, { code: 'KIX', name: '오사카 간사이' }, { code: 'FUK', name: '후쿠오카' }, { code: 'OKA', name: '오키나와' }, { code: 'CTS', name: '삿포로' }] },
  { group: '그 밖', list: [{ code: 'TPE', name: '타이베이' }, { code: 'GUM', name: '괌' }, { code: 'SIN', name: '싱가포르' }, { code: 'DPS', name: '발리' }] },
];
const AIRPORT_NAME = Object.fromEntries([...ORIGINS, ...DESTINATIONS.flatMap(g => g.list)].map(a => [a.code, a.name]));
export const airportName = code => AIRPORT_NAME[code] || code;

export const FLIGHT_DEFAULTS = { markupPerPax: 20000, fxBuffer: 3, autoTicket: false, rates: { USD: 0, EUR: 0, GBP: 0, THB: 0, JPY: 0 } };

const DUFFEL = 'https://api.duffel.com';
const TOSS = 'https://api.tosspayments.com';
const SEARCH_TTL = 10 * 60 * 1000;
const RATE_TTL = 6 * 3600 * 1000;

// "PT5H40M" → 340 (분)
export function isoMinutes(d) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(d || '');
  return m ? (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

// Duffel 오퍼 → 화면용 (금액은 원화로 바꾸기 전 원래 통화)
export function normalizeOffer(o) {
  const slices = (o.slices || []).map(s => {
    const segs = s.segments || [];
    const first = segs[0] || {}, last = segs[segs.length - 1] || {};
    return {
      from: s.origin?.iata_code, to: s.destination?.iata_code,
      dep: first.departing_at, arr: last.arriving_at,
      minutes: isoMinutes(s.duration) || segs.reduce((n, g) => n + isoMinutes(g.duration), 0),
      stops: Math.max(0, segs.length - 1),
      via: segs.slice(0, -1).map(g => g.destination?.iata_code),
      flights: segs.map(g => (g.marketing_carrier?.iata_code || '') + (g.marketing_carrier_flight_number || '')),
      cabin: segs[0]?.passengers?.[0]?.cabin_class_marketing_name || '',
    };
  });
  const bags = (o.slices?.[0]?.segments?.[0]?.passengers?.[0]?.baggages || []).filter(b => b.type === 'checked').reduce((n, b) => n + (b.quantity || 0), 0);
  const c = o.conditions || {};
  return {
    id: o.id,
    airline: o.owner?.name || '', airlineCode: o.owner?.iata_code || '', logo: o.owner?.logo_symbol_url || '',
    amount: Number(o.total_amount), currency: o.total_currency,
    pax: (o.passengers || []).length || 1,
    passengerIds: (o.passengers || []).map(p => p.id),
    expiresAt: o.expires_at || null,
    holdable: o.payment_requirements ? o.payment_requirements.requires_instant_payment === false : false,
    docsRequired: !!o.passenger_identity_documents_required,
    checkedBags: bags,
    refund: c.refund_before_departure ? { allowed: !!c.refund_before_departure.allowed, penalty: c.refund_before_departure.penalty_amount != null ? Number(c.refund_before_departure.penalty_amount) : null, cur: c.refund_before_departure.penalty_currency } : null,
    change: c.change_before_departure ? { allowed: !!c.change_before_departure.allowed, penalty: c.change_before_departure.penalty_amount != null ? Number(c.change_before_departure.penalty_amount) : null, cur: c.change_before_departure.penalty_currency } : null,
    slices,
  };
}

// 원화 판매가: 원가 × 환율 × (1 + 여유율) + 1인 수수료 × 인원, 100원 단위 올림
export function sellPrice(amount, currency, pax, cfg, rate) {
  const krw = currency === 'KRW' ? amount : amount * rate * (1 + (Number(cfg.fxBuffer) || 0) / 100);
  return Math.ceil((krw + (Number(cfg.markupPerPax) || 0) * pax) / 100) * 100;
}

const mask = s => (s ? s.slice(0, 12) + '…' + s.slice(-4) : '');
const keyMode = (k, test, live) => (!k ? '' : k.startsWith(test) ? '테스트' : k.startsWith(live) ? '실제' : '알 수 없음');

// ctx: { on, store, deps, now, today, err, str, settings, roles: { STAFF, MEMBER, ADMIN } }
export function registerFlightRoutes({ on, store, deps, now, today, err, str, settings, roles }) {
  const { STAFF, MEMBER, ADMIN } = roles;
  const http = deps.httpFetch || null;  // 서버에서만 있음
  const demo = !!deps.demoFlights;      // 미리보기: 예시 요금(실제 요금 아님)
  const searchCache = new Map();        // 같은 조건은 10분 동안 다시 묻지 않음(Duffel 검색 초과 요금 방지)
  const rateCache = {};
  let recent = [];                      // 1분에 30번까지만 검색

  async function cfg() {
    const s = (await store.get('secrets', 'flights')) || {};
    return { ...FLIGHT_DEFAULTS, ...s, rates: { ...FLIGHT_DEFAULTS.rates, ...(s.rates || {}) } };
  }
  const live = c => !!(http && c.duffelToken);

  async function duffel(c, method, path, body) {
    const r = await http(DUFFEL + path, {
      method,
      headers: { Authorization: 'Bearer ' + c.duffelToken, 'Duffel-Version': 'v2', Accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' },
      body: body ? JSON.stringify({ data: body }) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = (j.errors && j.errors[0] && (j.errors[0].message || j.errors[0].title)) || ('항공사 연결 오류 ' + r.status);
      throw err(r.status === 422 || r.status === 400 ? 400 : 502, '항공 요금 서버: ' + m);
    }
    return j.data;
  }

  async function toss(c, path, body) {
    const auth = typeof Buffer !== 'undefined' ? Buffer.from(c.tossSecretKey + ':').toString('base64') : btoa(c.tossSecretKey + ':');
    const r = await http(TOSS + path, { method: 'POST', headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw err(400, '결제: ' + (j.message || '처리하지 못했습니다.'));
    return j;
  }

  // 환율: ERP에 넣은 값이 있으면 그것, 없으면 자동(6시간마다)
  async function rateOf(c, cur) {
    if (cur === 'KRW') return 1;
    if (Number(c.rates[cur]) > 0) return Number(c.rates[cur]);
    const hit = rateCache[cur];
    if (hit && now() - hit.at < RATE_TTL) return hit.v;
    if (http) {
      try {
        const r = await http('https://open.er-api.com/v6/latest/' + encodeURIComponent(cur));
        const j = await r.json();
        const v = j && j.rates && Number(j.rates.KRW);
        if (v > 0) { rateCache[cur] = { at: now(), v }; return v; }
      } catch { /* 아래 오류로 */ }
    }
    if (demo && cur === 'USD') return 1400;
    throw err(503, `${cur} 환율을 가져오지 못했습니다. ERP 항공권 설정에서 환율을 넣어 주세요.`);
  }

  async function priced(c, offer) {
    const rate = await rateOf(c, offer.currency);
    return { ...offer, rate, price: sellPrice(offer.amount, offer.currency, offer.pax, c, rate), perPax: Math.ceil(sellPrice(offer.amount, offer.currency, offer.pax, c, rate) / offer.pax / 100) * 100 };
  }

  function readSearch(q) {
    const from = str(q.from, 3).toUpperCase(), to = str(q.to, 3).toUpperCase();
    const depart = str(q.depart, 10), ret = str(q.return, 10);
    const adults = Math.min(9, Math.max(1, parseInt(q.adults, 10) || 1));
    const cabin = q.cabin === 'business' ? 'business' : 'economy';
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to) throw err(400, '출발지와 도착지를 골라 주세요.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(depart) || depart <= today()) throw err(400, '가는 날을 내일 이후로 골라 주세요.');
    if (ret && (!/^\d{4}-\d{2}-\d{2}$/.test(ret) || ret < depart)) throw err(400, '오는 날은 가는 날 이후로 골라 주세요.');
    return { from, to, depart, ret, adults, cabin };
  }

  async function nextNo() {
    const ymd = today().replace(/-/g, '');
    const n = (await store.all('flightBookings')).filter(b => (b.no || '').startsWith('TF' + ymd)).length + 1;
    return 'TF' + ymd + '-' + String(n).padStart(3, '0');
  }
  const who = u => (u ? (u.name || u.email) : '시스템');
  const log = (b, u, action) => { (b.history = b.history || []).push({ at: now(), by: who(u), action }); };
  const pub = b => {
    const { history, duffelOrderId, offerRaw, payment, ...rest } = b;
    return { ...rest, paid: !!payment, payMethod: payment?.method || '' };
  };

  // ----- 공개 -----
  on('GET', '/api/flights/config', async () => {
    const c = await cfg();
    return { live: live(c) || demo, demo: demo && !live(c), pay: !!(http && c.tossClientKey && c.tossSecretKey), tossClientKey: http ? (c.tossClientKey || '') : '' };
  });

  on('GET', '/api/flights/search', async ({ query }) => {
    const c = await cfg();
    const s = readSearch(query);
    if (!live(c) && !demo) return { live: false, offers: [] };
    const key = JSON.stringify(s);
    const hit = searchCache.get(key);
    if (hit && now() - hit.at < SEARCH_TTL) return { live: true, demo: hit.demo, cachedAt: hit.at, offers: hit.offers };
    recent = recent.filter(t => now() - t < 60000);
    if (recent.length >= 30) throw err(429, '지금 검색이 많습니다. 잠시 후 다시 눌러 주세요.');
    recent.push(now());
    let raw;
    if (live(c)) {
      const slices = [{ origin: s.from, destination: s.to, departure_date: s.depart }];
      if (s.ret) slices.push({ origin: s.to, destination: s.from, departure_date: s.ret });
      const data = await duffel(c, 'POST', '/air/offer_requests?return_offers=true&supplier_timeout=20000', {
        slices, passengers: Array.from({ length: s.adults }, () => ({ type: 'adult' })), cabin_class: s.cabin, max_connections: 1,
      });
      raw = data.offers || [];
    } else raw = demoOffers(s);
    const offers = [];
    for (const o of raw) {
      try { offers.push(await priced(c, normalizeOffer(o))); } catch (e) { if (e.status === 503) throw e; }
    }
    offers.sort((a, b) => a.price - b.price);
    const top = offers.slice(0, 40);
    if (searchCache.size > 200) searchCache.clear();
    searchCache.set(key, { at: now(), offers: top, demo: !live(c) });
    return { live: true, demo: !live(c), cachedAt: now(), offers: top };
  });

  // ----- 회원 -----
  // 실시간 요금으로 예약(offerId) 또는 견적 요청(검색 조건만)
  on('POST', '/api/flights/bookings', async ({ body, user }) => {
    const c = await cfg();
    const name = str(body.name, 40) || user.name, phone = str(body.phone, 30) || user.phone || '';
    if (!phone) throw err(400, '연락처를 넣어 주세요.');
    if (!body.agree) throw err(400, '항공권 예약·환불 안내에 동의해 주세요.');
    const s = readSearch(body.search || {});
    const b = {
      id: deps.randomId(12), no: await nextNo(), createdAt: now(), memberId: user.id, memberEmail: user.email,
      name, phone, email: str(body.email, 80) || user.email, note: str(body.note, 1000), search: s,
      passengers: [], status: '견적 요청', price: 0,
    };
    if (body.offerId) {
      if (!live(c) && demo) throw err(400, '미리보기 화면에서는 예약할 수 없습니다. 실제 요금이 연결되면 예약됩니다.');
      if (!live(c)) throw err(400, '실시간 요금이 연결되지 않았습니다. 견적 요청으로 보내 주세요.');
      const pax = Array.isArray(body.passengers) ? body.passengers.slice(0, 9) : [];
      if (pax.length !== s.adults) throw err(400, '탑승객 정보를 모두 넣어 주세요.');
      b.passengers = pax.map((p, i) => {
        const family = str(p.family, 40).toUpperCase(), given = str(p.given, 60).toUpperCase(), birth = str(p.birth, 10);
        const gender = p.gender === 'f' ? 'f' : 'm';
        if (!/^[A-Z][A-Z \-]*$/.test(family) || !/^[A-Z][A-Z \-]*$/.test(given)) throw err(400, `${i + 1}번 탑승객 영문 이름을 여권과 같게 넣어 주세요.`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || birth >= today()) throw err(400, `${i + 1}번 탑승객 생년월일을 확인해 주세요.`);
        return { family, given, birth, gender };
      });
      const offer = await priced(c, normalizeOffer(await duffel(c, 'GET', '/air/offers/' + encodeURIComponent(str(body.offerId, 80)) + '?return_available_services=false')));
      if (offer.pax !== b.passengers.length) throw err(400, '인원이 바뀌었습니다. 다시 검색해 주세요.');
      Object.assign(b, { offer, price: offer.price, status: '결제 대기', payBy: offer.expiresAt });
      // 결제 전 좌석·요금을 잡아 둘 수 있는 항공편이면 미리 잡아 둡니다(돈은 아직 안 나감)
      if (offer.holdable && !offer.docsRequired) {
        try {
          const ord = await duffel(c, 'POST', '/air/orders', { type: 'hold', selected_offers: [offer.id], passengers: duffelPax(b, offer) });
          b.duffelOrderId = ord.id; b.pnr = ord.booking_reference || '';
          b.payBy = ord.payment_status?.price_guarantee_expires_at || ord.payment_status?.payment_required_by || b.payBy;
          log(b, user, '좌석 잡아 둠 (결제 전)');
        } catch (e) { log(b, user, '좌석 잡기 실패: ' + e.message); }
      }
      log(b, user, `실시간 요금 예약 신청 (${offer.airline} ${b.price.toLocaleString('ko-KR')}원)`);
    } else log(b, user, '항공권 견적 요청');
    await store.put('flightBookings', b);
    return pub(b);
  }, MEMBER);

  on('GET', '/api/flights/my', async ({ user }) => (await store.all('flightBookings'))
    .filter(b => b.memberId === user.id).sort((a, b) => b.createdAt - a.createdAt).map(pub), MEMBER);

  // 결제 창을 열기 전: 금액·주문번호 확인
  on('POST', '/api/flights/bookings/:id/pay', async ({ params, user }) => {
    const c = await cfg();
    const b = await store.get('flightBookings', params.id);
    if (!b || b.memberId !== user.id) throw err(404, '예약을 찾을 수 없습니다.');
    if (b.status !== '결제 대기' || !b.price) throw err(400, '지금은 결제할 수 없는 상태입니다.');
    if (b.payBy && Date.parse(b.payBy) < now()) throw err(400, '결제 기한이 지났습니다. 다시 검색하거나 상담해 주세요.');
    if (!(http && c.tossClientKey && c.tossSecretKey)) throw err(400, '카드 결제가 아직 연결되지 않았습니다. 계좌 입금이나 카톡 상담으로 안내드립니다.');
    b.orderId = b.no + '-' + deps.randomId(6);
    await store.put('flightBookings', b);
    const route = b.offer ? `${airportName(b.offer.slices[0].from)}→${airportName(b.offer.slices[0].to)}` : `${airportName(b.search.from)}→${airportName(b.search.to)}`;
    return { orderId: b.orderId, amount: b.price, orderName: `항공권 ${route}${b.search.ret ? ' 왕복' : ''}`.slice(0, 100), customerName: b.name, customerEmail: b.email };
  }, MEMBER);

  // 토스 결제 성공 후: 서버에서 금액 확인하고 승인 → (자동 발권이 켜져 있으면) 발권
  on('POST', '/api/flights/pay/confirm', async ({ body, user }) => {
    const c = await cfg();
    const orderId = str(body.orderId, 80), paymentKey = str(body.paymentKey, 200), amount = Number(body.amount);
    const b = (await store.all('flightBookings')).find(x => x.orderId === orderId);
    if (!b || b.memberId !== user.id) throw err(404, '예약을 찾을 수 없습니다.');
    if (b.payment) return pub(b);
    if (amount !== b.price) throw err(400, '결제 금액이 예약 금액과 다릅니다.');
    const p = await toss(c, '/v1/payments/confirm', { paymentKey, orderId, amount });
    b.payment = { key: p.paymentKey, method: p.method || '카드', amount: p.totalAmount, at: now(), receipt: p.receipt?.url || '' };
    b.status = '결제 완료';
    log(b, user, `카드 결제 ${amount.toLocaleString('ko-KR')}원`);
    await store.put('flightBookings', b);
    if (c.autoTicket && b.offer) await ticket(c, b, null).catch(() => {});
    return pub(await store.get('flightBookings', b.id));
  }, MEMBER);

  function duffelPax(b, offer) {
    return b.passengers.map((p, i) => ({
      id: offer.passengerIds[i], given_name: p.given, family_name: p.family, born_on: p.birth, gender: p.gender,
      title: p.gender === 'f' ? 'ms' : 'mr', email: b.email, phone_number: intlPhone(b.phone),
    }));
  }

  // 발권: 잡아 둔 주문이면 그 주문을 결제, 아니면 지금 요금을 다시 확인하고 바로 발권
  async function ticket(c, b, u) {
    try {
      if (!b.payment) throw err(400, '결제가 확인된 뒤에 발권할 수 있습니다.');
      if (b.offer.docsRequired) throw err(400, '이 항공편은 여권 정보가 필요합니다. Duffel 관리 화면에서 여권 정보를 넣고 발권해 주세요.');
      if (b.duffelOrderId) {
        const ord = await duffel(c, 'GET', '/air/orders/' + b.duffelOrderId);
        await duffel(c, 'POST', '/air/payments', { order_id: ord.id, payment: { type: 'balance', currency: ord.total_currency, amount: ord.total_amount } });
        b.pnr = ord.booking_reference || b.pnr;
      } else {
        const fresh = await priced(c, normalizeOffer(await duffel(c, 'GET', '/air/offers/' + b.offer.id)));
        if (fresh.price > b.payment.amount) throw err(400, `요금이 올랐습니다 (결제 ${b.payment.amount.toLocaleString('ko-KR')}원 → 지금 ${fresh.price.toLocaleString('ko-KR')}원). 고객과 상의 후 환불하거나 차액을 받아 주세요.`);
        const ord = await duffel(c, 'POST', '/air/orders', { type: 'instant', selected_offers: [fresh.id], passengers: duffelPax(b, fresh), payments: [{ type: 'balance', currency: fresh.currency, amount: String(fresh.amount) }] });
        b.duffelOrderId = ord.id; b.pnr = ord.booking_reference || '';
      }
      b.status = '발권 완료'; b.ticketedAt = now(); b.issue = '';
      log(b, u, `발권 완료 (예약번호 ${b.pnr})`);
    } catch (e) {
      b.status = '확인 필요'; b.issue = e.message;
      log(b, u, '발권 실패: ' + e.message);
      await store.put('flightBookings', b);
      throw e;
    }
    await store.put('flightBookings', b);
    return b;
  }

  // ----- 직원 (ERP) -----
  on('GET', '/api/erp/flights', async ({ query }) => {
    let list = (await store.all('flightBookings')).sort((a, b) => b.createdAt - a.createdAt);
    if (query.status) list = list.filter(b => b.status === query.status);
    return list.map(({ offerRaw, ...b }) => b);
  }, STAFF);

  on('GET', '/api/erp/flights/:id', async ({ params }) => {
    const b = await store.get('flightBookings', params.id);
    if (!b) throw err(404, '예약을 찾을 수 없습니다.');
    return b;
  }, STAFF);

  // 견적 요청에 요금·항공편 내용을 넣어 결제 대기로 (고객 "내 항공권"에 결제 버튼이 생김)
  on('PATCH', '/api/erp/flights/:id', async ({ params, body, user }) => {
    const b = await store.get('flightBookings', params.id);
    if (!b) throw err(404, '예약을 찾을 수 없습니다.');
    if (body.price != null && !b.payment) {
      const price = Math.round(Number(body.price));
      if (!(price > 0)) throw err(400, '금액을 확인해 주세요.');
      b.price = price;
      if (b.status === '견적 요청') b.status = '결제 대기';
    }
    if (body.quoteText != null) b.quoteText = str(body.quoteText, 2000);
    if (body.payBy != null) b.payBy = str(body.payBy, 30) || null;
    if (body.staffNote != null) b.staffNote = str(body.staffNote, 2000);
    if (body.pnr != null) b.pnr = str(body.pnr, 20);
    if (body.status && FLIGHT_STATUSES.includes(body.status)) b.status = body.status;
    if (body.markPaid && !b.payment) {
      b.payment = { method: '계좌 입금', amount: b.price, at: now() };
      if (b.status === '결제 대기') b.status = '결제 완료';
    }
    log(b, user, str(body.logText, 200) || '내용 수정');
    await store.put('flightBookings', b);
    return b;
  }, STAFF);

  on('POST', '/api/erp/flights/:id/ticket', async ({ params, user }) => {
    const c = await cfg();
    if (!live(c)) throw err(400, 'Duffel 키가 없어 자동 발권을 할 수 없습니다. 거래하는 발권처에서 발권한 뒤 예약번호를 넣어 주세요.');
    const b = await store.get('flightBookings', params.id);
    if (!b || !b.offer) throw err(400, '실시간 요금으로 받은 예약만 자동 발권할 수 있습니다.');
    if (b.status === '발권 완료') throw err(400, '이미 발권했습니다.');
    return ticket(c, b, user);
  }, STAFF);

  // 카드 결제 취소(환불). 항공사 환불은 운임 규정에 따라 따로 처리합니다.
  on('POST', '/api/erp/flights/:id/refund', async ({ params, body, user }) => {
    const c = await cfg();
    const b = await store.get('flightBookings', params.id);
    if (!b || !b.payment) throw err(400, '결제 내역이 없습니다.');
    const amount = Math.round(Number(body.amount) || b.payment.amount - (b.payment.refunded || 0));
    if (!(amount > 0) || amount > b.payment.amount - (b.payment.refunded || 0)) throw err(400, '환불 금액을 확인해 주세요.');
    if (b.payment.key) {
      if (!http || !c.tossSecretKey) throw err(400, '토스페이먼츠 키가 없어 카드 취소를 할 수 없습니다.');
      await toss(c, `/v1/payments/${encodeURIComponent(b.payment.key)}/cancel`, { cancelReason: str(body.reason, 200) || '고객 요청', cancelAmount: amount });
    }
    b.payment.refunded = (b.payment.refunded || 0) + amount;
    if (b.payment.refunded >= b.payment.amount) b.status = '환불 완료';
    log(b, user, `${b.payment.key ? '카드 취소' : '환불 처리'} ${amount.toLocaleString('ko-KR')}원 (${str(body.reason, 200) || '고객 요청'})`);
    await store.put('flightBookings', b);
    return b;
  }, STAFF);

  // 연결 설정 (관리자만). 키는 /api/site 로 나가지 않고, 화면에는 가려서 보여 줍니다.
  on('GET', '/api/erp/flights-config', async () => {
    const c = await cfg();
    return {
      duffel: mask(c.duffelToken), duffelMode: keyMode(c.duffelToken, 'duffel_test_', 'duffel_live_'),
      tossClient: mask(c.tossClientKey), tossSecret: c.tossSecretKey ? '저장됨' : '', tossMode: keyMode(c.tossClientKey, 'test_', 'live_'),
      markupPerPax: c.markupPerPax, fxBuffer: c.fxBuffer, autoTicket: !!c.autoTicket, rates: c.rates, server: !!http,
    };
  }, ADMIN);

  on('PUT', '/api/erp/flights-config', async ({ body, user }) => {
    const s = (await store.get('secrets', 'flights')) || { id: 'flights' };
    for (const k of ['duffelToken', 'tossClientKey', 'tossSecretKey']) {
      if (body[k] === '') delete s[k];
      else if (body[k]) s[k] = str(body[k], 300);
    }
    if (body.markupPerPax != null) s.markupPerPax = Math.max(0, Math.round(Number(body.markupPerPax) || 0));
    if (body.fxBuffer != null) s.fxBuffer = Math.min(20, Math.max(0, Number(body.fxBuffer) || 0));
    if (body.autoTicket != null) s.autoTicket = !!body.autoTicket;
    if (body.rates) s.rates = Object.fromEntries(Object.entries(body.rates).filter(([k]) => /^[A-Z]{3}$/.test(k)).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]));
    s.id = 'flights'; s.updatedBy = who(user); s.updatedAt = now();
    await store.put('secrets', s);
    searchCache.clear();
    return { ok: true };
  }, ADMIN);
}

function intlPhone(p) {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.startsWith('0')) return '+82' + d.slice(1);
  return '+' + d;
}

// 미리보기 전용 예시 오퍼 (실제 요금 아님, 화면에도 "예시"로 표시)
function demoOffers(s) {
  const carriers = [['TG', '타이항공 (예시)'], ['KE', '대한항공 (예시)'], ['7C', '제주항공 (예시)'], ['OZ', '아시아나 (예시)']];
  return carriers.map(([code, name], i) => {
    const seg = (from, to, date, h) => ({ origin: { iata_code: from }, destination: { iata_code: to }, departing_at: `${date}T${String(h).padStart(2, '0')}:${i % 2 ? '35' : '05'}:00`, arriving_at: `${date}T${String(h + 6).padStart(2, '0')}:${i % 2 ? '15' : '45'}:00`, duration: 'PT5H40M', marketing_carrier: { iata_code: code }, marketing_carrier_flight_number: String(600 + i * 37), passengers: [{ cabin_class_marketing_name: s.cabin === 'business' ? '비즈니스' : '일반석', baggages: [{ type: 'checked', quantity: code === '7C' ? 0 : 1 }] }] });
    const slices = [{ origin: { iata_code: s.from }, destination: { iata_code: s.to }, duration: 'PT5H40M', segments: [seg(s.from, s.to, s.depart, 8 + i * 3)] }];
    if (s.ret) slices.push({ origin: { iata_code: s.to }, destination: { iata_code: s.from }, duration: 'PT5H40M', segments: [seg(s.to, s.from, s.ret, 10 + i * 2)] });
    return {
      id: 'demo_' + code, owner: { name, iata_code: code }, total_currency: 'USD',
      total_amount: String(((s.ret ? 2 : 1) * (190 + i * 45) * s.adults * (s.cabin === 'business' ? 3 : 1)).toFixed(2)),
      passengers: Array.from({ length: s.adults }, (_, k) => ({ id: 'p' + k, type: 'adult' })), slices,
      conditions: { refund_before_departure: { allowed: i !== 2, penalty_amount: i !== 2 ? '50' : null, penalty_currency: 'USD' }, change_before_departure: { allowed: true, penalty_amount: '30', penalty_currency: 'USD' } },
      payment_requirements: { requires_instant_payment: i === 2 },
    };
  });
}
