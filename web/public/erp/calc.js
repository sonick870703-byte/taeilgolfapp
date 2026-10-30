// ERP "금액 계산기": 우리 상품 또는 골프장·숙박을 직접 골라 날짜별로 금액을 자동 계산합니다.
// 계산 규칙은 shared/calc.js (서버·미리보기와 같은 코드). 요금표(원가)는 저장소에만 있고 엑셀로 올립니다.
import { api } from '../shared/api.js';
import { ask } from '../shared/ask.js';
import { won } from '../shared/core.js';
import { compute, defaultDays, quoteText, RATE_KINDS, RATE_SHEETS, rateToRow, CALC_DEFAULTS } from '../shared/calc.js?v=20261030a';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const wd = ymd => (ymd ? WD[new Date(ymd + 'T00:00:00Z').getUTCDay()] : '');
const fmtDT = ms => (ms ? new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const opt = (v, label, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(label)}</option>`;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const DRAFT = 'taeil.calc.draft';
const ymdPlus = n => new Date(Date.now() + 9 * 3600000 + n * 86400000).toISOString().slice(0, 10);

let data = null;   // { cfg, rates, products }
let st = null;     // 계산 입력
let rateKind = 'golf';

function loadDraft() {
  try { const s = JSON.parse(localStorage.getItem(DRAFT)); if (s && s.mode) return s; } catch { /* 없음 */ }
  return { mode: 'custom', departDate: ymdPlus(30), nights: 3, pax: 4, singles: 0, hotelId: 'none', rooms: 0, carId: '', pickup: true, send: true, greenIncl: true, days: [] };
}
const saveDraft = () => { try { localStorage.setItem(DRAFT, JSON.stringify(st)); } catch { /* 무시 */ } };

async function load() {
  const [c, products] = await Promise.all([api.get('/api/erp/calc'), api.get('/api/erp/products')]);
  data = { cfg: c.cfg, rates: c.rates, products };
}
const golfRates = () => data.rates.filter(r => r.kind === 'golf');
const hotelRates = () => data.rates.filter(r => r.kind === 'hotel');
const carRates = () => data.rates.filter(r => r.kind === 'car');

// env: { toast, drawer, closeDrawer, setBarAct, me, loadXlsx, copy }
export async function calcView(view, arg, env) {
  await load();
  if (arg === 'rates') return ratesView(view, env);
  if (arg === 'quotes') return quotesView(view, env);
  env.setBarAct(`<a class="btn sm" href="#/calc/quotes">저장한 견적</a><a class="btn sm" href="#/calc/rates">요금표</a>${env.me.role === 'admin' ? '<button class="btn sm" id="cCfg">환율 · 마진</button>' : ''}`);
  if ($('#cCfg')) $('#cCfg').onclick = () => configDrawer(env, () => calcView(view, arg, env));
  if (!st) st = loadDraft();
  if (!data.rates.length) {
    view.innerHTML = `<div class="card"><h2>요금표가 아직 없습니다</h2>
      <p>골프장·숙박·차량 요금표(원가)를 한 번 올리면 금액이 자동으로 계산됩니다. 회사 공유 폴더의 <b>태일골프_요금표_초기자료.xlsx</b>를 <a href="#/calc/rates">요금표</a> 화면에서 "엑셀로 올리기"로 올려 주세요.</p>
      <p class="muted">요금표는 원가라서 ERP 안에만 저장하고 홈페이지·프로그램 파일에는 넣지 않습니다.</p>
      <a class="btn primary" href="#/calc/rates">요금표 올리러 가기</a></div>`;
    return;
  }
  render(view, env);
}

function render(view, env) {
  const golf = golfRates(), hotels = hotelRates(), cars = carRates();
  const products = data.products.filter(p => p.visible !== false || p.basePrice);
  const prod0 = () => data.products.find(p => p.id === st.productId);
  if (st.mode === 'product' && !products.some(p => p.id === st.productId)) st.productId = (products[0] || {}).id || '';
  if (st.carId && !cars.some(c => c.id === st.carId)) st.carId = '';
  // 상품이면 같은 지역의 "그린피 상품 포함" 골프장을 먼저 고름 (처음 일정을 만들 때만)
  if (!st.days.length) {
    const city = st.mode === 'product' && prod0() ? prod0().city || '' : '';
    const pick = st.mode === 'product' ? (golf.find(g => g.greenIncl && city && (g.area || '').includes(city)) || golf.find(g => g.greenIncl)) : golf.find(g => !g.greenIncl);
    st.courseId = (pick || golf[0] || {}).id || '';
  }
  st.days = defaultDays(st, data);
  const r = compute(st, data);
  saveDraft();
  const pax = r.pax;
  const prod = data.products.find(p => p.id === st.productId);
  const hotel = hotels.find(h => h.id === st.hotelId);
  const autoRooms = hotel ? Math.ceil((pax - r.singles) / (hotel.cap || 2)) + r.singles : 0;
  const costCell = ok => (ok ? '' : '<span class="muted">-</span>');
  const sel = (name, list, value, extra = '') => `<select data-k="${name}" ${extra}>${list}</select>`;

  view.innerHTML = `
    <div class="filters">
      <button class="chip ${st.mode === 'product' ? 'on' : ''}" data-mode="product">우리 상품</button>
      <button class="chip ${st.mode === 'custom' ? 'on' : ''}" data-mode="custom">골프장 · 숙박 직접 고르기 (골프만 가능)</button>
      <button class="btn sm ghost" id="cReset" style="margin-left:auto">처음부터</button>
    </div>
    <div class="card"><h2>기본 정보</h2>
      <div class="grid3">
        <div class="field"><label for="cDep">출발일</label><input id="cDep" type="date" data-k="departDate" value="${esc(st.departDate)}"></div>
        <div class="field"><label for="cN">박 수</label><input id="cN" type="number" min="1" max="100" data-k="nights" value="${r.nights}"><span class="hint">1 ~ 100박 · 돌아오는 날 ${esc(r.returnDate)}</span></div>
        <div class="field"><label for="cP">인원</label><input id="cP" type="number" min="1" max="200" data-k="pax" value="${pax}"></div>
      </div>
      <div class="grid3">
        <div class="field"><label for="cS">1인 1실 인원</label><input id="cS" type="number" min="0" max="${pax}" data-k="singles" value="${r.singles}"><span class="hint">${st.mode === 'product' ? '홀수 인원 1명은 자동으로 1인 1실' : '나머지는 객실 정원대로 같이 씀'}</span></div>
        ${st.mode === 'product' ? `
        <div class="field" style="grid-column:span 2"><label for="cProd">상품</label>${sel('productId', products.map(p => opt(p.id, `${p.title}${p.basePrice ? '' : ' (기준가 미입력)'}`, st.productId)).join(''), st.productId, 'id="cProd"')}
          <label class="check" style="margin-top:6px"><input type="checkbox" data-k="greenIncl" ${st.greenIncl !== false ? 'checked' : ''}> 그린피는 상품 요금에 포함 (카트·캐디만 따로 계산)</label>
          ${prod ? `<span class="hint">기준가 ${prod.basePrice ? won(prod.basePrice) : '미입력'} · 고객가 ${prod.basePrice ? won(prod.basePrice + 20000) : '-'} (1인)${prod.category === 'unlimited' && Number(prod.nights) === 1 ? ' · 1박 요금 × 박 수' : ''}</span>` : ''}</div>` : `
        <div class="field"><label for="cHotel">숙박</label>${sel('hotelId', opt('none', '숙박 없음 (골프만)', st.hotelId) + hotels.map(h => opt(h.id, `${h.name}${h.area ? ' · ' + h.area : ''}`, st.hotelId)).join(''), st.hotelId, 'id="cHotel"')}
          ${hotels.length ? '' : '<span class="hint">요금표에 숙박이 없습니다. <a href="#/calc/rates">요금표</a>에서 추가하세요.</span>'}</div>
        <div class="field"><label for="cRooms">객실 수</label><input id="cRooms" type="number" min="0" max="200" data-k="rooms" value="${st.rooms || ''}" placeholder="자동 ${autoRooms}" ${hotel ? '' : 'disabled'}><span class="hint">비우면 자동 (${autoRooms}실)</span></div>`}
      </div>
      <div class="grid3">
        <div class="field"><label for="cCar">차량 · 공항 송영 요금</label>${sel('carId', opt('', '차량 없음', st.carId) + cars.map(c => opt(c.id, c.name, st.carId)).join(''), st.carId, 'id="cCar"')}
          <span class="hint">3인 이하 승용차 · 4인 이상 승합차. 골프장 ↔ 골프장 이동 무료</span></div>
        <div class="field"><label>공항 송영 (각 1회)</label>
          <label class="check"><input type="checkbox" data-k="pickup" ${st.pickup ? 'checked' : ''} ${st.carId ? '' : 'disabled'}> 입국 때 픽업</label>
          <label class="check"><input type="checkbox" data-k="send" ${st.send ? 'checked' : ''} ${st.carId ? '' : 'disabled'}> 출국 때 샌딩</label></div>
      </div>
    </div>

    <div class="card"><h2>날짜별 일정 <small>날짜마다 골프장 · 홀 · 캐디 · 카트를 고르면 바로 계산됩니다. 0 = 안 씀</small></h2>
      <div class="filters" style="align-items:center"><span class="muted" style="font-size:13px">모든 날 한 번에</span>
        <select id="allCourse" aria-label="모든 날 골프장"><option value="">골프장 선택</option>${golf.map(g => opt(g.id, g.nameKo || g.name, '')).join('')}</select>
        <select id="allCad" aria-label="모든 날 캐디"><option value="">캐디</option>${range(0, pax).map(n => opt(n, `캐디 ${n}명`, '')).join('')}</select>
        <select id="allCart" aria-label="모든 날 카트"><option value="">카트</option>${range(0, pax).map(n => opt(n, `카트 ${n}대`, '')).join('')}</select>
        <select id="allHoles" aria-label="모든 날 홀"><option value="">홀</option>${[9, 18, 27, 36].map(h => opt(h, `${h}홀`, '')).join('')}</select>
      </div>
      <div class="tbl-wrap"><table class="tbl calc-days"><thead><tr><th>날짜</th><th>골프</th><th>골프장</th><th>홀</th><th>주말 요금</th><th>캐디</th><th>카트</th>${st.mode === 'custom' ? '<th>호텔↔골프장 차량</th>' : ''}<th class="num">소계</th></tr></thead><tbody>
      ${st.days.map((d, i) => { const row = r.days[i] || { items: {}, total: 0 }; return `<tr data-i="${i}">
        <td>${esc(d.date ? d.date.slice(5).replace('-', '/') : `${i + 1}일째`)} (${wd(d.date)})${i === 0 ? '<div class="muted" style="font-size:12px">도착</div>' : i === st.days.length - 1 ? '<div class="muted" style="font-size:12px">출발</div>' : ''}</td>
        <td><input type="checkbox" data-d="golf" ${d.golf ? 'checked' : ''} aria-label="골프"></td>
        <td><select data-d="courseId" ${d.golf ? '' : 'disabled'} aria-label="골프장">${golf.map(g => opt(g.id, g.nameKo || g.name, d.courseId)).join('')}</select></td>
        <td><select data-d="holes" ${d.golf ? '' : 'disabled'} aria-label="홀">${[9, 18, 27, 36].map(h => opt(h, h + '홀', d.holes)).join('')}</select></td>
        <td><input type="checkbox" data-d="weekend" ${d.weekend ? 'checked' : ''} ${d.golf ? '' : 'disabled'} aria-label="주말 요금"></td>
        <td><select data-d="caddie" ${d.golf ? '' : 'disabled'} aria-label="캐디 인원">${range(0, pax).map(n => opt(n, n ? `${n}명` : '안 씀', d.caddie)).join('')}</select></td>
        <td><select data-d="cart" ${d.golf ? '' : 'disabled'} aria-label="카트 대수">${range(0, pax).map(n => opt(n, n ? `${n}대` : '안 씀', d.cart)).join('')}</select></td>
        ${st.mode === 'custom' ? `<td><input type="checkbox" data-d="transfer" ${d.transfer ? 'checked' : ''} ${d.golf && st.carId && !(hotel && hotel.golftel) ? '' : 'disabled'} aria-label="차량"></td>` : ''}
        <td class="num">${row.total ? won(row.total) : costCell(false)}</td></tr>`; }).join('')}
      </tbody></table></div>
    </div>

    ${r.warnings.length ? `<div class="card alerts">${r.warnings.map(w => `<div class="alert" style="cursor:default"><span class="dot warn"></span><span class="t">${esc(w)}</span></div>`).join('')}</div>` : ''}

    <div class="card calc-sum"><h2>예상 금액 <small>${r.pax}명 · ${r.nights}박 · 골프 ${r.rounds}일</small></h2>
      <div class="kv">
        ${Object.entries(r.groups).map(([g, v]) => `<span>${esc(g)}</span><b>${won(v)}</b>`).join('') || '<span>항목</span><b>없음</b>'}
        <span>계${r.vat ? ' (VAT 미포함)' : ''}</span><b>${won(r.subtotal)}</b>
        ${r.vat ? `<span>VAT ${r.vatRate}%</span><b>${won(r.vat)}</b>` : ''}
        <span style="font-size:17px">합 계${r.vat ? ' (VAT 포함)' : ''}</span><b style="font-size:20px;color:var(--brand,#0f7a43)">${won(r.total)}</b>
        <span>1인당 약</span><b>${won(r.perPerson)}</b>
        <span>예약금 20%</span><b>${won(r.deposit)} <small class="muted">예약 확정 때</small></b>
        <span>잔금 80%</span><b>${won(r.balance)} ${r.balanceDue ? `<small class="muted">${esc(r.balanceDue)}까지</small>` : ''}</b>
        ${r.refundDeadline ? `<span>환불 기한</span><b>${esc(r.refundDeadline)} <small class="muted">출발 14일 전까지</small></b>` : ''}
      </div>
      <div class="muted" style="font-size:13px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)">직원만 보기 · 원가 ${won(r.cost)} · 마진 ${won(r.margin)} (VAT 빼고) · 환율 ${Object.entries(data.cfg.fx).filter(([k]) => k !== 'KRW' && data.rates.some(x => x.cur === k)).map(([k, v]) => `1 ${k} = ${v}원`).join(', ')} <span title="${esc(data.cfg.fxDate)}">(${esc(data.cfg.fxDate || '')})</span></div>
      <div class="filters" style="margin-top:12px">
        <button class="btn primary" id="cCopy">고객 안내문 복사</button>
        <button class="btn" id="cSave">견적 저장</button>
        <button class="btn ghost" id="cPrint">인쇄 · PDF</button>
      </div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">캐디팁은 현지에서 직접 주는 돈이라 계산에 넣지 않습니다. 항공권 · 여행자보험 별도.</p>
    </div>

    <details class="card"><summary style="cursor:pointer;font-weight:700">항목별 자세히 (${r.lines.length}줄)</summary>
      <div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>구분</th><th>내용</th><th class="num">수량</th><th class="num">단가</th><th class="num">금액</th><th class="num hide-m">원가</th></tr></thead><tbody>
      ${r.lines.map(l => `<tr><td>${esc(l.group)}</td><td>${l.date ? `<span class="muted">${esc(l.date.slice(5))}</span> ` : ''}${esc(l.label)}${l.note ? ` <span class="muted">(${esc(l.note)})</span>` : ''}</td><td class="num">${l.qty}</td><td class="num">${won(l.unit)}</td><td class="num">${won(l.total)}</td><td class="num hide-m muted">${won(Math.round(l.cost))}</td></tr>`).join('')}
      </tbody></table></div></details>`;

  const rerender = () => render(view, env);
  $$('[data-mode]', view).forEach(b => b.onclick = () => { st.mode = b.dataset.mode; st.days = []; rerender(); });
  $('#cReset', view).onclick = () => { st = { ...loadDraftDefaults(), mode: st.mode }; rerender(); };
  $$('[data-k]', view).forEach(el => el.onchange = () => {
    const k = el.dataset.k;
    if (el.type === 'checkbox') st[k] = el.checked;
    else if (el.type === 'number') st[k] = el.value === '' ? 0 : Number(el.value);
    else st[k] = el.value;
    if (k === 'nights') st.nights = Math.max(1, Math.min(100, st.nights || 1));
    if (k === 'pax') { st.pax = Math.max(1, Math.min(200, st.pax || 1)); st.days = st.days.map(d => ({ ...d, caddie: Math.min(d.caddie, st.pax), cart: Math.min(d.cart, st.pax) })); }
    if (k === 'departDate') st.days = st.days.map(d => ({ ...d, weekendSet: false }));
    if (k === 'productId' || k === 'hotelId') st.rooms = 0;
    if (k === 'productId') st.days = [];
    rerender();
  });
  $$('tr[data-i] [data-d]', view).forEach(el => el.onchange = () => {
    const d = st.days[+el.closest('tr').dataset.i];
    const k = el.dataset.d;
    if (el.type === 'checkbox') d[k] = el.checked; else d[k] = k === 'courseId' ? el.value : Number(el.value);
    if (k === 'weekend') d.weekendSet = true;
    if (k === 'courseId') { const c = golf.find(g => g.id === el.value); if (c && !c.wd18.c) d.caddie = 0; if (c && !c.wd18.cart) d.cart = 0; }
    rerender();
  });
  const all = (id, fn) => { $(id, view).onchange = e => { if (e.target.value === '') return; st.days.forEach(d => { if (d.golf) fn(d, e.target.value); }); rerender(); }; };
  all('#allCourse', (d, v) => { d.courseId = v; });
  all('#allCad', (d, v) => { d.caddie = Number(v); });
  all('#allCart', (d, v) => { d.cart = Number(v); });
  all('#allHoles', (d, v) => { d.holes = Number(v); });
  const title = () => (st.mode === 'product' ? (prod ? prod.title : '상품') : `맞춤 골프${hotel ? ' · ' + hotel.name : ' (골프만)'}`);
  $('#cCopy', view).onclick = () => env.copy(quoteText(r, st, { title: title(), wonFmt: won }));
  $('#cPrint', view).onclick = () => window.print();
  $('#cSave', view).onclick = () => {
    const d = env.drawer('견적 저장', `<div class="field"><label for="qT">견적 이름</label><input id="qT" value="${esc(title())}"></div>
      <div class="field"><label for="qC">고객 (이름 · 연락처, 선택)</label><input id="qC"></div>
      <p class="muted">합 계 ${won(r.total)} · 1인당 약 ${won(r.perPerson)}. 저장한 견적은 "저장한 견적"에서 다시 불러와 고칠 수 있습니다.</p>`, '<button class="btn primary" id="qGo">저장</button>');
    $('#qGo', d).onclick = async () => {
      try { await api.post('/api/erp/quotes', { title: $('#qT', d).value, customer: $('#qC', d).value, input: st, total: r.total, perPerson: r.perPerson }); env.toast('견적을 저장했습니다.'); env.closeDrawer(); }
      catch (err) { env.toast(err.message); }
    };
  };
}
function loadDraftDefaults() { try { localStorage.removeItem(DRAFT); } catch { /* 무시 */ } return loadDraft(); }

// ---------- 저장한 견적 ----------
async function quotesView(view, env) {
  env.setBarAct('<a class="btn sm primary" href="#/calc">계산기로</a>');
  const list = await api.get('/api/erp/quotes');
  view.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>저장</th><th>견적</th><th class="hide-m">고객</th><th class="num">합 계</th><th class="num hide-m">1인당</th><th></th></tr></thead><tbody>
    ${list.map(q => `<tr class="click" data-id="${esc(q.id)}"><td>${fmtDT(q.createdAt)}<div class="muted" style="font-size:12px">${esc(q.by || '')}</div></td>
      <td>${esc(q.title)}<div class="muted" style="font-size:12px">${esc(q.input.departDate || '')} · ${q.input.nights || ''}박 · ${q.input.pax || ''}명</div></td>
      <td class="hide-m">${esc(q.customer)}</td><td class="num">${won(q.total)}</td><td class="num hide-m">${won(q.perPerson)}</td>
      <td><button class="btn sm ghost" data-del="${esc(q.id)}" aria-label="견적 삭제">삭제</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="muted" style="text-align:center;padding:32px">저장한 견적이 없습니다. 계산기에서 "견적 저장"을 누르면 여기에 쌓입니다.</td></tr>'}</tbody></table></div>`;
  $$('tr[data-id]', view).forEach(tr => tr.onclick = e => {
    if (e.target.closest('[data-del]')) return;
    const q = list.find(x => x.id === tr.dataset.id);
    st = { ...q.input }; saveDraft(); location.hash = '#/calc';
  });
  $$('[data-del]', view).forEach(b => b.onclick = async () => {
    if (!await ask('이 견적을 삭제할까요?')) return;
    await api.del('/api/erp/quotes/' + b.dataset.del); quotesView(view, env);
  });
}

// ---------- 요금표 ----------
const curOf = r => r.cur || 'THB';
const n0 = v => (v ? Number(v).toLocaleString('ko-KR') : '<span class="muted">-</span>');

async function ratesView(view, env) {
  const admin = env.me.role === 'admin';
  env.setBarAct(`<a class="btn sm" href="#/calc">계산기로</a><a class="btn sm ghost" href="../assets/rates-template.xlsx" download>빈 양식</a><button class="btn sm" id="rOut">엑셀로 받기</button>${admin ? '<label class="btn sm primary" style="cursor:pointer">엑셀로 올리기<input type="file" id="rIn" accept=".xlsx,.xls" hidden></label>' : ''}`);
  const list = data.rates.filter(r => r.kind === rateKind);
  const head = {
    golf: '<th>골프장</th><th class="hide-m">지역</th><th>통화</th><th class="num">평일 그린피</th><th class="num">주말 그린피</th><th class="num">캐디피</th><th class="num">카트비(1대)</th><th class="num hide-m">공식 평일(참고)</th>',
    hotel: '<th>숙박시설</th><th class="hide-m">지역</th><th>통화</th><th class="num">1실 1박</th><th class="num">정원</th><th class="num">1인 1실</th><th class="hide-m">조식 · 골프텔</th>',
    car: '<th>이름</th><th class="hide-m">지역</th><th>통화</th><th>단위</th><th class="num">공항 픽업 (승용/승합)</th><th class="num">공항 샌딩</th><th class="num">호텔↔골프장 왕복</th>',
  }[rateKind];
  const row = r => ({
    golf: () => `<td>${esc(r.nameKo || r.name)}<div class="muted" style="font-size:12px">${esc(r.name)}${r.greenIncl ? ' · 그린피 상품 포함' : ''}</div></td><td class="hide-m">${esc(r.area)}</td><td>${curOf(r)}</td><td class="num">${n0(r.wd18.g)}</td><td class="num">${n0(r.we18.g)}</td><td class="num">${n0(r.wd18.c)}</td><td class="num">${n0(r.wd18.cart)}</td><td class="num hide-m">${n0(r.offWd)}</td>`,
    hotel: () => `<td>${esc(r.name)}</td><td class="hide-m">${esc(r.area)}</td><td>${curOf(r)}</td><td class="num">${n0(r.room)}</td><td class="num">${r.cap}</td><td class="num">${n0(r.single)}</td><td class="hide-m">${r.breakfast ? '조식 ' : ''}${r.golftel ? '골프텔' : ''}</td>`,
    car: () => `<td>${esc(r.name)}</td><td class="hide-m">${esc(r.area)}</td><td>${curOf(r)}</td><td>${r.unit === 'person' ? '1인' : '차량'}</td>${r.unit === 'person' ? `<td class="num" colspan="2">1인 ${[r.p1, r.p2, r.p3, r.p4].map(v => v || '-').join(' / ')} (1·2·3·4명+)</td><td class="num muted">-</td>` : `<td class="num">${n0(r.car.pickup)} / ${n0(r.van.pickup)}</td><td class="num">${n0(r.car.send)} / ${n0(r.van.send)}</td><td class="num">${n0(r.car.day)} / ${n0(r.van.day)}</td>`}`,
  }[rateKind]());
  view.innerHTML = `
    <div class="filters">${Object.entries(RATE_KINDS).map(([k, n]) => `<button class="chip ${k === rateKind ? 'on' : ''}" data-rk="${k}">${n} ${data.rates.filter(r => r.kind === k).length}</button>`).join('')}
      <button class="btn sm primary" id="rNew" style="margin-left:auto">+ ${RATE_KINDS[rateKind]} 추가</button></div>
    <p class="muted" style="font-size:13px">금액은 원가(현지 통화)입니다. 고객가 = 원가 × 환율 + 마진. 캐디피는 1인당, 카트비는 카트 1대당. 원가라서 홈페이지에는 보이지 않습니다.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>
      ${list.map(r => `<tr class="click" data-id="${esc(r.id)}">${row(r)}</tr>`).join('') || `<tr><td colspan="8" class="muted" style="text-align:center;padding:32px">${RATE_KINDS[rateKind]} 요금이 없습니다. "+ 추가"나 "엑셀로 올리기"로 넣어 주세요.</td></tr>`}
    </tbody></table></div>`;
  const again = async () => { await load(); ratesView(view, env); };
  $$('[data-rk]', view).forEach(b => b.onclick = () => { rateKind = b.dataset.rk; ratesView(view, env); });
  $('#rNew', view).onclick = () => rateEditor(env, { kind: rateKind, cur: rateKind === 'car' ? 'KRW' : 'THB', country: '태국' }, again);
  $$('tr[data-id]', view).forEach(tr => tr.onclick = () => rateEditor(env, data.rates.find(r => r.id === tr.dataset.id), again));
  $('#rOut').onclick = async () => {
    try {
      const XLSX = await env.loadXlsx();
      const wb = XLSX.utils.book_new();
      for (const [k, def] of Object.entries(RATE_SHEETS)) {
        const rows = data.rates.filter(r => r.kind === k).map(rateToRow);
        XLSX.utils.book_append_sheet(wb, rows.length ? XLSX.utils.json_to_sheet(rows, { header: def.cols.map(c => c[1]) }) : XLSX.utils.aoa_to_sheet([def.cols.map(c => c[1])]), def.sheet);
      }
      XLSX.writeFile(wb, `태일골프_요금표_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) { env.toast(err.message || '엑셀 프로그램을 불러오지 못했습니다.'); }
  };
  if ($('#rIn')) $('#rIn').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const XLSX = await env.loadXlsx();
      const wb = XLSX.read(await f.arrayBuffer());
      const rows = [];
      const count = {};
      for (const [k, def] of Object.entries(RATE_SHEETS)) {
        const ws = wb.Sheets[def.sheet];
        if (!ws) continue;
        const rs = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true }).filter(x => Object.values(x).some(v => String(v).trim()));
        rs.forEach(x => rows.push({ kind: k, row: x }));
        count[k] = rs.filter(x => !/^예시/.test(String(Object.values(x)[0] || '')) && !/^예시/.test(String(Object.values(x)[1] || ''))).length;
      }
      if (!rows.length) return env.toast('시트(골프장 · 숙박 · 차량)를 찾지 못했습니다. 양식 그대로 써 주세요.');
      const d = env.drawer('요금표 올리기', `<p>${Object.entries(count).map(([k, n]) => `${RATE_KINDS[k]} <b>${n}</b>줄`).join(' · ')}을 읽었습니다. 예시 줄은 건너뜁니다.</p>
        <label class="check"><input type="radio" name="rm" value="merge" checked> 코드가 같으면 고치고, 새 코드는 추가 (나머지는 그대로)</label>
        <label class="check"><input type="radio" name="rm" value="replace"> 파일에 있는 종류는 지금 요금표를 지우고 파일 내용으로 바꾸기</label>`, '<button class="btn primary" id="rGo">올리기</button>');
      $('#rGo', d).onclick = async () => {
        try {
          const res = await api.post('/api/erp/calc/import', { rows, replace: $('[name=rm]:checked', d).value === 'replace' });
          env.toast(`요금 ${res.count}줄을 올렸습니다.`); env.closeDrawer(); again();
        } catch (err) { env.toast(err.message); }
      };
    } catch (err) { env.toast(err.message || '엑셀을 읽지 못했습니다.'); }
  };
}

function rateEditor(env, r, after) {
  const isNew = !r.id;
  const def = RATE_SHEETS[r.kind];
  const val = key => { const [a, b] = key.split('.'); const v = b ? (r[a] || {})[b] : r[key]; return v ?? ''; };
  const boolKeys = ['breakfast', 'golftel', 'greenIncl'];
  const fields = def.cols.filter(([k]) => k !== 'code' || isNew).map(([k, h]) => {
    if (boolKeys.includes(k)) return `<label class="check"><input type="checkbox" name="${k}" ${r[k] ? 'checked' : ''}> ${esc(h)}</label>`;
    if (k === 'cur') return `<div class="field"><label>${esc(h)}</label><select name="cur">${['THB', 'USD', 'KRW', 'MYR', 'VND', 'PHP', 'JPY'].map(c => opt(c, c, r.cur || 'THB')).join('')}</select></div>`;
    if (k === 'unit') return `<div class="field"><label>${esc(h)}</label><select name="unit">${opt('vehicle', '차량 1대당', r.unit)}${opt('person', '1인당 (인원별 요금)', r.unit)}</select></div>`;
    const numeric = !['name', 'nameKo', 'country', 'area', 'season', 'note', 'code'].includes(k);
    return `<div class="field"><label>${esc(h)}</label><input name="${k}" ${numeric ? 'type="number" min="0" step="any"' : ''} value="${esc(val(k) === 0 ? '' : val(k))}"></div>`;
  });
  const d = env.drawer(`${RATE_KINDS[r.kind]} ${isNew ? '추가' : '수정'}`, `<form id="rf" class="grid2">${fields.join('')}</form>
    <p class="muted" style="font-size:13px">금액은 원가(현지 통화). 캐디피 1인당, 카트비 카트 1대당. 주말 캐디·카트비가 비면 평일 값으로 계산합니다.</p>`,
    `${!isNew && env.me.role === 'admin' ? '<button class="btn" id="rDel" style="color:var(--danger);margin-right:auto">삭제</button>' : ''}<button class="btn primary" id="rSave">${isNew ? '추가' : '저장'}</button>`);
  $('#rSave', d).onclick = async () => {
    const f = new FormData($('#rf', d));
    const body = { ...r };
    for (const [k] of def.cols) {
      if (boolKeys.includes(k)) { body[k] = !!f.get(k); continue; }
      if (!f.has(k)) continue;
      const [a, b] = k.split('.');
      if (b) { body[a] = { ...(body[a] || {}) }; body[a][b] = Number(f.get(k)) || 0; } else body[k] = f.get(k);
    }
    try { await api.put('/api/erp/calc/rates/' + (isNew ? 'new' : r.id), body); env.toast('저장했습니다.'); env.closeDrawer(); after(); }
    catch (err) { env.toast(err.message); }
  };
  if ($('#rDel', d)) $('#rDel', d).onclick = async () => {
    if (!await ask(`"${r.nameKo || r.name}" 요금을 삭제할까요?`)) return;
    await api.del('/api/erp/calc/rates/' + r.id); env.toast('삭제했습니다.'); env.closeDrawer(); after();
  };
}

// ---------- 환율 · 마진 (관리자) ----------
function configDrawer(env, after) {
  const c = { ...CALC_DEFAULTS, ...data.cfg };
  const curs = [...new Set([...Object.keys(c.fx), ...data.rates.map(r => r.cur)])].filter(k => k && k !== 'KRW');
  const d = env.drawer('환율 · 마진', `
    <div class="sec-title">환율 (1 통화 = 원)</div>
    <div class="grid3">${curs.map(k => `<div class="field"><label>1 ${k}</label><input type="number" step="any" min="0" data-fx="${k}" value="${c.fx[k] || ''}"></div>`).join('')}</div>
    <div class="field"><label for="fxD">환율 기준</label><input id="fxD" value="${esc(c.fxDate || '')}"></div>
    <button class="btn sm" id="fxLive" type="button">오늘 환율 받기</button> <span class="muted" style="font-size:12px">Exchange Rate API 하루 한 번 갱신 자료. 국제환율 프로그램이 준비되면 그쪽으로 연결합니다.</span>
    <div class="sec-title">마진 (원)</div>
    <div class="grid3">
      <div class="field"><label for="mG">그린피 · 1라운드 1인당</label><input id="mG" type="number" min="0" step="1000" value="${c.markupGolf}"></div>
      <div class="field"><label for="mH">숙박 · 1실 1박당</label><input id="mH" type="number" min="0" step="1000" value="${c.markupHotel}"></div>
      <div class="field"><label for="mC">차량 · 1회당</label><input id="mC" type="number" min="0" step="1000" value="${c.markupCar}"></div>
    </div>
    <div class="grid3">
      <div class="field"><label for="mR">그린피 · 숙박 올림 단위</label><select id="mR">${[100, 500, 1000, 5000, 10000].map(v => opt(v, won(v), c.round)).join('')}</select></div>
      <div class="field"><label for="mV">VAT (%)</label><input id="mV" type="number" min="0" max="50" value="${c.vat}"><span class="hint">0이면 VAT 줄을 숨깁니다</span></div>
      <div class="field"><label for="mHo">주말 요금 받는 휴일 (월-일)</label><input id="mHo" value="${esc((c.holidays || []).join(', '))}" placeholder="12-31, 01-01"></div>
    </div>`, '<button class="btn primary" id="cfgSave">저장</button>');
  $('#fxLive', d).onclick = async () => {
    try { const n = await api.post('/api/erp/calc/fx'); data.cfg = n; for (const [k, v] of Object.entries(n.fx)) { const i = $(`[data-fx="${k}"]`, d); if (i) i.value = v; } $('#fxD', d).value = n.fxDate; env.toast('오늘 환율을 받아 저장했습니다.'); }
    catch (err) { env.toast(err.message); }
  };
  $('#cfgSave', d).onclick = async () => {
    const fx = {};
    $$('[data-fx]', d).forEach(i => { fx[i.dataset.fx] = Number(i.value) || 0; });
    try {
      await api.put('/api/erp/calc/config', { fx, fxDate: $('#fxD', d).value, markupGolf: $('#mG', d).value, markupHotel: $('#mH', d).value, markupCar: $('#mC', d).value,
        round: $('#mR', d).value, vat: $('#mV', d).value, holidays: $('#mHo', d).value.split(/[,\s]+/).filter(Boolean) });
      env.toast('저장했습니다.'); env.closeDrawer(); after();
    } catch (err) { env.toast(err.message); }
  };
}

