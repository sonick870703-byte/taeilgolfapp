// 고객용 홈페이지 (tigc.co.kr)
import { api, getToken, setToken, isDemo, resetDemo } from './api.js';
import { ask } from './ask.js';
import { won, todayKST, addDays, INQUIRY_TYPES } from './core.js';
import { mountChat, countVisit } from './chat-widget.js';
import { renderBlocks, mountHero, productCard as card, priceHtml } from './blocks.js';
import { flightsPage } from './flights-site.js';
import { PRIVACY_POLICY, SIGNUP_CONSENT, CANCEL_POLICY, SERVICE_TERMS, TRAVEL_TERMS } from './legal.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
let site = null;
let me = null;
let heroTimer = null;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
}
const fmtDate = ms => new Date(ms).toLocaleDateString('ko-KR');
const catName = id => (site.menus.find(m => m.id === id) || {}).name || '';
const img = (images, size = 'md') => (images && images[0] && (images[0][size] || images[0].md || images[0].sm)) || '';

const productCard = p => card(p, site);

function applySite() {
  document.documentElement.style.setProperty('--primary', site.colors.primary);
  document.documentElement.style.setProperty('--accent', site.colors.accent);
  document.title = `${site.brand} | ${site.tagline}`;
  $('#brandName').textContent = site.brand;
  $('#logo').src = site.logo || 'assets/logo.jpg';
  $('#nav').innerHTML = site.menus.filter(m => m.visible !== false).map(m => `<a href="#/c/${m.id}" data-cat="${m.id}">${esc(m.name)}</a>`).join('')
    + (site.pages || []).map(pg => `<a href="#/page/${esc(pg.slug)}">${esc(pg.title)}</a>`).join('') + `<a href="#/flights">항공권</a><a href="#/inquiry">견적 문의</a><a href="#/notice">공지사항</a>${(site.downloads || []).length ? '<a href="#/download">프로그램 다운로드</a>' : ''}`;
  $('#kakaoFab').href = site.kakaoUrl ? site.kakaoUrl.replace(/\/$/, '') + '/chat' : '#';
  const s = site.sns || {};
  $('#foot').innerHTML = `<div class="wrap">
    <div class="links"><a href="#/terms/service">회원약관</a><a href="#/terms/privacy"><b>개인정보처리방침</b></a><a href="#/terms/cancel">예약·취소 규정</a><a href="#/terms/travel">여행 표준약관</a><a href="#/notice">공지사항</a><a href="erp/index.html">직원 ERP</a></div>
    <div class="cols">
      <div><b>${esc(site.companyName)}</b> (${esc(site.brand)})<br>대표 ${esc(site.ceo)} · 사업자등록번호 ${esc(site.bizNo)}${site.travelRegNo ? `<br>관광사업자 등록번호 ${esc(site.travelRegNo)}` : ''}${site.mailOrderNo ? ` · 통신판매업 ${esc(site.mailOrderNo)}` : ''}<br>${esc(site.address)}</div>
      <div><b>상담</b><br>${esc(site.tel)}${site.tel2 ? ' / ' + esc(site.tel2) : ''}<br>${esc(site.hours)}<br>${esc(site.email)}</div>
      <div><b>입금 계좌</b><br>${esc(site.bank.name)} ${esc(site.bank.account)}<br>예금주 ${esc(site.bank.holder)}<br>
        ${[['instagram', '인스타그램'], ['youtube', '유튜브'], ['band', '밴드'], ['tiktok', '틱톡']].filter(([k]) => s[k]).map(([k, n]) => `<a href="${esc(s[k])}" target="_blank" rel="noopener">${n}</a>`).join(' · ')}</div>
    </div>
    <div class="copy"><span>© ${new Date().getFullYear()} ${esc(site.companyName)} (${esc(site.companyNameEn)}). All rights reserved. 이 홈페이지의 글·사진·디자인을 허락 없이 복제하거나 다른 곳에 쓸 수 없습니다.</span><span>모든 상품 요금은 VAT 별도입니다.</span></div></div>`;
}

function renderTop() {
  $('#topAct').innerHTML = me
    ? `<a class="btn ghost sm" href="#/my">${esc(me.name)}님</a><a class="btn sm" href="#/my">내 예약</a>`
    : `<a class="btn ghost sm" href="#/login">로그인</a><a class="btn primary sm" href="#/signup">회원가입</a>`;
}

// ---------- 화면 ----------
async function page(slug) {
  const [pg, products, notices] = await Promise.all([api.get('/api/pages/' + encodeURIComponent(slug)), api.get('/api/products'), api.get('/api/notices')]);
  const { html } = renderBlocks(pg.blocks, { site, products, notices });
  app.innerHTML = html || '<div class="empty" style="margin:48px 16px">아직 내용이 없습니다.</div>';
  mountHero(app, site);
}
const home = () => page('home');

async function category(id) {
  const products = await api.get('/api/products?category=' + encodeURIComponent(id));
  app.innerHTML = `<section class="section"><div class="wrap">
    <div class="sec-head"><h2>${esc(catName(id))}</h2></div>
    <div class="grid">${products.map(productCard).join('') || '<div class="empty">준비 중인 상품입니다. 카카오톡으로 문의해 주세요.</div>'}</div></div></section>`;
}

async function product(id) {
  const p = await api.get('/api/products/' + encodeURIComponent(id));
  const imgs = p.images || [];
  const minDate = addDays(todayKST(), 1);
  app.innerHTML = `<div class="wrap">
    <div class="crumb"><a href="#/">홈</a> › <a href="#/c/${esc(p.category)}">${esc(catName(p.category))}</a></div>
    <div class="detail">
      <div>
        <div class="gallery"><div class="main pimg" id="gMain">${imgs.length ? `<img src="${esc(imgs[0].lg || imgs[0].md)}" alt="">` : `<div class="ph"><small>${esc(p.country)} · ${esc(p.city)}</small><strong>${esc(p.title)}</strong></div>`}</div>
          ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((im, k) => `<button class="${k ? '' : 'on'}" data-k="${k}" aria-label="사진 ${k + 1}"><img src="${esc(im.sm || im.md)}" alt=""></button>`).join('')}</div>` : ''}</div>
        <h1>${esc(p.title)}</h1>
        <div class="loc" style="color:var(--ink-3)">${esc([p.country, p.city].filter(Boolean).join(' · '))}${p.nights ? ` · ${p.nights}박` : ''} · 상품코드 ${esc(p.code || '-')}</div>
        ${p.summary ? `<div class="info-box"><p>${esc(p.summary)}</p></div>` : ''}
        <div class="inc">
          <div class="info-box ok"><h3>포함</h3><p>${esc(p.includes || '-')}</p></div>
          <div class="info-box no"><h3>불포함</h3><p>${esc(p.excludes || '-')}</p></div>
        </div>
        ${p.body ? `<div class="info-box"><h3>상품 안내</h3><div class="body-text">${esc(p.body)}</div></div>` : ''}
        <div class="info-box"><h3>예약 · 결제 · 환불</h3><p>· 예약금은 총액의 20%, 잔금은 출발 1개월 전까지 입금해 주세요.
· 환불은 출발 14일 전까지만 가능합니다. 날짜별 취소료는 <a href="#/terms/cancel" style="text-decoration:underline">예약·취소 규정</a>을 확인해 주세요.
· 1인 예약(1인 1실) 시 추가 요금이 있습니다.${p.category === 'month' ? ' 한 달 살기는 1인 예약 시 2인 요금입니다.' : ''}
· 항공권과 여행자보험은 포함되어 있지 않습니다. 요금은 VAT 별도입니다.</p></div>
      </div>
      <aside class="book">
        ${priceHtml(p, true)}
        <div class="note">${p.price ? (p.category === 'membership' ? '1인 요금 · VAT 별도' : '2인 1실 기준 1인 요금 · VAT 별도') : '요금은 상담 후 확정됩니다. 예약 신청을 남겨 주시면 연락드립니다.'}</div>
        <form id="bookForm" novalidate>
          <div class="row2">
            <div class="field"><label for="bDate">출발일</label><input id="bDate" type="date" min="${minDate}" required></div>
            <div class="field"><label for="bPax">인원</label><select id="bPax">${Array.from({ length: 12 }, (_, k) => `<option value="${k + 1}" ${k === 1 ? 'selected' : ''}>${k + 1}명</option>`).join('')}</select></div>
          </div>
          <label class="check"><input type="checkbox" id="bSingle"> 1인 1실 사용 (추가 요금)</label>
          <div class="quote" id="quote"><div class="muted">출발일을 고르면 예약금과 잔금 기한이 자동으로 계산됩니다.</div></div>
          <div id="bookMore"></div>
          <button class="btn primary block" type="submit" id="bookBtn">${me ? '예약 신청하기' : '로그인하고 예약 신청하기'}</button>
        </form>
      </aside>
    </div></div>`;
  app.querySelectorAll('.thumbs button').forEach(b => b.onclick = () => {
    app.querySelectorAll('.thumbs button').forEach(x => x.classList.remove('on')); b.classList.add('on');
    $('#gMain').innerHTML = `<img src="${esc(imgs[+b.dataset.k].lg || imgs[+b.dataset.k].md)}" alt="">`;
  });
  if (me) $('#bookMore').innerHTML = `
    <div class="row2"><div class="field"><label for="bName">예약자 이름</label><input id="bName" value="${esc(me.name)}" autocomplete="name"></div>
    <div class="field"><label for="bPhone">연락처</label><input id="bPhone" value="${esc(me.phone || '')}" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></div></div>
    <div class="field"><label for="bNote">요청사항</label><textarea id="bNote" placeholder="원하는 항공 시간, 라운드 일정 등"></textarea></div>
    <label class="check"><input type="checkbox" id="bAgree"> <span>(필수) <a href="#/terms/cancel" target="_blank" style="text-decoration:underline">예약·취소 규정</a>을 확인했고 동의합니다. 예약금 20%, 잔금 출발 30일 전, 환급은 출발 14일 전까지이며 표준약관과 다른 특약입니다.</span></label>`;
  const update = async () => {
    const d = $('#bDate').value;
    if (!d) return;
    const q = await api.post('/api/quote', { productId: p.id, pax: $('#bPax').value, single: $('#bSingle').checked, departDate: d });
    $('#quote').innerHTML = q.total ? `
      <div><span>1인 요금 × ${q.pax}명</span><span>${won(q.unit * q.pax)}</span></div>
      ${q.surcharge ? `<div><span>1인 1실 추가</span><span>${won(q.surcharge)}</span></div>` : ''}
      <div class="sum"><span>합계 (VAT 별도)</span><span>${won(q.total)}</span></div>
      <div><span>예약금 20%</span><span>${won(q.deposit)}</span></div>
      <div><span>잔금 (${q.balanceDue}까지)</span><span>${won(q.balance)}</span></div>
      <div class="muted"><span>환불 가능 기한</span><span>${q.refundDeadline}까지</span></div>`
      : `<div><span>잔금 기한</span><span>${q.balanceDue}</span></div><div class="muted"><span>환불 가능 기한</span><span>${q.refundDeadline}까지</span></div><div class="muted">요금은 상담 후 안내드립니다.</div>`;
  };
  ['bDate', 'bPax', 'bSingle'].forEach(k => $('#' + k).addEventListener('change', update));
  $('#bookForm').onsubmit = async e => {
    e.preventDefault();
    if (!me) { sessionStorage.setItem('afterLogin', location.hash); location.hash = '#/login'; return; }
    if (!$('#bDate').value) { toast('출발일을 선택해 주세요.'); $('#bDate').focus(); return; }
    if (!$('#bAgree').checked) { toast('예약·취소 규정에 동의해 주세요.'); $('#bAgree').focus(); return; }
    const btn = $('#bookBtn'); btn.disabled = true; btn.textContent = '신청하는 중…';
    try {
      const b = await api.post('/api/bookings', { productId: p.id, departDate: $('#bDate').value, pax: $('#bPax').value, single: $('#bSingle').checked, name: $('#bName').value, phone: $('#bPhone').value, note: $('#bNote').value, agreeCancel: true });
      toast(`예약 신청이 접수되었습니다. (예약번호 ${b.no})`);
      location.hash = '#/my';
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = '예약 신청하기'; }
  };
}

function authPage(kind) {
  const signup = kind === 'signup';
  app.innerHTML = `<div class="narrow">
    <h1>${signup ? '회원가입' : '로그인'}</h1>
    <p class="sub">${signup ? '가입하시면 홈페이지와 태일골프 PC·휴대폰 앱에서 같은 계정으로 예약할 수 있습니다.' : '태일골프 계정으로 로그인해 주세요.'}</p>
    <form id="authForm" novalidate>
      <div id="formErr"></div>
      ${signup ? `<div class="field"><label for="aName">이름</label><input id="aName" autocomplete="name" required></div>
      <div class="field"><label for="aPhone">휴대폰 번호</label><input id="aPhone" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></div>` : ''}
      <div class="field"><label for="aEmail">이메일</label><input id="aEmail" type="email" autocomplete="email" required></div>
      <div class="field"><label for="aPw">비밀번호</label><input id="aPw" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required>${signup ? '<span class="hint">8자 이상</span>' : ''}</div>
      ${signup ? `<label class="check"><input type="checkbox" id="aT"> <span>(필수) <a href="#/terms/service" target="_blank" style="text-decoration:underline">회원약관(예약·취소 규정 포함)</a>에 동의합니다</span></label>
      <label class="check"><input type="checkbox" id="aP"> <span>(필수) <a href="#/terms/consent" target="_blank" style="text-decoration:underline">개인정보 수집·이용</a>에 동의합니다</span></label>
      <label class="check"><input type="checkbox" id="aM"> <span>(선택) 할인·신상품 소식 받기 (<a href="#/terms/consent" target="_blank" style="text-decoration:underline">내용 보기</a>)</span></label>` : ''}
      <button class="btn primary block" type="submit" id="aBtn">${signup ? '가입하기' : '로그인'}</button>
    </form>
    <div class="alt-link">${signup ? '이미 회원이신가요? <a href="#/login">로그인</a>' : '처음이신가요? <a href="#/signup">회원가입</a>'}</div>
  </div>`;
  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#aBtn'); btn.disabled = true;
    try {
      const body = { email: $('#aEmail').value, password: $('#aPw').value };
      if (signup) Object.assign(body, { name: $('#aName').value, phone: $('#aPhone').value, agreeTerms: $('#aT').checked, agreePrivacy: $('#aP').checked, marketing: $('#aM').checked });
      const r = await api.post(signup ? '/api/signup' : '/api/login', body);
      setToken(r.token); me = r.user; renderTop();
      toast(signup ? `${me.name}님, 가입을 환영합니다.` : `${me.name}님, 반갑습니다.`);
      const back = sessionStorage.getItem('afterLogin'); sessionStorage.removeItem('afterLogin');
      location.hash = back || '#/';
    } catch (err) {
      $('#formErr').innerHTML = `<div class="formerr">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  };
}

const STATUS_CLS = { '접수': 'b', '예약금 대기': 'o', '예약금 입금': 'g', '완납': 'g', '출발 완료': '', '취소': 'r' };
async function my() {
  if (!me) { sessionStorage.setItem('afterLogin', '#/my'); location.hash = '#/login'; return; }
  const list = await api.get('/api/my/bookings');
  app.innerHTML = `<div class="wrap page" style="max-width:820px">
    <div class="sec-head"><h1 style="margin:0">내 예약</h1><div><a class="btn sm" href="#/flights/my">내 항공권</a> <button class="btn sm" id="logout">로그아웃</button></div></div>
    <div class="my-list">${list.map(b => {
      const paid = (b.payments || []).reduce((s, p) => s + p.amount, 0);
      return `<div class="my-item"><div><h3>${esc(b.productTitle)}</h3>
        <div class="meta">예약번호 ${esc(b.no)} · 출발 ${esc(b.departDate)} · ${b.pax}명${b.single ? ' · 1인 1실' : ''}</div>
        <div class="meta">${b.total ? `합계 ${won(b.total)} · 입금 ${won(paid)} · 예약금 ${won(b.deposit)} · 잔금 기한 ${esc(b.balanceDue)}` : '요금 상담 후 안내'}</div>
        <div class="meta">환불 가능 기한 ${esc(b.refundDeadline)}${b.cancelRequested ? ' · <b style="color:var(--danger)">취소 요청됨</b>' : ''}</div></div>
        <div style="text-align:right"><span class="badge ${STATUS_CLS[b.status] || ''}">${esc(b.status === '접수' ? '접수 (확인 중)' : b.status)}</span>
        ${!['취소', '출발 완료'].includes(b.status) && !b.cancelRequested ? `<div style="margin-top:10px"><button class="btn sm" data-cancel="${esc(b.id)}">취소 요청</button></div>` : ''}</div></div>`;
    }).join('') || '<div class="empty">아직 예약이 없습니다.<br><a class="btn primary" href="#/">상품 보러 가기</a></div>'}</div>
    ${list.length ? `<p style="color:var(--ink-3);font-size:14px;margin-top:20px">입금 계좌: ${esc(site.bank.name)} ${esc(site.bank.account)} (예금주 ${esc(site.bank.holder)}) · 입금하시면 담당자가 확인 후 상태가 바뀝니다.</p>` : ''}
  </div>`;
  $('#logout').onclick = async () => { await api.post('/api/logout').catch(() => {}); setToken(null); me = null; renderTop(); location.hash = '#/'; };
  app.querySelectorAll('[data-cancel]').forEach(btn => btn.onclick = async () => {
    const b = list.find(x => x.id === btn.dataset.cancel);
    const late = todayKST() > b.refundDeadline;
    if (!await ask(`"${b.productTitle}" 예약 취소를 요청할까요?${late ? '\n\n환불 가능 기한(출발 14일 전)이 지나 환불이 되지 않습니다.' : ''}`)) return;
    await api.post(`/api/my/bookings/${b.id}/cancel`);
    toast('취소 요청을 보냈습니다. 담당자가 확인 후 연락드립니다.');
    my();
  });
}

async function notices(id) {
  const list = await api.get('/api/notices');
  if (id) {
    const n = list.find(x => x.id === id);
    app.innerHTML = `<div class="wrap page" style="max-width:860px"><div class="crumb"><a href="#/notice">공지사항</a></div>
      ${n ? `<article class="article"><h1>${esc(n.title)}</h1><div class="meta">${fmtDate(n.createdAt)} · ${esc(n.author || '')}</div>${esc(n.body)}</article>` : '<div class="empty">공지사항을 찾을 수 없습니다.</div>'}</div>`;
    return;
  }
  app.innerHTML = `<div class="wrap page" style="max-width:860px"><h1>공지사항</h1>
    <div class="notice-list">${list.map(n => `<a href="#/notice/${esc(n.id)}">${n.pinned ? '<span class="pin">필독</span>' : ''}<span class="t">${esc(n.title)}</span><span class="d">${fmtDate(n.createdAt)}</span></a>`).join('') || '<div class="empty">공지사항이 없습니다.</div>'}</div></div>`;
}

function terms(kind) {
  const titles = { service: '회원약관', privacy: '개인정보처리방침', travel: '여행 표준약관', consent: '개인정보 수집·이용 동의', cancel: '예약 및 취소 규정' };
  const builtIn = { service: SERVICE_TERMS, travel: TRAVEL_TERMS, privacy: PRIVACY_POLICY, consent: SIGNUP_CONSENT, cancel: CANCEL_POLICY };
  const text = (site.terms || {})[kind] || builtIn[kind] || '내용을 준비하고 있습니다. 관리자 화면 › 홈페이지 설정 › 약관에서 입력할 수 있습니다.';
  app.innerHTML = `<div class="wrap page" style="max-width:860px"><h1>${titles[kind] || '약관'}</h1><article class="article">${esc(text)}</article></div>`;
}

// ---------- 프로그램 다운로드 ----------
function downloadPage() {
  const list = (site.downloads || []).filter(d => d.url && /^https:\/\//.test(d.url));
  const tip = { pc: '설치할 때 "Windows의 PC 보호" 창이 뜨면 <b>추가 정보 → 실행</b>을 누르세요.', android: '설치할 때 "출처를 알 수 없는 앱" 안내가 뜨면 <b>설정 → 이 출처 허용</b>을 켜고 다시 설치하세요.' };
  app.innerHTML = `<div class="wrap page" style="max-width:860px"><h1>프로그램 다운로드</h1>
    <p class="sub">태일골프에서 만든 프로그램을 내려받을 수 있습니다. 버튼을 누르면 바로 받아집니다.</p>
    ${list.map(d => `<div class="card" style="padding:20px;margin:14px 0;border:1px solid var(--line);border-radius:14px">
      <h2 style="margin:0 0 6px;font-size:19px">${esc(d.name)}</h2>
      ${d.desc ? `<p style="margin:0 0 10px">${esc(d.desc)}</p>` : ''}
      ${tip[d.kind] ? `<p class="muted" style="margin:0 0 12px;font-size:14px">${tip[d.kind]}</p>` : ''}
      <a class="btn primary" href="${esc(d.url)}" rel="noopener" download>내려받기</a></div>`).join('') || '<div class="empty">아직 올린 프로그램이 없습니다.</div>'}
  </div>`;
}

// ---------- 견적 문의 ----------
function inquiryPage(preType) {
  const type = INQUIRY_TYPES.includes(decodeURIComponent(preType || '')) ? decodeURIComponent(preType) : '골프여행';
  app.innerHTML = `<div class="narrow" style="max-width:640px">
    <h1>견적 문의</h1>
    <p class="sub">원하시는 여행을 적어 주시면 담당자가 견적을 만들어 연락드립니다. 로그인하지 않아도 됩니다.</p>
    <form id="iqForm" novalidate>
      <div class="field"><label>어떤 여행인가요?</label><div class="chips">${INQUIRY_TYPES.map(t => `<label class="chip"><input type="radio" name="type" value="${esc(t)}" ${t === type ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div></div>
      <div class="row2"><div class="field"><label for="iqDest">가고 싶은 곳</label><input id="iqDest" placeholder="예: 태국 파타야"></div>
      <div class="field"><label for="iqDate">출발 희망일</label><input id="iqDate" type="date"></div></div>
      <div class="row2"><div class="field"><label for="iqN">일정 (박)</label><input id="iqN" type="number" min="0" max="100" placeholder="예: 5"></div>
      <div class="field"><label for="iqP">인원</label><input id="iqP" type="number" min="1" max="200" value="2"></div></div>
      <div class="field"><label for="iqB">예산 (1인, 선택)</label><input id="iqB" placeholder="예: 150만 원 안팎"></div>
      <div class="field"><label for="iqMsg">원하시는 점</label><textarea id="iqMsg" placeholder="골프 라운드 수, 숙소, 항공 시간 등 편하게 적어 주세요"></textarea></div>
      <div class="row2"><div class="field"><label for="iqName">이름</label><input id="iqName" autocomplete="name" value="${esc(me?.name || '')}"></div>
      <div class="field"><label for="iqPhone">연락처</label><input id="iqPhone" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000" value="${esc(me?.phone || '')}"></div></div>
      <input id="iqWeb" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
      <label class="check"><input type="checkbox" id="iqAgree"> <span>(필수) 견적 상담을 위해 이름·연락처·여행 희망 내용을 수집하고, 상담이 끝나고 1년 뒤 파기하는 데 동의합니다. 동의하지 않으시면 전화(${esc(site.tel)})나 카카오톡으로 문의하실 수 있습니다.</span></label>
      <button class="btn primary block" type="submit" id="iqBtn">견적 요청 보내기</button>
    </form></div>`;
  $('#iqForm').onsubmit = async e => {
    e.preventDefault();
    const v = id => $('#' + id).value.trim();
    if (!v('iqName') || !v('iqPhone')) { toast('이름과 연락처를 입력해 주세요.'); return; }
    if (!$('#iqAgree').checked) { toast('개인정보 수집·이용에 동의해 주세요.'); return; }
    const btn = $('#iqBtn'); btn.disabled = true; btn.textContent = '보내는 중…';
    try {
      await api.post('/api/inquiries', { type: app.querySelector('input[name=type]:checked')?.value, destination: v('iqDest'), departDate: v('iqDate'), nights: v('iqN'), pax: v('iqP'), budget: v('iqB'), message: v('iqMsg'), name: v('iqName'), phone: v('iqPhone'), agreePrivacy: true, website: v('iqWeb') });
      app.innerHTML = `<div class="narrow" style="text-align:center"><h1>견적 요청을 받았습니다</h1><p class="sub">담당자가 확인하고 남겨 주신 연락처로 연락드리겠습니다. 급하시면 오른쪽 아래 "1:1 문의"나 전화 ${esc(site.tel)}로 연락 주세요.</p><a class="btn" href="#/">홈으로</a></div>`;
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = '견적 요청 보내기'; }
  };
}

// ---------- 라우터 ----------
async function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [, a, b] = h.split('/');
  $('#nav').classList.remove('open');
  $('#nav').querySelectorAll('a').forEach(x => x.classList.toggle('on', x.getAttribute('href') === '#' + h));
  window.scrollTo(0, 0);
  try {
    if (!a) await home();
    else if (a === 'c') await category(b);
    else if (a === 'page') await page(b);
    else if (a === 'p') await product(b);
    else if (a === 'login' || a === 'signup') authPage(a);
    else if (a === 'my') await my();
    else if (a === 'notice') await notices(b);
    else if (a === 'terms') terms(b);
    else if (a === 'inquiry') inquiryPage(b);
    else if (a === 'download') downloadPage();
    else if (a === 'flights') await flightsPage(b, { app, me, site, toast });
    else app.innerHTML = '<div class="empty" style="margin:48px 16px">페이지를 찾을 수 없습니다. <a href="#/" class="btn">홈으로</a></div>';
  } catch (e) {
    app.innerHTML = `<div class="wrap page"><div class="empty">${esc(e.message || '불러오지 못했습니다.')}<br><a href="#/" class="btn">홈으로</a></div></div>`;
  }
}

async function start() {
  site = await api.get('/api/site');
  if (getToken()) me = (await api.get('/api/me').catch(() => ({}))).user || null;
  if (await isDemo()) {
    const bar = document.createElement('div');
    bar.className = 'demo-bar';
    bar.innerHTML = '미리보기 화면입니다. 입력한 내용은 이 브라우저에만 저장됩니다. <button id="resetDemo">처음 상태로</button>';
    document.body.prepend(bar);
    $('#resetDemo').onclick = resetDemo;
  }
  applySite(); renderTop();
  mountChat(me);
  countVisit();
  $('#menuBtn').onclick = () => $('#nav').classList.toggle('open');
  window.addEventListener('hashchange', route);
  route();
}
start();
