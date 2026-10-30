// 홈페이지 "항공권" 화면 (#/flights, #/flights/my)
import { api } from './api.js';
import { ask } from './ask.js';
import { won, todayKST, addDays } from './core.js';
import { ORIGINS, DESTINATIONS, airportName } from './flights.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = iso => (iso || '').slice(11, 16);
const md = iso => { const d = new Date((iso || '').slice(0, 10) + 'T00:00:00'); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()}(${'일월화수목금토'[d.getDay()]})`; };
const dur = m => `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
const dayPlus = (a, b) => { const n = Math.round((Date.parse((b || '').slice(0, 10)) - Date.parse((a || '').slice(0, 10))) / 86400000); return n > 0 ? `<sup>+${n}</sup>` : ''; };
const STATUS_CLS = { '견적 요청': 'b', '결제 대기': 'o', '결제 완료': 'g', '발권 완료': 'g', '확인 필요': 'o', '환불 완료': '', '취소': 'r' };

let last = null; // 마지막 검색 (뒤로 왔을 때 그대로)

function css() {
  if ($('#flightsCss')) return;
  const l = document.createElement('link');
  l.id = 'flightsCss'; l.rel = 'stylesheet'; l.href = new URL('./flights.css', import.meta.url).href;
  document.head.append(l);
}

// env: { app, me, site, toast, login() }
export async function flightsPage(sub, env) {
  css();
  if (sub === 'my') return myFlights(env);
  const { app, site } = env;
  const cfg = await api.get('/api/flights/config').catch(() => ({ live: false }));
  const t = todayKST();
  const s = last || { from: 'ICN', to: 'BKK', depart: addDays(t, 30), return: addDays(t, 35), adults: 2, cabin: 'economy', trip: 'round' };
  const destOpts = DESTINATIONS.map(g => `<optgroup label="${esc(g.group)}">${g.list.map(a => `<option value="${a.code}" ${a.code === s.to ? 'selected' : ''}>${esc(a.name)} (${a.code})</option>`).join('')}</optgroup>`).join('');
  app.innerHTML = `<div class="fl-hero"><div class="wrap">
      <h1>항공권</h1>
      <p>${cfg.live ? (cfg.demo ? '미리보기 화면입니다. 아래 요금은 <b>예시</b>이며 실제 요금이 아닙니다.' : '항공사 실시간 요금을 바로 보고 예약·결제할 수 있습니다.') : '원하는 날짜와 인원을 남겨 주시면 담당자가 가장 좋은 요금을 찾아 안내드립니다.'}</p>
      <form class="fl-search" id="fs" novalidate>
        <div class="fl-trip" role="radiogroup" aria-label="여정">
          <label><input type="radio" name="trip" value="round" ${s.trip !== 'oneway' ? 'checked' : ''}> 왕복</label>
          <label><input type="radio" name="trip" value="oneway" ${s.trip === 'oneway' ? 'checked' : ''}> 편도</label>
        </div>
        <div class="fl-grid">
          <div class="field"><label for="fFrom">출발</label><select id="fFrom">${ORIGINS.map(a => `<option value="${a.code}" ${a.code === s.from ? 'selected' : ''}>${esc(a.name)} (${a.code})</option>`).join('')}</select></div>
          <div class="field"><label for="fTo">도착</label><select id="fTo">${destOpts}</select></div>
          <div class="field"><label for="fDep">가는 날</label><input type="date" id="fDep" min="${addDays(t, 1)}" value="${esc(s.depart)}"></div>
          <div class="field" id="retWrap"><label for="fRet">오는 날</label><input type="date" id="fRet" min="${addDays(t, 1)}" value="${esc(s.return)}"></div>
          <div class="field"><label for="fAd">인원 (성인)</label><select id="fAd">${Array.from({ length: 9 }, (_, k) => `<option value="${k + 1}" ${k + 1 === +s.adults ? 'selected' : ''}>${k + 1}명</option>`).join('')}</select></div>
          <div class="field"><label for="fCab">좌석</label><select id="fCab"><option value="economy">일반석</option><option value="business" ${s.cabin === 'business' ? 'selected' : ''}>비즈니스</option></select></div>
        </div>
        <button class="btn primary block" id="fGo">${cfg.live ? '항공권 검색' : '이 조건으로 견적 받기'}</button>
        <p class="fl-small">아동·유아 동반, 단체(10명 이상), 골프백 추가는 <a href="${esc(site.kakaoUrl || '#')}" target="_blank" rel="noopener">카톡 상담</a>으로 문의해 주세요.${env.me ? ' · <a href="#/flights/my">내 항공권 보기</a>' : ''}</p>
      </form></div></div>
    <div class="wrap fl-body" id="fr"></div>`;
  const trip = () => $('input[name=trip]:checked').value;
  const syncTrip = () => { $('#retWrap').hidden = trip() === 'oneway'; };
  document.querySelectorAll('input[name=trip]').forEach(r => r.onchange = syncTrip); syncTrip();
  $('#fDep').onchange = () => { if ($('#fRet').value && $('#fRet').value < $('#fDep').value) $('#fRet').value = addDays($('#fDep').value, 5); };
  const read = () => ({ trip: trip(), from: $('#fFrom').value, to: $('#fTo').value, depart: $('#fDep').value, return: trip() === 'oneway' ? '' : $('#fRet').value, adults: +$('#fAd').value, cabin: $('#fCab').value });
  $('#fs').onsubmit = async e => {
    e.preventDefault();
    const q = read();
    if (!q.depart) return env.toast('가는 날을 골라 주세요.');
    if (q.trip === 'round' && !q.return) return env.toast('오는 날을 골라 주세요.');
    last = q;
    if (!cfg.live) return quoteForm(q, env);
    await search(q, cfg, env);
  };
  if (last && cfg.live) search(last, cfg, env);
}

async function search(q, cfg, env) {
  const box = $('#fr');
  box.innerHTML = '<div class="loading">항공사 요금을 모으는 중입니다… (최대 20초)</div>';
  const btn = $('#fGo'); btn.disabled = true;
  try {
    const qs = new URLSearchParams({ from: q.from, to: q.to, depart: q.depart, return: q.return || '', adults: q.adults, cabin: q.cabin });
    const r = await api.get('/api/flights/search?' + qs);
    if (!r.live) return quoteForm(q, env);
    render(r, q, env);
  } catch (e) {
    box.innerHTML = `<div class="empty">${esc(e.message)}<br><button class="btn" id="toQuote">이 조건으로 견적 받기</button></div>`;
    $('#toQuote').onclick = () => quoteForm(q, env);
  } finally { btn.disabled = false; }
}

function render(r, q, env) {
  const box = $('#fr');
  let directOnly = false;
  const draw = () => {
    const list = r.offers.filter(o => !directOnly || o.slices.every(s => s.stops === 0));
    box.innerHTML = `<div class="fl-head">
        <div><b>${esc(airportName(q.from))} → ${esc(airportName(q.to))}</b> · ${md(q.depart)}${q.return ? ` ~ ${md(q.return)}` : ' 편도'} · 성인 ${q.adults}명
        <div class="fl-small">${r.demo ? '<b class="fl-demo">예시 요금 (실제 요금 아님)</b> · ' : ''}${list.length}개 · 낮은 요금 순 · ${new Date(r.cachedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준</div></div>
        <label class="check" style="margin:0"><input type="checkbox" id="dOnly" ${directOnly ? 'checked' : ''}> 직항만</label></div>
      ${list.map((o, k) => card(o, k, r.demo)).join('') || '<div class="empty">조건에 맞는 항공편이 없습니다. 날짜를 바꿔 보시거나 견적을 요청해 주세요.<br><button class="btn" id="toQuote">견적 받기</button></div>'}
      <p class="fl-small">표시 요금은 1인 기준 세금·유류할증료·발권 수수료가 포함된 원화 금액입니다. 항공사 요금은 수시로 바뀌며, 예약 단계에서 한 번 더 확인합니다. 환불·변경은 항공사 운임 규정을 따릅니다.</p>`;
    $('#dOnly').onchange = e => { directOnly = e.target.checked; draw(); };
    if ($('#toQuote')) $('#toQuote').onclick = () => quoteForm(q, env);
    box.querySelectorAll('[data-k]').forEach(b => b.onclick = () => bookForm(list[+b.dataset.k], q, env, r.demo));
  };
  draw();
}

function sliceRow(s) {
  return `<div class="fl-slice">
    <div class="t"><b>${hm(s.dep)}</b><span>${esc(s.from)}</span></div>
    <div class="mid"><span>${dur(s.minutes)}</span><i></i><span>${s.stops ? `경유 ${s.stops}회 (${esc(s.via.join(', '))})` : '직항'}</span></div>
    <div class="t"><b>${hm(s.arr)}${dayPlus(s.dep, s.arr)}</b><span>${esc(s.to)}</span></div>
    <div class="fn">${md(s.dep)} · ${esc(s.flights.join(' · '))}</div></div>`;
}

function rules(o) {
  const r = o.refund, c = o.change;
  const t = (x, n) => !x ? `${n} 규정 확인 필요` : !x.allowed ? `${n} 불가` : x.penalty ? `${n} 수수료 ${x.cur} ${x.penalty}` : `${n} 가능`;
  return `${t(r, '환불')} · ${t(c, '변경')} · 무료 위탁 수하물 ${o.checkedBags ? o.checkedBags + '개' : '없음'}`;
}

function card(o, k, demo) {
  return `<div class="fl-card">
    <div class="air">${o.logo ? `<img src="${esc(o.logo)}" alt="" loading="lazy">` : `<span class="code">${esc(o.airlineCode)}</span>`}<span>${esc(o.airline)}</span></div>
    <div class="slices">${o.slices.map(sliceRow).join('')}<div class="fl-small">${rules(o)}</div></div>
    <div class="buy"><div class="p">${demo ? '<span class="fl-demo">예시</span> ' : ''}${won(o.perPax)}<small>1인</small></div>
      <div class="fl-small">총 ${won(o.price)}</div>
      <button class="btn primary" data-k="${k}">선택</button></div></div>`;
}

function needLogin(env) {
  if (env.me) return false;
  sessionStorage.setItem('afterLogin', location.hash);
  env.toast('로그인하면 예약할 수 있습니다.');
  location.hash = '#/login';
  return true;
}

function bookForm(o, q, env, demo) {
  if (needLogin(env)) return;
  const box = $('#fr');
  box.innerHTML = `<div class="fl-book">
    <button class="btn sm ghost" id="back">← 목록으로</button>
    <h2>예약하기</h2>
    ${card(o, -1, demo).replace(/<button[^>]*>선택<\/button>/, '')}
    <form id="bf" novalidate>
      <h3>탑승객 (여권과 똑같이 영문으로)</h3>
      ${Array.from({ length: q.adults }, (_, i) => `<fieldset class="fl-pax"><legend>탑승객 ${i + 1}</legend>
        <div class="fl-grid">
          <div class="field"><label for="pf${i}">성 (영문)</label><input id="pf${i}" autocomplete="family-name" placeholder="HONG" autocapitalize="characters"></div>
          <div class="field"><label for="pg${i}">이름 (영문)</label><input id="pg${i}" autocomplete="given-name" placeholder="GILDONG" autocapitalize="characters"></div>
          <div class="field"><label for="pb${i}">생년월일</label><input id="pb${i}" type="date" max="${todayKST()}"></div>
          <div class="field"><label for="ps${i}">성별</label><select id="ps${i}"><option value="m">남</option><option value="f">여</option></select></div>
        </div></fieldset>`).join('')}
      <h3>연락처</h3>
      <div class="fl-grid">
        <div class="field"><label for="bn">예약자 이름</label><input id="bn" value="${esc(env.me.name)}"></div>
        <div class="field"><label for="bp">휴대폰</label><input id="bp" inputmode="tel" value="${esc(env.me.phone || '')}" placeholder="010-0000-0000"></div>
        <div class="field"><label for="be">이메일 (전자 항공권 받을 곳)</label><input id="be" type="email" value="${esc(env.me.email || '')}"></div>
      </div>
      <div class="field"><label for="bnote">요청사항</label><textarea id="bnote" placeholder="골프백 추가, 좌석 요청 등"></textarea></div>
      <label class="check"><input type="checkbox" id="ag"> <span>(필수) 영문 이름·생년월일이 여권과 같음을 확인했습니다. 항공권 환불·변경은 위에 표시된 항공사 운임 규정을 따르며, 결제 후 이름은 바꿀 수 없습니다. 예약을 위해 탑승객 정보가 항공사와 항공권 발권 대행사(Duffel)에 제공되는 것에 동의합니다.</span></label>
      <div class="quote"><div class="sum"><span>결제 금액 (성인 ${q.adults}명)</span><span>${won(o.price)}</span></div><div class="muted">예약하면 요금을 한 번 더 확인합니다.</div></div>
      <button class="btn primary block" id="go">${demo ? '미리보기에서는 예약할 수 없습니다' : '예약하고 결제하기'}</button>
    </form></div>`;
  $('#back').onclick = () => { const r = $('#fs'); r.requestSubmit ? r.requestSubmit() : r.onsubmit(new Event('submit')); };
  $('#bf').onsubmit = async e => {
    e.preventDefault();
    if (demo) return env.toast('미리보기 화면입니다. 실제 요금이 연결되면 예약할 수 있습니다.');
    const passengers = Array.from({ length: q.adults }, (_, i) => ({ family: $('#pf' + i).value.trim(), given: $('#pg' + i).value.trim(), birth: $('#pb' + i).value, gender: $('#ps' + i).value }));
    const bad = passengers.findIndex(p => !/^[A-Za-z][A-Za-z \-]*$/.test(p.family) || !/^[A-Za-z][A-Za-z \-]*$/.test(p.given) || !p.birth);
    if (bad >= 0) { env.toast(`탑승객 ${bad + 1}의 영문 이름과 생년월일을 넣어 주세요.`); $('#pf' + bad).focus(); return; }
    if (!$('#bp').value.trim()) { env.toast('휴대폰 번호를 넣어 주세요.'); $('#bp').focus(); return; }
    if (!$('#ag').checked) { env.toast('안내에 동의해 주세요.'); $('#ag').focus(); return; }
    const btn = $('#go'); btn.disabled = true; btn.textContent = '요금 확인하는 중…';
    try {
      const b = await api.post('/api/flights/bookings', { offerId: o.id, search: q, passengers, name: $('#bn').value, phone: $('#bp').value, email: $('#be').value, note: $('#bnote').value, agree: true });
      if (b.price !== o.price) await ask(`요금이 바뀌었습니다: ${won(o.price)} → ${won(b.price)}. 이 요금으로 결제하시겠어요?`, '결제하기') ? await pay(b, env) : (location.hash = '#/flights/my');
      else await pay(b, env);
    } catch (err) { env.toast(err.message); btn.disabled = false; btn.textContent = '예약하고 결제하기'; }
  };
}

function quoteForm(q, env) {
  const box = $('#fr');
  box.innerHTML = `<div class="fl-book">
    <h2>항공권 견적 받기</h2>
    <p class="fl-small">${esc(airportName(q.from))} → ${esc(airportName(q.to))} · ${md(q.depart)}${q.return ? ` ~ ${md(q.return)}` : ' 편도'} · 성인 ${q.adults}명 · ${q.cabin === 'business' ? '비즈니스' : '일반석'}</p>
    <p>담당자가 항공사 요금을 확인해 <b>내 항공권</b>에 금액을 올려 드리고 카톡·문자로 알려 드립니다. 금액을 확인하신 뒤 결제하시면 발권합니다.</p>
    ${env.me ? `<form id="qf" novalidate>
      <div class="fl-grid">
        <div class="field"><label for="qn">이름</label><input id="qn" value="${esc(env.me.name)}"></div>
        <div class="field"><label for="qp">휴대폰</label><input id="qp" inputmode="tel" value="${esc(env.me.phone || '')}" placeholder="010-0000-0000"></div>
      </div>
      <div class="field"><label for="qnote">원하는 시간·항공사 등</label><textarea id="qnote" placeholder="예: 오전 출발, 직항, 골프백 2개"></textarea></div>
      <label class="check"><input type="checkbox" id="qag"> <span>(필수) 견적 안내를 위해 이름·연락처를 받는 것에 동의합니다. 항공권 환불·변경은 견적과 함께 안내드리는 항공사 운임 규정을 따릅니다.</span></label>
      <button class="btn primary block" id="qgo">견적 요청하기</button></form>`
      : `<a class="btn primary block" href="#/login" id="qlogin">로그인하고 견적 요청하기</a>`}
  </div>`;
  if (!env.me) { $('#qlogin').onclick = () => sessionStorage.setItem('afterLogin', '#/flights'); return; }
  $('#qf').onsubmit = async e => {
    e.preventDefault();
    if (!$('#qp').value.trim()) { env.toast('휴대폰 번호를 넣어 주세요.'); $('#qp').focus(); return; }
    if (!$('#qag').checked) { env.toast('안내에 동의해 주세요.'); $('#qag').focus(); return; }
    const btn = $('#qgo'); btn.disabled = true;
    try {
      const b = await api.post('/api/flights/bookings', { search: q, name: $('#qn').value, phone: $('#qp').value, note: $('#qnote').value, agree: true });
      env.toast(`견적 요청을 받았습니다. (번호 ${b.no})`);
      location.hash = '#/flights/my';
    } catch (err) { env.toast(err.message); btn.disabled = false; }
  };
}

// 토스페이먼츠 결제창 열기
async function pay(b, env) {
  const cfg = await api.get('/api/flights/config');
  if (!cfg.pay) {
    await ask(`예약을 받았습니다 (번호 ${b.no}). 카드 결제 연결 전이라 담당자가 결제 방법을 카톡·문자로 안내드립니다.`, '내 항공권 보기');
    location.hash = '#/flights/my'; return;
  }
  const o = await api.post(`/api/flights/bookings/${b.id}/pay`);
  await loadToss();
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  const payment = window.TossPayments(cfg.tossClientKey).payment({ customerKey: window.TossPayments.ANONYMOUS });
  await payment.requestPayment({
    method: 'CARD', amount: { currency: 'KRW', value: o.amount }, orderId: o.orderId, orderName: o.orderName,
    customerName: o.customerName, customerEmail: o.customerEmail || undefined,
    successUrl: base + 'flights-pay.html', failUrl: base + 'flights-pay.html?fail=1',
  });
}
function loadToss() {
  if (window.TossPayments) return Promise.resolve();
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = 'https://js.tosspayments.com/v2/standard';
    s.onload = ok; s.onerror = () => no(new Error('결제창을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'));
    document.head.append(s);
  });
}

async function myFlights(env) {
  const { app, site } = env;
  if (needLogin(env)) return;
  const list = await api.get('/api/flights/my');
  app.innerHTML = `<div class="wrap page" style="max-width:820px">
    <div class="sec-head"><h1 style="margin:0">내 항공권</h1><a class="btn sm" href="#/flights">항공권 검색</a></div>
    <div class="my-list">${list.map(b => {
      const s = b.search, o = b.offer;
      return `<div class="my-item"><div><h3>${esc(airportName(s.from))} → ${esc(airportName(s.to))} ${s.ret ? '왕복' : '편도'}</h3>
        <div class="meta">번호 ${esc(b.no)} · ${md(s.depart)}${s.ret ? ` ~ ${md(s.ret)}` : ''} · 성인 ${s.adults}명${o ? ` · ${esc(o.airline)} ${esc(o.slices.map(x => x.flights.join('/')).join(', '))}` : ''}</div>
        ${b.quoteText ? `<div class="meta" style="white-space:pre-line">${esc(b.quoteText)}</div>` : ''}
        <div class="meta">${b.price ? `결제 금액 <b>${won(b.price)}</b>` : '담당자가 요금을 확인하고 있습니다'}${b.pnr ? ` · 항공 예약번호 <b>${esc(b.pnr)}</b>` : ''}${b.payBy && b.status === '결제 대기' ? ` · 결제 기한 ${esc(new Date(b.payBy).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}` : ''}</div></div>
        <div style="text-align:right"><span class="badge ${STATUS_CLS[b.status] || ''}">${esc(b.status)}</span>
        ${b.status === '결제 대기' && b.price ? `<div style="margin-top:10px"><button class="btn primary sm" data-pay="${esc(b.id)}">결제하기</button></div>` : ''}</div>
        ${b.payLink && b.status === '결제 대기' ? `<div class="meta" style="grid-column:1/-1">결제는 태일골프 제휴 발권처 <b>${esc(b.partnerName)}</b>에서 진행됩니다. 결제창의 받는 곳 이름을 확인해 주세요.</div>` : ''}</div>`;
    }).join('') || '<div class="empty">아직 항공권 예약이 없습니다.<br><a class="btn primary" href="#/flights">항공권 검색</a></div>'}</div>
    ${list.some(b => b.status === '결제 대기') ? `<p class="fl-small" style="margin-top:20px">카드 결제가 어려우시면 ${esc(site.bank.name)} ${esc(site.bank.account)} (예금주 ${esc(site.bank.holder)})로 입금해 주세요. 담당자가 확인 후 발권합니다. 항공 요금은 바뀔 수 있어 결제 기한 안에 결제해 주셔야 합니다.</p>` : ''}
  </div>`;
  app.querySelectorAll('[data-pay]').forEach(btn => btn.onclick = async () => {
    btn.disabled = true;
    const b = list.find(x => x.id === btn.dataset.pay);
    if (b.payLink) {
      btn.disabled = false;
      if (await ask(`${b.partnerName} 결제창으로 이동합니다. 금액 ${won(b.price)}을 확인하고 결제해 주세요. 결제가 끝나면 담당자가 확인 후 발권합니다.`, '결제창 열기')) window.open(b.payLink, '_blank', 'noopener');
      return;
    }
    try { await pay(b, env); } catch (e) { env.toast(e.message); btn.disabled = false; }
  });
}
