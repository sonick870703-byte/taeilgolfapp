// ERP "환율": 호텔·골프장에 해외 송금할 때 보는 환율 화면 (지구본 프로그램 '환율 관리'와 같은 자료)
// 출처: Currency API (fawazahmed0, 무료·키 없음, 하루 한 번 갱신). 원화 기준 값만 받고 나머지는 교차 계산.
// 지난 날짜 값은 바뀌지 않으므로 이 PC에 저장해 두고(taeil.fx.days), 다음부터는 오늘 값만 새로 받는다.
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 안 돼도 됨 */ } } };
const DAYS = 14;
// 송금 대상 통화 (자주 쓰는 순서) + 등락표 통화
const SEND = ['THB', 'USD', 'VND', 'PHP', 'MYR', 'JPY', 'IDR', 'KHR', 'LAK', 'CNY', 'TWD', 'SGD', 'HKD', 'AUD', 'EUR', 'GBP', 'NZD', 'MNT', 'FJD'];
const POOL = ['USD', 'EUR', 'JPY', 'CNY', 'GBP', 'HKD', 'AUD', 'CAD', 'CHF', 'SGD', 'THB', 'TWD', 'VND', 'PHP', 'IDR', 'MYR', 'INR', 'KHR', 'LAK', 'NZD'];
const NEED = new Set([...SEND, ...POOL].map(c => c.toLowerCase()));
const curName = (() => { try { const d = new Intl.DisplayNames(['ko'], { type: 'currency' }); return c => { try { return d.of(c); } catch { return c; } }; } catch { return c => c; } })();
const fmt = (n, d = 2) => Number(n).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const iso = d => d.toISOString().slice(0, 10);
const md = s => s.slice(5).replace('-', '/');
const unitOf = (c, krw) => (krw < 1 ? 100 : 1);

const FX = { dates: [], krwPer: {}, stale: false, error: '' };
async function fetchDay(tag) {
  for (const u of [`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/krw.min.json`, `https://${tag}.currency-api.pages.dev/v1/currencies/krw.min.json`]) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch(u, { signal: ctl.signal, cache: 'no-cache' }); clearTimeout(t);
      if (r.ok) { const j = await r.json(); if (j && j.krw && j.date) return j; }
    } catch { /* 다음 주소 */ }
  }
  return null;
}
const slim = krw => { const o = {}; for (const k in krw) if (NEED.has(k) && krw[k] > 0) o[k] = +krw[k].toPrecision(8); return o; };
async function loadFX(force) {
  const cache = store.get('taeil.fx.days', {});
  const today = new Date(), want = [];
  for (let i = DAYS; i >= 1; i--) want.push(iso(new Date(today - i * 864e5)));
  const lastAt = +store.get('taeil.fx.latestAt', 0), fresh = !force && Date.now() - lastAt < 3 * 3600e3 && Object.keys(cache).length;
  const jobs = want.filter(d => !cache[d]).map(fetchDay);
  if (!fresh) jobs.push(fetchDay('latest'));
  const res = await Promise.all(jobs);
  let got = 0;
  for (const d of res) if (d) { cache[d.date] = slim(d.krw); got++; }
  if (!fresh && res.at(-1)) store.set('taeil.fx.latestAt', Date.now());
  const keep = {}; Object.keys(cache).sort().slice(-(DAYS + 6)).forEach(k => { keep[k] = cache[k]; });
  store.set('taeil.fx.days', keep);
  const all = Object.keys(keep).sort().filter(d => d >= want[0]);
  FX.stale = !fresh && !res.at(-1);
  if (all.length < 2) { FX.dates = []; FX.krwPer = {}; FX.error = got || all.length ? 'data' : 'net'; return; }
  FX.error = ''; FX.dates = all; FX.krwPer = {};
  for (const k of Object.keys(keep[all.at(-1)])) {
    let lastV = null;
    let arr = all.map(d => { const v = keep[d][k]; return v > 0 ? 1 / v : null; }).map(v => (lastV = v ?? lastV));
    if (arr[0] == null) { const f = arr.find(v => v != null); arr = arr.map(v => v ?? f); }
    FX.krwPer[k.toUpperCase()] = arr;
  }
}
const has = c => !!FX.krwPer[c];
const series = c => FX.krwPer[c];
const rate = c => FX.krwPer[c].at(-1);
const chg = (c, n = DAYS + 1) => { const s = series(c).slice(-n); return (s.at(-1) - s[0]) / s[0] * 100; };

function chartSVG(s, labels, W, H) {
  const lo = Math.min(...s), hi = Math.max(...s), pad = (hi - lo) * .15 || hi * .01;
  const PL = 6, PR = 6, PT = 16, PB = 20;
  const x = i => PL + i / (s.length - 1) * (W - PL - PR), y = v => PT + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - PT - PB);
  const pts = s.map((v, i) => ({ x: x(i), y: y(v), v, d: labels[i] }));
  const col = s.at(-1) >= s[0] ? '#c8372d' : '#1d6fb0';
  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const loP = pts.reduce((a, b) => (b.v < a.v ? b : a));
  let g = `<path d="M${pts[0].x},${H - PB} L${line.replace(/ /g, ' L')} L${pts.at(-1).x},${H - PB} Z" fill="${col}" opacity=".1"/>
    <polyline points="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${pts.at(-1).x}" cy="${pts.at(-1).y}" r="3.5" fill="${col}"/>
    <circle cx="${loP.x}" cy="${loP.y}" r="4.5" fill="none" stroke="#1d6fb0" stroke-width="1.8"/>
    <text x="${Math.min(Math.max(loP.x, 16), W - 16)}" y="${Math.min(loP.y + 15, H - PB - 2)}" text-anchor="middle" style="fill:#1d6fb0;font-weight:700">최저</text>`;
  const step = Math.ceil(pts.length / 6);
  pts.forEach((p, i) => { if (i % step === 0 || i === pts.length - 1) g += `<text x="${Math.min(Math.max(p.x, 14), W - 14)}" y="${H - 5}" text-anchor="middle">${md(p.d)}</text>`; });
  g += `<line class="cross" y1="${PT}" y2="${H - PB}" stroke="#15201a" stroke-opacity=".4" stroke-dasharray="3 3" visibility="hidden"/><circle class="dot" r="5" fill="none" stroke="${col}" stroke-width="2" visibility="hidden"/>`;
  return { svg: `<svg class="fx-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="환율 그래프">${g}</svg>`, pts };
}
function wireChart(root, pts, W, onHover) {
  const svg = $('svg.fx-chart', root); if (!svg) return;
  const c = $('.cross', svg), d = $('.dot', svg);
  const move = e => {
    const r = svg.getBoundingClientRect(), mx = (e.clientX - r.left) / r.width * W;
    const p = pts.reduce((a, b) => (Math.abs(b.x - mx) < Math.abs(a.x - mx) ? b : a));
    c.setAttribute('x1', p.x); c.setAttribute('x2', p.x); c.setAttribute('visibility', 'visible');
    d.setAttribute('cx', p.x); d.setAttribute('cy', p.y); d.setAttribute('visibility', 'visible');
    onHover(p);
  };
  svg.addEventListener('pointerdown', move); svg.addEventListener('pointermove', move);
}

const CSS = `<style id="fxCss">
.fx-cols{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:980px){.fx-cols{grid-template-columns:minmax(0,1fr)}}
.fx-big{font-size:32px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.15}
.fx-sub{font-size:13px;color:var(--ink-3)}
.fx-up{color:#c8372d}.fx-down{color:#1d6fb0}
.fx-chart{width:100%;height:auto;display:block;touch-action:none}
.fx-chart text{fill:var(--ink-3);font-size:10px}
.fx-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 14px}
.fx-out{background:var(--bg-2);border-radius:12px;padding:12px 14px;display:grid;gap:4px;margin-bottom:12px}
.fx-out b{font-size:22px;font-variant-numeric:tabular-nums}
.fx-out .send b{color:var(--danger)}
.fx-heat{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.fx-heat button{border:0;border-radius:10px;padding:8px 4px;display:grid;gap:1px;cursor:pointer;font:inherit;color:var(--ink)}
.fx-heat button b{font-size:14px}.fx-heat button span{font-size:12px;font-weight:600}
.fx-heat button.sel{outline:2px solid var(--primary);outline-offset:-2px}
.fx-sig{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;margin:10px 0;font-size:14px}
.fx-sig i{width:14px;height:14px;border-radius:50%;flex:none}
.fx-sig.g{background:#e8f6ee}.fx-sig.g i{background:#16a34a}
.fx-sig.y{background:#fff6dd}.fx-sig.y i{background:#e0a106}
.fx-sig.r{background:#fdecea}.fx-sig.r i{background:#dc3b26}
.fx-al{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-2);border-radius:10px;font-size:14px;margin-top:6px}
.fx-al .hit{color:var(--danger);font-weight:800}
.fx-al button{border:0;background:none;cursor:pointer;color:var(--ink-3)}
.fx-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
.fx-stats div{background:var(--bg-2);border-radius:10px;padding:8px 10px;font-size:12px;color:var(--ink-3)}
.fx-stats b{display:block;color:var(--ink);font-size:15px;font-variant-numeric:tabular-nums}
</style>`;

const st = { cur: 'THB', range: 14, amt: '', fee: 1, ...store.get('taeil.fx.erp', {}) };
const save = () => store.set('taeil.fx.erp', { cur: st.cur, range: st.range, fee: st.fee });
let alerts = store.get('taeil.fx.alerts', []);

export async function fxView(view, arg, env) {
  if (!$('#fxCss')) document.head.insertAdjacentHTML('beforeend', CSS);
  env.setBarAct('<button class="btn sm" id="fxRe">환율 새로 받기</button>');
  const start = async force => {
    if (!FX.dates.length) view.innerHTML = '<div class="loading">환율을 불러오는 중…</div>';
    await loadFX(force);
    if (!FX.dates.length) {
      view.innerHTML = `<div class="card" style="max-width:480px"><h2>환율을 받아오지 못했습니다</h2><p class="muted">${FX.error === 'net' ? '인터넷 연결을 확인한 뒤 다시 시도해 주세요.' : '환율 서버 응답이 올바르지 않습니다. 잠시 뒤 다시 시도해 주세요.'}</p><button class="btn primary" id="fxTry">다시 시도</button></div>`;
      $('#fxTry', view).onclick = () => start(true);
      return;
    }
    render(view, env);
  };
  $('#fxRe').onclick = () => start(true).then(() => env.toast('환율을 새로 받았습니다.'));
  await start(false);
}

function render(view, env) {
  if (!has(st.cur)) st.cur = SEND.find(has) || 'USD';
  const cur = st.cur, r = rate(cur), per = unitOf(cur, r), n = st.range + 1;
  const s = series(cur).slice(-n).map(v => v * per), lo = Math.min(...s), hi = Math.max(...s), avg = s.reduce((a, b) => a + b, 0) / s.length;
  const pos = hi === lo ? .5 : (s.at(-1) - lo) / (hi - lo), lv = pos < .33 ? 'g' : pos < .67 ? 'y' : 'r';
  const sig = { g: '최근 2주 중 원화로 싸게 보낼 수 있는 편입니다.', y: '최근 2주 평균 근처입니다.', r: '최근 2주 중 비싼 편입니다. 급하지 않으면 지켜보세요.' }[lv];
  const { svg, pts } = chartSVG(s, FX.dates.slice(-n), 520, 210);
  const p = chg(cur, n);
  const amt = parseFloat(String(st.amt).replace(/,/g, '')) || 0;
  const heat = POOL.filter(has).map(c => { const q = chg(c); const a = Math.min(Math.abs(q) / 2.5, 1);
    const bg = q >= 0 ? `rgba(200,55,45,${.08 + a * .42})` : `rgba(29,111,176,${.08 + a * .42})`;
    return `<button class="${c === cur ? 'sel' : ''}" data-c="${c}" style="background:${bg}" title="${esc(curName(c))}"><b>${c}</b><span>${q >= 0 ? '+' : ''}${q.toFixed(2)}%</span></button>`; }).join('');
  const myAl = alerts.filter(a => has(a.c)).map(a => { const now = rate(a.c) * a.per, hit = now <= a.target;
    return `<div class="fx-al"><span>${a.c}${a.per > 1 ? ' ' + a.per : ''} ≤ <b>${fmt(a.target)}</b>원</span><span class="${hit ? 'hit' : ''}">${hit ? '● 도달! 송금하기 좋은 때' : `지금 ${fmt(now)}원`}</span><button data-rm="${esc(a.id)}" aria-label="알림 삭제">✕</button></div>`; }).join('');
  view.innerHTML = `${FX.stale ? `<div class="msg" style="margin-bottom:12px">인터넷 연결이 불안정해 마지막으로 받은 환율(${md(FX.dates.at(-1))})을 보여 줍니다.</div>` : ''}
  <div class="fx-cols">
    <div>
      <div class="card">
        <h2>송금 금액 계산 <small>호텔·골프장에 보낼 금액</small></h2>
        <div class="chips-erp">${SEND.filter(has).map(c => `<button class="${c === cur ? 'on' : ''}" data-c="${c}">${c}</button>`).join('')}</div>
        <div class="fx-row">
          <div class="field"><label for="fxAmt">보낼 금액 (${cur} · ${esc(curName(cur))})</label><input id="fxAmt" inputmode="decimal" placeholder="예: 25,000" value="${esc(st.amt)}"></div>
          <div class="field"><label for="fxFee">은행 송금 환율 가산 (%)</label><input id="fxFee" type="number" step="0.1" min="0" max="10" value="${st.fee}"><span class="hint">매매기준율보다 보낼 때 더 받는 비율. 거래 은행 값으로 맞추세요.</span></div>
        </div>
        <div class="fx-out">
          <div>매매기준율로 <b id="fxBase">${fmt(amt * r, 0)}</b> 원</div>
          <div class="send">송금 보낼 때 예상 <b id="fxSend">${fmt(amt * r * (1 + st.fee / 100), 0)}</b> 원 <span class="fx-sub">(추정)</span></div>
        </div>
        <div class="fx-sub">오늘 ${cur} ${per} = <b style="color:var(--ink)">${fmt(r * per)}원</b> · ${md(FX.dates.at(-1))} 기준 시장 기준값입니다. 실제 송금은 은행의 '송금 보낼 때' 환율과 수수료가 적용됩니다.</div>
      </div>
      <div class="card">
        <h2>${cur} 흐름 <small>${cur} ${per} = ? 원</small><span style="margin-left:auto" class="chips-erp">${[[7, '1주'], [14, '2주']].map(([k, l]) => `<button class="${st.range === k ? 'on' : ''}" data-range="${k}">${l}</button>`).join('')}</span></h2>
        <div class="fx-big">${fmt(s.at(-1))}원</div>
        <div class="fx-sub"><span class="${p > 0 ? 'fx-up' : p < 0 ? 'fx-down' : ''}">${p > 0 ? '▲' : p < 0 ? '▼' : ''}${Math.abs(p).toFixed(2)}%</span> · ${md(FX.dates.at(-n) || FX.dates[0])}~${md(FX.dates.at(-1))} <span id="fxTip" style="float:right"></span></div>
        <div class="fx-sig ${lv}"><i></i>${sig}</div>
        ${svg}
        <div class="fx-stats"><div>최저<b>${fmt(lo)}</b></div><div>평균<b>${fmt(avg)}</b></div><div>최고<b>${fmt(hi)}</b></div></div>
      </div>
    </div>
    <div>
      <div class="card">
        <h2>2주 등락 <small>원화 기준 · 누르면 그 통화로</small></h2>
        <div class="fx-heat">${heat}</div>
        <p class="fx-sub" style="margin:8px 0 0"><span class="fx-down">■</span> 하락(원화로 싸짐) <span class="fx-up">■</span> 상승(비싸짐)</p>
      </div>
      <div class="card">
        <h2>목표 환율 알림 <small>${cur} ${per} 기준</small></h2>
        <div class="fx-row" style="grid-template-columns:minmax(0,1fr) auto;align-items:end">
          <div class="field" style="margin:0"><label for="fxT">이 값 이하가 되면</label><input id="fxT" inputmode="decimal" placeholder="${fmt(lo)}"></div>
          <button class="btn primary" id="fxAdd">등록</button>
        </div>
        ${myAl || '<p class="muted" style="margin:10px 0 0">등록한 알림이 없습니다.</p>'}
        <p class="fx-sub" style="margin:8px 0 0">이 PC에만 저장되고, 이 화면을 열면 도달 여부를 보여 줍니다.</p>
      </div>
      <p class="fx-sub">환율 출처: Currency API (fawazahmed0) · 하루 한 번 갱신되는 시장 기준값. 마지막 기준일 ${FX.dates.at(-1)}</p>
    </div>
  </div>`;
  wireChart(view, pts, 520, q => { $('#fxTip', view).textContent = `${md(q.d)} ${fmt(q.v)}원`; });
  const upd = () => {
    const a = parseFloat(String(st.amt).replace(/,/g, '')) || 0;
    $('#fxBase', view).textContent = fmt(a * r, 0); $('#fxSend', view).textContent = fmt(a * r * (1 + st.fee / 100), 0);
  };
  const ai = $('#fxAmt', view);
  ai.oninput = () => {
    const raw = ai.value.replace(/[^\d.]/g, '');
    st.amt = raw ? Number(raw.split('.')[0]).toLocaleString('ko-KR') + (raw.includes('.') ? '.' + raw.split('.')[1].slice(0, 2) : '') : '';
    ai.value = st.amt; upd();
  };
  $('#fxFee', view).oninput = e => { st.fee = Math.max(0, Math.min(10, Number(e.target.value) || 0)); save(); upd(); };
  const add = () => { const inp = $('#fxT', view), v = parseFloat(inp.value.replace(/,/g, '')); if (!(v > 0)) { inp.focus(); return; }
    alerts.push({ id: String(Date.now()), c: cur, per, target: v }); store.set('taeil.fx.alerts', alerts); render(view, env); env.toast('알림을 등록했습니다.'); };
  $('#fxAdd', view).onclick = add;
  $('#fxT', view).onkeydown = e => { if (e.key === 'Enter') add(); };
  $('.fx-cols', view).onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.c) { st.cur = b.dataset.c; save(); render(view, env); }
    else if (b.dataset.range) { st.range = +b.dataset.range; save(); render(view, env); }
    else if (b.dataset.rm) { alerts = alerts.filter(a => a.id !== b.dataset.rm); store.set('taeil.fx.alerts', alerts); render(view, env); }
  };
}
