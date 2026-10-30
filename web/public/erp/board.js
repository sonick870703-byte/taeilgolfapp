// ERP "운항 현황": 출발(기본 인천) → 도착 공항 직항편 실시간 운항표, 즐겨찾기 노선, 확인용 그룹, 연결 설정
import { api } from '../shared/api.js';
import { ask } from '../shared/ask.js';
import { BOARD_AIRPORTS, boardAirportName, normFlight } from '../shared/flight-board.js?v=20261030e';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = s => (s ? s.slice(8, 10) + ':' + s.slice(10, 12) : '');
const CLS = { ok: 'g', warn: 'o', bad: 'r' };
const REFRESH = 3 * 60 * 1000;
const todayStr = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);  // 한국 날짜
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 안 돼도 됨 */ } } };

// 고른 노선은 이 PC에 기억 (처음엔 인천 출발, 도착 전체)
const st = { from: 'ICN', to: '', q: '', airline: '', day: '', ...(store.get('taeil.board') || {}) };
// 항공사는 편명 앞 2글자(IATA 코드)로 고릅니다. 예전에 이름으로 저장된 값은 비움
if (!/^[A-Z0-9]{2}$/.test(st.airline || '')) st.airline = '';

// 항공사 목록: 오늘 편이 없어도 늘 보이게 고정 (운항표에 다른 항공사가 있으면 아래에 덧붙임)
const AIRLINES = [
  ['한국 항공사', [['KE', '대한항공'], ['OZ', '아시아나항공'], ['7C', '제주항공'], ['LJ', '진에어'], ['TW', '티웨이항공'], ['BX', '에어부산'], ['RS', '에어서울'], ['ZE', '이스타항공'], ['YP', '에어프레미아'], ['RF', '에어로케이']]],
  ['외국 항공사', [['TG', '타이항공'], ['XJ', '타이에어아시아엑스'], ['FD', '타이에어아시아'], ['VZ', '타이비엣젯항공'], ['PG', '방콕에어웨이즈'], ['VJ', '비엣젯항공'], ['VN', '베트남항공'], ['QH', '뱀부항공'], ['PR', '필리핀항공'], ['5J', '세부퍼시픽'], ['Z2', '필리핀에어아시아'], ['MH', '말레이시아항공'], ['AK', '에어아시아'], ['D7', '에어아시아엑스'], ['JL', '일본항공'], ['NH', '전일본공수'], ['MM', '피치항공'], ['SQ', '싱가포르항공'], ['TR', '스쿠트'], ['CX', '캐세이퍼시픽'], ['CI', '중화항공'], ['BR', '에바항공'], ['GA', '가루다인도네시아']]],
];
const AIRLINE_NAME = Object.fromEntries(AIRLINES.flatMap(g => g[1]));
const carrier = f => String(f || '').slice(0, 2);
// 실제로 비행기를 띄우는 항공사(운항사)만 봅니다. 공동운항(남의 편에 붙인 편명)은 넣지 않음
const ofAirline = (r, code) => carrier(r.flight) === code;
if (st.from !== 'ICN' && st.to !== 'ICN') { st.from = st.from || 'ICN'; if (st.from !== 'ICN') st.to = 'ICN'; }
let timer = null, curEnv = null, last = null, prefs = { favs: [], groups: [] };

// ----- 전세계 공항 목록 (OurAirports) -----
let AP = null;
const country = (() => { try { const d = new Intl.DisplayNames(['ko'], { type: 'region' }); return c => { try { return d.of(c); } catch { return c; } }; } catch { return c => c; } })();
async function airports() {
  if (AP) return AP;
  try { AP = new Map((await (await fetch('airports.json?v=20261030')).json()).map(a => [a[0], { code: a[0], name: a[1], city: a[2], cc: a[3] }])); } catch { AP = new Map(); }
  return AP;
}
// 한국어 짧은 이름 (자주 쓰는 공항) → 없으면 도시 이름
function apName(code) {
  if (!code) return '';
  const ko = boardAirportName(code);
  if (ko !== code) return ko;
  const a = AP && AP.get(code);
  return a ? (a.city || a.name) : code;
}
const apLabel = code => (code ? `${apName(code)} ${code}` : '');
// 입력 → 공항 코드 ("bkk", "방콕", "Bangkok" 모두 됨)
function resolve(v) {
  v = String(v || '').trim();
  if (!v) return '';
  const m = /^([A-Za-z]{3})(\s|$)/.exec(v);
  if (m && (!AP || !AP.size || AP.has(m[1].toUpperCase()))) return m[1].toUpperCase();
  const q = v.toLowerCase();
  const ko = BOARD_AIRPORTS.flatMap(g => g.list).find(a => a.name.includes(v));
  if (ko) return ko.code;
  for (const a of (AP || new Map()).values()) if ((a.city || '').toLowerCase().includes(q) || a.name.toLowerCase().includes(q)) return a.code;
  return null;
}
function datalist() {
  const quick = BOARD_AIRPORTS.flatMap(g => g.list).map(a => `<option value="${a.code} ${esc(a.name)}">`).join('');
  const all = [...(AP || new Map()).values()].filter(a => boardAirportName(a.code) === a.code)
    .map(a => `<option value="${a.code} ${esc(a.city || a.name)}">${esc(a.name)} · ${esc(country(a.cc))}</option>`).join('');
  return `<datalist id="apList">${quick}${all}</datalist>`;
}

// 그룹에 들어 있는 편 (오늘 날짜이거나 날짜 없는 편) → ★ 표시
function watched() {
  const t = todayStr(), set = new Set();
  for (const g of prefs.groups) for (const it of g.items || []) if (!it.date || it.date === t) set.add(normFlight(it.flight));
  return set;
}
const isFav = () => prefs.favs.some(f => f.from === st.from && f.to === st.to);

// env: { toast, drawer, closeDrawer, setBarAct, me }
export async function boardView(view, arg, env) {
  clearInterval(timer);
  curEnv = env;
  if (arg === 'settings') return settingsView(view, env);
  env.setBarAct(env.me.role === 'admin' ? '<a class="btn sm" href="#/board/settings">연결 설정</a>' : '');
  await airports();
  prefs = await api.get('/api/erp/board/prefs');
  view.innerHTML = `
    ${datalist()}
    <div class="filters">
      <label class="muted" for="bFrom" style="font-size:13px">출발</label>
      <input id="bFrom" list="apList" style="width:170px" value="${esc(apLabel(st.from))}" placeholder="인천 ICN" autocomplete="off">
      <button class="btn sm" id="bSwap" title="출발·도착 바꾸기" aria-label="출발·도착 바꾸기">⇄</button>
      <label class="muted" for="bTo" style="font-size:13px">도착</label>
      <input id="bTo" list="apList" style="width:170px" value="${esc(apLabel(st.to))}" placeholder="전체 (모든 직항)" autocomplete="off">
      <button class="btn sm" id="bFav" title="즐겨찾기">${isFav() ? '★ 즐겨찾기됨' : '☆ 즐겨찾기'}</button>
      <button class="btn sm" id="bReload">새로고침</button>
    </div>
    <div class="filters" id="bFavs"></div>
    <div class="filters" id="bDays"></div>
    <div class="filters"><select id="bAir" aria-label="항공사"><option value="">항공사 전체</option></select><input class="grow" id="bQ" placeholder="편명·항공사·도시 찾기" value="${esc(st.q)}"></div>
    <div id="bInfo" class="muted" style="font-size:13px;margin-bottom:10px"></div>
    <div id="bList"><div class="loading">불러오는 중…</div></div>
    <div class="card" style="margin-top:16px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0;flex:1">그룹 <small>고객 편 모아 두고 확인 체크</small></h2><button class="btn sm primary" id="gNew">+ 새 그룹</button></div>
      <p class="muted" style="margin:6px 0 12px">운항표에서 <b>+ 그룹</b>을 누르거나 그룹 안에서 직접 편명을 넣으세요. 그룹에 넣은 오늘 편은 운항표에 <b>★</b>로 표시되고, 아래에 실시간 상태가 같이 보입니다.</p>
      <div id="gList"></div>
    </div>`;
  const pick = async (id, key) => {
    const el = $(id, view), code = resolve(el.value);
    if (code === null) { env.toast('공항을 찾지 못했습니다. 영문 3글자 코드(예: BKK)나 도시 이름을 넣어 주세요.'); el.value = apLabel(st[key]); return; }
    if (key === 'from' && !code) { el.value = apLabel(st.from); return; }
    st[key] = code;
    // 우리 노선은 늘 인천 출발 또는 인천 도착: 한쪽이 인천이 아니면 다른 쪽을 인천으로
    const other = key === 'from' ? 'to' : 'from';
    if (code && code !== 'ICN' && st[other] !== 'ICN') { st[other] = 'ICN'; $(other === 'from' ? '#bFrom' : '#bTo', view).value = apLabel('ICN'); }
    if (code === 'ICN' && st[other] === 'ICN') { st[other] = ''; $(other === 'from' ? '#bFrom' : '#bTo', view).value = ''; }
    if (!st.from) { st.from = 'ICN'; $('#bFrom', view).value = apLabel('ICN'); }
    el.value = apLabel(st[key]); save(); await load(view);
  };
  $('#bFrom', view).onchange = () => pick('#bFrom', 'from');
  $('#bTo', view).onchange = () => pick('#bTo', 'to');
  $('#bSwap', view).onclick = () => { if (!st.to) return env.toast('도착 공항을 먼저 골라 주세요.'); [st.from, st.to] = [st.to, st.from]; $('#bFrom', view).value = apLabel(st.from); $('#bTo', view).value = apLabel(st.to); save(); load(view); };
  $('#bFav', view).onclick = async () => {
    const favs = isFav() ? prefs.favs.filter(f => !(f.from === st.from && f.to === st.to)) : [...prefs.favs, { from: st.from, to: st.to }];
    try { prefs.favs = (await api.put('/api/erp/board/favs', { favs })).favs; drawFavs(view); } catch (e) { env.toast(e.message); }
  };
  $('#bQ', view).oninput = e => { st.q = e.target.value; draw(view); };
  $('#bAir', view).onchange = e => { st.airline = e.target.value; save(); draw(view); };
  $('#bReload', view).onclick = () => { schedCache.clear(); load(view); };
  $('#gNew', view).onclick = async () => { const name = prompt('그룹 이름 (예: 11월 3일 파타야 김OO님 팀)'); if (!name) return; try { prefs.groups.push(await api.post('/api/erp/board/groups', { name })); drawGroups(view); } catch (e) { env.toast(e.message); } };
  drawFavs(view);
  drawGroups(view);
  await load(view);
  // 화면을 보고 있는 동안 3분마다 새로 받음 (서버도 3~15분 저장해 두므로 사용량은 늘지 않음)
  timer = setInterval(() => { if (!view.isConnected || !$('#bList', view)) return clearInterval(timer); if (!document.hidden) { load(view, true); groupStatus(view); } }, REFRESH);
}

function save() { store.set('taeil.board', { from: st.from, to: st.to, airline: st.airline }); }

function drawFavs(view) {
  const el = $('#bFavs', view), b = $('#bFav', view);
  if (b) b.textContent = isFav() ? '★ 즐겨찾기됨' : '☆ 즐겨찾기';
  if (!el) return;
  el.hidden = !prefs.favs.length;
  el.innerHTML = prefs.favs.map((f, i) => `<button class="chip ${f.from === st.from && f.to === st.to ? 'on' : ''}" data-fav="${i}">★ ${esc(apName(f.from))} → ${esc(f.to ? apName(f.to) : '전체')}</button>`).join('');
  $$('[data-fav]', el).forEach(c => c.onclick = () => {
    const f = prefs.favs[+c.dataset.fav]; st.from = f.from; st.to = f.to; save();
    $('#bFrom', view).value = apLabel(st.from); $('#bTo', view).value = apLabel(st.to); load(view);
  });
}

async function load(view, quiet) {
  const list = $('#bList', view);
  if (!list) return;
  drawFavs(view);
  if (!quiet) list.innerHTML = '<div class="loading">불러오는 중…</div>';
  try {
    last = await api.get(`/api/erp/board/route?from=${st.from}&to=${st.to}`);
    draw(view);
  } catch (e) {
    if (!quiet) { list.innerHTML = `<div class="alerts"><div class="alert danger">${esc(e.message)}</div></div>`; $('#bInfo', view).textContent = ''; }
  }
}

// 운항표 한 줄의 실제 노선 (그룹에 넣을 때 씀)
const rowRoute = (d, r) => (d.to === 'ICN' && d.from !== 'ICN' ? { from: r.other || d.from, to: 'ICN' } : { from: d.from, to: r.other || d.to });

const schedCache = new Map(), schedBusy = new Set();  // "ICN-BKK-20261205" → 그 날 정기 스케줄
const DMIN = '2026-01-01', DMAX = '2027-12-31';
const dash = x => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`;
const dot = x => `${x.slice(0, 4)}.${+x.slice(4, 6)}.${+x.slice(6, 8)}`;

async function loadSched(view, key, from, to, day) {
  if (schedBusy.has(key)) return;
  schedBusy.add(key);
  try { schedCache.set(key, await api.get(`/api/erp/board/sched?from=${from}&to=${to}&date=${day}`)); }
  catch (e) { schedCache.set(key, { error: e.message }); }
  schedBusy.delete(key);
  if (`${last && last.from}-${last && last.to}-${st.day}` === key) draw(view);
}

function draw(view) {
  const list = $('#bList', view), info = $('#bInfo', view);
  if (!list || !last) return;
  const d = last, admin = curEnv && curEnv.me.role === 'admin';
  const setLink = admin ? ' <a href="#/board/settings" style="text-decoration:underline">연결 설정</a>' : ' 관리자에게 부탁해 주세요.';
  // 날짜: 실시간 자료(어제·오늘·내일)는 바로, 그 밖의 날(2026~2027년)은 정기 스케줄로
  const ymd = todayStr().replace(/-/g, '');
  const days = [...new Set((d.rows || []).map(r => r.sched.slice(0, 8)).filter(Boolean))].sort();
  if (!/^\d{8}$/.test(st.day || '') || st.day < DMIN.replace(/-/g, '') || st.day > DMAX.replace(/-/g, '')) st.day = ymd;
  const dayRel = x => { const diff = Math.round((Date.UTC(+x.slice(0, 4), +x.slice(4, 6) - 1, +x.slice(6, 8)) - Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))) / 864e5); return { '-1': '어제', 0: '오늘', 1: '내일' }[diff] || ''; };
  const dayEl = $('#bDays', view);
  if (dayEl) {
    const chips = [...new Set([...days, ymd])].sort();
    dayEl.innerHTML = `<button class="btn sm" data-step="-1" title="하루 전" aria-label="하루 전">‹</button>
      <input type="date" id="bDate" min="${DMIN}" max="${DMAX}" value="${dash(st.day)}" aria-label="날짜" style="width:150px">
      <button class="btn sm" data-step="1" title="하루 뒤" aria-label="하루 뒤">›</button>
      ${chips.map(x => `<button class="chip ${x === st.day ? 'on' : ''}" data-day="${x}">${+x.slice(4, 6)}/${+x.slice(6, 8)}${dayRel(x) ? ' ' + dayRel(x) : ''}</button>`).join('')}`;
    const go = x => { if (x < DMIN.replace(/-/g, '') || x > DMAX.replace(/-/g, '')) return curEnv.toast('2026년 1월 1일 ~ 2027년 12월 31일 안에서 골라 주세요.'); st.day = x; draw(view); };
    $$('[data-day]', dayEl).forEach(b => b.onclick = () => go(b.dataset.day));
    $('#bDate', dayEl).onchange = e => { if (e.target.value) go(e.target.value.replace(/-/g, '')); };
    $$('[data-step]', dayEl).forEach(b => b.onclick = () => { const t = new Date(Date.UTC(+st.day.slice(0, 4), +st.day.slice(4, 6) - 1, +st.day.slice(6, 8)) + +b.dataset.step * 864e5); go(t.toISOString().slice(0, 10).replace(/-/g, '')); });
  }
  const dayTxt = `${st.day.slice(0, 4)}년 ${+st.day.slice(4, 6)}/${+st.day.slice(6, 8)}${dayRel(st.day) ? ' ' + dayRel(st.day) : ''}`;
  const note = (cls, html) => { info.textContent = ''; list.innerHTML = `<div class="alerts"><div class="alert ${cls}">${html}</div></div>`; };
  if (d.need) {
    return note('warn', (d.need === 'icn'
      ? '인천 출발·도착 운항표를 보려면 공공데이터포털 인증키가 필요합니다.'
      : `인천을 거치지 않는 노선(${esc(apName(d.from))} 출발)은 AeroDataBox 키가 있어야 볼 수 있습니다. 출발이나 도착을 인천으로 고르면 키 없이 볼 수 있습니다.`) + setLink);
  }
  let src = d, sch = null;
  if (!days.includes(st.day)) {
    const key = `${d.from}-${d.to}-${st.day}`;
    sch = schedCache.get(key);
    if (!sch) { info.textContent = ''; list.innerHTML = `<div class="loading">${esc(dayTxt)} 운항 스케줄 불러오는 중…</div>`; loadSched(view, key, d.from, d.to, st.day); return; }
    if (sch.error) return note('danger', esc(sch.error));
    if (sch.need) return note('warn', `${esc(dayTxt)}은(는) 실시간 운항 정보가 없는 날이라 <b>정기 운항 스케줄</b>로 보여 드립니다. 이 자료는 공공데이터포털에서 <b>「인천국제공항공사_여객기 정기운항 편 일정 조회」</b>를 따로 활용신청해야 나옵니다 (지금 쓰는 인증키 그대로, 무료).` + setLink);
    if (sch.seasonEnd && st.day > sch.seasonEnd) return note('warn', `${esc(dayTxt)} 스케줄은 아직 나오지 않았습니다. 지금 공개된 인천공항 정기 스케줄은 <b>${dot(sch.seasonEnd)}</b>까지입니다. 다음 시즌 스케줄은 항공사가 확정하면 (보통 시즌 시작 전) 자동으로 보입니다.`);
    if (st.day < ymd && (!sch.seasonStart || st.day < sch.seasonStart)) return note('warn', `${esc(dayTxt)}은(는) 지난 날짜입니다. 인천공항 자료는 지난 운항 기록을 어제까지만 주고, 지난 시즌 스케줄은 제공하지 않습니다.`);
    src = sch;
  }
  const dayRows = (src.rows || []).filter(r => r.sched.startsWith(st.day));
  const watch = watched();
  const mine = r => [r.flight, ...(r.alias || [])].some(f => watch.has(normFlight(f)));
  const q = st.q.trim().toLowerCase();
  // 항공사 고르기: 지금 노선에 있는 항공사만 목록에 (고른 항공사가 이 노선에 없어도 목록엔 남김)
  const count = code => dayRows.filter(r => ofAirline(r, code)).length;
  const extra = {};
  for (const r of dayRows) { const c = carrier(r.flight); if (c && !AIRLINE_NAME[c]) extra[c] = r.airline || c; }
  const sel = $('#bAir', view);
  const opt = (code, name) => { const n = count(code); return `<option value="${code}" ${code === st.airline ? 'selected' : ''}>${esc(name)} (${n ? n + '편' : '편 없음'})</option>`; };
  if (sel) sel.innerHTML = `<option value="">항공사 전체</option>${AIRLINES.map(([g, list]) => `<optgroup label="${g}">${list.map(([c, n]) => opt(c, n)).join('')}</optgroup>`).join('')}${Object.keys(extra).length ? `<optgroup label="그 밖">${Object.entries(extra).sort((a, b) => a[1].localeCompare(b[1], 'ko')).map(([c, n]) => opt(c, n)).join('')}</optgroup>` : ''}`;
  const rows = dayRows.filter(r => (!st.airline || ofAirline(r, st.airline)) && (!q || [r.flight, ...(r.alias || []), r.airline, r.other, r.otherName, apName(r.other)].join(' ').toLowerCase().includes(q)));
  const bad = rows.filter(r => r.cls === 'bad').length;
  const otherHead = d.to === 'ICN' && d.from !== 'ICN' ? '출발지' : '도착지';
  info.innerHTML = `${dayTxt} · ${esc(apName(d.from))} → ${esc(d.to ? apName(d.to) : '전체')} 직항 ${rows.length}편${st.airline ? ` (${esc(AIRLINE_NAME[st.airline] || extra[st.airline] || st.airline)})` : ''}${bad ? ` · <b style="color:#c0392b">지연·결항 ${bad}편</b>` : ''} · 시각은 ${esc(src.timeLabel)} 현지 기준 · ${sch ? `<b>정기 운항 스케줄</b> (실제 운항 상태가 아니라 계획표입니다. 지연·결항은 출발 하루 전부터 실시간으로 보입니다)` : `${new Date(d.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 받음`} · 자료: ${esc(src.source)}${src.demo ? ' · <b>미리보기 예시</b>' : ''}`;
  list.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(src.timeLabel)}</th><th>변경</th><th>편명</th><th class="hide-m">항공사</th><th>${otherHead}</th><th class="hide-m">터미널 · 게이트</th><th>상태</th><th></th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr${mine(r) ? ' style="background:#fffbea"' : ''}><td>${hm(r.sched)}</td><td>${r.est && r.est !== r.sched ? `<b>${hm(r.est)}</b>` : ''}</td>
        <td><b>${mine(r) ? '★ ' : ''}${esc(r.flight)}</b>${r.alias && r.alias.length ? `<div class="muted" style="font-size:12px">공동운항 ${esc(r.alias.join(' · '))}</div>` : ''}</td>
        <td class="hide-m">${esc(r.airline)}</td>
        <td>${esc(apName(r.other) !== r.other ? apName(r.other) : (r.otherName || r.other))} <span class="muted">${esc(r.other)}</span></td>
        <td class="hide-m">${esc([r.terminal, r.gate && '게이트 ' + r.gate].filter(Boolean).join(' · '))}</td>
        <td>${r.status ? `<span class="badge ${CLS[r.cls] || ''}">${esc(r.status)}</span>` : sch ? '<span class="badge">스케줄</span>' : ''}</td>
        <td><button class="btn sm" data-add="${i}" title="그룹에 넣기">+ 그룹</button></td></tr>`).join('')
      || `<tr><td colspan="8" class="muted" style="text-align:center;padding:32px">${st.airline ? `${dayTxt} ${esc(AIRLINE_NAME[st.airline] || extra[st.airline] || st.airline)}의 ` : `${dayTxt} `}${esc(apName(d.from))} → ${esc(d.to ? apName(d.to) : '전체')} 직항편이 없습니다.</td></tr>`}
    </tbody></table></div>
    <p class="muted" style="font-size:12px">직항편만 보입니다. 실제 탑승 시각·게이트는 항공사 안내가 우선입니다.</p>`;
  $$('[data-add]', list).forEach(b => b.onclick = () => { const r = rows[+b.dataset.add]; addDialog(view, { flight: r.flight, ...rowRoute(d, r), date: r.sched ? `${r.sched.slice(0, 4)}-${r.sched.slice(4, 6)}-${r.sched.slice(6, 8)}` : todayStr() }); });
}

// ----- 그룹 -----
function addDialog(view, item) {
  const env = curEnv;
  const d = env.drawer(`그룹에 넣기 · ${item.flight}`, `
    <div class="field"><label>그룹</label><select id="adG">${prefs.groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}<option value="">+ 새 그룹 만들기</option></select></div>
    <div class="field" id="adNewF" ${prefs.groups.length ? 'hidden' : ''}><label>새 그룹 이름</label><input id="adNew" placeholder="예: 11월 3일 파타야 김OO님 팀"></div>
    <div class="field"><label>탑승 날짜</label><input id="adDate" type="date" value="${esc(item.date)}"></div>
    <div class="field"><label>메모</label><input id="adMemo" placeholder="예: 4명, 픽업 기사 이OO"></div>
    <p class="muted" style="font-size:13px">${esc(apLabel(item.from))} → ${esc(apLabel(item.to))}</p>`,
    '<button class="btn primary" id="adOk">넣기</button>');
  $('#adG', d).onchange = e => { $('#adNewF', d).hidden = !!e.target.value; };
  $('#adOk', d).onclick = async () => {
    try {
      let g = prefs.groups.find(x => x.id === $('#adG', d).value);
      if (!g) { const name = $('#adNew', d).value.trim(); if (!name) return env.toast('새 그룹 이름을 넣어 주세요.'); g = await api.post('/api/erp/board/groups', { name }); prefs.groups.push(g); }
      await putItems(g, [...(g.items || []), { ...item, date: $('#adDate', d).value, memo: $('#adMemo', d).value, checked: false }]);
      env.closeDrawer(); env.toast(`"${g.name}" 그룹에 넣었습니다.`); drawGroups(view); draw(view);
    } catch (e) { env.toast(e.message); }
  };
}

async function putItems(g, items) {
  const r = await api.put('/api/erp/board/groups/' + g.id, { items });
  Object.assign(g, r);
  return g;
}

const statusCache = new Map();  // "ICN-BKK" → 운항표 (그룹 실시간 상태용)

function drawGroups(view) {
  const el = $('#gList', view);
  if (!el) return;
  const env = curEnv, t = todayStr();
  el.innerHTML = prefs.groups.map(g => {
    const items = g.items || [], done = items.filter(x => x.checked).length;
    return `<div class="card" style="margin:0 0 12px;padding:14px" data-g="${esc(g.id)}">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <b style="flex:1">${esc(g.name)}</b><span class="badge ${items.length && done === items.length ? 'g' : ''}">${done}/${items.length} 확인</span>
        <button class="btn sm" data-gren>이름 바꾸기</button><button class="btn sm" data-gdel>그룹 삭제</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>확인</th><th>편명</th><th>날짜</th><th class="hide-m">노선</th><th>실시간</th><th class="hide-m">메모</th><th></th></tr></thead><tbody>
      ${items.map(it => `<tr data-i="${esc(it.id)}"><td><input type="checkbox" data-chk ${it.checked ? 'checked' : ''} aria-label="${esc(it.flight)} 확인">${it.checked && it.checkedBy ? `<div class="muted" style="font-size:11px">${esc(it.checkedBy)}</div>` : ''}</td>
        <td><b>${esc(it.flight)}</b></td><td>${esc(it.date ? it.date.slice(5).replace('-', '/') : '')}${it.date === t ? ' <span class="badge b">오늘</span>' : ''}</td>
        <td class="hide-m">${it.from ? `${esc(apName(it.from))} → ${esc(apName(it.to))}` : '<span class="muted">-</span>'}</td>
        <td data-live>${it.from && it.to && (!it.date || it.date === t) ? '<span class="muted">…</span>' : '<span class="muted">-</span>'}</td>
        <td class="hide-m">${esc(it.memo)}</td><td><button class="btn sm" data-idel aria-label="빼기">×</button></td></tr>`).join('')
        || '<tr><td colspan="7" class="muted" style="text-align:center;padding:14px">아직 편이 없습니다.</td></tr>'}
      </tbody></table></div>
      <div class="filters" style="margin:10px 0 0">
        <input data-nf placeholder="편명 (TG659)" style="width:120px"><input data-nd type="date" value="${t}">
        <input data-nfrom list="apList" placeholder="출발 (ICN)" style="width:120px"><input data-nto list="apList" placeholder="도착 (BKK)" style="width:120px">
        <input data-nm class="grow" placeholder="메모"><button class="btn sm" data-nadd>+ 편 넣기</button></div>
    </div>`;
  }).join('') || '<div class="muted" style="text-align:center;padding:16px">그룹이 없습니다. "+ 새 그룹"을 눌러 만드세요.</div>';

  $$('[data-g]', el).forEach(card => {
    const g = prefs.groups.find(x => x.id === card.dataset.g);
    const save = async items => { try { await putItems(g, items); drawGroups(view); draw(view); } catch (e) { env.toast(e.message); drawGroups(view); } };
    $('[data-gren]', card).onclick = async () => { const n = prompt('그룹 이름', g.name); if (!n || n === g.name) return; try { Object.assign(g, await api.put('/api/erp/board/groups/' + g.id, { name: n })); drawGroups(view); } catch (e) { env.toast(e.message); } };
    $('[data-gdel]', card).onclick = async () => { if (!(await ask(`"${g.name}" 그룹을 지울까요? 안의 편 ${(g.items || []).length}개도 같이 지워집니다.`, '지우기'))) return; await api.del('/api/erp/board/groups/' + g.id); prefs.groups = prefs.groups.filter(x => x !== g); drawGroups(view); draw(view); };
    $$('[data-chk]', card).forEach(c => c.onchange = () => { const id = c.closest('tr').dataset.i; save(g.items.map(x => x.id === id ? { ...x, checked: c.checked } : x)); });
    $$('[data-idel]', card).forEach(b => b.onclick = () => { const id = b.closest('tr').dataset.i; save(g.items.filter(x => x.id !== id)); });
    $('[data-nadd]', card).onclick = () => {
      const flight = normFlight($('[data-nf]', card).value);
      if (!flight) return env.toast('편명을 넣어 주세요. (예: TG659)');
      const from = resolve($('[data-nfrom]', card).value), to = resolve($('[data-nto]', card).value);
      if (from === null || to === null) return env.toast('공항을 찾지 못했습니다. 영문 3글자 코드로 넣어 주세요.');
      save([...(g.items || []), { flight, date: $('[data-nd]', card).value, from: from || '', to: to || '', memo: $('[data-nm]', card).value, checked: false }]);
    };
  });
  groupStatus(view);
}

// 그룹에 있는 오늘 편의 실시간 상태 (노선별로 한 번만 묻고, 서버가 3~15분 저장)
async function groupStatus(view) {
  const el = $('#gList', view);
  if (!el) return;
  const t = todayStr(), need = new Map();
  for (const g of prefs.groups) for (const it of g.items || []) if (it.from && it.to && (!it.date || it.date === t)) need.set(it.from + '-' + it.to, [it.from, it.to]);
  for (const [k, [from, to]] of need) {
    const hit = statusCache.get(k);
    if (hit && Date.now() - hit.at < REFRESH) continue;
    try { statusCache.set(k, { at: Date.now(), d: await api.get(`/api/erp/board/route?from=${from}&to=${to}`) }); } catch { statusCache.set(k, { at: Date.now(), d: null }); }
  }
  for (const g of prefs.groups) for (const it of g.items || []) {
    const cell = $(`[data-g="${CSS.escape(g.id)}"] tr[data-i="${CSS.escape(it.id)}"] [data-live]`, el);
    if (!cell || !it.from || !it.to || (it.date && it.date !== t)) continue;
    const d = (statusCache.get(it.from + '-' + it.to) || {}).d;
    const r = d && (d.rows || []).find(x => (!it.date || x.sched.startsWith(it.date.replace(/-/g, ''))) && [x.flight, ...(x.alias || [])].some(f => normFlight(f) === normFlight(it.flight)));
    cell.innerHTML = !d ? '<span class="muted">확인 불가</span>' : d.need ? '<span class="muted">키 필요</span>'
      : !r ? '<span class="muted">운항표에 없음</span>'
      : `${hm(r.est || r.sched)} <span class="badge ${CLS[r.cls] || ''}">${esc(r.status || '예정')}</span>`;
  }
}

async function settingsView(view, env) {
  env.setBarAct('<a class="btn sm" href="#/board">← 운항 현황</a>');
  const c = await api.get('/api/erp/board/config');
  view.innerHTML = `
    ${c.server ? '' : '<div class="alerts"><div class="alert warn">미리보기에서는 실제 연결이 되지 않습니다.</div></div>'}
    <form id="bcf">
    <div class="card"><h2>인천 출발·도착 운항 <small>공공데이터포털 · 무료 · 이 키 하나면 됩니다</small></h2>
      <p class="muted" style="margin-top:0">출발이나 도착이 인천인 노선(인천→전세계, 전세계→인천)은 이 키 하나로 봅니다. data.go.kr에서 <b>인천국제공항공사_여객편 운항현황(다국어)</b>을 활용신청한 뒤, 마이페이지의 <b>일반 인증키</b>를 넣습니다. 프로그램(지구본)에 쓰던 그 키를 그대로 써도 됩니다.</p>
      <div class="field"><label>공공데이터 인증키 ${c.dataKey ? `<span class="badge g">저장됨 · ${esc(c.dataKey)}</span>` : '<span class="badge">없음</span>'}</label><input name="dataKey" type="password" autocomplete="off" placeholder="${c.dataKey ? '바꿀 때만 입력 (지우려면 - 입력)' : '인증키'}"></div>
      <div class="field"><label>또는 연결 서버 주소 (구글 Apps Script, 선택)</label><input name="proxyUrl" value="${esc(c.proxyUrl)}" placeholder="https://script.google.com/macros/s/…/exec">
        <div class="muted" style="font-size:13px">인증키로 직접 연결이 안 될 때만 씁니다. 넣으면 이 주소를 먼저 씁니다.</div></div>
    </div>
    <details ${c.adbKey ? 'open' : ''}><summary class="muted" style="cursor:pointer;margin-bottom:10px">인천을 거치지 않는 노선용 설정 (우리 회사는 쓰지 않음)</summary>
    <div class="card"><h2>인천 밖 노선 <small>AeroDataBox · 선택</small></h2>
      <p class="muted" style="margin-top:0">김해→방콕, 방콕→푸껫처럼 인천을 거치지 않는 노선은 AeroDataBox 키가 있어야 보입니다. RapidAPI(rapidapi.com) 또는 API.Market(api.market)에서 AeroDataBox 무료 요금제를 구독하고 키를 넣으세요. 더 많이 보려면 월 5달러 정도 요금제가 있습니다.</p>
      <div class="field"><label>구독한 곳</label><select name="adbProvider"><option value="rapidapi" ${c.adbProvider !== 'apimarket' ? 'selected' : ''}>RapidAPI</option><option value="apimarket" ${c.adbProvider === 'apimarket' ? 'selected' : ''}>API.Market</option></select></div>
      <div class="field"><label>API 키 ${c.adbKey ? `<span class="badge g">저장됨 · ${esc(c.adbKey)}</span>` : '<span class="badge">없음</span>'}</label><input name="adbKey" type="password" autocomplete="off" placeholder="${c.adbKey ? '바꿀 때만 입력 (지우려면 - 입력)' : 'API 키'}"></div>
    </div></details>
    <button class="btn primary">저장</button></form>`;
  $('#bcf', view).onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { proxyUrl: String(f.get('proxyUrl') || '').trim(), adbProvider: f.get('adbProvider') };
    for (const k of ['dataKey', 'adbKey']) { const v = String(f.get(k) || '').trim(); if (v === '-') body[k] = ''; else if (v) body[k] = v; }
    try { await api.put('/api/erp/board/config', body); env.toast('저장했습니다.'); settingsView(view, env); } catch (err) { env.toast(err.message); }
  };
}
