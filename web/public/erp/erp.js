// 태일골프 ERP (직원용 관리자 화면)
import { api, getToken, setToken, isDemo, resetDemo } from '../shared/api.js';
import { ask } from '../shared/ask.js';
import { APPROVAL_TYPES, INQUIRY_TYPES, INQUIRY_STATUSES, won, STATUSES, CATEGORIES, PRICE_MARKUP, todayKST, daysBetween, excelRowToProduct, isExampleRow } from '../shared/core.js';
import { resizeForSlot, SLOTS } from '../shared/image.js';
import { pagesView } from './pages.js?v=20261030h';
import { mailView } from './mail.js?v=20261030j';
import { flightsView } from './flights.js';
import { boardView } from './board.js?v=20261030h';
import { calcView } from './calc.js?v=20261030a';
import { travelersHtml, bindTravelers } from './passport.js';
import { SERVICE_TERMS, PRIVACY_POLICY, CANCEL_POLICY, TRAVEL_TERMS } from '../shared/legal.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#root');
let me = null;
let demo = false;
let settingsCache = null;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
}
const fmtDT = ms => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtD = ms => new Date(ms).toLocaleDateString('ko-KR');
const catName = id => (CATEGORIES.find(c => c.id === id) || {}).name || id;
const STATUS_CLS = { '접수': 'b', '예약금 대기': 'o', '예약금 입금': 'g', '완납': 'g', '출발 완료': '', '취소': 'r' };
const badge = s => `<span class="badge ${STATUS_CLS[s] || ''}">${esc(s)}</span>`;
const paid = b => (b.payments || []).reduce((s, p) => s + p.amount, 0);
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('복사했습니다. 카카오톡이나 문자에 붙여넣으세요.'); }
  catch { toast('자동 복사가 막혀 있습니다. 내용을 길게 눌러 직접 복사해 주세요.'); }
}

// ---------- 로그인 ----------
const COPYRIGHT = `© ${new Date().getFullYear()} 태일 골프커뮤니케이션 (TAEIL GOLF COMMUNICATION). All rights reserved.`;

function loginView() {
  root.innerHTML = `<div class="login-wrap"><form class="login-card" id="lf" novalidate>
    <div class="brand"><img src="../assets/logo.jpg" alt="" style="width:44px;height:44px"><span>태일골프 ERP</span></div>
    ${demo ? '<div class="demo">미리보기 계정: <b>admin@tigc.co.kr</b> / <b>demo1234</b></div>' : ''}
    <div id="lerr"></div>
    <div class="field"><label for="le">이메일</label><input id="le" type="email" autocomplete="username" value="${demo ? 'admin@tigc.co.kr' : ''}"></div>
    <div class="field"><label for="lp">비밀번호</label><input id="lp" type="password" autocomplete="current-password" value="${demo ? 'demo1234' : ''}"></div>
    <button class="btn primary block" id="lb">ERP 로그인</button>
    <p class="muted" style="font-size:13px;margin:14px 0 0">직원 계정만 들어올 수 있습니다. 직원 등록은 관리자가 회원 관리에서 합니다.</p>
    <p class="muted" style="font-size:12px;margin:18px 0 0;text-align:center">${COPYRIGHT}</p>
  </form></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await api.post('/api/login', { email: $('#le').value, password: $('#lp').value });
      if (!['admin', 'staff'].includes(r.user.role)) throw new Error('직원 계정이 아닙니다. 관리자에게 직원 등록을 요청해 주세요.');
      setToken(r.token); me = r.user; shell();
    } catch (err) { $('#lerr').innerHTML = `<div class="formerr">${esc(err.message)}</div>`; }
  };
}

// ---------- 화면 틀 ----------
const MENU = [
  ['dashboard', '대시보드', '오늘 할 일'],
  ['bookings', '예약 관리', ''],
  ['calc', '금액 계산기', ''],
  ['inquiries', '견적 문의', ''],
  ['flights', '항공권', ''],
  ['board', '운항 현황', ''],
  ['chats', '1:1 실시간 문의', ''],
  ['mail', '메일함', ''],
  ['products', '상품 관리', ''],
  ['notices', '공지사항', ''],
  ['members', '회원 · 직원', ''],
  ['approvals', '전자결재', ''],
  ['-', '홈페이지'],
  ['pages', '페이지 만들기', ''],
  ['site', '홈페이지 설정', ''],
  ['domain', '도메인 연결', ''],
];
const TITLES = { calc: '금액 계산기', board: '운항 현황', mail: '메일함', flights: '항공권', approvals: '전자결재', inquiries: '견적 문의', chats: '1:1 실시간 문의', pages: '페이지 만들기', dashboard: '대시보드', bookings: '예약 관리', products: '상품 관리', notices: '공지사항', members: '회원 · 직원', site: '홈페이지 설정', domain: '도메인 연결' };

function shell() {
  root.innerHTML = `<div class="shell">
    <aside class="side" id="side">
      <div class="brand"><img src="../assets/logo.jpg" alt=""><span>태일골프 ERP</span></div>
      <nav id="snav">${MENU.map(([k, n]) => k === '-' ? `<div class="grp">${n}</div>` : `<a href="#/${k}" data-k="${k}">${n}${{ bookings: '<span class="cnt" id="waitCnt" hidden></span>', inquiries: '<span class="cnt" id="inqCnt" hidden></span>', flights: '<span class="cnt" id="flCnt" hidden></span>', chats: '<span class="cnt" id="chatCnt" hidden></span>', mail: '<span class="cnt" id="mailCnt" hidden></span>', approvals: '<span class="cnt" id="apCnt" hidden></span>' }[k] || ''}</a>`).join('')}</nav>
      <div class="who">${esc(me.name)} · ${me.role === 'admin' ? '관리자' : '직원'}<br><a href="../" target="_blank" style="text-decoration:underline">홈페이지 보기</a> · <button id="pwc">비밀번호 바꾸기</button> · <button id="lo">로그아웃</button>
        ${demo ? '<br><button id="rd" style="margin-top:6px">미리보기 처음 상태로</button>' : ''}
        <div style="margin-top:10px;font-size:11px;color:#7f9488;line-height:1.5">${COPYRIGHT}</div></div>
    </aside>
    <div class="main"><div class="bar"><button class="menu-btn" id="mb" aria-label="메뉴"><span></span><span></span><span></span></button><h1 id="title"></h1><div id="barAct"></div></div>
      <div class="content" id="view"></div></div></div>`;
  $('#pwc').onclick = passwordDrawer;
  $('#lo').onclick = async () => { await api.post('/api/logout').catch(() => {}); setToken(null); me = null; loginView(); };
  if ($('#rd')) $('#rd').onclick = resetDemo;
  $('#mb').onclick = () => $('#side').classList.toggle('open');
  window.onhashchange = route;
  route();
}

async function route() {
  const [, k = 'dashboard', arg] = (location.hash.replace(/^#/, '') || '/dashboard').split('/');
  $$('#snav a').forEach(a => a.classList.toggle('on', a.dataset.k === k));
  $('#side').classList.remove('open');
  $('#title').textContent = TITLES[k] || '';
  $('#barAct').innerHTML = '';
  const view = $('#view');
  view.innerHTML = '<div class="loading">불러오는 중…</div>';
  try {
    await ({ dashboard, bookings, inquiries, chats, approvals, products, notices, members, site: siteSettings, domain, pages: (v, a) => pagesView(v, a, pageEnv), flights: (v, a) => flightsView(v, a, { ...pageEnv, me }), board: (v, a) => boardView(v, a, { ...pageEnv, me }), mail: (v, a) => mailView(v, a, { ...pageEnv, me }), calc: (v, a) => calcView(v, a, { ...pageEnv, me, loadXlsx, copy }) }[k] || dashboard)(view, arg);
  } catch (e) {
    if (e.status === 401) { me = null; return loginView(); }
    view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
  refreshWaitCount();
}

// 메뉴 옆 숫자(접수 대기, 새 견적 문의, 답장 필요한 1:1 문의). 30초마다 자동으로 새로 셉니다.
let lastChatCount = 0;
async function refreshWaitCount() {
  try {
    const c = await api.get('/api/erp/counts');
    for (const [id, n] of [['waitCnt', c.waiting], ['inqCnt', c.inquiries], ['chatCnt', c.chats], ['flCnt', c.flights], ['apCnt', c.approvals], ['mailCnt', c.mails]]) { const el = $('#' + id); if (el) { el.hidden = !n; el.textContent = n; } }
    if (c.chats > lastChatCount) toast('새 1:1 문의가 왔습니다.');
    lastChatCount = c.chats;
    document.title = (c.chats + c.inquiries ? `(${c.chats + c.inquiries}) ` : '') + '태일골프 ERP';
  } catch { /* 무시 */ }
}
setInterval(() => { if (me) refreshWaitCount(); }, 30000);

// ---------- 대시보드 ----------
async function dashboard(view) {
  const d = await api.get('/api/erp/dashboard');
  const c = d.counts;
  view.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>오늘 방문자</span><b>${c.visitorsToday}명</b><small class="muted">페이지 조회 ${c.viewsToday}회</small></div>
      <div class="kpi"><span>새 문의 (견적 · 1:1)</span><b style="color:${c.newInquiries + c.openChats ? 'var(--accent)' : 'inherit'}">${c.newInquiries + c.openChats}건</b></div>
      <div class="kpi"><span>오늘 들어온 예약</span><b>${c.newToday}건</b></div>
      <div class="kpi"><span>확인 대기 (접수)</span><b style="color:${c.waiting ? 'var(--accent)' : 'inherit'}">${c.waiting}건</b></div>
      <div class="kpi"><span>이번 달 출발</span><b>${c.departingThisMonth}건</b></div>
      <div class="kpi"><span>받을 돈 (미수금)</span><b>${won(c.unpaid)}</b></div>
    </div>
    <div class="cols2">
      <div class="card"><h2>오늘 할 일 <small>자동으로 정리됩니다</small></h2>
        <div class="alerts">${d.alerts.map(a => `<div class="alert" ${a.inquiryId ? `data-inq="${esc(a.inquiryId)}"` : a.chatId ? `data-chat="${esc(a.chatId)}"` : `data-id="${esc(a.bookingId)}"`}><span class="dot ${a.level}"></span><div class="t">${esc(a.text)}<small>${esc(a.no)} · ${esc(a.name)} · ${esc(a.product)}</small></div><span class="muted">›</span></div>`).join('') || '<div class="muted">처리할 일이 없습니다.</div>'}</div></div>
      <div class="card"><h2>다가오는 출발</h2>
        <table class="tbl"><tbody>${d.upcoming.map(b => `<tr class="click" data-id="${esc(b.id)}"><td style="white-space:nowrap">${esc(b.departDate)}<div class="muted" style="font-size:12px">D-${daysBetween(d.today, b.departDate)}</div></td><td>${esc(b.name)} · ${b.pax}명<div class="muted" style="font-size:12px">${esc(b.productTitle)}</div></td><td>${badge(b.status)}</td></tr>`).join('') || '<tr><td class="muted">예정된 출발이 없습니다.</td></tr>'}</tbody></table></div>
    </div>
    <div class="card"><h2>월별 출발 · 매출 <small>출발월 기준, 취소 제외, VAT 별도</small></h2>
      <div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr><th>출발월</th><th class="num">예약</th><th class="num">인원</th><th class="num">매출</th><th class="num">입금</th><th class="num">미수</th></tr></thead>
      <tbody>${d.monthly.map(m => `<tr><td>${esc(m.month)}</td><td class="num">${m.count}건</td><td class="num">${m.pax}명</td><td class="num">${won(m.sales)}</td><td class="num">${won(m.paid)}</td><td class="num">${won(m.sales - m.paid)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">아직 데이터가 없습니다.</td></tr>'}</tbody></table></div></div>`;
  $$('[data-id]', view).forEach(el => el.onclick = () => openBooking(el.dataset.id, () => dashboard(view)));
  $$('[data-inq]', view).forEach(el => el.onclick = () => { location.hash = '#/inquiries/' + el.dataset.inq; });
  $$('[data-chat]', view).forEach(el => el.onclick = () => { location.hash = '#/chats/' + el.dataset.chat; });
  const max = Math.max(1, ...d.visits7.map(v => v.visitors));
  view.insertAdjacentHTML('beforeend', `<div class="card"><h2>최근 7일 방문자 <small>같은 사람은 하루 1명으로 셉니다</small></h2>
    <div class="visit-bars">${d.visits7.map(v => `<div class="vb"><b>${v.visitors}</b><i style="height:${Math.round(v.visitors / max * 100)}%"></i><span>${v.date.slice(5).replace('-', '/')}</span></div>`).join('')}</div></div>`);
}

// ---------- 견적 문의 ----------
const INQ_CLS = { '새 문의': 'o', '상담 중': 'b', '견적 보냄': 'b', '예약 전환': 'g', '종료': '' };
async function inquiries(view, openId) {
  const list = await api.get('/api/erp/inquiries');
  view.innerHTML = `<p class="muted" style="margin-top:0">홈페이지 "견적 문의"로 들어온 문의입니다. 누르면 내용을 보고, 상태를 바꾸거나 바로 예약으로 등록할 수 있습니다.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>받은 날</th><th>종류</th><th>이름 · 연락처</th><th class="hide-m">희망 내용</th><th>상태</th></tr></thead>
    <tbody>${list.map(q => `<tr class="click" data-q="${esc(q.id)}"><td style="white-space:nowrap">${fmtDT(q.createdAt)}</td><td>${esc(q.type)}</td><td><b>${esc(q.name)}</b><div class="muted" style="font-size:12px">${esc(q.phone)}</div></td>
      <td class="hide-m">${esc([q.destination, q.departDate, q.nights ? q.nights + '박' : '', q.pax ? q.pax + '명' : ''].filter(Boolean).join(' · '))}<div class="muted" style="font-size:12px">${esc((q.message || '').slice(0, 40))}</div></td>
      <td><span class="badge ${INQ_CLS[q.status] || ''}">${esc(q.status)}</span></td></tr>`).join('') || '<tr><td colspan="5" class="muted">아직 들어온 문의가 없습니다.</td></tr>'}</tbody></table></div>`;
  $$('[data-q]', view).forEach(tr => tr.onclick = () => inquiryDrawer(list.find(q => q.id === tr.dataset.q), () => inquiries(view)));
  if (openId) { const q = list.find(x => x.id === openId); if (q) inquiryDrawer(q, () => inquiries(view)); }
}

function inquiryDrawer(q, after) {
  const tel = q.phone.replace(/[^0-9+]/g, '');
  const d = drawer(`견적 문의 · ${q.name}`, `
    <div class="kv"><span>받은 날</span><b>${fmtDT(q.createdAt)}</b><span>종류</span><b>${esc(q.type)}</b><span>연락처</span><b>${esc(q.phone)} ${tel ? `<a class="btn sm" href="tel:${esc(tel)}">전화</a> <a class="btn sm" href="sms:${esc(tel)}">문자</a>` : ''}</b>
      ${q.email ? `<span>이메일</span><b>${esc(q.email)}</b>` : ''}<span>여행지</span><b>${esc(q.destination || '-')}</b><span>출발 희망일</span><b>${esc(q.departDate || '미정')}</b>
      <span>일정 · 인원</span><b>${q.nights ? q.nights + '박' : '-'} · ${q.pax ? q.pax + '명' : '-'}</b><span>예산</span><b>${esc(q.budget || '-')}</b></div>
    ${q.message ? `<div class="card" style="padding:12px 14px;white-space:pre-line;margin:12px 0">${esc(q.message)}</div>` : ''}
    <div class="field"><label for="iqS">상태</label><select id="iqS">${INQUIRY_STATUSES.map(s => `<option ${s === q.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="field"><label for="iqM">직원 메모</label><textarea id="iqM" placeholder="상담 내용, 보낸 견적 금액 등">${esc(q.memo || '')}</textarea></div>
    ${q.bookingId ? `<p class="muted">예약으로 등록됨 · <a href="#/bookings/${esc(q.bookingId)}" style="text-decoration:underline">예약 보기</a></p>` : ''}`,
    `${me.role === 'admin' ? '<button class="btn" id="iqDel" style="color:var(--danger);margin-right:auto">삭제</button>' : ''}<button class="btn" id="iqBk">예약으로 등록</button><button class="btn primary" id="iqSave">저장</button>`);
  const save = async (extra = {}) => api.patch('/api/erp/inquiries/' + q.id, { status: $('#iqS', d).value, memo: $('#iqM', d).value, ...extra });
  $('#iqSave', d).onclick = async () => { try { await save(); toast('저장했습니다.'); closeDrawer(); after(); } catch (e) { toast(e.message); } };
  $('#iqBk', d).onclick = async () => {
    await save();
    newBookingDrawer(after, { departDate: q.departDate, pax: q.pax || 2, nights: q.nights || '', name: q.name, phone: q.phone, note: [q.type, q.destination, q.budget && '예산 ' + q.budget, q.message].filter(Boolean).join(' / ') },
      async b => { await api.patch('/api/erp/inquiries/' + q.id, { status: '예약 전환', bookingId: b.id }); });
  };
  if ($('#iqDel', d)) $('#iqDel', d).onclick = async () => { if (!await ask('이 문의를 삭제할까요?', '삭제')) return; await api.del('/api/erp/inquiries/' + q.id); closeDrawer(); after(); };
}

// ---------- 전자결재 ----------
const AP_CLS = { '대기': 'o', '승인': 'g', '반려': 'r', '취소': '' };
async function approvals(view) {
  $('#barAct').innerHTML = '<button class="btn primary sm" id="apNew">+ 결재 요청</button>';
  $('#apNew').onclick = () => approvalNew(() => approvals(view));
  const list = await api.get('/api/erp/approvals');
  view.innerHTML = `<p class="muted" style="margin-top:0">직원이 결재를 요청하면 대표(관리자)가 승인하거나 반려합니다. 결재 항목은 아직 정해지지 않아 (임시)로 두었습니다.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>문서 번호</th><th>항목</th><th>제목</th><th class="num">금액</th><th class="hide-m">요청자</th><th>상태</th></tr></thead>
    <tbody>${list.map(a => `<tr class="click" data-a="${esc(a.id)}"><td style="white-space:nowrap">${esc(a.no)}<div class="muted" style="font-size:12px">${fmtDT(a.createdAt)}</div></td><td>${esc(a.type)}</td><td><b>${esc(a.title)}</b>${a.bookingNo ? `<div class="muted" style="font-size:12px">예약 ${esc(a.bookingNo)}</div>` : ''}</td>
      <td class="num">${a.amount ? won(a.amount) : '-'}</td><td class="hide-m">${esc(a.requester)}</td><td><span class="badge ${AP_CLS[a.status] || ''}">${esc(a.status)}</span></td></tr>`).join('') || '<tr><td colspan="6" class="muted">결재 문서가 없습니다.</td></tr>'}</tbody></table></div>`;
  $$('[data-a]', view).forEach(tr => tr.onclick = () => approvalView(list.find(a => a.id === tr.dataset.a), () => approvals(view)));
}

function approvalNew(after) {
  const d = drawer('결재 요청', `<form id="apF">
    <div class="field"><label for="apT">항목</label><select id="apT">${APPROVAL_TYPES.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
    <div class="field"><label for="apTi">제목</label><input id="apTi" placeholder="예: 김OO 고객 환불 요청"></div>
    <div class="grid2"><div class="field"><label for="apAm">금액 (원)</label><input id="apAm" inputmode="numeric" placeholder="없으면 비워 두기"></div>
    <div class="field"><label for="apBk">관련 예약 번호</label><input id="apBk" placeholder="예: TG20261030-001"></div></div>
    <div class="field"><label for="apC">내용</label><textarea id="apC" style="min-height:140px" placeholder="이유와 자세한 내용"></textarea></div></form>`,
    '<button class="btn" id="apN">취소</button><button class="btn primary" id="apY">결재 올리기</button>');
  $('#apN', d).onclick = closeDrawer;
  $('#apY', d).onclick = async () => {
    try { const a = await api.post('/api/erp/approvals', { type: $('#apT', d).value, title: $('#apTi', d).value, amount: $('#apAm', d).value, bookingNo: $('#apBk', d).value, content: $('#apC', d).value });
      toast(`결재 ${a.no}를 올렸습니다.`); closeDrawer(); after(); refreshWaitCount(); } catch (e) { toast(e.message); }
  };
}

function approvalView(a, after) {
  const canDecide = me.role === 'admin' && a.status === '대기';
  const canCancel = a.requesterId === me.id && a.status === '대기';
  const d = drawer(`전자결재 · ${a.no}`, `
    <div class="kv"><span>항목</span><b>${esc(a.type)}</b><span>제목</span><b>${esc(a.title)}</b><span>금액</span><b>${a.amount ? won(a.amount) : '-'}</b>
      <span>관련 예약</span><b>${esc(a.bookingNo || '-')}</b><span>요청자</span><b>${esc(a.requester)} · ${fmtDT(a.createdAt)}</b><span>상태</span><b><span class="badge ${AP_CLS[a.status] || ''}">${esc(a.status)}</span>${a.decidedBy ? ` ${esc(a.decidedBy)} · ${fmtDT(a.decidedAt)}` : ''}</b></div>
    ${a.content ? `<div class="card" style="padding:12px 14px;white-space:pre-line;margin-bottom:12px">${esc(a.content)}</div>` : ''}
    ${a.comment ? `<p><b>결재 의견:</b> ${esc(a.comment)}</p>` : ''}
    ${canDecide ? '<div class="field"><label for="apCm">결재 의견 (선택)</label><textarea id="apCm"></textarea></div>' : ''}
    <h3 style="font-size:14px;margin:16px 0 6px">처리 기록</h3><div class="muted" style="font-size:13px">${a.history.map(h => `${fmtDT(h.at)} · ${esc(h.by)} · ${esc(h.action)}`).join('<br>')}</div>`,
    (canCancel ? '<button class="btn" id="apCan" style="margin-right:auto">요청 취소</button>' : '') + (canDecide ? '<button class="btn" id="apRej" style="color:var(--danger)">반려</button><button class="btn primary" id="apOk">승인</button>' : ''));
  const decide = async approve => { try { await api.post(`/api/erp/approvals/${a.id}/decide`, { approve, comment: $('#apCm', d).value }); toast(approve ? '승인했습니다.' : '반려했습니다.'); closeDrawer(); after(); refreshWaitCount(); } catch (e) { toast(e.message); } };
  if (canDecide) { $('#apOk', d).onclick = () => decide(true); $('#apRej', d).onclick = () => decide(false); }
  if (canCancel) $('#apCan', d).onclick = async () => { try { await api.post(`/api/erp/approvals/${a.id}/cancel`); toast('요청을 취소했습니다.'); closeDrawer(); after(); } catch (e) { toast(e.message); } };
}

// ---------- 1:1 실시간 문의 ----------
let chatTimer = null;
async function chats(view, openId) {
  clearInterval(chatTimer);
  let list = await api.get('/api/erp/chats');
  let cur = openId || null;
  view.innerHTML = `<div class="chat-erp"><div class="chat-list" id="cl"></div><div class="chat-pane" id="cp"><div class="empty">왼쪽에서 대화를 고르세요.</div></div></div>`;
  const drawList = () => {
    $('#cl', view).innerHTML = list.map(c => { const last = c.messages[c.messages.length - 1] || {};
      return `<button class="chat-item ${c.id === cur ? 'on' : ''}" data-c="${esc(c.id)}"><b>${esc(c.name)}${c.unread ? ` <span class="cnt">${c.unread}</span>` : ''}</b><span>${esc((last.from === 'staff' ? '나: ' : '') + (last.text || '').slice(0, 30))}</span><small>${fmtDT(c.updatedAt || c.createdAt)}${c.closed ? ' · 끝남' : ''}</small></button>`; }).join('') || '<div class="empty">아직 들어온 대화가 없습니다.</div>';
    $$('[data-c]', view).forEach(b => b.onclick = () => { cur = b.dataset.c; history.replaceState(null, '', '#/chats/' + cur); drawPane(true); drawList(); });
  };
  const drawPane = async (markRead) => {
    const c = list.find(x => x.id === cur); if (!c) return;
    if (markRead && c.unread) { Object.assign(c, await api.post('/api/erp/chats/' + c.id, { read: true })); refreshWaitCount(); }
    const tel = (c.phone || '').replace(/[^0-9+]/g, '');
    const pane = $('#cp', view);
    const keep = $('#cpIn', view)?.value || '';
    pane.innerHTML = `<div class="chat-head"><b>${esc(c.name)}</b><span class="muted">${esc(c.phone || '연락처 없음')}</span>${tel ? `<a class="btn sm" href="tel:${esc(tel)}">전화</a>` : ''}<button class="btn sm" id="cpClose">${c.closed ? '다시 열기' : '대화 끝내기'}</button></div>
      <div class="chat-msgs" id="cpM">${c.messages.map(m => `<div class="msg ${m.from}"><div>${esc(m.text)}</div><small>${m.from === 'staff' ? esc(m.by || '') + ' · ' : ''}${fmtDT(m.at)}</small></div>`).join('')}</div>
      <form class="chat-in" id="cpF"><textarea id="cpIn" rows="2" placeholder="답장을 쓰고 Enter (줄바꿈은 Shift+Enter)"></textarea><button class="btn primary">보내기</button></form>`;
    $('#cpIn', view).value = keep;
    const m = $('#cpM', view); m.scrollTop = m.scrollHeight;
    $('#cpIn', view).onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#cpF', view).requestSubmit(); } };
    $('#cpF', view).onsubmit = async e => {
      e.preventDefault();
      const text = $('#cpIn', view).value.trim(); if (!text) return;
      $('#cpIn', view).value = '';
      Object.assign(c, await api.post('/api/erp/chats/' + c.id, { text })); drawPane(); drawList();
    };
    $('#cpClose', view).onclick = async () => { Object.assign(c, await api.post('/api/erp/chats/' + c.id, { close: !c.closed })); drawPane(); drawList(); };
  };
  drawList(); if (cur) drawPane(true);
  // 화면을 보고 있는 동안 4초마다 새 메시지 확인
  chatTimer = setInterval(async () => {
    if (!document.body.contains(view) || !location.hash.startsWith('#/chats')) return clearInterval(chatTimer);
    const before = JSON.stringify(list.map(c => [c.id, c.messages.length]));
    list = await api.get('/api/erp/chats').catch(() => list);
    if (JSON.stringify(list.map(c => [c.id, c.messages.length])) !== before) { drawList(); if (cur) drawPane(true); }
  }, 4000);
}

// ---------- 예약 관리 ----------
const bookingFilter = { status: '', month: '', q: '' };
async function bookings(view, openId) {
  $('#barAct').innerHTML = '<button class="btn primary sm" id="newB">+ 전화·카톡 예약 등록</button>';
  $('#newB').onclick = () => newBookingDrawer(() => bookings(view));
  const qs = new URLSearchParams(Object.entries(bookingFilter).filter(([, v]) => v)).toString();
  const list = await api.get('/api/erp/bookings' + (qs ? '?' + qs : ''));
  view.innerHTML = `
    <div class="filters">
      ${['', ...STATUSES].map(s => `<button class="chip ${bookingFilter.status === s ? 'on' : ''}" data-s="${esc(s)}">${s || '전체'}</button>`).join('')}
    </div>
    <div class="filters">
      <label class="muted" for="fm">출발월</label><input type="month" id="fm" value="${esc(bookingFilter.month)}">
      <input class="grow" id="fq" placeholder="예약번호, 이름, 연락처, 상품명으로 찾기" value="${esc(bookingFilter.q)}">
      <button class="btn sm" id="csv">엑셀(CSV) 내려받기</button>
    </div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>예약번호</th><th>예약자</th><th class="hide-m">상품</th><th>출발일</th><th class="num">인원</th><th class="num hide-m">합계</th><th class="num hide-m">입금</th><th>상태</th></tr></thead>
    <tbody>${list.map(b => `<tr class="click" data-id="${esc(b.id)}"><td>${esc(b.no)}<div class="muted" style="font-size:12px">${fmtDT(b.createdAt)}</div></td><td>${esc(b.name)}<div class="muted" style="font-size:12px">${esc(b.phone)}</div></td><td class="hide-m">${esc(b.productTitle)}</td><td>${esc(b.departDate)}</td><td class="num">${b.pax}</td><td class="num hide-m">${b.total ? won(b.total) : '상담'}</td><td class="num hide-m">${won(paid(b))}</td><td>${badge(b.status)}${b.cancelRequested && b.status !== '취소' ? '<div><span class="badge r" style="margin-top:4px">취소 요청</span></div>' : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:32px">조건에 맞는 예약이 없습니다.</td></tr>'}</tbody></table></div>`;
  $$('.chip', view).forEach(c => c.onclick = () => { bookingFilter.status = c.dataset.s; bookings(view); });
  $('#fm').onchange = e => { bookingFilter.month = e.target.value; bookings(view); };
  let t; $('#fq').oninput = e => { clearTimeout(t); t = setTimeout(() => { bookingFilter.q = e.target.value; bookings(view).then(() => { const q = $('#fq'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 350); };
  $('#csv').onclick = () => {
    const rows = [['예약번호', '접수일', '예약자', '연락처', '상품', '출발일', '박', '인원', '1인1실', '합계', '예약금', '입금', '미수', '잔금기한', '환불기한', '상태', '요청사항']];
    for (const b of list) rows.push([b.no, fmtD(b.createdAt), b.name, b.phone, b.productTitle, b.departDate, b.nights, b.pax, b.single ? 'Y' : '', b.total, b.deposit, paid(b), b.total - paid(b), b.balanceDue, b.refundDeadline, b.status, b.note]);
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `태일골프_예약_${todayKST()}.csv`; a.click();
  };
  $$('tr[data-id]', view).forEach(tr => tr.onclick = () => openBooking(tr.dataset.id, () => bookings(view)));
  if (openId) openBooking(openId, () => bookings(view));
}

function drawer(title, bodyHtml, footHtml) {
  closeDrawer();
  const bg = document.createElement('div'); bg.className = 'drawer-bg'; bg.id = 'dbg';
  const d = document.createElement('div'); d.className = 'drawer'; d.id = 'drw'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', title);
  d.innerHTML = `<header><h2>${esc(title)}</h2><button class="xbtn" id="dx" aria-label="닫기">×</button></header><div class="body">${bodyHtml}</div>${footHtml ? `<footer>${footHtml}</footer>` : ''}`;
  document.body.append(bg, d);
  bg.onclick = closeDrawer; $('#dx').onclick = closeDrawer;
  document.addEventListener('keydown', escClose);
  d.querySelector('input, select, textarea, button')?.focus();
  return d;
}
function escClose(e) { if (e.key === 'Escape') closeDrawer(); }
function closeDrawer() { $('#dbg')?.remove(); $('#drw')?.remove(); document.removeEventListener('keydown', escClose); }

function guideMessage(b, s) {
  const p = paid(b);
  const lines = [`[${s.brand}] ${b.name}님, 예약해 주셔서 감사합니다.`, '', `■ 상품: ${b.productTitle}`, `■ 출발일: ${b.departDate}${b.nights ? ` (${b.nights}박)` : ''}`, `■ 인원: ${b.pax}명${b.single ? ' (1인 1실)' : ''}`, `■ 예약번호: ${b.no}`];
  if (b.total) {
    lines.push(`■ 합계: ${won(b.total)} (VAT 별도)`);
    if (p < b.deposit) lines.push(`■ 예약금(20%): ${won(b.deposit - p)}`);
    if (p < b.total) lines.push(`■ 잔금: ${won(b.total - Math.max(p, b.deposit))} · ${b.balanceDue}까지`);
    else lines.push('■ 완납 확인되었습니다.');
    if (p < b.total) lines.push('', `입금 계좌: ${s.bank.name} ${s.bank.account} (예금주 ${s.bank.holder})`);
  }
  lines.push('', `※ 환불은 출발 14일 전(${b.refundDeadline})까지만 가능합니다.`, `문의: ${s.tel} · 카카오톡 채널 ${s.brand}`);
  return lines.join('\n');
}

// 카카오톡 채널로 보낼 안내문 종류. 금액·기한은 예약에서 자동으로 채웁니다.
const NOTICE_KINDS = [['guide', '예약 안내'], ['deposit', '예약금 입금 요청'], ['balance', '잔금 안내'], ['refund', '환불 마감 안내'], ['depart', '출발 안내']];
function noticeMessage(kind, b, s) {
  if (kind === 'guide') return guideMessage(b, s);
  const p = paid(b);
  const head = `[${s.brand}] ${b.name}님, 안녕하세요.`;
  const bank = `입금 계좌: ${s.bank.name} ${s.bank.account} (예금주 ${s.bank.holder})`;
  const tail = `문의: ${s.tel} · 카카오톡 채널 ${s.brand}`;
  const item = `■ ${b.productTitle} / 출발 ${b.departDate} / ${b.pax}명 (예약번호 ${b.no})`;
  const amt = (label, due) => !b.total ? `■ ${label}: 금액을 확정해 따로 안내드립니다.` : due > 0 ? `■ ${label}: ${won(due)}` : `■ ${label}: 입금 확인되었습니다. 감사합니다.`;
  if (kind === 'deposit') return [head, '', '예약이 접수되었습니다. 아래 예약금을 입금해 주시면 예약이 확정됩니다.', '', item, amt('예약금(20%)', b.deposit - p), '', bank, '', tail].join('\n');
  if (kind === 'balance') return [head, '', `잔금 입금 기한(${b.balanceDue})이 다가와 안내드립니다.`, '', item, amt('잔금', b.total - p), '', bank, '', tail].join('\n');
  if (kind === 'refund') return [head, '', `환불은 출발 14일 전인 ${b.refundDeadline}까지만 가능합니다. 일정 변경이나 취소를 생각하고 계시면 그 전에 알려 주세요.`, '', item, '', tail].join('\n');
  if (kind === 'depart') return [head, '', `출발일(${b.departDate})이 다가왔습니다. 즐거운 라운드 되시도록 준비하겠습니다.`, '', item,
    '■ 챙기실 것: 여권(만료 6개월 이상 남아야 함), 골프 장비, 상비약', '■ 캐디팁은 현지에서 직접 드리는 비용입니다.', '', tail].join('\n');
  return '';
}
const channelAdminUrl = s => { const m = (s.kakaoUrl || '').match(/pf\.kakao\.com\/(_[A-Za-z0-9]+)/); return m ? `https://center-pf.kakao.com/${m[1]}/chats` : 'https://center-pf.kakao.com/'; };

async function openBooking(id, after) {
  const [b, s] = await Promise.all([api.get('/api/erp/bookings/' + id), getSettings()]);
  const p = paid(b);
  const closed = ['취소', '출발 완료'].includes(b.status);
  const t = todayKST();
  const d = drawer(`${b.no} · ${b.name}`, `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">${badge(b.status)}${b.cancelRequested && b.status !== '취소' ? '<span class="badge r">고객 취소 요청</span>' : ''}<span class="muted" style="font-size:13px">접수 ${fmtDT(b.createdAt)}${b.memberEmail ? ' · 회원 ' + esc(b.memberEmail) : ' · 직원 등록'}</span></div>
    <div class="money">
      <div><span>합계</span><b>${b.total ? won(b.total) : '상담'}</b></div>
      <div><span>예약금 20%</span><b>${won(b.deposit)}</b></div>
      <div><span>입금</span><b>${won(p)}</b></div>
      <div class="${b.total - p > 0 ? 'due' : ''}"><span>남은 금액</span><b>${won(Math.max(0, b.total - p))}</b></div>
    </div>
    <dl class="kv">
      <dt>상품</dt><dd>${esc(b.productTitle)}</dd>
      <dt>잔금 기한</dt><dd>${esc(b.balanceDue)} <span class="muted">(출발 1개월 전 · 자동 계산)</span></dd>
      <dt>환불 가능 기한</dt><dd>${esc(b.refundDeadline)} ${t > b.refundDeadline ? '<span class="badge r">지남</span>' : `<span class="muted">(D-${daysBetween(t, b.refundDeadline)})</span>`}</dd>
    </dl>
    <div class="sec-title">예약 내용</div>
    <form id="bf" ${closed ? 'inert' : ''}>
      <div class="grid3">
        <div class="field"><label>출발일</label><input name="departDate" type="date" value="${esc(b.departDate)}"></div>
        <div class="field"><label>박 수</label><input name="nights" type="number" min="0" value="${b.nights}"></div>
        <div class="field"><label>인원</label><input name="pax" type="number" min="1" max="40" value="${b.pax}"></div>
      </div>
      <label class="check"><input type="checkbox" name="single" ${b.single ? 'checked' : ''}> 1인 1실</label>
      <div class="grid3">
        <div class="field"><label>예약자</label><input name="name" value="${esc(b.name)}"></div>
        <div class="field"><label>연락처</label><input name="phone" value="${esc(b.phone)}"></div>
        <div class="field"><label>카카오톡 ID</label><input name="kakaoId" value="${esc(b.kakaoId || '')}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>항공편</label><input name="flight" value="${esc(b.flight || '')}" placeholder="예: LJ1 인천 07:30 → 방콕"></div>
        <div class="field"><label>호텔</label><input name="hotel" value="${esc(b.hotel || '')}"></div>
      </div>
      <div class="field"><label>합계 금액 직접 수정 <span class="muted">(비우면 자동 계산)</span></label><input name="total" type="number" min="0" step="1000" value="${b.manualTotal ? b.total : ''}" placeholder="${b.total}"></div>
      <div class="field"><label>고객 요청사항</label><textarea name="note">${esc(b.note || '')}</textarea></div>
      <div class="field"><label>직원 메모 <span class="muted">(고객에게 안 보임)</span></label><textarea name="staffMemo">${esc(b.staffMemo || '')}</textarea></div>
      ${closed ? '' : '<button class="btn sm" type="submit">변경 내용 저장</button>'}
    </form>
    <div class="sec-title">입금 내역</div>
    <div>${(b.payments || []).map(x => `<div class="pay-row"><span>${esc(x.date)}</span><span class="grow">${esc(x.method)}${x.memo ? ' · ' + esc(x.memo) : ''} <span class="muted">(${esc(x.by || '')})</span></span><b>${won(x.amount)}</b>${closed ? '' : `<button class="btn sm ghost" data-delpay="${esc(x.id)}" aria-label="입금 삭제">삭제</button>`}</div>`).join('') || '<div class="muted" style="font-size:14px">아직 입금이 없습니다.</div>'}</div>
    ${closed ? '' : `<form id="pf" class="filters" style="margin-top:10px">
      <input name="amount" type="number" min="0" step="1000" placeholder="입금액" style="width:140px" value="${p < b.deposit ? b.deposit - p : Math.max(0, b.total - p) || ''}">
      <input name="date" type="date" value="${t}">
      <select name="method"><option>계좌이체</option><option>카드</option><option>현금</option></select>
      <input name="memo" placeholder="메모 (예: 예약금)" class="grow">
      <button class="btn primary sm">입금 등록</button></form>`}
    ${travelersHtml(b, closed)}
    <div class="sec-title">카카오톡 안내문 <span class="muted" style="font-weight:400;font-size:13px">금액·기한이 자동으로 들어갑니다</span></div>
    <div class="chips-erp" id="nk">${NOTICE_KINDS.map(([k, n], i) => `<button type="button" class="${i ? '' : 'on'}" data-nk="${k}">${n}</button>`).join('')}</div>
    <div class="msgbox" id="msg">${esc(guideMessage(b, s))}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" id="cpy">복사</button><button class="btn primary sm" id="cpyK">복사하고 카카오 채널 열기</button></div>
    <p class="muted" style="font-size:12px;margin:6px 0 0">채널 관리자 채팅에서 ${esc(b.name)}님을 찾아 붙여 넣으세요. 카카오 규칙상 먼저 채널로 말을 건 고객에게만 보낼 수 있습니다.</p>
    <div class="sec-title">처리 기록</div>
    <div class="history">${(b.history || []).slice().reverse().map(h => `<div>${fmtDT(h.at)} · ${esc(h.by)} · ${esc(h.action)}</div>`).join('')}</div>`,
    closed
      ? (b.status === '취소' ? '<button class="btn" data-act="restore">취소 철회</button>' : '')
      : `${b.status === '접수' ? '<button class="btn primary" data-act="confirm">예약 확정</button>' : ''}
         <button class="btn" data-act="done">출발 완료</button>
         <button class="btn" data-act="cancel" style="color:var(--danger)">예약 취소</button>`);
  const reload = () => { openBooking(id, after); after && after(); };
  let nk = 'guide';
  $$('[data-nk]', d).forEach(btn => btn.onclick = () => { nk = btn.dataset.nk; $$('[data-nk]', d).forEach(x => x.classList.toggle('on', x === btn)); $('#msg', d).textContent = noticeMessage(nk, b, s); });
  const logSent = () => api.post(`/api/erp/bookings/${b.id}/notified`, { kind: NOTICE_KINDS.find(x => x[0] === nk)[1] }).catch(() => {});
  $('#cpy', d).onclick = () => { copy(noticeMessage(nk, b, s)); logSent(); };
  $('#cpyK', d).onclick = () => { copy(noticeMessage(nk, b, s)); logSent(); window.open(channelAdminUrl(s), '_blank', 'noopener'); };
  bindTravelers(d, b, { toast, copy, reload });
  const bf = $('#bf', d);
  bf.onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(bf);
    const body = Object.fromEntries(['departDate', 'name', 'phone', 'kakaoId', 'note', 'staffMemo', 'flight', 'hotel'].map(k => [k, f.get(k)]));
    body.nights = Number(f.get('nights')); body.pax = Number(f.get('pax')); body.single = !!f.get('single');
    if (f.get('total')) body.total = Number(f.get('total'));
    try { await api.patch('/api/erp/bookings/' + id, body); toast('저장했습니다. 금액과 기한이 다시 계산되었습니다.'); reload(); } catch (err) { toast(err.message); }
  };
  const pf = $('#pf', d);
  if (pf) pf.onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(pf));
    try { await api.post(`/api/erp/bookings/${id}/payments`, f); toast('입금을 등록했습니다. 상태가 자동으로 바뀝니다.'); reload(); } catch (err) { toast(err.message); }
  };
  $$('[data-delpay]', d).forEach(btn => btn.onclick = async () => {
    if (!await ask('이 입금 내역을 삭제할까요?')) return;
    await api.del(`/api/erp/bookings/${id}/payments/${btn.dataset.delpay}`); reload();
  });
  $$('[data-act]', d).forEach(btn => btn.onclick = async () => {
    const act = btn.dataset.act;
    const msg = { cancel: `${b.name}님 예약을 취소할까요?${t > b.refundDeadline ? '\n환불 가능 기한이 지났습니다.' : ''}`, done: '출발 완료로 처리할까요?', restore: '취소를 철회할까요?' }[act];
    if (msg && !await ask(msg)) return;
    await api.patch('/api/erp/bookings/' + id, { action: act });
    toast({ confirm: '예약을 확정했습니다. 안내 메시지를 복사해서 보내 주세요.', cancel: '예약을 취소했습니다.', done: '출발 완료로 처리했습니다.', restore: '취소를 철회했습니다.' }[act]);
    reload();
  });
}

async function newBookingDrawer(after, pre = {}, onSaved) {
  const products = await api.get('/api/erp/products');
  const d = drawer('전화·카톡 예약 등록', `
    <form id="nb">
      <div class="field"><label>상품</label><select name="productId" required>${products.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select></div>
      <div class="grid3">
        <div class="field"><label>출발일</label><input name="departDate" type="date" required value="${esc(pre.departDate || '')}"></div>
        <div class="field"><label>박 수</label><input name="nights" type="number" min="0" placeholder="상품 기본값" value="${esc(pre.nights || '')}"></div>
        <div class="field"><label>인원</label><input name="pax" type="number" min="1" value="${esc(pre.pax || 2)}"></div>
      </div>
      <label class="check"><input type="checkbox" name="single"> 1인 1실</label>
      <div class="grid2">
        <div class="field"><label>예약자 이름</label><input name="name" required value="${esc(pre.name || '')}"></div>
        <div class="field"><label>연락처</label><input name="phone" value="${esc(pre.phone || '')}"></div>
      </div>
      <div class="field"><label>요청사항</label><textarea name="note">${esc(pre.note || '')}</textarea></div>
      <p class="muted" style="font-size:13px">저장하면 금액, 예약금 20%, 잔금 기한(출발 1개월 전), 환불 기한(출발 14일 전)이 자동으로 계산됩니다.</p>
    </form>`, '<button class="btn primary" id="nbSave">예약 등록</button>');
  $('#nbSave', d).onclick = async () => {
    const f = new FormData($('#nb', d));
    const body = Object.fromEntries(f); body.single = !!f.get('single');
    try { const b = await api.post('/api/erp/bookings', body); if (onSaved) await onSaved(b); toast(`예약 ${b.no} 등록했습니다.`); closeDrawer(); after && after(); openBooking(b.id, after); }
    catch (err) { toast(err.message); }
  };
}

// ---------- 비밀번호 바꾸기 ----------
function passwordDrawer() {
  const d = drawer('비밀번호 바꾸기', `<form id="pwf">
    <div class="field"><label for="pw0">지금 비밀번호</label><input id="pw0" type="password" autocomplete="current-password" required></div>
    <div class="field"><label for="pw1">새 비밀번호</label><input id="pw1" type="password" autocomplete="new-password" required><span class="muted" style="font-size:13px">영문과 숫자를 섞어 8자 이상 (예: taeil2026)</span></div>
    <div class="field"><label for="pw2">새 비밀번호 한 번 더</label><input id="pw2" type="password" autocomplete="new-password" required></div></form>`,
    '<button class="btn" id="pwN">취소</button><button class="btn primary" id="pwY">바꾸기</button>');
  $('#pwN', d).onclick = closeDrawer;
  $('#pwY', d).onclick = async () => {
    const [a, b, c] = ['#pw0', '#pw1', '#pw2'].map(s => $(s, d).value);
    if (b !== c) return toast('새 비밀번호 두 칸이 서로 다릅니다.');
    try { await api.post('/api/me/password', { current: a, next: b }); toast('비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요.'); closeDrawer(); }
    catch (err) { toast(err.message); }
  };
}

// ---------- 상품 관리 ----------
async function products(view) {
  $('#barAct').innerHTML = `<a class="btn sm" href="../assets/product-template.xlsx" download="태일골프_상품등록_양식.xlsx">엑셀 양식 받기</a>
    <label class="btn sm">엑셀로 올리기<input type="file" id="xlIn" accept=".xlsx,.xls,.csv" hidden></label>
    <button class="btn primary sm" id="newP">+ 상품 등록</button>`;
  $('#newP').onclick = () => productEditor(null, () => products(view));
  const list = await api.get('/api/erp/products');
  $('#xlIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) excelImport(f, list, () => products(view)); };
  view.innerHTML = `<p class="muted" style="margin-top:0">기준가(시트 가격)를 넣으면 홈페이지·앱에는 <b>기준가 + ${won(PRICE_MARKUP)}</b>이 1인 요금으로 자동 표시됩니다. 기준가는 직원에게만 보입니다.<br>홈페이지 "지금 예약할 수 있는 상품"은 여기 목록입니다. <b>수정</b>을 누르면 사진·이름·가격·설명·노출·순서를 바꿀 수 있습니다.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:80px">사진</th><th>상품명</th><th class="hide-m">분류</th><th class="num">기준가</th><th class="num hide-m">고객 표시가</th><th>노출</th><th></th></tr></thead>
    <tbody>${list.map(p => {
      const im = p.images && p.images[0];
      return `<tr class="click" data-id="${esc(p.id)}"><td>${im ? `<img src="${esc(im.sm || im.md)}" alt="" style="width:64px;aspect-ratio:4/3;object-fit:cover;border-radius:6px">` : '<div style="width:64px;aspect-ratio:4/3;border-radius:6px;background:var(--bg-2)"></div>'}</td>
      <td><b>${esc(p.title)}</b><div class="muted" style="font-size:12px">${esc(p.code || '')} · ${esc([p.country, p.city].filter(Boolean).join(' '))}${p.nights ? ` · ${p.nights}박` : ''}</div></td>
      <td class="hide-m">${esc(catName(p.category))}</td><td class="num">${p.basePrice ? won(p.basePrice) : '<span class="muted">미입력</span>'}</td><td class="num hide-m">${p.basePrice ? won(p.basePrice + PRICE_MARKUP) : '요금 상담'}</td>
      <td>${p.visible !== false ? '<span class="badge g">노출</span>' : '<span class="badge">숨김</span>'}</td><td><button type="button" class="btn sm">수정</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">등록된 상품이 없습니다.</td></tr>'}</tbody></table></div>`;
  $$('tr[data-id]', view).forEach(tr => tr.onclick = () => productEditor(list.find(p => p.id === tr.dataset.id), () => products(view)));
}

// 엑셀 읽기 도구는 엑셀을 올릴 때만 불러옵니다
let xlsxLib = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return xlsxLib ||= new Promise((ok, no) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = () => ok(window.XLSX);
    sc.onerror = () => { xlsxLib = null; no(new Error('엑셀 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
    document.head.append(sc);
  });
}

async function excelImport(file, list, after) {
  let rows;
  try {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer());
    const name = wb.SheetNames.find(n => n === '상품목록') || wb.SheetNames[0];
    rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: true });
  } catch (err) { toast(err.message || '엑셀 파일을 읽지 못했습니다.'); return; }
  const checked = rows.map((raw, i) => {
    const { data, errors } = excelRowToProduct(raw);
    const kind = isExampleRow(data) ? 'skip' : errors.length ? 'err' : list.some(p => p.code && p.code === data.code) ? 'upd' : 'new';
    return { line: i + 2, raw, data, errors, kind };
  });
  const n = k => checked.filter(c => c.kind === k).length;
  const good = checked.filter(c => c.kind === 'new' || c.kind === 'upd');
  const LABEL = { new: '<span class="badge g">새로 등록</span>', upd: '<span class="badge b">수정</span>', err: '<span class="badge r">오류</span>', skip: '<span class="badge">예시 · 건너뜀</span>' };
  const d = drawer('엑셀로 상품 올리기', `<p style="margin-top:0"><b>${esc(file.name)}</b> · ${checked.length}줄을 읽었습니다.</p>
    <div class="xl-sum"><span>새로 등록 <b>${n('new')}</b></span><span>수정 <b>${n('upd')}</b></span><span class="${n('err') ? 'bad' : ''}">오류 <b>${n('err')}</b></span>${n('skip') ? `<span>예시 줄 <b>${n('skip')}</b></span>` : ''}</div>
    ${n('err') ? '<p class="muted">오류가 있는 줄은 빼고 올립니다. 엑셀에서 고친 뒤 다시 올리면 됩니다.</p>' : ''}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>줄</th><th>처리</th><th>상품</th><th class="num">기준가</th></tr></thead><tbody>
    ${checked.map(c => `<tr class="${c.kind === 'err' ? 'xl-err' : ''}"><td>${c.line}</td><td>${LABEL[c.kind]}</td>
      <td><b>${esc(c.data.title || '(상품명 없음)')}</b><div class="muted" style="font-size:12px">${esc(c.data.code)} · ${esc(catName(c.data.category))}${c.data.nights ? ` · ${c.data.nights}박` : ''}${c.data.visible ? '' : ' · 숨김'}</div>
      ${c.errors.length ? `<div class="xl-msg">${c.errors.map(esc).join('<br>')}</div>` : ''}</td>
      <td class="num">${c.data.basePrice ? won(c.data.basePrice) : '<span class="muted">요금 상담</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">읽은 줄이 없습니다. 첫 줄에 제목(상품코드, 상품명, 분류 …)이 있는지 확인해 주세요.</td></tr>'}
    </tbody></table></div>`,
    `<button class="btn" id="xlNo">취소</button><button class="btn primary" id="xlGo" ${good.length ? '' : 'disabled'}>${good.length}개 상품 올리기</button>`);
  $('#xlNo', d).onclick = closeDrawer;
  $('#xlGo', d).onclick = async () => {
    $('#xlGo', d).disabled = true;
    try {
      const r = await api.post('/api/erp/products/import', { rows: good.map(c => c.raw) });
      toast(`새로 등록 ${r.created}개, 수정 ${r.updated}개 했습니다. 홈페이지에 바로 반영됩니다.`);
      closeDrawer(); after();
    } catch (err) { toast(err.message); $('#xlGo', d).disabled = false; }
  };
}

function imageUploader(container, images, slot, onChange, max = 8) {
  const wide = slot === 'banner';
  const render = () => {
    container.innerHTML = `<div class="img-list">${images.map((im, k) => `<div class="img-item ${wide ? 'wide' : ''} ${slot}"><img src="${esc(im.sm || im.md)}" alt="">${k === 0 && !wide && max > 1 ? '<span class="first">대표</span>' : ''}<button type="button" data-rm="${k}" aria-label="사진 삭제">×</button></div>`).join('')}</div>
      ${images.length < max ? `<label class="drop" style="display:block;margin-top:8px"><input type="file" accept="image/*" ${max > 1 ? 'multiple' : ''} hidden><b>사진 올리기</b> · 끌어다 놓아도 됩니다<br><span style="font-size:13px">${SLOTS[slot].label} 비율로 자동으로 잘라내고, 크기별(큰·중간·작은)로 자동 저장합니다.</span></label>` : ''}`;
    $$('[data-rm]', container).forEach(b => b.onclick = () => { images.splice(+b.dataset.rm, 1); onChange(images); render(); });
    const drop = $('.drop', container);
    if (!drop) return;
    const input = $('input', drop);
    const handle = async files => {
      drop.innerHTML = '사진을 맞추는 중…';
      for (const f of [...files].slice(0, max - images.length)) {
        try {
          const sized = await resizeForSlot(f, slot);
          if (demo) delete sized.lg; // 미리보기는 브라우저 저장 공간이 작아 큰 사진은 생략
          const { urls } = await api.post('/api/erp/upload', { files: sized });
          images.push(urls);
        } catch (err) { toast(err.message); }
      }
      onChange(images); render();
    };
    input.onchange = () => handle(input.files);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); handle(e.dataTransfer.files); };
  };
  render();
}

function productEditor(p, after) {
  const isNew = !p;
  p = p || { category: 'unlimited', visible: true, images: [], order: 99 };
  const images = [...(p.images || [])];
  const d = drawer(isNew ? '상품 등록' : '상품 수정', `
    <form id="pe">
      <div class="sec-title">사진</div><div id="imgs"></div>
      <div class="sec-title">기본 정보</div>
      <div class="field"><label>상품명</label><input name="title" value="${esc(p.title || '')}" required></div>
      <div class="grid3">
        <div class="field"><label>분류</label><select name="category">${CATEGORIES.map(c => `<option value="${c.id}" ${p.category === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>
        <div class="field"><label>상품코드</label><input name="code" value="${esc(p.code || '')}"></div>
        <div class="field"><label>박 수</label><input name="nights" type="number" min="0" value="${p.nights || 0}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>나라</label><input name="country" value="${esc(p.country || '')}"></div>
        <div class="field"><label>도시</label><input name="city" value="${esc(p.city || '')}"></div>
      </div>
      <div class="field"><label>한 줄 소개</label><input name="summary" value="${esc(p.summary || '')}"></div>
      <div class="sec-title">요금</div>
      <div class="grid3">
        <div class="field"><label>기준가 (1인, 직원만 보임)</label><input name="basePrice" type="number" min="0" step="1000" value="${p.basePrice || ''}"><span class="hint" id="shown"></span></div>
        <div class="field"><label>1인 1실 추가요금</label><input name="singleSupplement" type="number" min="0" step="1000" value="${p.singleSupplement || ''}"><span class="hint">한 달 살기는 자동으로 2인 요금</span></div>
        <div class="field"><label>요금 없을 때 문구</label><input name="priceNote" value="${esc(p.priceNote || '')}" placeholder="요금 상담"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>포함</label><textarea name="includes">${esc(p.includes || '')}</textarea></div>
        <div class="field"><label>불포함</label><textarea name="excludes">${esc(p.excludes || '')}</textarea></div>
      </div>
      <div class="field"><label>상세 안내</label><textarea name="body" style="min-height:160px">${esc(p.body || '')}</textarea></div>
      <div class="sec-title">노출</div>
      <div class="grid3">
        <div class="field"><label>노출 시작일</label><input name="showFrom" type="date" value="${esc(p.showFrom || '')}"></div>
        <div class="field"><label>노출 종료일</label><input name="showTo" type="date" value="${esc(p.showTo || '')}"></div>
        <div class="field"><label>순서 (작을수록 앞)</label><input name="order" type="number" value="${p.order || 99}"></div>
      </div>
      <label class="check"><input type="checkbox" name="visible" ${p.visible !== false ? 'checked' : ''}> 홈페이지에 노출</label>
    </form>`,
    `${!isNew && me.role === 'admin' ? '<button class="btn" id="pDel" style="color:var(--danger);margin-right:auto">삭제</button>' : ''}<button class="btn primary" id="pSave">${isNew ? '등록' : '저장'}</button>`);
  imageUploader($('#imgs', d), images, 'product', () => {});
  const shown = () => { const v = Number($('[name=basePrice]', d).value); $('#shown', d).textContent = v ? `고객 표시가 ${won(v + PRICE_MARKUP)}` : '비우면 "요금 상담"으로 표시'; };
  $('[name=basePrice]', d).oninput = shown; shown();
  $('#pSave', d).onclick = async () => {
    const f = new FormData($('#pe', d));
    const body = Object.fromEntries(f); body.visible = !!f.get('visible'); body.images = images;
    try { await api.put('/api/erp/products/' + (isNew ? 'new' : p.id), body); toast('저장했습니다. 홈페이지에 바로 반영됩니다.'); closeDrawer(); after(); }
    catch (err) { toast(err.message); }
  };
  if ($('#pDel', d)) $('#pDel', d).onclick = async () => {
    if (!await ask(`"${p.title}" 상품을 삭제할까요? 되돌릴 수 없습니다. 잠시 내리려면 "노출"을 끄세요.`)) return;
    await api.del('/api/erp/products/' + p.id); toast('삭제했습니다.'); closeDrawer(); after();
  };
}

// ---------- 공지사항 ----------
async function notices(view) {
  $('#barAct').innerHTML = '<button class="btn primary sm" id="newN">+ 공지 쓰기</button>';
  const list = await api.get('/api/erp/notices');
  const edit = n => {
    n = n || { visible: true };
    const d = drawer(n.id ? '공지 수정' : '공지 쓰기', `<form id="ne">
      <div class="field"><label>제목</label><input name="title" value="${esc(n.title || '')}"></div>
      <div class="field"><label>내용</label><textarea name="body" style="min-height:320px">${esc(n.body || '')}</textarea></div>
      <label class="check"><input type="checkbox" name="pinned" ${n.pinned ? 'checked' : ''}> 맨 위에 고정 (필독)</label>
      <label class="check"><input type="checkbox" name="visible" ${n.visible !== false ? 'checked' : ''}> 홈페이지에 노출</label></form>`,
      `${n.id ? '<button class="btn" id="nDel" style="color:var(--danger);margin-right:auto">삭제</button>' : ''}<button class="btn primary" id="nSave">저장</button>`);
    $('#nSave', d).onclick = async () => {
      const f = new FormData($('#ne', d));
      try { await api.put('/api/erp/notices/' + (n.id || 'new'), { title: f.get('title'), body: f.get('body'), pinned: !!f.get('pinned'), visible: !!f.get('visible') }); toast('저장했습니다.'); closeDrawer(); notices(view); }
      catch (err) { toast(err.message); }
    };
    if ($('#nDel', d)) $('#nDel', d).onclick = async () => { if (!await ask('이 공지를 삭제할까요?')) return; await api.del('/api/erp/notices/' + n.id); closeDrawer(); notices(view); };
  };
  $('#newN').onclick = () => edit(null);
  view.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>제목</th><th class="hide-m">작성자</th><th>작성일</th><th>노출</th></tr></thead><tbody>
    ${list.map(n => `<tr class="click" data-id="${esc(n.id)}"><td>${n.pinned ? '<span class="badge o">필독</span> ' : ''}${esc(n.title)}</td><td class="hide-m">${esc(n.author || '')}</td><td>${fmtD(n.createdAt)}</td><td>${n.visible !== false ? '<span class="badge g">노출</span>' : '<span class="badge">숨김</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">공지가 없습니다.</td></tr>'}</tbody></table></div>`;
  $$('tr[data-id]', view).forEach(tr => tr.onclick = () => edit(list.find(n => n.id === tr.dataset.id)));
}

// ---------- 회원 · 직원 ----------
async function members(view) {
  const list = await api.get('/api/erp/members');
  const ROLE = { member: '회원', staff: '직원', admin: '관리자' };
  view.innerHTML = `<p class="muted" style="margin-top:0">홈페이지에서 가입한 회원이 자동으로 보입니다. 직원으로 바꾸면 그 계정으로 ERP에 들어올 수 있습니다.${me.role !== 'admin' ? ' (권한 변경은 관리자만 할 수 있습니다.)' : ''}</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>이메일</th><th class="hide-m">연락처</th><th class="hide-m">가입일</th><th>구분</th></tr></thead><tbody>
    ${list.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td class="hide-m">${esc(u.phone || '')}</td><td class="hide-m">${fmtD(u.createdAt)}</td>
      <td>${me.role === 'admin' && u.id !== me.id ? `<select data-role="${esc(u.id)}" aria-label="${esc(u.name)} 구분">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : ROLE[u.role]}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-role]', view).forEach(sel => sel.onchange = async () => {
    try { await api.patch('/api/erp/members/' + sel.dataset.role, { role: sel.value }); toast('권한을 바꿨습니다.'); } catch (err) { toast(err.message); members(view); }
  });
}

// ---------- 홈페이지 설정 ----------
async function getSettings(force) {
  if (!settingsCache || force) settingsCache = await api.get('/api/erp/settings');
  return settingsCache;
}

// 구글 스프레드시트 Apps Script (열쇠가 맞는 요청만 받아 탭별로 한 줄씩 붙임)
function sheetScript(key) {
  return `// 태일골프 ERP → 구글 시트 (이 열쇠는 다른 사람에게 알려 주지 마세요)
const KEY = '${key}';
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.key !== KEY) return out({ ok: false, error: '열쇠가 맞지 않습니다.' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(d.sheet) || ss.insertSheet(d.sheet);
    const rows = d.rows || [];
    if (!rows.length) return out({ ok: true, added: 0 });
    const head = sh.getLastRow() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].filter(String) : [];
    Object.keys(rows[0]).forEach(k => { if (head.indexOf(k) < 0) head.push(k); });
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    const vals = rows.map(r => head.map(h => (r[h] === undefined || r[h] === null) ? '' : String(r[h])));
    sh.getRange(sh.getLastRow() + 1, 1, vals.length, head.length).setNumberFormat('@').setValues(vals);
    return out({ ok: true, added: vals.length });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
`;
}

async function siteSettings(view) {
  const s = structuredClone(await getSettings(true));
  const ro = me.role !== 'admin';
  $('#barAct').innerHTML = '<a class="btn sm" href="../" target="_blank">홈페이지 미리보기</a>';
  const F = (label, key, val, attrs = '') => `<div class="field"><label>${label}</label><input data-k="${key}" value="${esc(val ?? '')}" ${attrs}></div>`;
  view.innerHTML = `<form id="sf" ${ro ? 'inert' : ''}>
    <div class="card"><h2>브랜드</h2>
      <div class="grid3">${F('브랜드 이름', 'brand', s.brand)}${F('회사명', 'companyName', s.companyName)}${F('영문 회사명', 'companyNameEn', s.companyNameEn)}</div>
      ${F('대표 문구', 'tagline', s.tagline)}
      <div class="grid3">
        <div class="field"><label>대표 색상</label><div class="color-in"><input type="color" data-c="primary" value="${esc(s.colors.primary)}"><span class="muted">${esc(s.colors.primary)}</span></div></div>
        <div class="field"><label>강조 색상 (버튼)</label><div class="color-in"><input type="color" data-c="accent" value="${esc(s.colors.accent)}"><span class="muted">${esc(s.colors.accent)}</span></div></div>
        <div class="field"><label>로고</label><div id="logoUp"></div></div>
      </div>
    </div>
    <div class="card"><h2>메인 배너 <small>사진을 올리면 16:7 비율로 자동 맞춤 · 여러 장이면 6초마다 바뀝니다</small></h2>
      <div id="banners"></div><button type="button" class="btn sm" id="addBanner" style="margin-top:8px">+ 배너 추가</button></div>
    <div class="card"><h2>메뉴 <small>이름을 바꾸거나 숨길 수 있습니다</small></h2>
      ${s.menus.map((m, k) => `<div class="filters"><input data-menu="${k}" value="${esc(m.name)}" aria-label="메뉴 이름"><label class="check" style="margin:0"><input type="checkbox" data-menuv="${k}" ${m.visible !== false ? 'checked' : ''}> 보이기</label></div>`).join('')}</div>
    <div class="card"><h2>회사 정보 <small>홈페이지 맨 아래에 표시됩니다</small></h2>
      <div class="grid3">${F('대표자', 'ceo', s.ceo)}${F('사업자등록번호', 'bizNo', s.bizNo)}${F('관광사업자 등록번호', 'travelRegNo', s.travelRegNo)}</div>
      <div class="grid3">${F('통신판매업 신고번호', 'mailOrderNo', s.mailOrderNo)}${F('대표 전화', 'tel', s.tel)}${F('휴대폰', 'tel2', s.tel2)}</div>
      <div class="grid3">${F('이메일', 'email', s.email)}${F('상담 시간', 'hours', s.hours)}${F('카카오톡 채널 주소', 'kakaoUrl', s.kakaoUrl)}</div>
      ${F('주소', 'address', s.address)}
      <div class="grid3">${F('입금 은행', 'bank.name', s.bank.name)}${F('계좌번호', 'bank.account', s.bank.account)}${F('예금주', 'bank.holder', s.bank.holder)}</div>
      <div class="grid2">${F('인스타그램', 'sns.instagram', s.sns.instagram)}${F('유튜브', 'sns.youtube', s.sns.youtube)}${F('밴드', 'sns.band', s.sns.band)}${F('틱톡', 'sns.tiktok', s.sns.tiktok)}</div>
    </div>
    <div class="card"><h2>약관</h2>
      <div class="field"><label>이용약관</label><textarea data-k="terms.service" style="min-height:220px">${esc(s.terms.service || SERVICE_TERMS)}</textarea></div>
      <div class="field"><label>개인정보처리방침</label><textarea data-k="terms.privacy" style="min-height:220px">${esc(s.terms.privacy || PRIVACY_POLICY)}</textarea><span class="hint">주민등록번호는 법으로 수집이 금지되어 있으니 수집 항목에 넣지 마세요.</span></div>
      <div class="field"><label>예약·취소 규정</label><textarea data-k="terms.cancel" style="min-height:220px">${esc(s.terms.cancel || CANCEL_POLICY)}</textarea><span class="hint">출발 14일 전까지만 환급하는 기본 규정입니다.</span></div>
      <div class="field"><label>여행 표준약관</label><textarea data-k="terms.travel" style="min-height:220px">${esc(s.terms.travel || TRAVEL_TERMS)}</textarea></div>
      <p class="hint">미리 정리해 둔 문구가 들어가 있습니다. 고칠 곳만 고치고 저장하세요.</p>
    </div>
    <div class="card"><h2>프로그램 다운로드 <small>홈페이지 메뉴 "프로그램 다운로드"에 나옵니다</small></h2>
      <div id="dls"></div><button type="button" class="btn sm" id="addDl" style="margin-top:8px">+ 프로그램 추가</button>
      <p class="hint">설치 파일은 크기가 커서 GitHub 등에 올린 뒤 그 내려받기 주소(https://…)를 넣습니다. 새 버전은 주소만 바꾸면 됩니다.</p></div>
    <div class="card"><h2>구글 스프레드시트에 같이 저장 <small>회원가입 · 예약 · 견적 문의가 들어올 때마다 시트에 한 줄씩 쌓입니다</small></h2>
      <ol class="steps">
        <li>회사 구글 계정으로 새 스프레드시트를 만들고 <b>확장 프로그램 → Apps Script</b>를 엽니다.</li>
        <li>있던 글을 모두 지우고 아래 <b>코드 복사</b>로 복사한 내용을 붙여 넣은 뒤 저장(💾)합니다.</li>
        <li><b>배포 → 새 배포 → 유형: 웹 앱</b>, 실행: <b>나</b>, 액세스: <b>모든 사용자</b> → 배포 → 권한 승인(고급 → 이동 → 허용).</li>
        <li>나온 <b>웹 앱 URL</b>을 아래에 붙여 넣고 맨 아래 <b>저장</b>을 누릅니다. 그다음 "지금까지 내역 보내기"로 확인해 보세요.</li>
      </ol>
      <div class="filters"><input class="grow" id="shUrl" value="${esc((s.sheet && s.sheet.url) || '')}" placeholder="https://script.google.com/macros/s/…/exec" aria-label="웹 앱 URL"><button type="button" class="btn sm" id="shCode">코드 복사</button></div>
      <div class="filters">${[['signups', '회원가입'], ['bookings', '예약'], ['inquiries', '견적 문의']].map(([k, n]) => `<label class="check" style="margin:0"><input type="checkbox" data-sh="${k}" ${s.sheet && s.sheet[k] === false ? '' : 'checked'}> ${n}</label>`).join('')}</div>
      <div class="filters">${[['signups', '회원'], ['bookings', '예약'], ['inquiries', '견적 문의']].map(([k, n]) => `<button type="button" class="btn sm ghost" data-shsend="${k}">지금까지 ${n} 내역 보내기</button>`).join('')}</div>
      <p class="hint">비밀번호와 여권번호는 보내지 않습니다. 시트는 회사 직원만 볼 수 있게 공유 범위를 "제한됨"으로 두세요.</p></div>
    ${ro ? '' : '<div class="save-bar"><button class="btn primary" id="sSave">저장하고 홈페이지에 반영</button></div>'}
  </form>`;
  // 구글 시트
  s.sheet = { url: '', key: '', signups: true, bookings: true, inquiries: true, ...(s.sheet || {}) };
  if (!s.sheet.key) s.sheet.key = Array.from(crypto.getRandomValues(new Uint8Array(18)), x => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 56]).join('');
  $('#shUrl', view).oninput = e => { s.sheet.url = e.target.value.trim(); };
  $$('[data-sh]', view).forEach(c => c.onchange = () => { s.sheet[c.dataset.sh] = c.checked; });
  $('#shCode', view).onclick = () => { copy(sheetScript(s.sheet.key)); toast('코드를 복사했습니다. Apps Script에 붙여 넣으세요.'); };
  $$('[data-shsend]', view).forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { const r = await api.post('/api/erp/sheet/send', { kind: b.dataset.shsend }); toast(`${r.count}건을 구글 시트로 보냈습니다.`); }
    catch (err) { toast(err.message); }
    b.disabled = false;
  });
  // 로고
  const logoImgs = s.logo ? [{ md: s.logo.startsWith('data:') || s.logo.startsWith('/') ? s.logo : '../' + s.logo }] : [];
  imageUploader($('#logoUp', view), logoImgs, 'logo', imgs => { s.logo = imgs[0] ? (imgs[0].md || '') : 'assets/logo.jpg'; }, 1);
  // 배너
  const renderBanners = () => {
    const box = $('#banners', view);
    box.innerHTML = s.heroBanners.map((b, k) => `<div class="banner-ed"><label class="thumb">${b.img ? `<img src="${esc(typeof b.img === 'string' ? b.img : (b.img.md || b.img.sm))}" alt="">` : '사진 올리기<br>(없으면 단색 배경)'}<input type="file" accept="image/*" hidden data-bimg="${k}"></label>
      <div><div class="field"><label>큰 글씨</label><input data-b="${k}" data-f="title" value="${esc(b.title)}"></div><div class="grid2"><div class="field"><label>작은 글씨</label><input data-b="${k}" data-f="sub" value="${esc(b.sub || '')}"></div><div class="field"><label>버튼 연결</label><select data-b="${k}" data-f="link"><option value="">버튼 없음</option>${CATEGORIES.map(c => `<option value="#/c/${c.id}" ${b.link === '#/c/' + c.id ? 'selected' : ''}>${c.name}</option>`).join('')}<option value="#/notice" ${b.link === '#/notice' ? 'selected' : ''}>공지사항</option></select></div></div></div>
      <button type="button" class="btn sm ghost" data-brm="${k}" style="color:var(--danger)">삭제</button></div>`).join('') || '<div class="muted">배너가 없습니다.</div>';
    $$('[data-b]', box).forEach(inp => inp.oninput = inp.onchange = () => { s.heroBanners[+inp.dataset.b][inp.dataset.f] = inp.value; });
    $$('[data-brm]', box).forEach(b => b.onclick = () => { s.heroBanners.splice(+b.dataset.brm, 1); renderBanners(); });
    $$('[data-bimg]', box).forEach(inp => inp.onchange = async () => {
      const k = +inp.dataset.bimg;
      try {
        const sized = await resizeForSlot(inp.files[0], 'banner');
        if (demo) delete sized.lg;
        const { urls } = await api.post('/api/erp/upload', { files: sized });
        s.heroBanners[k].img = urls; renderBanners();
        toast('배너 비율(16:7)로 자동으로 맞췄습니다.');
      } catch (err) { toast(err.message); }
    });
  };
  renderBanners();
  s.downloads = s.downloads || [];
  const renderDls = () => {
    const box = $('#dls', view);
    box.innerHTML = s.downloads.map((d, k) => `<div style="border-top:1px solid var(--line);padding:10px 0">
      <div class="grid2"><div class="field"><label>이름</label><input data-dl="${k}" data-f="name" value="${esc(d.name || '')}"></div>
      <div class="field"><label>종류</label><select data-dl="${k}" data-f="kind"><option value="">기타</option><option value="pc" ${d.kind === 'pc' ? 'selected' : ''}>PC (윈도우)</option><option value="android" ${d.kind === 'android' ? 'selected' : ''}>안드로이드</option></select></div></div>
      <div class="field"><label>설명</label><input data-dl="${k}" data-f="desc" value="${esc(d.desc || '')}"></div>
      <div class="filters"><input class="grow" data-dl="${k}" data-f="url" value="${esc(d.url || '')}" placeholder="https://…" aria-label="내려받기 주소"><button type="button" class="btn sm ghost" data-dlrm="${k}" style="color:var(--danger)">삭제</button></div></div>`).join('') || '<div class="muted">없습니다. 비워 두면 홈페이지 메뉴에서 숨겨집니다.</div>';
    $$('[data-dl]', box).forEach(inp => inp.oninput = inp.onchange = () => { s.downloads[+inp.dataset.dl][inp.dataset.f] = inp.value.trim(); });
    $$('[data-dlrm]', box).forEach(b => b.onclick = () => { s.downloads.splice(+b.dataset.dlrm, 1); renderDls(); });
  };
  renderDls();
  $('#addDl', view).onclick = () => { s.downloads.push({ name: '', desc: '', url: '', kind: '' }); renderDls(); };
  $('#addBanner', view).onclick = () => { s.heroBanners.push({ img: '', title: '새 배너 문구', sub: '', link: '' }); renderBanners(); };
  $$('[data-c]', view).forEach(inp => inp.oninput = () => { s.colors[inp.dataset.c] = inp.value; inp.nextElementSibling.textContent = inp.value; });
  $$('[data-menu]', view).forEach(inp => inp.oninput = () => { s.menus[+inp.dataset.menu].name = inp.value; });
  $$('[data-menuv]', view).forEach(inp => inp.onchange = () => { s.menus[+inp.dataset.menuv].visible = inp.checked; });
  $$('[data-k]', view).forEach(inp => inp.oninput = () => {
    const [a, b] = inp.dataset.k.split('.');
    if (b) s[a] = { ...(s[a] || {}), [b]: inp.value }; else s[a] = inp.value;
  });
  if ($('#sSave', view)) $('#sSave', view).onclick = async e => {
    e.preventDefault();
    try { settingsCache = await api.put('/api/erp/settings', s); toast('저장했습니다. 홈페이지에 바로 반영됩니다.'); }
    catch (err) { toast(err.message); }
  };
}

// ---------- 도메인 연결 ----------
async function dnsLookup(name, type) {
  const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { cache: 'no-store' });
  const j = await r.json();
  return (j.Answer || []).map(a => String(a.data).replace(/\.$/, '').toLowerCase());
}

function recordsFor(dom, target) {
  const host = dom.host.toLowerCase();
  const parts = host.split('.');
  const isKr = /\.(co|or|ne|go|re|pe)\.kr$/.test(host);
  const apexLen = isKr ? 3 : 2;
  const apex = parts.length <= apexLen;
  const sub = apex ? '@' : parts.slice(0, parts.length - apexLen).join('.');
  const out = [];
  if (apex) {
    out.push({ type: 'A', name: '@', value: target.a || '(서버 IP)', check: { name: host, type: 'A', want: target.a } });
    out.push({ type: 'CNAME', name: 'www', value: target.cname || host, check: { name: 'www.' + host, type: 'CNAME', want: (target.cname || host).toLowerCase() } });
  } else if (target.cname) {
    out.push({ type: 'CNAME', name: sub, value: target.cname, check: { name: host, type: 'CNAME', want: target.cname.toLowerCase() } });
  } else {
    out.push({ type: 'A', name: sub, value: target.a || '(서버 IP)', check: { name: host, type: 'A', want: target.a } });
  }
  return out;
}

async function domain(view) {
  const s = structuredClone(await getSettings(true));
  s.domains = s.domains || [];
  s.dnsTarget = s.dnsTarget || { a: '', cname: '' };
  const ro = me.role !== 'admin';
  const save = async () => { settingsCache = await api.put('/api/erp/settings', s); };
  const render = () => {
    view.innerHTML = `
      <div class="card"><h2>연결 순서</h2>
        <ol class="steps">
          <li>아래에 쓰실 주소를 추가합니다. 예: 홈페이지 <b>tigc.co.kr</b>, ERP <b>erp.tigc.co.kr</b></li>
          <li>도메인을 산 곳(가비아 등)의 <b>DNS 관리</b> 화면에 표에 나온 값을 그대로 넣습니다.</li>
          <li><b>연결 확인</b>을 누르면 자동으로 확인합니다. 보통 10분~1시간이면 연결되고, 보안 연결(https)은 서버가 자동으로 붙입니다.</li>
        </ol>
        <p class="muted" style="font-size:13px;margin:8px 0 0">새 도메인이 필요하면 가비아(gabia.com) 등에서 사신 뒤 같은 방법으로 연결하면 됩니다. .co.kr 같은 한국 도메인은 국내 업체에서만 살 수 있습니다.</p>
      </div>
      <div class="card"><h2>서버 주소 <small>서버를 정하면 한 번만 넣으면 됩니다</small></h2>
        <div class="grid2"><div class="field"><label>서버 IP (A 레코드 값)</label><input id="tA" value="${esc(s.dnsTarget.a)}" placeholder="예: 203.0.113.10" ${ro ? 'disabled' : ''}></div>
        <div class="field"><label>서버 별칭 (CNAME 값, 있을 때만)</label><input id="tC" value="${esc(s.dnsTarget.cname)}" placeholder="예: taeil.호스팅주소.com" ${ro ? 'disabled' : ''}></div></div>
        ${ro ? '' : '<button class="btn sm" id="tSave">저장</button>'}
      </div>
      <div class="card"><h2>연결할 주소</h2>
        ${ro ? '' : `<form class="filters" id="addD"><input class="grow" id="dHost" placeholder="예: tigc.co.kr 또는 erp.tigc.co.kr" autocomplete="off">
          <select id="dPur"><option value="site">홈페이지</option><option value="erp">ERP</option></select><button class="btn primary sm">주소 추가</button></form>`}
        ${s.domains.map((dm, k) => `<div style="border-top:1px solid var(--line);padding:14px 0">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:16px">${esc(dm.host)}</b><span class="badge">${dm.purpose === 'erp' ? 'ERP' : '홈페이지'}</span>
            ${dm.status === 'ok' ? '<span class="badge g">연결됨</span>' : dm.status === 'pending' ? '<span class="badge o">아직 연결 전</span>' : '<span class="badge">확인 전</span>'}
            ${dm.checkedAt ? `<span class="muted" style="font-size:13px">${fmtDT(dm.checkedAt)} 확인</span>` : ''}
            <span style="margin-left:auto;display:flex;gap:6px"><button class="btn sm" data-chk="${k}">연결 확인</button>${ro ? '' : `<button class="btn sm ghost" data-drm="${k}" style="color:var(--danger)">삭제</button>`}</span></div>
          ${dm.status === 'ok' ? '' : `<table class="tbl dns" style="margin-top:10px"><thead><tr><th>타입</th><th>이름(호스트)</th><th>값</th><th></th></tr></thead><tbody>
            ${recordsFor(dm, s.dnsTarget).map(r => `<tr><td>${r.type}</td><td>${esc(r.name)}</td><td>${esc(r.value)}</td><td><button class="btn sm ghost" data-copy="${esc(r.value)}">복사</button></td></tr>`).join('')}
          </tbody></table>`}
          ${dm.detail ? `<div class="muted" style="font-size:13px;margin-top:6px">${esc(dm.detail)}</div>` : ''}
        </div>`).join('') || '<div class="muted">아직 추가한 주소가 없습니다.</div>'}
      </div>`;
    if ($('#tSave', view)) $('#tSave', view).onclick = async () => { s.dnsTarget = { a: $('#tA', view).value.trim(), cname: $('#tC', view).value.trim().replace(/\.$/, '') }; await save(); toast('저장했습니다.'); render(); };
    if ($('#dHost', view)) $('#dHost', view).oninput = e => { if (/^(erp|admin)\./.test(e.target.value.trim())) $('#dPur', view).value = 'erp'; };
    if ($('#addD', view)) $('#addD', view).onsubmit = async e => {
      e.preventDefault();
      const host = $('#dHost', view).value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) return toast('주소 형식을 확인해 주세요. 예: erp.tigc.co.kr');
      if (s.domains.some(x => x.host === host)) return toast('이미 추가한 주소입니다.');
      s.domains.push({ host, purpose: $('#dPur', view).value, status: '' });
      await save(); render();
    };
    $$('[data-drm]', view).forEach(b => b.onclick = async () => { if (!await ask('이 주소 연결을 삭제할까요?')) return; s.domains.splice(+b.dataset.drm, 1); await save(); render(); });
    $$('[data-copy]', view).forEach(b => b.onclick = () => copy(b.dataset.copy));
    $$('[data-chk]', view).forEach(b => b.onclick = async () => {
      const dm = s.domains[+b.dataset.chk];
      b.disabled = true; b.textContent = '확인 중…';
      try {
        // 홈페이지·ERP는 Cloudflare에서 바로 답하므로, 그 주소에서 우리 서버가 답하는지 먼저 봅니다
        const live = await fetch(`https://${dm.host}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).then(r => r.json()).then(j => j && j.ok === true).catch(() => false);
        if (live) {
          Object.assign(dm, { status: 'ok', checkedAt: Date.now(), detail: 'Cloudflare에서 바로 연결되어 있습니다. 따로 넣을 값은 없습니다.' });
          if (!ro) await save();
          render();
          return toast(`${dm.host} 연결이 확인되었습니다.`);
        }
        const recs = recordsFor(dm, s.dnsTarget);
        const results = [];
        for (const r of recs) {
          const got = await dnsLookup(r.check.name, r.check.type);
          results.push({ r, got, ok: r.check.want ? got.includes(r.check.want) : got.length > 0 });
        }
        const ok = results.every(x => x.ok);
        dm.status = ok ? 'ok' : 'pending';
        dm.checkedAt = Date.now();
        dm.detail = ok ? '모든 값이 맞게 들어가 있습니다.' : results.filter(x => !x.ok).map(x => `${x.r.type} ${x.r.name}: 지금 값 ${x.got.join(', ') || '없음'}`).join(' · ') + (s.dnsTarget.a || s.dnsTarget.cname ? ' (넣은 지 얼마 안 됐다면 조금 뒤 다시 확인해 주세요)' : ' · 먼저 위의 서버 주소를 넣어 주세요.');
        if (!ro) await save();
        render();
        toast(ok ? `${dm.host} 연결이 확인되었습니다.` : '아직 연결되지 않았습니다. 아래 안내를 확인해 주세요.');
      } catch {
        b.disabled = false; b.textContent = '연결 확인';
        toast('지금은 확인할 수 없습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.');
      }
    });
  };
  render();
}

const pageEnv = { toast, imageUploader, getSettings, drawer, closeDrawer, setBarAct: html => { $('#barAct').innerHTML = html; },
  async editProduct(id, after) { const p = (await api.get('/api/erp/products')).find(x => x.id === id); if (!p) return toast('상품을 찾을 수 없습니다.'); productEditor(p, after); } };

// ---------- 시작 ----------
async function start() {
  demo = await isDemo();
  if (getToken()) {
    const r = await api.get('/api/me').catch(() => ({}));
    me = r.user && ['admin', 'staff'].includes(r.user.role) ? r.user : null;
  }
  me ? shell() : loginView();
}
start();
