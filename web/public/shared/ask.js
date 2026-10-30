// 화면 안에서 띄우는 확인 창 (브라우저 기본 confirm 대신)
export function ask(message, okLabel = '확인') {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'ask-bg';
    bg.innerHTML = `<div class="askbox" role="alertdialog" aria-modal="true" aria-labelledby="askMsg">
      <p id="askMsg"></p><div class="ask-act"><button class="btn" data-v="0">취소</button><button class="btn primary" data-v="1"></button></div></div>`;
    bg.querySelector('#askMsg').textContent = message;
    bg.querySelector('[data-v="1"]').textContent = okLabel;
    const done = v => { bg.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    bg.addEventListener('click', e => { if (e.target === bg) done(false); const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); });
    document.addEventListener('keydown', key, true);
    document.body.append(bg);
    bg.querySelector('[data-v="1"]').focus();
  });
}
