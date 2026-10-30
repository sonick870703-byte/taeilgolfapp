// 운항 현황: 출발 공항(기본 인천) → 도착 공항 직항편의 실시간 운항표, 즐겨찾기 노선, 확인용 그룹
// (항공권 판매가 아니라 "지금 비행기가 뜨고 내리는지" 보는 화면)
// 서버와 미리보기가 같이 씁니다. 바깥 연결은 서버에서만 합니다(deps.httpFetch).
//   인천(ICN): 인천국제공항공사 여객편 운항현황 (공공데이터포털, 무료, 일반 인증키)
//   인천이 출발·도착 어느 쪽도 아닌 노선(예: 김해→방콕, 방콕→푸껫): AeroDataBox (RapidAPI 또는 API.Market 키, 월 무료 한도 있음)
// 키는 ERP에서 관리자가 넣고 secrets 컬렉션(id 'board')에만 저장합니다. 홈페이지에는 나가지 않습니다.

// 자주 쓰는 공항 (한국어 이름). 전세계 공항 목록은 erp/airports.json (OurAirports, 퍼블릭 도메인)
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

// 스케줄 응답 한 줄 → { flight, airline, other, otherName, time:"HHMM", first, last:"YYYYMMDD", days:"1..7"(월=1), codeshareOf, via }
// 항목 이름이 문서에 안 나와 있어 비슷한 이름을 여러 개 받아 줍니다
const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const on8 = v => /^(y|yes|1|o|true|운항)$/i.test(String(v ?? '').trim());
export function schedRows(items) {
  const out = [];
  for (const raw of items || []) {
    if (!raw || typeof raw !== 'object') continue;
    const r = {};
    for (const [k, v] of Object.entries(raw)) r[k.toLowerCase()] = v;
    const pick = (...ks) => { for (const k of ks) if (r[k] != null && String(r[k]).trim() !== '') return String(r[k]).trim(); return ''; };
    const d8 = v => { const x = String(v || '').replace(/\D/g, ''); return x.length >= 8 ? x.slice(0, 8) : ''; };
    const flight = normFlight(pick('flightid', 'flightno', 'fid', 'flight'));
    const first = d8(pick('firstdate', 'startdate', 'fromdate', 'sdate', 'firstday', 'effectivedate'));
    const last = d8(pick('lastdate', 'enddate', 'todate', 'edate', 'lastday', 'expirydate'));
    let t = pick('st', 'scheduletime', 'scheduledatetime', 'schedule', 'std', 'sta', 'time', 'stime', 'internationaltime').replace(/\D/g, '');
    t = t.length >= 12 ? t.slice(8, 12) : t.length === 3 ? '0' + t : t.slice(0, 4);
    let days = '';
    if (DAY_KEYS.some(k => k in r)) days = DAY_KEYS.map((k, i) => (on8(r[k]) || String(r[k] || '').trim().toLowerCase() === k ? String(i + 1) : '')).join('');
    else {
      const w = pick('opday', 'operationday', 'operday', 'weekday', 'week', 'day', 'days');
      days = /[월화수목금토일]/.test(w) ? [...'월화수목금토일'].map((c, i) => (w.includes(c) ? String(i + 1) : '')).join('') : [...new Set(w.replace(/[^1-7]/g, ''))].sort().join('');
    }
    if (!flight || !first || !last || !/^\d{4}$/.test(t)) continue;
    out.push({
      flight, airline: pick('airline', 'airlinename'), other: pick('airportcode', 'airport_code').toUpperCase(), otherName: pick('airport', 'airportname'),
      time: t, first, last, days: days || '1234567',
      codeshareOf: /slave/i.test(pick('codeshare')) ? pick('masterflightid', 'masterflight') : '',
      via: ['airportcode2', 'airportcode3'].some(k => r[k]),
    });
  }
  return out;
}

// 그 날 다니는 스케줄 편만 운항표 줄로
export function schedForDay(list, day) {
  const wd = String((new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8))).getUTCDay() + 6) % 7 + 1);
  return tidy(list.filter(s => s.first <= day && day <= s.last && s.days.includes(wd)).map(s => ({
    sched: day + s.time, est: '', flight: s.flight, airline: s.airline, other: s.other, otherName: s.otherName,
    terminal: '', gate: '', counter: '', via: s.via, codeshareOf: s.codeshareOf, status: '', cls: '',
  })));
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

const ICN_URL = { D: 'https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDeOdp/getPassengerDeparturesDeOdp', A: 'https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDeOdp/getPassengerArrivalsDeOdp' };
// 정기 운항 스케줄 (한 시즌치: 하계 3월 말~10월 말, 동계 10월 말~3월 말). 실시간과 별도로 공공데이터포털 활용신청 필요
const SCHED_URL = { D: 'https://apis.data.go.kr/B551177/StatusOfPaxFltSched/getPaxFltSchedDeparturesDeOdp', A: 'https://apis.data.go.kr/B551177/StatusOfPaxFltSched/getPaxFltSchedArrivalsDeOdp' };
const SCHED_TTL = 12 * 60 * 60 * 1000;  // 스케줄은 자주 안 바뀜: 12시간
const ADB_HOST = { rapidapi: 'https://aerodatabox.p.rapidapi.com', apimarket: 'https://prod.api.market/api/v1/aedbx/aerodatabox' };
const ICN_TTL = 3 * 60 * 1000;   // 인천: 3분 (하루 사용량 넉넉함)
const ADB_TTL = 15 * 60 * 1000;  // 그 밖: 15분 (월 무료 한도를 아끼려고)
const IATA = /^[A-Z]{3}$/;

const mask = s => (s ? s.slice(0, 6) + '…' + s.slice(-4) : '');
const ymd = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '');

// 그룹 안의 한 편 (편명·날짜·노선·메모·확인 체크)
function cleanItem(x, old, user, now, str) {
  const it = {
    id: str(x.id, 20) || Math.random().toString(36).slice(2, 10),
    flight: normFlight(x.flight).slice(0, 8),
    date: ymd(x.date),
    from: IATA.test(String(x.from || '').toUpperCase()) ? String(x.from).toUpperCase() : '',
    to: IATA.test(String(x.to || '').toUpperCase()) ? String(x.to).toUpperCase() : '',
    memo: str(x.memo, 200),
    checked: !!x.checked,
  };
  const was = old && old.find(o => o.id === it.id);
  if (it.checked && !(was && was.checked)) { it.checkedBy = user.name || user.email; it.checkedAt = now; }
  else if (it.checked && was) { it.checkedBy = was.checkedBy; it.checkedAt = was.checkedAt; }
  return it;
}

// ctx: { on, store, deps, now, err, str, roles: { STAFF, ADMIN } }
export function registerBoardRoutes({ on, store, deps, now, err, str, roles }) {
  const { STAFF, ADMIN } = roles;
  const http = deps.httpFetch || null;
  const demo = !http;
  const mem = new Map();

  async function cfg() { return { adbProvider: 'rapidapi', ...((await store.get('secrets', 'board')) || {}) }; }

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

  // 하루치 전부: 공동운항 편까지 1,000줄이 넘는 날이 있어 totalCount 까지 쪽(page)을 넘기며 받음
  async function icn(c, dir) {
    const all = [];
    for (let page = 1; page <= 8; page++) {
      const q = `type=json&lang=K&numOfRows=1000&pageNo=${page}&from_time=0000&to_time=2400`;
      const j = c.proxyUrl
        ? await getJson(c.proxyUrl + (c.proxyUrl.includes('?') ? '&' : '?') + 'api=' + (dir === 'D' ? 'dep' : 'arr') + '&' + q)
        : await getJson(ICN_URL[dir] + '?serviceKey=' + (/%[0-9a-f]{2}/i.test(c.dataKey) ? c.dataKey : encodeURIComponent(c.dataKey)) + '&' + q);  // Encoding 키를 넣어도 됨
      if (j && j.ok === false) throw err(502, '연결 서버: ' + (j.error || '오류'));
      const got = items(j).filter(Boolean);
      all.push(...got);
      const total = Number(((j && j.response && j.response.body) || (j || {})).totalCount) || 0;
      if (!got.length || !total || all.length >= total) break;
    }
    return tidy(icnRows(all, dir));
  }

  // 정기 스케줄 한 시즌치 (출발 또는 도착 전체)
  async function icnSched(c, dir) {
    const all = [];
    for (let page = 1; page <= 10; page++) {
      const j = await getJson(SCHED_URL[dir] + '?serviceKey=' + (/%[0-9a-f]{2}/i.test(c.dataKey) ? c.dataKey : encodeURIComponent(c.dataKey)) + `&type=json&lang=K&numOfRows=1000&pageNo=${page}`);
      const got = items(j).filter(Boolean);
      all.push(...got);
      const total = Number(((j && j.response && j.response.body) || (j || {})).totalCount) || 0;
      if (!got.length || !total || all.length >= total) break;
    }
    const list = schedRows(all);
    if (all.length && !list.length) throw err(502, '스케줄 자료 형식을 읽지 못했습니다. 받은 항목: ' + Object.keys(all[0]).slice(0, 25).join(', '));
    return list;
  }

  // 공항 출발편: 지금부터 2시간 전 ~ 10시간 뒤 (현지 시각 계산 없이 "지금 기준"으로 묻는 주소)
  async function adb(c, code) {
    const url = `${ADB_HOST[c.adbProvider] || ADB_HOST.rapidapi}/flights/airports/iata/${code}?offsetMinutes=-120&durationMinutes=720&withLeg=false&direction=Departure&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`;
    const headers = c.adbProvider === 'apimarket' ? { 'x-magicapi-key': c.adbKey } : { 'X-RapidAPI-Key': c.adbKey, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' };
    const j = await getJson(url, headers);
    return tidy(adbRows(j.departures));
  }

  // 미리보기용 예시 (실제 운항 아님)
  function sample(from, to) {
    const t = new Date(now() + 9 * 3600e3), day = t.toISOString().slice(0, 10).replace(/-/g, ''), h = t.getUTCHours();
    const pool = from === 'ICN'
      ? [['TG659', '타이항공', 'BKK'], ['KE651', '대한항공', 'BKK'], ['7C2203', '제주항공', 'BKK'], ['OZ741', '아시아나항공', 'BKK'], ['VJ961', '비엣젯항공', 'HAN'], ['KE461', '대한항공', 'SGN'], ['LJ073', '진에어', 'CEB'], ['MH067', '말레이시아항공', 'KUL'], ['KE705', '대한항공', 'NRT']]
      : [['TG658', '타이항공', from], ['KE652', '대한항공', from], ['7C2204', '제주항공', from], ['ZE512', '이스타항공', from]];
    const st = ['출발', '탑승 중', '체크인', '지연', '예정', '예정', '결항', '예정', '예정'];
    return pool.filter(p => from !== 'ICN' || !to || p[2] === to).map(([flight, airline, o], i) => {
      const s = day + String((h - 1 + i) % 24).padStart(2, '0') + (i % 2 ? '35' : '10'), status = st[i] || '예정';
      return { sched: s, est: status === '지연' ? day + String((h + i + 1) % 24).padStart(2, '0') + '05' : '', flight, airline, other: from === 'ICN' ? o : 'ICN', otherName: '', terminal: 'T1', gate: String(100 + i * 7), counter: '', alias: flight === 'TG659' ? ['OZ6747'] : [], status, cls: statusClass(status) };
    });
  }

  // 노선 운항표: 출발(기본 인천) → 도착(비우면 출발 공항의 모든 직항)
  on('GET', '/api/erp/board/route', async ({ query }) => {
    const from = String(query.from || 'ICN').toUpperCase(), to = String(query.to || '').toUpperCase();
    if (!IATA.test(from) || (to && !IATA.test(to))) throw err(400, '공항 코드(영문 3글자)를 확인해 주세요.');
    if (from === to) throw err(400, '출발과 도착 공항이 같습니다.');
    const c = await cfg();
    const viaIcn = from === 'ICN' ? 'D' : to === 'ICN' ? 'A' : '';
    const out = { from, to, demo, rows: [], at: now(), source: '', timeLabel: viaIcn === 'A' ? '인천 도착' : `${boardAirportName(from)} 출발` };
    if (demo) return { ...out, rows: sample(from, to), source: '예시 자료 (실제 운항 아님)' };
    if (viaIcn) {
      if (!c.dataKey && !c.proxyUrl) return { ...out, need: 'icn' };
      const v = await cached('board:ICN:' + viaIcn, ICN_TTL, () => icn(c, viaIcn));
      const want = viaIcn === 'D' ? to : from;
      return { ...out, rows: v.data.filter(r => !r.via && (!want || r.other === want)), at: v.at, source: '인천국제공항공사 (공공데이터포털)' };
    }
    if (!c.adbKey) return { ...out, need: 'adb' };
    const v = await cached('board:' + from, ADB_TTL, () => adb(c, from));
    return { ...out, rows: v.data.filter(r => !to || r.other === to), at: v.at, source: 'AeroDataBox' };
  }, STAFF);

  // 고른 날짜의 정기 스케줄 (실시간 자료가 없는 날: 며칠 뒤 ~ 시즌 끝, 또는 이번 시즌의 지난 날)
  on('GET', '/api/erp/board/sched', async ({ query }) => {
    const from = String(query.from || 'ICN').toUpperCase(), to = String(query.to || '').toUpperCase(), day = String(query.date || '').replace(/\D/g, '');
    if (!IATA.test(from) || (to && !IATA.test(to))) throw err(400, '공항 코드(영문 3글자)를 확인해 주세요.');
    if (!/^20(2[6-7])(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(day)) throw err(400, '날짜는 2026년~2027년 안에서 골라 주세요.');
    const dir = from === 'ICN' ? 'D' : to === 'ICN' ? 'A' : '';
    if (!dir) throw err(400, '스케줄은 인천 출발·도착 노선만 볼 수 있습니다.');
    const out = { from, to, day, demo, rows: [], at: now(), source: '인천국제공항공사 정기 운항 스케줄 (공공데이터포털)', timeLabel: dir === 'A' ? '인천 도착' : '인천 출발', seasonStart: '', seasonEnd: '' };
    if (demo) {
      const rows = sample(from, to).map(r => ({ ...r, sched: day + r.sched.slice(8), est: '', status: '', cls: '', gate: '', terminal: '' })).sort((a, b) => a.sched.localeCompare(b.sched));
      const y = +day.slice(0, 4);
      return { ...out, rows, seasonStart: '20261025', seasonEnd: '20270327', source: '예시 자료 (실제 스케줄 아님)', ...(y === 2027 && day > '20270327' ? { rows: [] } : {}) };
    }
    const c = await cfg();
    if (!c.dataKey) return { ...out, need: 'sched' };
    let v;
    try { v = await cached('sched:' + dir, SCHED_TTL, () => icnSched(c, dir)); }
    catch (e) { if (/키|활용|HTTP 40[13]/.test(e.message || '')) return { ...out, need: 'sched' }; throw e; }
    const list = v.data || [];
    const want = dir === 'D' ? to : from;
    return {
      ...out, at: v.at,
      seasonStart: list.reduce((m, s) => (!m || s.first < m ? s.first : m), ''),
      seasonEnd: list.reduce((m, s) => (s.last > m ? s.last : m), ''),
      rows: schedForDay(list, day).filter(r => !r.via && (!want || r.other === want)),
    };
  }, STAFF);

  // 즐겨찾기 노선 + 그룹 (회사 직원 모두 같이 봄)
  on('GET', '/api/erp/board/prefs', async () => {
    let groups = await store.all('flightGroups');
    const c = (await store.get('secrets', 'board')) || null;
    if (!groups.length && c && (c.watch || []).length) {   // 예전 "관심 편명"을 그룹으로 옮김
      const g = { id: 'g_watch', name: '우리 고객 편', order: 0, items: c.watch.map((f, i) => ({ id: 'w' + i, flight: f, date: '', from: '', to: '', memo: '', checked: false })) };
      await store.put('flightGroups', g); groups = [g];
      delete c.watch; await store.put('secrets', c);
    }
    const favs = ((await store.get('config', 'boardFavs')) || {}).favs || [];
    return { favs, groups: groups.sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.id).localeCompare(String(b.id))) };
  }, STAFF);

  on('PUT', '/api/erp/board/favs', async ({ body }) => {
    const favs = [];
    for (const f of Array.isArray(body.favs) ? body.favs : []) {
      const from = String(f.from || '').toUpperCase(), to = String(f.to || '').toUpperCase();
      if (IATA.test(from) && (!to || IATA.test(to)) && !favs.some(x => x.from === from && x.to === to)) favs.push({ from, to });
    }
    await store.put('config', { id: 'boardFavs', favs: favs.slice(0, 40) });
    return { favs };
  }, STAFF);

  on('POST', '/api/erp/board/groups', async ({ body }) => {
    const name = str(body.name, 40);
    if (!name) throw err(400, '그룹 이름을 넣어 주세요.');
    const g = { id: 'g_' + now().toString(36) + Math.random().toString(36).slice(2, 6), name, order: now(), items: [] };
    await store.put('flightGroups', g);
    return g;
  }, STAFF);

  on('PUT', '/api/erp/board/groups/:id', async ({ params, body, user }) => {
    const g = await store.get('flightGroups', params.id);
    if (!g) throw err(404, '그룹을 찾을 수 없습니다.');
    if (body.name != null) { const n = str(body.name, 40); if (!n) throw err(400, '그룹 이름을 넣어 주세요.'); g.name = n; }
    if (Array.isArray(body.items)) {
      const list = body.items.slice(0, 200).map(x => cleanItem(x, g.items, user, now(), str));
      if (list.some(x => !/^[A-Z0-9]{2}[A-Z]?\d{1,4}[A-Z]?$/.test(x.flight))) throw err(400, '편명을 확인해 주세요. (예: TG659)');
      g.items = list;
    }
    await store.put('flightGroups', g);
    return g;
  }, STAFF);

  on('DELETE', '/api/erp/board/groups/:id', async ({ params }) => { await store.del('flightGroups', params.id); return { ok: true }; }, STAFF);

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
    for (const d of await store.all('cache')) if (/^(board|sched):/.test(String(d.id))) await store.del('cache', d.id);
    return { ok: true };
  }, ADMIN);
}
