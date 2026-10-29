// ERP "페이지 만들기": 블록을 쌓아 홈페이지 화면을 직접 만듭니다.
import { api } from '../shared/api.js';
import { ask } from '../shared/ask.js';
import { CATEGORIES } from '../shared/core.js';
import { BLOCK_TYPES, PAGE_TEMPLATES, blockName, newBlock, renderBlocks, mountHero, esc } from '../shared/blocks.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// env: { toast, imageUploader, getSettings, drawer, closeDrawer, setBarAct }
export async function pagesView(view, id, env) {
  if (id) return editor(view, id, env);
  const pages = await api.get('/api/erp/pages');
  env.setBarAct('<button class="btn primary sm" id="newPg">+ 새 페이지</button>');
  $('#newPg').onclick = () => templatePicker(env);
  view.innerHTML = `<p class="muted" style="margin-top:0">블록(제목, 글, 사진, 상품 목록 등)을 골라 쌓기만 하면 페이지가 만들어집니다. 오른쪽에서 바로 미리 보고, 저장하면 홈페이지에 반영됩니다.</p>
    <div class="pg-list">${pages.map(p => `<a class="pg-card" href="#/pages/${esc(p.id)}">
      <div><b>${esc(p.title)}</b><div class="muted" style="font-size:13px">${p.id === 'home' ? '홈페이지 첫 화면' : (p.inMenu ? '상단 메뉴에 표시' : '메뉴에 없음 (주소로만 열림)')} · 블록 ${(p.blocks || []).length}개</div></div>
      <span>${p.id === 'home' ? '<span class="badge g">메인</span>' : p.visible === false ? '<span class="badge">숨김</span>' : '<span class="badge b">공개</span>'}</span></a>`).join('')}</div>`;
}

function templatePicker(env) {
  const d = env.drawer('새 페이지 만들기', `<p class="muted" style="margin-top:0">틀을 고르면 내용이 채워진 채로 시작합니다. 글과 사진만 바꾸면 됩니다.</p>
    <div class="tpl-grid">${PAGE_TEMPLATES.map(t => `<button class="tpl" data-t="${t.id}"><b>${esc(t.name)}</b><span>${t.blocks({ brand: '', tagline: '', companyName: '', address: '', tel: '', hours: '' }).map(b => blockName(b.type)).join(' · ')}</span></button>`).join('')}</div>`);
  $$('[data-t]', d).forEach(btn => btn.onclick = async () => {
    const t = PAGE_TEMPLATES.find(x => x.id === btn.dataset.t);
    const s = await env.getSettings();
    const pg = await api.put('/api/erp/pages/new', { title: t.title, inMenu: t.id !== 'event', visible: true, slug: t.id === 'blank' ? '' : t.id, blocks: t.blocks(s) });
    env.closeDrawer();
    location.hash = '#/pages/' + pg.id;
  });
}

async function editor(view, id, env) {
  const [pages, s, products, notices] = await Promise.all([api.get('/api/erp/pages'), env.getSettings(true), api.get('/api/products'), api.get('/api/notices')]);
  const pg = structuredClone(pages.find(p => p.id === id));
  if (!pg) { view.innerHTML = '<div class="empty">페이지를 찾을 수 없습니다. <a class="btn" href="#/pages">목록으로</a></div>'; return; }
  const isHome = pg.id === 'home';
  let dirty = false;
  env.setBarAct(`<a class="btn sm" href="#/pages">목록</a>`);
  $('#title').textContent = `페이지 만들기 · ${pg.title}`;

  view.innerHTML = `<div class="pb">
    <div class="pb-edit">
      ${isHome ? '<div class="card" style="padding:14px 16px"><b>메인 화면</b><div class="muted" style="font-size:13px">홈페이지 첫 화면입니다. 블록 순서를 바꾸거나 빼고, 새 블록을 넣을 수 있습니다.</div></div>' : `
      <div class="card" style="padding:14px 16px">
        <div class="field"><label for="pgTitle">페이지 이름</label><input id="pgTitle" value="${esc(pg.title)}"></div>
        <label class="check"><input type="checkbox" id="pgMenu" ${pg.inMenu ? 'checked' : ''}> 상단 메뉴에 보이기</label>
        <label class="check"><input type="checkbox" id="pgVis" ${pg.visible !== false ? 'checked' : ''}> 홈페이지에 공개</label>
        <details><summary class="muted" style="cursor:pointer;font-size:13px">더 보기 (메뉴 순서, 주소)</summary>
          <div class="grid2" style="margin-top:10px"><div class="field"><label for="pgOrder">메뉴 순서</label><input id="pgOrder" type="number" value="${pg.menuOrder || 99}"></div>
          <div class="field"><label for="pgSlug">주소 (영문)</label><input id="pgSlug" value="${esc(pg.slug)}"></div></div></details>
      </div>`}
      <div id="blocks"></div>
      <div class="card add-blk"><b>블록 추가</b><div class="add-grid">${BLOCK_TYPES.map(t => `<button type="button" data-add="${t.type}"><b>${t.name}</b><span>${t.hint}</span></button>`).join('')}</div></div>
      <div class="save-bar">${isHome ? '' : '<button class="btn" id="pgDel" style="color:var(--danger);margin-right:auto">페이지 삭제</button>'}<a class="btn" href="../${isHome ? '' : '#/page/' + esc(pg.slug)}" target="_blank">홈페이지에서 보기</a><button class="btn primary" id="pgSave">저장</button></div>
    </div>
    <div class="pb-preview"><div class="pb-pv-head"><span>미리보기</span><span class="muted">저장 전 화면입니다</span></div><div class="pv" id="pv"></div></div>
  </div>`;

  const pv = $('#pv', view);
  pv.addEventListener('click', e => { if (e.target.closest('a, button')) e.preventDefault(); });
  let stopHero = () => {};
  let t;
  const preview = (focus) => {
    clearTimeout(t);
    t = setTimeout(() => {
      stopHero();
      pv.innerHTML = renderBlocks(pg.blocks, { site: s, products, notices }).html || '<div class="empty" style="margin:24px">블록을 추가해 주세요.</div>';
      stopHero = mountHero(pv, s);
      if (focus != null) pv.querySelector(`[data-blk="${focus}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 120);
  };
  const touch = (focus) => { dirty = true; preview(focus); };

  const linkOptions = cur => {
    const opts = [['kakao', '카카오톡 상담'], ['tel', '전화 걸기'], ...CATEGORIES.map(c => ['#/c/' + c.id, c.name]), ...pages.filter(p => p.id !== 'home').map(p => ['#/page/' + p.slug, p.title + ' 페이지']), ['#/notice', '공지사항'], ['#/', '메인 화면']];
    const custom = cur && !opts.some(o => o[0] === cur);
    return opts.map(([v, n]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(n)}</option>`).join('') + `<option value="__url" ${custom ? 'selected' : ''}>다른 사이트 주소…</option>`;
  };

  const fields = (b, k) => {
    const F = (label, f, val, type = 'text') => `<div class="field"><label for="b${k}${f}">${label}</label><input id="b${k}${f}" data-f="${f}" type="${type}" value="${esc(val ?? '')}"></div>`;
    const T = (label, f, val) => `<div class="field"><label for="b${k}${f}">${label}</label><textarea id="b${k}${f}" data-f="${f}">${esc(val ?? '')}</textarea></div>`;
    switch (b.type) {
      case 'heading': return F('제목', 'text', b.text) + F('작은 설명 (없어도 됨)', 'sub', b.sub);
      case 'text': return T('내용', 'text', b.text);
      case 'image': return `<div data-img="banner"></div>` + F('사진 설명 (없어도 됨)', 'caption', b.caption);
      case 'imageText': return `<div data-img="product"></div>` + F('제목', 'title', b.title) + T('설명', 'text', b.text)
        + `<div class="field"><label for="b${k}side">사진 위치</label><select id="b${k}side" data-f="side"><option value="left" ${b.side !== 'right' ? 'selected' : ''}>왼쪽</option><option value="right" ${b.side === 'right' ? 'selected' : ''}>오른쪽</option></select></div>`;
      case 'products': return F('제목', 'title', b.title)
        + `<div class="grid2"><div class="field"><label for="b${k}cat">어떤 상품</label><select id="b${k}cat" data-f="category"><option value="">전체 상품</option>${CATEGORIES.map(c => `<option value="${c.id}" ${b.category === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>`
        + `<div class="field"><label for="b${k}lim">최대 개수</label><input id="b${k}lim" data-f="limit" type="number" min="1" max="24" value="${b.limit || 6}"></div></div><p class="muted" style="font-size:13px;margin:0">상품 관리에 등록된 상품이 자동으로 나옵니다.</p>`;
      case 'button': {
        const custom = /^https?:/.test(b.link || '');
        return F('버튼 글자', 'label', b.label)
          + `<div class="field"><label for="b${k}link">누르면</label><select id="b${k}link" data-link>${linkOptions(b.link)}</select></div>`
          + `<div class="field" ${custom ? '' : 'hidden'} data-urlbox><label for="b${k}url">사이트 주소</label><input id="b${k}url" data-url value="${esc(custom ? b.link : '')}" placeholder="https://"></div>`;
      }
      case 'notices': return `<div class="grid2">${F('제목', 'title', b.title)}${F('개수', 'limit', b.limit || 5, 'number')}</div><p class="muted" style="font-size:13px;margin:0">최근 공지가 자동으로 나옵니다.</p>`;
      case 'contact': return F('문구', 'title', b.title) + '<p class="muted" style="font-size:13px;margin:0">전화번호·상담 시간·카카오톡은 홈페이지 설정의 회사 정보가 자동으로 들어갑니다.</p>';
      case 'hero': return '<p class="muted" style="font-size:13px;margin:0">배너 사진과 문구는 <a href="#/site" style="text-decoration:underline">홈페이지 설정</a>에서 바꿉니다.</p>';
      case 'categories': return '<p class="muted" style="font-size:13px;margin:0">분류 이름은 <a href="#/site" style="text-decoration:underline">홈페이지 설정 › 메뉴</a>에서 바꿉니다.</p>';
      default: return '';
    }
  };

  const renderBlocksEditor = () => {
    const box = $('#blocks', view);
    box.innerHTML = pg.blocks.map((b, k) => `<div class="card blk-ed" data-k="${k}">
      <div class="blk-ed-head"><b>${k + 1}. ${esc(blockName(b.type))}</b>
        <span><button type="button" class="ib" data-mv="-1" ${k === 0 ? 'disabled' : ''} aria-label="위로">↑</button><button type="button" class="ib" data-mv="1" ${k === pg.blocks.length - 1 ? 'disabled' : ''} aria-label="아래로">↓</button><button type="button" class="ib" data-dup aria-label="복사">⧉</button><button type="button" class="ib" data-rm aria-label="블록 삭제" style="color:var(--danger)">×</button></span></div>
      ${fields(b, k)}</div>`).join('') || '<div class="empty" style="margin-bottom:16px">블록이 없습니다. 아래에서 추가해 주세요.</div>';
    $$('.blk-ed', box).forEach(card => {
      const k = +card.dataset.k, b = pg.blocks[k];
      $$('[data-f]', card).forEach(inp => inp.oninput = inp.onchange = () => { b[inp.dataset.f] = inp.type === 'number' ? Number(inp.value) : inp.value; touch(k); });
      const link = $('[data-link]', card);
      if (link) link.onchange = () => {
        const box2 = $('[data-urlbox]', card);
        box2.hidden = link.value !== '__url';
        b.link = link.value === '__url' ? ($('[data-url]', card).value || '') : link.value; touch(k);
      };
      const url = $('[data-url]', card);
      if (url) url.oninput = () => { b.link = url.value.trim(); touch(k); };
      const imgBox = $('[data-img]', card);
      if (imgBox) env.imageUploader(imgBox, b.img ? [b.img] : [], imgBox.dataset.img, imgs => { b.img = imgs[0] || null; touch(k); }, 1);
      $$('[data-mv]', card).forEach(btn => btn.onclick = () => {
        const j = k + Number(btn.dataset.mv);
        [pg.blocks[k], pg.blocks[j]] = [pg.blocks[j], pg.blocks[k]];
        renderBlocksEditor(); touch(j);
      });
      $('[data-dup]', card).onclick = () => { pg.blocks.splice(k + 1, 0, structuredClone(b)); renderBlocksEditor(); touch(k + 1); };
      $('[data-rm]', card).onclick = async () => {
        if (!await ask(`${blockName(b.type)} 블록을 뺄까요?`, '빼기')) return;
        pg.blocks.splice(k, 1); renderBlocksEditor(); touch();
      };
      card.addEventListener('focusin', () => pv.querySelector(`[data-blk="${k}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    });
  };

  $$('[data-add]', view).forEach(btn => btn.onclick = () => {
    pg.blocks.push(newBlock(btn.dataset.add));
    renderBlocksEditor(); touch(pg.blocks.length - 1);
    $$('.blk-ed', view).pop()?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  if (!isHome) {
    $('#pgTitle', view).oninput = e => { pg.title = e.target.value; dirty = true; };
    $('#pgMenu', view).onchange = e => { pg.inMenu = e.target.checked; dirty = true; };
    $('#pgVis', view).onchange = e => { pg.visible = e.target.checked; dirty = true; };
    $('#pgOrder', view).oninput = e => { pg.menuOrder = Number(e.target.value); dirty = true; };
    $('#pgSlug', view).oninput = e => { pg.slug = e.target.value; dirty = true; };
    $('#pgDel', view).onclick = async () => {
      if (!await ask(`"${pg.title}" 페이지를 삭제할까요? 되돌릴 수 없습니다. 잠시 내리려면 "홈페이지에 공개"를 끄세요.`, '삭제')) return;
      await api.del('/api/erp/pages/' + pg.id); dirty = false; env.toast('삭제했습니다.'); location.hash = '#/pages';
    };
  }
  $('#pgSave', view).onclick = async () => {
    try {
      const saved = await api.put('/api/erp/pages/' + pg.id, pg);
      pg.slug = saved.slug; dirty = false;
      if ($('#pgSlug', view)) $('#pgSlug', view).value = saved.slug;
      env.toast('저장했습니다. 홈페이지에 바로 반영됩니다.');
    } catch (err) { env.toast(err.message); }
  };
  window.addEventListener('beforeunload', e => { if (dirty) e.preventDefault(); }, { once: true });
  renderBlocksEditor();
  preview();
}
