// ERP "항공권": 홈페이지 항공 예약·견적 요청 관리, 발권, 환불, 연결 설정
import { api } from '../shared/api.js';
import { ask } from '../shared/ask.js';
import { won } from '../shared/core.js';
import { FLIGHT_STATUSES, airportName } from '../shared/flights.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDT = ms => (ms ? new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const CLS = { '견적 요청': 'b', '결제 대기': 'o', '결제 완료': 'g', '발권 완료': 'g', '확인 필요': 'r', '환불 완료': '', '취소': 'r' };
const badge = s => `<span class="badge ${CLS[s] || ''}">${esc(s)}</span>`;
const route = b => `${airportName(b.search.from)}→${airportName(b.search.to)}${b.search.ret ? ' 왕복' : ' 편도'}`;
let filter = '';

// env: { toast, drawer, closeDrawer, setBarAct, me }
export async function flightsView(view, arg, env) {
  if (arg === 'settings') return settingsView(view, env);
  env.setBarAct(env.me.role === 'admin' ? '<a class="btn sm" href="#/flights/settings">연결 설정</a>' : '');
  const [list, cfg] = await Promise.all([api.get('/api/erp/flights' + (filter ? '?status=' + encodeURIComponent(filter) : '')), api.get('/api/flights/config')]);
  view.innerHTML = `
    ${cfg.live && !cfg.demo ? '' : `<div class="alerts"><div class="alert ${cfg.demo ? '' : 'warn'}">${cfg.demo ? '미리보기: 홈페이지 항공권 화면에 <b>예시 요금</b>이 보입니다.' : '실시간 요금이 아직 연결되지 않아 홈페이지에서는 <b>견적 요청</b>으로 받습니다. 요청을 눌러 요금을 넣으면 고객 "내 항공권"에 결제 버튼이 생깁니다.'}${env.me.role === 'admin' ? ' <a href="#/flights/settings" style="text-decoration:underline">연결 설정</a>' : ''}</div></div>`}
    <div class="filters">${['', ...FLIGHT_STATUSES].map(s => `<button class="chip ${filter === s ? 'on' : ''}" data-s="${esc(s)}">${s || '전체'}</button>`).join('')}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>번호</th><th>예약자</th><th>여정</th><th>날짜</th><th class="num">인원</th><th class="num hide-m">금액</th><th>상태</th></tr></thead>
    <tbody>${list.map(b => `<tr class="click" data-id="${esc(b.id)}"><td>${esc(b.no)}<div class="muted" style="font-size:12px">${fmtDT(b.createdAt)}</div></td>
      <td>${esc(b.name)}<div class="muted" style="font-size:12px">${esc(b.phone)}</div></td>
      <td>${esc(route(b))}${b.offer ? `<div class="muted" style="font-size:12px">${esc(b.offer.airline)}</div>` : ''}</td>
      <td>${esc(b.search.depart)}${b.search.ret ? `<div class="muted" style="font-size:12px">~ ${esc(b.search.ret)}</div>` : ''}</td>
      <td class="num">${b.search.adults}</td><td class="num hide-m">${b.price ? won(b.price) : '-'}</td><td>${badge(b.status)}</td></tr>`).join('')
      || '<tr><td colspan="7" class="muted" style="text-align:center;padding:32px">항공권 예약·견적 요청이 없습니다.</td></tr>'}</tbody></table></div>`;
  $$('.chip', view).forEach(c => c.onclick = () => { filter = c.dataset.s; flightsView(view, null, env); });
  $$('tr[data-id]', view).forEach(tr => tr.onclick = () => openFlight(tr.dataset.id, env, () => flightsView(view, null, env)));
  if (arg) openFlight(arg, env, () => flightsView(view, null, env));
}

function sliceText(s) {
  return `${s.from} ${(s.dep || '').slice(5, 16).replace('T', ' ')} → ${s.to} ${(s.arr || '').slice(11, 16)} · ${s.stops ? `경유 ${s.stops}회` : '직항'} · ${s.flights.join(' ')}`;
}

async function openFlight(id, env, after) {
  const b = await api.get('/api/erp/flights/' + id);
  const o = b.offer, p = b.payment;
  const canRefund = p && (p.refunded || 0) < p.amount;
  const d = env.drawer(`${b.no} · ${b.name}`, `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">${badge(b.status)}<span class="muted" style="font-size:13px">접수 ${fmtDT(b.createdAt)} · 회원 ${esc(b.memberEmail)}</span></div>
    ${b.issue ? `<div class="alerts"><div class="alert danger">${esc(b.issue)}</div></div>` : ''}
    <div class="money">
      <div><span>판매 금액</span><b>${b.price ? won(b.price) : '-'}</b></div>
      <div><span>결제</span><b>${p ? won(p.amount) : '-'}</b></div>
      <div><span>환불</span><b>${p && p.refunded ? won(p.refunded) : '-'}</b></div>
      <div><span>항공 예약번호</span><b>${esc(b.pnr || '-')}</b></div>
    </div>
    <dl class="kv">
      <dt>여정</dt><dd>${esc(route(b))} · ${esc(b.search.depart)}${b.search.ret ? ' ~ ' + esc(b.search.ret) : ''} · 성인 ${b.search.adults}명 · ${b.search.cabin === 'business' ? '비즈니스' : '일반석'}</dd>
      <dt>연락처</dt><dd>${esc(b.phone)} · ${esc(b.email || '')}</dd>
      ${b.note ? `<dt>고객 요청</dt><dd style="white-space:pre-line">${esc(b.note)}</dd>` : ''}
      ${o ? `<dt>항공편</dt><dd>${esc(o.airline)}<br>${o.slices.map(s => esc(sliceText(s))).join('<br>')}</dd>
      <dt>원가</dt><dd>${esc(o.currency)} ${o.amount.toLocaleString('en-US')} (환율 ${Math.round(o.rate * 100) / 100})</dd>
      <dt>규정</dt><dd>환불 ${o.refund ? (o.refund.allowed ? `가능${o.refund.penalty ? ` (수수료 ${o.refund.cur} ${o.refund.penalty})` : ''}` : '불가') : '확인 필요'} · 변경 ${o.change ? (o.change.allowed ? `가능${o.change.penalty ? ` (수수료 ${o.change.cur} ${o.change.penalty})` : ''}` : '불가') : '확인 필요'}${o.docsRequired ? ' · <b>여권 정보 필요</b>' : ''}</dd>` : ''}
      ${b.passengers && b.passengers.length ? `<dt>탑승객</dt><dd>${b.passengers.map(x => `${esc(x.family)}/${esc(x.given)} · ${esc(x.birth)} · ${x.gender === 'f' ? '여' : '남'}`).join('<br>')}</dd>` : ''}
      ${b.payBy ? `<dt>결제 기한</dt><dd>${esc(new Date(b.payBy).toLocaleString('ko-KR'))}</dd>` : ''}
      ${p ? `<dt>결제</dt><dd>${esc(p.method)} ${won(p.amount)} · ${fmtDT(p.at)}${p.receipt ? ` · <a href="${esc(p.receipt)}" target="_blank" rel="noopener" style="text-decoration:underline">영수증</a>` : ''}</dd>` : ''}
    </dl>
    <div class="sec-title">${o ? '처리' : '견적 넣기'}</div>
    <form id="ff">
      ${!p ? `<div class="field"><label>판매 금액 (원, 전체 인원 합계)</label><input name="price" inputmode="numeric" value="${b.price || ''}" placeholder="예: 1280000"></div>` : ''}
      ${!o ? `<div class="field"><label>고객에게 보여 줄 항공편 내용</label><textarea name="quoteText" placeholder="예: 타이항공 TG659 10:20 출발 / TG658 23:40 출발, 수하물 23kg">${esc(b.quoteText || '')}</textarea></div>
      <div class="field"><label>결제 기한</label><input name="payBy" type="datetime-local" value="${b.payBy ? esc(new Date(new Date(b.payBy).getTime() + 9 * 3600e3).toISOString().slice(0, 16)) : ''}"></div>` : ''}
      <div class="field"><label>항공 예약번호 (PNR)</label><input name="pnr" value="${esc(b.pnr || '')}" placeholder="발권처에서 받은 예약번호"></div>
      <div class="field"><label>상태</label><select name="status">${FLIGHT_STATUSES.map(s => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>직원 메모</label><textarea name="staffNote">${esc(b.staffNote || '')}</textarea></div>
    </form>
    <div class="sec-title">기록</div>
    <div class="history">${(b.history || []).slice().reverse().map(h => `<div>${fmtDT(h.at)} · ${esc(h.by)} · ${esc(h.action)}</div>`).join('')}</div>`,
    `<button class="btn primary" id="fsave">저장</button>
     ${b.price && !p ? '<button class="btn" id="fpaid">계좌 입금 확인</button>' : ''}
     ${o && p && b.status !== '발권 완료' ? '<button class="btn" id="ftk">발권하기</button>' : ''}
     ${canRefund ? `<button class="btn" id="frf">${p.key ? '카드 결제 취소' : '환불 처리'}</button>` : ''}`);
  const done = msg => { env.toast(msg); env.closeDrawer(); after(); };
  $('#fsave', d).onclick = async () => {
    const f = Object.fromEntries(new FormData($('#ff', d)));
    if (f.payBy) f.payBy = new Date(f.payBy + ':00+09:00').toISOString();
    if (f.price === '') delete f.price; else if (f.price != null) f.price = Number(String(f.price).replace(/[^\d]/g, ''));
    try { await api.patch('/api/erp/flights/' + id, { ...f, logText: f.price && !b.price ? `견적 금액 ${won(f.price)} 안내` : '내용 수정' }); done('저장했습니다.' + (f.price && !b.price ? ' 고객 "내 항공권"에 결제 버튼이 생겼습니다.' : '')); }
    catch (e) { env.toast(e.message); }
  };
  if ($('#fpaid', d)) $('#fpaid', d).onclick = async () => {
    if (!(await ask(`${won(b.price)} 입금을 확인하셨나요?`, '입금 확인'))) return;
    try { await api.patch('/api/erp/flights/' + id, { markPaid: true, logText: '계좌 입금 확인' }); done('입금 확인했습니다.'); } catch (e) { env.toast(e.message); }
  };
  if ($('#ftk', d)) $('#ftk', d).onclick = async () => {
    if (!(await ask('Duffel로 발권합니다. Duffel 잔액에서 항공 요금이 빠져나갑니다. 진행할까요?', '발권하기'))) return;
    const btn = $('#ftk', d); btn.disabled = true; btn.textContent = '발권하는 중…';
    try { const r = await api.post(`/api/erp/flights/${id}/ticket`); done(`발권했습니다. 항공 예약번호 ${r.pnr}`); }
    catch (e) { env.toast(e.message); after(); env.closeDrawer(); }
  };
  if ($('#frf', d)) $('#frf', d).onclick = async () => {
    const left = p.amount - (p.refunded || 0);
    const amt = prompt(`환불할 금액 (최대 ${left.toLocaleString('ko-KR')}원)`, String(left));
    if (!amt) return;
    const reason = prompt('환불 사유', '고객 요청') || '고객 요청';
    try { await api.post(`/api/erp/flights/${id}/refund`, { amount: Number(amt.replace(/[^\d]/g, '')), reason }); done(p.key ? '카드 결제를 취소했습니다.' : '환불 처리했습니다.'); }
    catch (e) { env.toast(e.message); }
  };
}

async function settingsView(view, env) {
  env.setBarAct('<a class="btn sm" href="#/flights">← 항공권 목록</a>');
  const c = await api.get('/api/erp/flights-config');
  view.innerHTML = `
    ${c.server ? '' : '<div class="alerts"><div class="alert warn">미리보기에서는 실제 연결이 되지 않습니다. 사무실 서버에서 설정해 주세요.</div></div>'}
    <form id="cf">
    <div class="card"><h2>실시간 항공 요금 · 발권 <small>Duffel</small></h2>
      <p class="muted" style="margin-top:0">duffel.com에서 회사로 가입한 뒤 Developers → Access tokens에서 만든 토큰을 넣습니다. <b>duffel_test_</b>로 시작하면 시험용(가짜 항공사), <b>duffel_live_</b>로 시작하면 실제 발권입니다.</p>
      <div class="field"><label>Duffel 토큰 ${c.duffel ? `<span class="badge ${c.duffelMode === '실제' ? 'g' : 'o'}">${esc(c.duffelMode)} · ${esc(c.duffel)}</span>` : '<span class="badge">없음</span>'}</label><input name="duffelToken" autocomplete="off" placeholder="${c.duffel ? '바꿀 때만 입력 (지우려면 - 입력)' : 'duffel_test_...'}"></div>
      <label class="check"><input type="checkbox" name="autoTicket" ${c.autoTicket ? 'checked' : ''}> 카드 결제가 끝나면 바로 자동 발권 (끄면 직원이 "발권하기"를 눌러 발권)</label>
    </div>
    <div class="card"><h2>카드 결제 <small>토스페이먼츠</small></h2>
      <p class="muted" style="margin-top:0">토스페이먼츠 개발자센터 → API 키에서 클라이언트 키와 시크릿 키를 복사해 넣습니다. <b>test_</b>로 시작하면 시험 결제(돈이 안 나감), <b>live_</b>는 계약 후 실제 결제입니다.</p>
      <div class="field"><label>클라이언트 키 ${c.tossClient ? `<span class="badge ${c.tossMode === '실제' ? 'g' : 'o'}">${esc(c.tossMode)} · ${esc(c.tossClient)}</span>` : '<span class="badge">없음</span>'}</label><input name="tossClientKey" autocomplete="off" placeholder="${c.tossClient ? '바꿀 때만 입력' : 'test_ck_...'}"></div>
      <div class="field"><label>시크릿 키 ${c.tossSecret ? '<span class="badge g">저장됨</span>' : '<span class="badge">없음</span>'}</label><input name="tossSecretKey" type="password" autocomplete="off" placeholder="${c.tossSecret ? '바꿀 때만 입력' : 'test_sk_...'}"></div>
    </div>
    <div class="card"><h2>판매 금액 계산</h2>
      <p class="muted" style="margin-top:0">고객 금액 = 항공 원가 × 환율 × (1 + 환율 여유) + 1인 수수료 × 인원 (100원 단위 올림). 카드 수수료와 Duffel 수수료(건당 3달러 + 1%, 환전 2%)가 여기서 나옵니다.</p>
      <div class="grid"><div class="field"><label>1인 발권 수수료 (원)</label><input name="markupPerPax" inputmode="numeric" value="${c.markupPerPax}"></div>
      <div class="field"><label>환율 여유 (%)</label><input name="fxBuffer" inputmode="decimal" value="${c.fxBuffer}"></div></div>
      <p class="muted">환율은 비워 두면(0) 6시간마다 자동으로 받아 옵니다. 고정하려면 1단위당 원화를 넣으세요.</p>
      <div class="grid">${Object.entries(c.rates).map(([k, v]) => `<div class="field"><label>1 ${k} =</label><input data-rate="${k}" inputmode="decimal" value="${v || ''}" placeholder="자동"></div>`).join('')}</div>
    </div>
    <button class="btn primary" id="csave">저장</button></form>`;
  $('#cf', view).onsubmit = async e => {
    e.preventDefault();
    const f = new FormData($('#cf', view));
    const body = { markupPerPax: f.get('markupPerPax'), fxBuffer: f.get('fxBuffer'), autoTicket: f.get('autoTicket') === 'on', rates: Object.fromEntries($$('[data-rate]', view).map(i => [i.dataset.rate, i.value])) };
    for (const k of ['duffelToken', 'tossClientKey', 'tossSecretKey']) { const v = String(f.get(k) || '').trim(); if (v === '-') body[k] = ''; else if (v) body[k] = v; }
    try { await api.put('/api/erp/flights-config', body); env.toast('저장했습니다.'); settingsView(view, env); } catch (err) { env.toast(err.message); }
  };
}
