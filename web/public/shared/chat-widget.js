// 홈페이지 오른쪽 아래 "1:1 문의" 채팅 창과 오늘 방문자 세기.
import { api } from './api.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mem = {};
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch { delete mem[k]; } },
};
const rid = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(x => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join(''); };

// 브라우저마다 만든 익명 표시로 하루에 한 사람으로 셉니다 (이름·IP는 보내지 않음)
export function countVisit() {
  let v = ls.get('taeil.v');
  if (!v) { v = rid(16); ls.set('taeil.v', v); }
  api.post('/api/visit', { v }).catch(() => {});
}

export function mountChat(me) {
  const KEY = 'taeil.chat';
  let saved = null;
  try { saved = JSON.parse(ls.get(KEY) || 'null'); } catch { saved = null; }
  let timer = null;

  const fab = document.createElement('button');
  fab.className = 'chat-fab'; fab.type = 'button';
  fab.innerHTML = '<span aria-hidden="true">💬</span><b>1:1 문의</b>';
  const box = document.createElement('div');
  box.className = 'chat-box'; box.hidden = true;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '1:1 실시간 문의');
  document.body.append(fab, box);

  const msgsHtml = chat => chat.messages.map(m => `<div class="cm ${m.from}"><div>${esc(m.text)}</div></div>`).join('');
  const render = chat => {
    box.innerHTML = `<div class="cb-head"><b>태일골프 1:1 문의</b><button type="button" class="cb-x" aria-label="닫기">×</button></div>
      <div class="cb-msgs" id="cbM"><div class="cm staff"><div>안녕하세요, 태일골프입니다. 궁금한 점을 남겨 주시면 바로 답해 드립니다. (상담 시간 외에는 다음 영업일에 답장드립니다)</div></div>${chat ? msgsHtml(chat) : ''}</div>
      <form class="cb-in" id="cbF">
        ${chat ? '' : `<div class="cb-who"><input id="cbN" placeholder="이름" value="${esc(me?.name || '')}" autocomplete="name"><input id="cbP" placeholder="연락처" value="${esc(me?.phone || '')}" inputmode="tel" autocomplete="tel"></div>
        <label class="cb-agree"><input type="checkbox" id="cbA"> (필수) 상담을 위해 이름·연락처·대화 내용을 수집하고, 상담이 끝나고 1년 뒤 파기하는 데 동의합니다.</label>`}
        <div class="cb-row"><textarea id="cbT" rows="2" placeholder="문의 내용을 입력하세요"></textarea><button class="btn primary sm">보내기</button></div>
      </form>`;
    const m = box.querySelector('#cbM'); m.scrollTop = m.scrollHeight;
    box.querySelector('.cb-x').onclick = close;
    const t = box.querySelector('#cbT');
    t.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); box.querySelector('#cbF').requestSubmit(); } };
    box.querySelector('#cbF').onsubmit = async e => {
      e.preventDefault();
      const text = t.value.trim(); if (!text) return;
      const body = { text };
      if (saved) Object.assign(body, { id: saved.id, key: saved.key });
      else {
        if (!box.querySelector('#cbA').checked) { box.querySelector('.cb-agree').classList.add('need'); return; }
        Object.assign(body, { name: box.querySelector('#cbN').value, phone: box.querySelector('#cbP').value, agreePrivacy: true });
      }
      t.value = '';
      try {
        const r = await api.post('/api/chat', body);
        saved = { id: r.id, key: r.key }; ls.set(KEY, JSON.stringify(saved));
        render(r.chat); box.querySelector('#cbT').focus();
      } catch (err) { t.value = text; alertIn(err.message); }
    };
  };
  const alertIn = msg => { const m = box.querySelector('#cbM'); m.insertAdjacentHTML('beforeend', `<div class="cm sys"><div>${esc(msg)}</div></div>`); m.scrollTop = m.scrollHeight; };
  const load = async () => {
    if (!saved) return null;
    try { return await api.get(`/api/chat/${saved.id}?key=${encodeURIComponent(saved.key)}`); }
    catch { saved = null; ls.del(KEY); return null; }
  };
  let shown = 0;
  const open = async () => {
    box.hidden = false; fab.hidden = true;
    const chat = await load(); shown = chat ? chat.messages.length : 0; render(chat);
    box.querySelector('#cbT').focus();
    clearInterval(timer);
    // 창이 열려 있는 동안 5초마다 답장 확인
    timer = setInterval(async () => {
      const c = await load();
      if (c && c.messages.length !== shown) {
        shown = c.messages.length;
        const keep = box.querySelector('#cbT')?.value || '';
        render(c); box.querySelector('#cbT').value = keep;
      }
    }, 5000);
  };
  function close() { box.hidden = true; fab.hidden = false; clearInterval(timer); }
  fab.onclick = open;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) close(); });
}
