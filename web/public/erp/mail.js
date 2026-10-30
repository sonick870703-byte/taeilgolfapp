// ERP "메일함": @tigc.co.kr 로 온 메일을 받아 보고, 답장·새 메일을 보냅니다.
// 받기 = Cloudflare 메일 라우팅 → Worker(email) → 메일함, 보내기 = Resend(무료) API
import { api } from '../shared/api.js';
import { ask } from '../shared/ask.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDT = ms => (ms ? new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const who = f => (f ? (f.name ? `${f.name} <${f.address}>` : f.address) : '');
const FOLDERS = [['inbox', '받은 메일'], ['sent', '보낸 메일'], ['trash', '휴지통']];
let folder = 'inbox', q = '';

export async function mailView(view, arg, env) {
  env.setBarAct(`${env.me.role === 'admin' ? '<button class="btn sm" id="mCfg">설정</button>' : ''}<button class="btn primary sm" id="mNew">+ 메일 쓰기</button>`);
  $('#mNew').onclick = () => compose(env, {}, () => mailView(view, null, env));
  if ($('#mCfg')) $('#mCfg').onclick = () => settings(env);
  const list = await api.get(`/api/erp/mails?folder=${folder}&q=${encodeURIComponent(q)}`);
  view.innerHTML = `<div class="filters">${FOLDERS.map(([k, n]) => `<button type="button" class="btn sm ${k === folder ? 'primary' : 'ghost'}" data-f="${k}">${n}</button>`).join('')}
      <input class="grow" id="mQ" placeholder="보낸 사람, 제목, 내용 찾기" value="${esc(q)}"></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${folder === 'sent' ? '받는 사람' : '보낸 사람'}</th><th>제목</th><th class="hide-m">받은 시각</th></tr></thead><tbody>
    ${list.map(m => `<tr class="click" data-id="${esc(m.id)}" style="${m.read ? '' : 'font-weight:700'}">
      <td>${esc(folder === 'sent' ? (m.to || []).join(', ') : (m.from && (m.from.name || m.from.address)))}</td>
      <td>${m.read ? '' : '<span class="badge o">새 메일</span> '}${esc(m.subject)}${m.atts ? ' 📎' : ''}${m.replied ? ' <span class="badge g">답장함</span>' : ''}<div class="muted" style="font-size:12px;font-weight:400">${esc(m.snippet)}</div></td>
      <td class="hide-m">${fmtDT(m.at)}</td></tr>`).join('') || `<tr><td colspan="3" class="muted">${folder === 'inbox' ? '받은 메일이 없습니다. 메일 받기 연결이 끝나면 taeilgolf@tigc.co.kr 로 온 메일이 여기에 쌓입니다.' : '메일이 없습니다.'}</td></tr>`}
    </tbody></table></div>`;
  $$('[data-f]', view).forEach(b => b.onclick = () => { folder = b.dataset.f; mailView(view, null, env); });
  let t;
  $('#mQ', view).oninput = e => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); mailView(view, null, env).then(() => { const i = $('#mQ', view); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 400); };
  $$('tr[data-id]', view).forEach(tr => tr.onclick = () => open(env, tr.dataset.id, () => mailView(view, null, env)));
}

async function open(env, id, after) {
  const m = await api.get('/api/erp/mails/' + id);
  // 받은 메일의 HTML은 스크립트를 막은 상자 안에서만 보여 줍니다
  const csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:\"><base target=\"_blank\">";
  const d = env.drawer(m.subject, `
    <div class="muted" style="font-size:14px;line-height:1.7">보낸 사람 <b>${esc(who(m.from))}</b><br>받는 사람 ${esc((m.to || []).join(', '))}<br>${fmtDT(m.at)}${m.by ? ` · 보낸 직원 ${esc(m.by)}` : ''}</div>
    ${(m.atts || []).length ? `<div class="filters" style="margin-top:10px">${m.atts.map((a, n) => `<button type="button" class="btn sm ghost" data-att="${n}">📎 ${esc(a.name)} <span class="muted">(${Math.ceil(a.size / 1024)}KB)</span></button>`).join('')}</div>` : ''}
    <div style="margin-top:12px">${m.html ? `<iframe id="mBody" sandbox="allow-popups allow-popups-to-escape-sandbox" style="width:100%;min-height:420px;border:1px solid var(--line);border-radius:10px;background:#fff"></iframe>` : `<pre style="white-space:pre-wrap;font:inherit;margin:0">${esc(m.text)}</pre>`}</div>`,
    `${m.folder === 'inbox' ? '<button class="btn" id="mDel" style="color:var(--danger);margin-right:auto">휴지통</button>' : m.folder === 'trash' ? '<button class="btn" id="mBack" style="margin-right:auto">받은 메일로</button>' : ''}${m.folder !== 'sent' ? '<button class="btn primary" id="mRe">답장</button>' : ''}`);
  if (m.html) $('#mBody', d).srcdoc = csp + m.html;
  $$('[data-att]', d).forEach(b => b.onclick = async () => {
    try {
      const a = await api.get(`/api/erp/mails/${m.id}/att/${b.dataset.att}`);
      const bin = Uint8Array.from(atob(a.data), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bin], { type: a.type }));
      const link = Object.assign(document.createElement('a'), { href: url, download: a.name });
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) { env.toast(err.message); }
  });
  if ($('#mDel', d)) $('#mDel', d).onclick = async () => { await api.patch('/api/erp/mails/' + m.id, { folder: 'trash' }); env.closeDrawer(); after(); };
  if ($('#mBack', d)) $('#mBack', d).onclick = async () => { await api.patch('/api/erp/mails/' + m.id, { folder: 'inbox' }); env.closeDrawer(); after(); };
  if ($('#mRe', d)) $('#mRe', d).onclick = () => compose(env, {
    to: m.from && m.from.address, replyTo: m.id, subject: /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject,
    text: `\n\n\n--- ${fmtDT(m.at)}, ${who(m.from)} 님이 보낸 메일 ---\n` + (m.text || '').split('\n').map(l => '> ' + l).join('\n'),
  }, after);
}

function compose(env, pre, after) {
  const d = env.drawer(pre.replyTo ? '답장 쓰기' : '메일 쓰기', `<form id="mf">
    <div class="field"><label>받는 사람</label><input name="to" value="${esc(pre.to || '')}" placeholder="example@naver.com (여러 명은 쉼표로)"></div>
    <div class="field"><label>제목</label><input name="subject" value="${esc(pre.subject || '')}"></div>
    <div class="field"><label>내용</label><textarea name="text" style="min-height:300px">${esc(pre.text || '')}</textarea></div>
    <p class="hint">회사 주소(taeilgolf@tigc.co.kr)로 보내집니다. 고객 여권번호 같은 민감한 정보는 메일로 보내지 마세요.</p></form>`,
    '<button class="btn" id="mX">취소</button><button class="btn primary" id="mSend">보내기</button>');
  $('#mX', d).onclick = env.closeDrawer;
  $('#mSend', d).onclick = async () => {
    const f = Object.fromEntries(new FormData($('#mf', d)));
    if (!await ask(`${f.to} 에게 메일을 보낼까요?`, '보내기')) return;
    $('#mSend', d).disabled = true;
    try { await api.post('/api/erp/mails/send', { ...f, replyTo: pre.replyTo }); env.toast('보냈습니다.'); env.closeDrawer(); after(); }
    catch (err) { env.toast(err.message); $('#mSend', d).disabled = false; }
  };
}

async function settings(env) {
  const c = await api.get('/api/erp/mail-config');
  const d = env.drawer('메일 설정', `
    <h3 style="margin-top:0">1. 메일 받기</h3>
    <p class="muted" style="font-size:14px">Cloudflare에서 한 번만 켜면 @tigc.co.kr 로 오는 메일이 이 메일함에 쌓입니다. (Cloudflare › tigc.co.kr › 이메일 › 이메일 라우팅 › 전체 받기 → Worker: taeil-erp)</p>
    <h3>2. 메일 보내기 (답장)</h3>
    <p class="muted" style="font-size:14px">무료 메일 발송 서비스 Resend(resend.com)에 가입해 tigc.co.kr 을 등록하고, 만든 API 키를 아래에 넣습니다. 키는 관리자만 바꿀 수 있고 다시 보이지 않습니다.</p>
    <div class="field"><label>보내는 주소</label><input id="cFrom" value="${esc(c.from || 'taeilgolf@tigc.co.kr')}"></div>
    <div class="field"><label>보내는 이름</label><input id="cName" value="${esc(c.fromName || '태일골프')}"></div>
    <div class="field"><label>Resend API 키 ${c.hasKey ? '<span class="badge g">저장됨</span>' : ''}</label><input id="cKey" type="password" autocomplete="off" placeholder="${c.hasKey ? '바꿀 때만 입력' : 're_로 시작하는 키'}"></div>`,
    '<button class="btn primary" id="cSave">저장</button>');
  $('#cSave', d).onclick = async () => {
    try { await api.put('/api/erp/mail-config', { from: $('#cFrom', d).value.trim(), fromName: $('#cName', d).value.trim(), resendKey: $('#cKey', d).value.trim() }); env.toast('저장했습니다.'); env.closeDrawer(); }
    catch (err) { env.toast(err.message); }
  };
}
