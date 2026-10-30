// ERP "운항 현황": 공항 출발·도착 실시간 운항표, 우리 고객 편(관심 편명) 표시, 연결 설정
import { api } from '../shared/api.js';
import { BOARD_AIRPORTS, boardAirportName, isGolfRoute, normFlight } from '../shared/flight-board.js?v=20261030c';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = s => (s ? s.slice(8, 10) + ':' + s.slice(10, 12) : '');
const CLS = { ok: 'g', warn: 'o', bad: 'r' };
const REFRESH = 3 * 60 * 1000;

// 화면을 다시 열어도 고른 값 유지
const st = { airport: 'ICN', dir: 'D', mine: false, q: '' };
let timer = null, curEnv = null;

// env: { toast, setBarAct, me }
export async function boardView(view, arg, env) {
  clearInterval(timer);
  curEnv = env;
  if (arg === 'settings') return settingsView(view, env);
  env.setBarAct(env.me.role === 'admin' ? '<a class="btn sm" href="#/board/settings">연결 설정</a>' : '');
  view.innerHTML = `
    <div class="filters">
      <select id="bAp" aria-label="공항">${BOARD_AIRPORTS.map(g => `<optgroup label="${esc(g.group)}">${g.list.map(a => `<option value="${a.code}" ${a.code === st.airport ? 'selected' : ''}>${esc(a.name)} ${a.code}</option>`).join('')}</optgroup>`).join('')}</select>
      <button class="chip ${st.dir === 'D' ? 'on' : ''}" data-dir="D">출발</button>
      <button class="chip ${st.dir === 'A' ? 'on' : ''}" data-dir="A">도착</button>
      <button class="chip ${st.mine ? 'on' : ''}" id="bMine">우리 고객 편만</button>
      <input class="grow" id="bQ" placeholder="편명·항공사·도시 찾기" value="${esc(st.q)}">
      <button class="btn sm" id="bReload">새로고침</button>
    </div>
    <div id="bInfo" class="muted" style="font-size:13px;margin-bottom:10px"></div>
    <div id="bList"><div class="loading">불러오는 중…</div></div>
    <div class="card" style="margin-top:16px"><h2>우리 고객 편 <small>관심 편명</small></h2>
      <p class="muted" style="margin-top:0">고객이 타는 편명을 넣어 두면 운항표에서 <b>★</b>로 표시되고 "우리 고객 편만"으로 모아 볼 수 있습니다. 쉼표로 구분 (예: TG659, KE651, 7C2203).</p>
      <div class="filters"><input class="grow" id="bWatch" placeholder="TG659, KE651"><button class="btn sm" id="bWatchSave">저장</button></div>
    </div>`;
  $('#bAp', view).onchange = e => { st.airport = e.target.value; load(view, env); };
  $$('[data-dir]', view).forEach(b => b.onclick = () => { st.dir = b.dataset.dir; $$('[data-dir]', view).forEach(x => x.classList.toggle('on', x === b)); load(view, env); });
  $('#bMine', view).onclick = e => { st.mine = !st.mine; e.target.classList.toggle('on', st.mine); draw(view); };
  $('#bQ', view).oninput = e => { st.q = e.target.value; draw(view); };
  $('#bReload', view).onclick = () => load(view, env);
  $('#bWatchSave', view).onclick = async () => {
    try { const r = await api.put('/api/erp/board/watch', { watch: $('#bWatch', view).value }); last.watch = r.watch; $('#bWatch', view).value = r.watch.join(', '); draw(view); env.toast('저장했습니다.'); } catch (e) { env.toast(e.message); }
  };
  await load(view, env);
  // 화면을 보고 있는 동안 3분마다 새로 받음 (서버도 3~15분 저장해 두므로 사용량은 늘지 않음)
  timer = setInterval(() => { if (!view.isConnected || !$('#bList', view)) return clearInterval(timer); if (!document.hidden) load(view, env, true); }, REFRESH);
}

let last = { rows: [], watch: [] };

async function load(view, env, quiet) {
  const list = $('#bList', view);
  if (!list) return;
  if (!quiet) list.innerHTML = '<div class="loading">불러오는 중…</div>';
  try {
    last = await api.get(`/api/erp/board?airport=${st.airport}&dir=${st.dir}`);
    const w = $('#bWatch', view);
    if (w && document.activeElement !== w) w.value = (last.watch || []).join(', ');
    draw(view);
  } catch (e) {
    if (!quiet) list.innerHTML = `<div class="alerts"><div class="alert danger">${esc(e.message)}</div></div>`;
  }
}

function draw(view) {
  const list = $('#bList', view), info = $('#bInfo', view);
  if (!list) return;
  const d = last, admin = curEnv && curEnv.me.role === 'admin';
  if (d.need) {
    info.textContent = '';
    list.innerHTML = `<div class="alerts"><div class="alert warn">${d.need === 'icn'
      ? '인천공항 실시간 운항표를 보려면 공공데이터포털 인증키가 필요합니다.'
      : `${esc(boardAirportName(d.airport))} 운항표는 AeroDataBox 키가 있어야 볼 수 있습니다. (인천은 키 없이 공공데이터로 봅니다)`}
      ${admin ? ' <a href="#/board/settings" style="text-decoration:underline">연결 설정</a>' : ' 관리자에게 연결 설정을 부탁해 주세요.'}</div></div>`;
    return;
  }
  const watch = new Set((d.watch || []).map(normFlight));
  const isMine = r => [r.flight, ...(r.alias || [])].some(f => watch.has(normFlight(f)));
  const q = st.q.trim().toLowerCase();
  const rows = (d.rows || []).filter(r => isGolfRoute(d.airport, r.other) && !r.via && (!st.mine || isMine(r))
    && (!q || [r.flight, ...(r.alias || []), r.airline, r.other, r.otherName, boardAirportName(r.other)].join(' ').toLowerCase().includes(q)));
  const bad = rows.filter(r => r.cls === 'bad').length;
  info.innerHTML = `${esc(boardAirportName(d.airport))} ${d.dir === 'D' ? '출발' : '도착'} 직항 ${rows.length}편 (한국 ↔ 골프 여행지)${bad ? ` · <b style="color:#c0392b">지연·결항 ${bad}편</b>` : ''} · 시각은 ${esc(boardAirportName(d.airport))} 현지 기준 · ${new Date(d.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 받음 · 자료: ${esc(d.source)}${d.demo ? ' · <b>미리보기 예시</b>' : ''}`;
  list.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>예정</th><th>변경</th><th>편명</th><th class="hide-m">항공사</th><th>${d.dir === 'D' ? '목적지' : '출발지'}</th><th class="hide-m">터미널 · 게이트</th><th>상태</th></tr></thead><tbody>
    ${rows.map(r => {
      const mine = isMine(r);
      return `<tr${mine ? ' style="background:#fffbea"' : ''}><td>${hm(r.sched)}</td><td>${r.est && r.est !== r.sched ? `<b>${hm(r.est)}</b>` : ''}</td>
        <td><b>${mine ? '★ ' : ''}${esc(r.flight)}</b>${r.alias && r.alias.length ? `<div class="muted" style="font-size:12px">공동운항 ${esc(r.alias.join(' · '))}</div>` : ''}</td>
        <td class="hide-m">${esc(r.airline)}</td>
        <td>${esc(boardAirportName(r.other) !== r.other ? boardAirportName(r.other) : (r.otherName || r.other))} <span class="muted">${esc(r.other)}</span></td>
        <td class="hide-m">${esc([r.terminal, r.gate && '게이트 ' + r.gate].filter(Boolean).join(' · '))}</td>
        <td>${r.status ? `<span class="badge ${CLS[r.cls] || ''}">${esc(r.status)}</span>` : ''}</td></tr>`;
    }).join('') || `<tr><td colspan="7" class="muted" style="text-align:center;padding:32px">${st.mine ? '우리 고객 편이 이 시간대에 없습니다.' : '조건에 맞는 운항 편이 없습니다.'}</td></tr>`}
    </tbody></table></div>
    <p class="muted" style="font-size:12px">실제 탑승 시각·게이트는 항공사 안내가 우선입니다.</p>`;
}

async function settingsView(view, env) {
  env.setBarAct('<a class="btn sm" href="#/board">← 운항 현황</a>');
  const c = await api.get('/api/erp/board/config');
  view.innerHTML = `
    ${c.server ? '' : '<div class="alerts"><div class="alert warn">미리보기에서는 실제 연결이 되지 않습니다.</div></div>'}
    <form id="bcf">
    <div class="card"><h2>인천공항 실시간 운항 <small>공공데이터포털 · 무료</small></h2>
      <p class="muted" style="margin-top:0">data.go.kr에서 <b>인천국제공항공사_여객편 운항현황(다국어)</b>을 활용신청한 뒤, 마이페이지의 <b>일반 인증키(Decoding)</b>를 넣습니다. 프로그램(지구본)에 쓰던 그 키를 그대로 써도 됩니다.</p>
      <div class="field"><label>공공데이터 인증키 ${c.dataKey ? `<span class="badge g">저장됨 · ${esc(c.dataKey)}</span>` : '<span class="badge">없음</span>'}</label><input name="dataKey" type="password" autocomplete="off" placeholder="${c.dataKey ? '바꿀 때만 입력 (지우려면 - 입력)' : '인증키'}"></div>
      <div class="field"><label>또는 연결 서버 주소 (구글 Apps Script, 선택)</label><input name="proxyUrl" value="${esc(c.proxyUrl)}" placeholder="https://script.google.com/macros/s/…/exec">
        <div class="muted" style="font-size:13px">인증키로 직접 연결이 안 될 때만 씁니다. 넣으면 이 주소를 먼저 씁니다.</div></div>
    </div>
    <div class="card"><h2>해외·지방 공항 운항 <small>AeroDataBox</small></h2>
      <p class="muted" style="margin-top:0">방콕 수완나품, 김해, 김포, 제주 등 인천 밖의 공항은 AeroDataBox로 봅니다. RapidAPI(rapidapi.com)에서 AeroDataBox를 구독하면 무료 Basic 요금제가 있고, 더 많이 보려면 월 5달러 정도 요금제가 있습니다. 공항 하나를 15분에 한 번만 불러 사용량을 아낍니다.</p>
      <div class="field"><label>구독한 곳</label><select name="adbProvider"><option value="rapidapi" ${c.adbProvider !== 'apimarket' ? 'selected' : ''}>RapidAPI</option><option value="apimarket" ${c.adbProvider === 'apimarket' ? 'selected' : ''}>API.Market</option></select></div>
      <div class="field"><label>API 키 ${c.adbKey ? `<span class="badge g">저장됨 · ${esc(c.adbKey)}</span>` : '<span class="badge">없음</span>'}</label><input name="adbKey" type="password" autocomplete="off" placeholder="${c.adbKey ? '바꿀 때만 입력 (지우려면 - 입력)' : 'X-RapidAPI-Key'}"></div>
    </div>
    <button class="btn primary">저장</button></form>`;
  $('#bcf', view).onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { proxyUrl: String(f.get('proxyUrl') || '').trim(), adbProvider: f.get('adbProvider') };
    for (const k of ['dataKey', 'adbKey']) { const v = String(f.get(k) || '').trim(); if (v === '-') body[k] = ''; else if (v) body[k] = v; }
    try { await api.put('/api/erp/board/config', body); env.toast('저장했습니다.'); settingsView(view, env); } catch (err) { env.toast(err.message); }
  };
}
