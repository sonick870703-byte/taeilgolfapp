// 예약 상세의 "여행자 · 여권" 칸.
// 여권 사진은 이 브라우저 안에서만 읽고(서버로 보내지 않음), 읽은 글자만 저장합니다.
// 여권번호는 서버에서 암호화되어 저장되고 화면에는 가린 번호만 보입니다.
import { api } from '../shared/api.js';
import { ask } from '../shared/ask.js';
import { addMonths } from '../shared/core.js';
import { parseMRZ } from '../shared/mrz.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VENDOR = new URL('../vendor/tesseract/', import.meta.url).href;

// 여권 만료 확인: 대부분의 나라가 입국일 기준 6개월 이상 남아 있어야 합니다.
function expiryWarn(x, departDate) {
  if (!x.passportExp || !departDate) return '';
  if (x.passportExp < departDate) return '<span class="badge r">여권 만료됨</span>';
  if (x.passportExp < addMonths(departDate, 6)) return '<span class="badge r">만료 6개월 미만</span>';
  return '';
}

export function travelersHtml(b, closed) {
  const list = b.travelers || [];
  const rows = list.map(x => `
    <div class="tv-row" data-tid="${esc(x.id)}">
      <div class="grow">
        <b>${esc(x.surname)} ${esc(x.given)}</b>${x.korName ? ` <span class="muted">${esc(x.korName)}</span>` : ''} ${expiryWarn(x, b.departDate)}
        <div class="muted tv-sub">${[x.sex === 'M' ? '남' : x.sex === 'F' ? '여' : '', x.birth && '생년월일 ' + x.birth, x.nationality,
          x.passportMasked ? '여권 <span class="tv-no">' + esc(x.passportMasked) + '</span>' : (x.purgedAt ? '여권번호 파기됨' : '여권번호 없음'),
          x.passportExp && '만료 ' + x.passportExp].filter(Boolean).join(' · ')}</div>
      </div>
      ${x.passportMasked ? '<button class="btn sm ghost" data-tv="reveal">번호 보기</button>' : ''}
      ${closed ? '' : '<button class="btn sm ghost" data-tv="edit">수정</button><button class="btn sm ghost" data-tv="del" aria-label="여행자 삭제">삭제</button>'}
    </div>`).join('');
  return `
    <div class="sec-title">여행자 · 여권 <span class="muted" style="font-weight:400;font-size:13px">${list.length}명 등록 / 예약 인원 ${b.pax}명</span></div>
    <div>${rows || '<div class="muted" style="font-size:14px">아직 등록된 여행자가 없습니다. 고객이 보낸 여권 사진으로 바로 채울 수 있습니다.</div>'}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
      ${closed ? '' : '<button class="btn primary sm" type="button" id="tvAdd">여행자 추가</button>'}
      ${list.length ? '<button class="btn sm" type="button" id="tvCopy">영문 명단 복사</button>' : ''}
    </div>
    <div id="tvPane"></div>`;
}

function formHtml(x) {
  const v = k => esc((x && x[k]) || '');
  return `<form class="tv-form" id="tvF">
    <div class="tv-scan">
      <label class="btn sm"><input type="file" accept="image/*" id="tvImg" hidden>여권 사진으로 채우기</label>
      <span class="muted" id="tvScanMsg">여권 사진면(아래 두 줄이 보이게)을 고르면 자동으로 채워집니다. 사진은 저장하지 않습니다.</span>
    </div>
    <div class="grid3">
      <div class="field"><label>영문 성 (Surname)</label><input name="surname" value="${v('surname')}" autocapitalize="characters" required></div>
      <div class="field"><label>영문 이름 (Given names)</label><input name="given" value="${v('given')}" autocapitalize="characters" required></div>
      <div class="field"><label>한글 이름 <span class="muted">(선택)</span></label><input name="korName" value="${v('korName')}"></div>
    </div>
    <div class="grid3">
      <div class="field"><label>여권번호${x && x.passportMasked ? ` <span class="muted">(지금 ${esc(x.passportMasked)}, 바꿀 때만 입력)</span>` : ''}</label><input name="passportNo" autocomplete="off" autocapitalize="characters"></div>
      <div class="field"><label>여권 만료일</label><input name="passportExp" type="date" value="${v('passportExp')}"></div>
      <div class="field"><label>생년월일</label><input name="birth" type="date" value="${v('birth')}"></div>
    </div>
    <div class="grid3">
      <div class="field"><label>성별</label><select name="sex"><option value="">-</option><option value="M" ${x && x.sex === 'M' ? 'selected' : ''}>남 (M)</option><option value="F" ${x && x.sex === 'F' ? 'selected' : ''}>여 (F)</option></select></div>
      <div class="field"><label>국적</label><input name="nationality" value="${v('nationality') || 'KOR'}" maxlength="3"></div>
    </div>
    ${x ? '' : '<label class="check"><input type="checkbox" name="consent" required> (필수) 고객에게 여권 정보 수집·이용 동의를 받았습니다. 여행이 끝나고 3개월 안에 자동으로 지워집니다.</label>'}
    <div style="display:flex;gap:6px"><button class="btn primary sm">${x ? '수정 저장' : '여행자 저장'}</button><button class="btn sm ghost" type="button" id="tvCancel">닫기</button></div>
  </form>`;
}

// ---------- 여권 사진 읽기 (Tesseract.js, 이 PC 안에서 실행) ----------
let workerP = null;
function loadScript(src) {
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('글자 인식 도구를 불러오지 못했습니다.')); document.head.append(s); });
}
async function getWorker() {
  if (!workerP) workerP = (async () => {
    if (!window.Tesseract) await loadScript(VENDOR + 'tesseract.min.js');
    const w = await window.Tesseract.createWorker('eng', 1, { workerPath: VENDOR + 'worker.min.js', corePath: VENDOR, langPath: VENDOR, gzip: true });
    await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6' });
    return w;
  })().catch(e => { workerP = null; throw e; });
  return workerP;
}
function loadImage(file) {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('사진을 열 수 없습니다. JPG나 PNG로 보내 주세요.')); };
    img.src = url;
  });
}
// 사진의 아래쪽(from~1)만 잘라 흑백으로 바꿉니다. hard 이면 대비를 세게 줘서 글자를 또렷하게 합니다.
function prepare(img, from, rotate, hard) {
  const scale = Math.min(1, 2000 / img.naturalWidth);
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const full = document.createElement('canvas'); full.width = w; full.height = h;
  const fc = full.getContext('2d');
  if (rotate) { fc.translate(w, h); fc.rotate(Math.PI); }
  fc.drawImage(img, 0, 0, w, h);
  const y = Math.round(h * from), ch = h - y;
  const c = document.createElement('canvas'); c.width = w; c.height = ch;
  const ctx = c.getContext('2d');
  ctx.drawImage(full, 0, y, w, ch, 0, 0, w, ch);
  const d = ctx.getImageData(0, 0, w, ch);
  for (let i = 0; i < d.data.length; i += 4) {
    const g = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
    const v = !hard ? g : g < 110 ? 0 : g > 170 ? 255 : (g - 110) * 255 / 60;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}
export async function readPassport(file, onStep = () => {}) {
  const img = await loadImage(file);
  onStep('글자 인식 준비 중… (처음 한 번은 10초쯤 걸립니다)');
  const w = await getWorker();
  let best = null;
  for (const [from, rotate, hard] of [[0.6, false, true], [0.6, false, false], [0.35, false, true], [0, false, false], [0.6, true, true]]) {
    onStep('여권 아래 두 줄을 읽는 중…');
    const { data } = await w.recognize(prepare(img, from, rotate, hard));
    const r = parseMRZ(data.text);
    if (r && (!best || Object.values(r.checks).filter(Boolean).length > Object.values(best.checks).filter(Boolean).length)) best = r;
    if (best && Object.values(best.checks).every(Boolean)) break;
  }
  return best;
}

// ---------- 화면 연결 ----------
export function bindTravelers(d, b, { toast, copy, reload }) {
  const pane = $('#tvPane', d);
  const base = `/api/erp/bookings/${b.id}/travelers`;
  const find = el => (b.travelers || []).find(x => x.id === el.closest('[data-tid]').dataset.tid);

  const open = x => {
    pane.innerHTML = formHtml(x);
    const f = $('#tvF', pane);
    let fromScan = false;
    f.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('#tvCancel', pane).onclick = () => { pane.innerHTML = ''; };
    $('#tvImg', pane).onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      const msg = $('#tvScanMsg', pane);
      try {
        const r = await readPassport(file, t => { msg.textContent = t; });
        if (!r) { msg.textContent = '여권 아래 두 줄을 찾지 못했습니다. 두 줄이 잘 보이게 다시 찍거나 직접 입력해 주세요.'; return; }
        for (const [k, v] of [['surname', r.surname], ['given', r.given], ['passportNo', r.passportNo], ['passportExp', r.expiry], ['birth', r.birth], ['sex', r.sex], ['nationality', r.nationality]]) if (v) f.elements[k].value = v;
        fromScan = true;
        const bad = [r.checks.passportNo || '여권번호', r.checks.birth || '생년월일', r.checks.expiry || '만료일'].filter(v => v !== true);
        msg.innerHTML = bad.length ? `<b style="color:var(--danger)">${bad.join(', ')}가 확실하지 않습니다.</b> 여권과 꼭 비교해 고쳐 주세요.` : '다 읽었습니다. 여권과 한 번 더 비교한 뒤 저장해 주세요.';
      } catch (err) { msg.textContent = err.message + ' 직접 입력해 주세요.'; }
      e.target.value = '';
    };
    f.onsubmit = async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      body.consent = !!body.consent; body.fromScan = fromScan;
      try {
        if (x) await api.patch(`${base}/${x.id}`, body); else await api.post(base, body);
        toast('저장했습니다. 여권번호는 암호화되어 보관됩니다.'); reload();
      } catch (err) { toast(err.message); }
    };
  };

  const add = $('#tvAdd', d); if (add) add.onclick = () => open(null);
  const cp = $('#tvCopy', d);
  if (cp) cp.onclick = () => copy((b.travelers || []).map((x, i) => `${i + 1}. ${x.surname}/${x.given} ${x.sex === 'F' ? 'MS' : 'MR'}${x.birth ? ' ' + x.birth : ''}`).join('\n'));
  $$('[data-tv]', d).forEach(btn => btn.onclick = async function handler() {
    const x = find(btn);
    if (btn.dataset.tv === 'edit') return open(x);
    if (btn.dataset.tv === 'del') {
      if (!await ask(`${x.surname} ${x.given}님을 여행자에서 빼고 여권 정보를 지울까요?`)) return;
      await api.del(`${base}/${x.id}`); toast('삭제했습니다.'); return reload();
    }
    if (btn.dataset.tv === 'reveal') {
      try {
        const { passportNo } = await api.post(`${base}/${x.id}/reveal`);
        const el = btn.closest('.tv-row').querySelector('.tv-no'); el.textContent = passportNo;
        btn.textContent = '복사'; btn.onclick = () => copy(passportNo);
        // 30초 뒤 다시 가립니다
        setTimeout(() => { el.textContent = x.passportMasked; btn.textContent = '번호 보기'; btn.onclick = handler; }, 30000);
      } catch (err) { toast(err.message); }
    }
  });
}
