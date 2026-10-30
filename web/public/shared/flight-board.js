// 운항 현황: 공항 출발·도착 실시간 운항표 (항공권 판매가 아니라 "지금 비행기가 뜨고 내리는지" 보는 화면)
// 서버와 미리보기가 같이 씁니다. 바깥 연결은 서버에서만 합니다(deps.httpFetch).
//   인천(ICN): 인천국제공항공사 여객편 운항현황 (공공데이터포털, 무료, 일반 인증키)
//   그 밖의 공항(김해·김포·제주·수완나품 등): AeroDataBox (RapidAPI 또는 API.Market 키, 월 무료 한도 있음)
// 키는 ERP에서 관리자가 넣고 secrets 컬렉션(id 'board')에만 저장합니다. 홈페이지에는 나가지 않습니다.

// tz: 공항 현지 시각(UTC 기준 시간). 아래 나라들은 서머타임이 없습니다.
export const BOARD_AIRPORTS = [
  { group: '한국', list: [{ code: 'ICN', name: '인천', tz: 9 }, { code: 'GMP', name: '김포', tz: 9 }, { code: 'PUS', name: '부산 김해', tz: 9 }, { code: 'CJU', name: '제주', tz: 9 }, { code: 'TAE', name: '대구', tz: 9 }, { code: 'CJJ', name: '청주', tz: 9 }] },
  { group: '태국', list: [{ code: 'BKK', name: '방콕 수완나품', tz: 7 }] },
  { group: '말레이시아', list: [{ code: 'KUL', name: '쿠알라룸푸르', tz: 8 }, { code: 'BKI', name: '코타키나발루', tz: 8 }, { code: 'PEN', name: '페낭', tz: 8 }] },
  { group: '베트남', list: [{ code: 'HAN', name: '하노이', tz: 7 }, { code: 'DAD', name: '다낭', tz: 7 }, { code: 'SGN', name: '호찌민', tz: 7 }, { code: 'CXR', name: '나트랑(깜라인)', tz: 7 }, { code: 'PQC', name: '푸꾸옥', tz: 7 }] },
  { group: '필리핀', list: [{ code: 'MNL', name: '마닐라', tz: 8 }, { code: 'CRK', name: '클라크', tz: 8 }, { code: 'CEB', name: '세부', tz: 8 }] },
  { group: '일본', list: [{ code: 'NRT', name: '도쿄 나리타', tz: 9 }, { code: 'HND', name: '도쿄 하네다', tz: 9 }, { code: 'KIX', name: '오사카 간사이', tz: 9 }, { code: 'FUK', name: '후쿠오카', tz: 9 }, { code: 'OKA', name: '오키나와', tz: 9 }, { code: 'CTS', name: '삿포로', tz: 9 }] },
  { group: '그 밖', list: [{ code: 'TPE', name: '타이베이', tz: 8 }, { code: 'GUM', name: '괌', tz: 10 }, { code: 'SIN', name: '싱가포르', tz: 8 }, { code: 'DPS', name: '발리', tz: 8 }] },
];
const ALL = BOARD_AIRPORTS.flatMap(g => g.list);
const BY_CODE = Object.fromEntries(ALL.map(a => [a.code, a]));
const KOREA = new Set(BOARD_AIRPORTS[0].list.map(a => a.code).concat(['MWX', 'YNY', 'RSU', 'USN', 'KWJ', 'KUV', 'WJU', 'HIN']));
const GOLF = new Set(BOARD_AIRPORTS.slice(1).flatMap(g => g.list.map(a => a.code)));
export const boardAirportName = code => (BY_CODE[code] && BY_CODE[code].name) || code;

// 우리 고객이 타는 노선인지: 한국 공항 운항표면 골프 여행지, 해외 공항 운항표면 한국 공항
export const isGolfRoute = (airport, other) => (KOREA.has(airport) ? GOLF.has(other) : KOREA.has(other));

// 상태 → 색 (bad: 결항·회항·지연, warn: 탑승 관련, ok: 출발·도착)
export function statusClass(s) {
  if (/결항|취소|회항|지연/.test(s)) return 'bad';
  if (/탑승|마감|체크인|게이트/.test(s)) return 'warn';
  if (/출발|도착|착륙|이륙|운항 중/.test(s)) return 'ok';
  return '';
}

// AeroDataBox 상태 → 한국어
const ADB_STATUS = {
  Unknown: '', Expected: '예정', EnRoute: '운항 중', CheckIn: '체크인', Boarding: '탑승 중', GateClosed: '탑승 마감',
  Departed: '출발', Delayed: '지연', Approaching: '착륙 준비', Arrived: '도착', Canceled: '결항', Diverted: '회항', CanceledUncertain: '결항 가능성',
};

export const normFlight = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// "202610301020" 또는 "2026-10-30 10:20+07:00" → "202610301020" (공항 현지 시각)
function stamp(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 12 ? d.slice(0, 12) : '';
}

// 인천공항 응답 → 화면 행
export function icnRows(items, dir) {
  return items.filter(r => r && r.flightId).map(r => {
    const status = String(r.remark || '').trim();
    return {
      sched: stamp(r.scheduleDateTime), est: stamp(r.estimatedDateTime),
      flight: normFlight(r.flightId), airline: r.airline || '',
      other: String(r.airportCode || '').toUpperCase(), otherName: r.airport || '',
      terminal: { P01: 'T1', P02: 'T1(탑승동)', P03: 'T2' }[r.terminalid] || r.terminalid || '',
      via: [r.airportCode2, r.airportcode2, r.airportCode3].some(Boolean),
      gate: r.gatenumber || '', counter: dir === 'D' ? (r.chkinrange || '') : (r.exitnumber || ''),
      codeshareOf: /slave/i.test(r.codeshare || '') ? String(r.masterflightid || '').trim() : '',
      status, cls: statusClass(status),
    };
  });
}

// AeroDataBox 응답 한쪽(departures 또는 arrivals) → 화면 행
export function adbRows(list) {
  return (list || []).filter(f => !f.isCargo).map(f => {
    const m = f.movement || f.departure || f.arrival || {};
    const status = ADB_STATUS[f.status] ?? String(f.status || '');
    return {
      sched: stamp(m.scheduledTime && m.scheduledTime.local), est: stamp((m.revisedTime || m.predictedTime || m.runwayTime || {}).local),
      flight: normFlight(f.number), airline: (f.airline && f.airline.name) || '',
      other: String((m.airport && m.airport.iata) || '').toUpperCase(), otherName: (m.airport && (m.airport.shortName || m.airport.name)) || '',
      terminal: m.terminal ? 'T' + String(m.terminal).replace(/^T/i, '') : '', gate: m.gate || '', counter: m.checkInDesk || m.baggageBelt || '',
      status, cls: statusClass(status),
    };
  });
}

// 같은 편이 두 번 오면 하나만. 공동운항 편명(예: OZ6747 = TG659)은 원래 편 줄에 붙입니다.
function tidy(rows) {
  const seen = new Map(), out = [];
  for (const r of rows) {
    const k = r.flight + '|' + r.sched;
    if (seen.has(k)) continue;
    seen.set(k, r); r.alias = r.alias || []; out.push(r);
  }
  const keep = out.filter(r => {
    if (!r.codeshareOf) return true;
    const m = seen.get(normFlight(r.codeshareOf) + '|' + r.sched);
    if (!m || m === r) return true;
    m.alias.push(r.flight);
    return false;
  });
  return keep.map(({ codeshareOf, ...r }) => r).sort((a, b) => a.sched.localeCompare(b.sched) || a.flight.localeCompare(b.flight));
}

// 공항 현지 시각 "YYYY-MM-DDTHH:mm"
function localIso(ms, tz) { return new Date(ms + tz * 3600e3).toISOString().slice(0, 16); }

const ICN_URL = { D: 'https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDeOdp/getPassengerDeparturesDeOdp', A: 'https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDeOdp/getPassengerArrivalsDeOdp' };
const ADB_HOST = { rapidapi: 'https://aerodatabox.p.rapidapi.com', apimarket: 'https://prod.api.market/api/v1/aedbx/aerodatabox' };
const ICN_TTL = 3 * 60 * 1000;   // 인천: 3분 (하루 사용량 넉넉함)
const ADB_TTL = 15 * 60 * 1000;  // 그 밖: 15분 (월 무료 한도를 아끼려고)

const mask = s => (s ? s.slice(0, 6) + '…' + s.slice(-4) : '');

// ctx: { on, store, deps, now, err, str, roles: { STAFF, ADMIN } }
export function registerBoardRoutes({ on, store, deps, now, err, str, roles }) {
  const { STAFF, ADMIN } = roles;
  const http = deps.httpFetch || null;
  const demo = !http;
  const mem = new Map();

  async function cfg() { return { adbProvider: 'rapidapi', watch: [], ...((await store.get('secrets', 'board')) || {}) }; }

  // 같은 요청은 잠시 저장해서 다시 묻지 않습니다 (Workers는 작업 공간이 여러 개라 D1에도 남김)
  async function cached(key, ttl, load) {
    const m = mem.get(key);
    if (m && now() - m.at < ttl) return m;
    const d = await store.get('cache', key).catch(() => null);
    if (d && now() - d.at < ttl) { mem.set(key, d); return d; }
    const v = { id: key, at: now(), data: await load() };
    mem.set(key, v);
    await store.put('cache', v).catch(() => {});
    return v;
  }

  async function getJson(url, headers) {
    let r;
    try { r = await http(url, { headers: { Accept: 'application/json', ...(headers || {}) } }); } catch { throw err(502, '운항 정보 서버에 연결하지 못했습니다. 잠시 뒤 다시 눌러 주세요.'); }
    const text = await r.text();
    if (r.status === 401 || r.status === 403) throw err(502, '운항 정보 키가 맞지 않거나 사용 신청이 안 되어 있습니다. (HTTP ' + r.status + ')');
    if (r.status === 429) throw err(502, '이번 달 무료 사용량을 다 썼거나 너무 자주 불렀습니다. 잠시 뒤 다시 보세요.');
    if (r.status === 204 || !text.trim()) return {};
    if (!r.ok) throw err(502, '운항 정보 서버 오류 (HTTP ' + r.status + ')');
    try { return JSON.parse(text); } catch { throw err(502, /SERVICE.?KEY|SERVICE_KEY/i.test(text) ? '공공데이터 인증키 오류입니다. 인증키와 활용신청을 확인해 주세요.' : '운항 정보 응답 형식이 바뀌었습니다.'); }
  }

  const items = j => { const b = (j && j.response && j.response.body) || j || {}; const it = (b.items && (b.items.item || b.items)) || []; return Array.isArray(it) ? it : [it]; };

  async function icn(c, dir) {
    const q = 'type=json&lang=K&numOfRows=1000&pageNo=1&from_time=0000&to_time=2400';
    const j = c.proxyUrl
      ? await getJson(c.proxyUrl + (c.proxyUrl.includes('?') ? '&' : '?') + 'api=' + (dir === 'D' ? 'dep' : 'arr') + '&' + q)
      : await getJson(ICN_URL[dir] + '?serviceKey=' + (/%[0-9a-f]{2}/i.test(c.dataKey) ? c.dataKey : encodeURIComponent(c.dataKey)) + '&' + q)  // Encoding 키를 넣어도 됨;
    if (j && j.ok === false) throw err(502, '연결 서버: ' + (j.error || '오류'));
    return tidy(icnRows(items(j), dir));
  }

  async function adb(c, code) {
    const tz = (BY_CODE[code] || { tz: 9 }).tz, t = now();
    // 현지 시각 기준 2시간 전 ~ 10시간 뒤 (한 번에 최대 12시간)
    const url = `${ADB_HOST[c.adbProvider] || ADB_HOST.rapidapi}/flights/airports/iata/${code}/${localIso(t - 2 * 3600e3, tz)}/${localIso(t + 10 * 3600e3, tz)}?withLeg=false&direction=Both&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`;
    const headers = c.adbProvider === 'apimarket' ? { 'x-magicapi-key': c.adbKey } : { 'X-RapidAPI-Key': c.adbKey, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' };
    const j = await getJson(url, headers);
    return { D: tidy(adbRows(j.departures)), A: tidy(adbRows(j.arrivals)) };
  }

  // 미리보기용 예시 (실제 운항 아님)
  function sample(code, dir) {
    const t = new Date(now() + 9 * 3600e3), ymd = t.toISOString().slice(0, 10).replace(/-/g, ''), h = t.getUTCHours();
    const ko = KOREA.has(code);
    const base = ko ? [['TG659', '타이항공', 'BKK'], ['KE651', '대한항공', 'BKK'], ['7C2203', '제주항공', 'BKK'], ['OZ741', '아시아나항공', 'BKK'], ['VJ961', '비엣젯항공', 'HAN'], ['KE461', '대한항공', 'SGN'], ['LJ073', '진에어', 'CEB'], ['MH067', '말레이시아항공', 'KUL'], ['KE705', '대한항공', 'NRT']]
      : [['TG658', '타이항공', 'ICN'], ['KE652', '대한항공', 'ICN'], ['7C2204', '제주항공', 'ICN'], ['BX726', '에어부산', 'PUS'], ['ZE512', '이스타항공', 'ICN']];
    const st = dir === 'D' ? ['출발', '탑승 중', '체크인', '지연', '예정', '예정', '결항', '예정', '예정'] : ['도착', '도착', '운항 중', '지연', '예정', '예정', '예정', '예정', '예정'];
    return base.map(([flight, airline, other], i) => {
      const hh = String((h - 1 + i) % 24).padStart(2, '0'), s = ymd + hh + (i % 2 ? '35' : '10');
      const status = st[i] || '예정';
      return { sched: s, est: status === '지연' ? ymd + String((h + i + 1) % 24).padStart(2, '0') + '05' : '', flight, airline, other, otherName: boardAirportName(other), terminal: 'T1', gate: String(100 + i * 7), counter: '', alias: i === 0 ? ['OZ6747'] : [], status, cls: statusClass(status) };
    });
  }

  on('GET', '/api/erp/board', async ({ query }) => {
    const code = String(query.airport || 'ICN').toUpperCase(), dir = query.dir === 'A' ? 'A' : 'D';
    if (!/^[A-Z]{3}$/.test(code)) throw err(400, '공항 코드를 확인해 주세요.');
    const c = await cfg();
    const out = { airport: code, dir, watch: c.watch || [], demo, rows: [], at: now(), source: '' };
    if (demo) return { ...out, rows: sample(code, dir), source: '예시 자료 (실제 운항 아님)' };
    if (code === 'ICN') {
      if (!c.dataKey && !c.proxyUrl) return { ...out, need: 'icn', source: '인천국제공항공사' };
      const v = await cached('board:ICN:' + dir, ICN_TTL, () => icn(c, dir));
      return { ...out, rows: v.data, at: v.at, source: '인천국제공항공사 (공공데이터포털)' };
    }
    if (!c.adbKey) return { ...out, need: 'adb', source: 'AeroDataBox' };
    const v = await cached('board:' + code, ADB_TTL, () => adb(c, code));
    return { ...out, rows: v.data[dir] || [], at: v.at, source: 'AeroDataBox' };
  }, STAFF);

  // 관심 편명 (우리 고객이 타는 편): 직원 누구나 바꿀 수 있음
  on('PUT', '/api/erp/board/watch', async ({ body }) => {
    const c = (await store.get('secrets', 'board')) || { id: 'board' };
    c.id = 'board';
    c.watch = [...new Set((Array.isArray(body.watch) ? body.watch : String(body.watch || '').split(/[,\n]+/)).map(normFlight).filter(f => /^[A-Z0-9]{2}[A-Z]?\d{1,4}[A-Z]?$/.test(f)))].slice(0, 100);
    await store.put('secrets', c);
    return { watch: c.watch };
  }, STAFF);

  on('GET', '/api/erp/board/config', async () => {
    const c = await cfg();
    return { server: !!http, dataKey: mask(c.dataKey), proxyUrl: c.proxyUrl || '', adbKey: mask(c.adbKey), adbProvider: c.adbProvider };
  }, ADMIN);

  on('PUT', '/api/erp/board/config', async ({ body }) => {
    const c = (await store.get('secrets', 'board')) || {};
    c.id = 'board';
    for (const k of ['dataKey', 'adbKey']) if (body[k] != null) c[k] = str(body[k], 400);
    if (body.proxyUrl != null) {
      const u = str(body.proxyUrl, 400);
      if (u && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) throw err(400, '연결 서버 주소는 https://script.google.com/macros/s/…/exec 형식이어야 합니다.');
      c.proxyUrl = u;
    }
    if (body.adbProvider) c.adbProvider = body.adbProvider === 'apimarket' ? 'apimarket' : 'rapidapi';
    await store.put('secrets', c);
    mem.clear();
    for (const d of await store.all('cache')) if (String(d.id).startsWith('board:')) await store.del('cache', d.id);
    return { ok: true };
  }, ADMIN);
}
