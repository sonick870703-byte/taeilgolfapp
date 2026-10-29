// 홈페이지 블록: ERP "페이지 만들기"에서 쌓은 블록을 화면으로 그립니다.
// 홈페이지와 ERP 미리보기가 같이 씁니다.
import { won } from './core.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = ms => new Date(ms).toLocaleDateString('ko-KR');
const pick = (im, ...sizes) => (!im ? '' : typeof im === 'string' ? im : sizes.map(s => im[s]).find(Boolean) || '');

// 블록 종류 (ERP의 "블록 추가" 버튼 순서)
export const BLOCK_TYPES = [
  { type: 'heading', name: '제목', hint: '큰 제목과 작은 설명' },
  { type: 'text', name: '글', hint: '문단 글' },
  { type: 'image', name: '사진', hint: '넓은 사진 한 장' },
  { type: 'imageText', name: '사진 + 글', hint: '사진 옆에 설명' },
  { type: 'products', name: '상품 목록', hint: '분류별 상품 자동 표시' },
  { type: 'button', name: '버튼', hint: '다른 페이지·상담으로 연결' },
  { type: 'notices', name: '공지사항', hint: '최근 공지 자동 표시' },
  { type: 'contact', name: '상담 안내', hint: '카톡·전화 상담 띠' },
  { type: 'categories', name: '분류 바로가기', hint: '무제한 골프·한 달 살기 등' },
  { type: 'hero', name: '메인 배너', hint: '홈페이지 설정의 배너' },
  { type: 'divider', name: '여백', hint: '구역 나누기' },
];
export const blockName = t => (BLOCK_TYPES.find(b => b.type === t) || {}).name || t;

export function newBlock(type) {
  return {
    heading: { type, text: '제목을 입력하세요', sub: '' },
    text: { type, text: '내용을 입력하세요.' },
    image: { type, img: null, caption: '' },
    imageText: { type, img: null, title: '제목', text: '설명을 입력하세요.', side: 'left' },
    products: { type, title: '추천 상품', category: '', limit: 6 },
    button: { type, label: '카카오톡으로 상담하기', link: 'kakao', align: 'center' },
    notices: { type, title: '공지사항', limit: 5 },
    contact: { type, title: '어떤 여행이 맞을지 고민되시나요?' },
    categories: { type },
    hero: { type },
    divider: { type },
  }[type] || { type };
}

// 바로 쓰는 페이지 틀 (클릭 한 번으로 시작)
export const PAGE_TEMPLATES = [
  { id: 'about', name: '회사 소개', title: '회사 소개', blocks: s => [
    { type: 'heading', text: `${s.brand}를 소개합니다`, sub: s.tagline },
    { type: 'imageText', img: null, title: '골프 여행 전문 브랜드', text: `${s.companyName}은 태국·말레이시아 골프 여행과 한 달 살기를 전문으로 합니다.\n현지 골프장과 직접 계약해 합리적인 요금으로 모십니다.`, side: 'left' },
    { type: 'contact', title: '궁금한 점은 편하게 물어보세요' },
  ] },
  { id: 'map', name: '찾아오시는 길', title: '찾아오시는 길', blocks: s => [
    { type: 'heading', text: '찾아오시는 길', sub: '' },
    { type: 'image', img: null, caption: '약도 사진을 올려 주세요' },
    { type: 'text', text: `주소: ${s.address}\n전화: ${s.tel}${s.tel2 ? ' / ' + s.tel2 : ''}\n상담 시간: ${s.hours}` },
  ] },
  { id: 'course', name: '골프장 안내', title: '골프장 안내', blocks: () => [
    { type: 'heading', text: '골프장 안내', sub: '태일골프가 모시는 골프장' },
    { type: 'imageText', img: null, title: '골프장 이름', text: '골프장 소개, 홀 수, 특징을 적어 주세요.', side: 'left' },
    { type: 'imageText', img: null, title: '골프장 이름', text: '골프장 소개, 홀 수, 특징을 적어 주세요.', side: 'right' },
    { type: 'products', title: '이 골프장 상품', category: '', limit: 3 },
  ] },
  { id: 'event', name: '이벤트·특가', title: '이벤트', blocks: () => [
    { type: 'image', img: null, caption: '' },
    { type: 'heading', text: '이벤트 제목', sub: '기간: 2026.11.01 ~ 2026.11.30' },
    { type: 'text', text: '이벤트 내용을 적어 주세요.' },
    { type: 'button', label: '카카오톡으로 신청하기', link: 'kakao', align: 'center' },
  ] },
  { id: 'blank', name: '빈 페이지', title: '새 페이지', blocks: () => [{ type: 'heading', text: '제목을 입력하세요', sub: '' }] },
];

export function defaultHomeBlocks() {
  return [
    { type: 'hero' },
    { type: 'categories' },
    { type: 'products', title: '지금 예약할 수 있는 상품', category: '', limit: 12 },
    { type: 'notices', title: '공지사항', limit: 5 },
    { type: 'contact', title: '어떤 여행이 맞을지 고민되시나요?' },
  ];
}

export function linkHref(link, site) {
  if (!link) return '#/';
  if (link === 'kakao') return (site.kakaoUrl || '').replace(/\/$/, '') + '/chat';
  if (link === 'tel') return 'tel:' + (site.tel || '');
  return /^(https?:\/\/|#)/.test(link) ? link : '#/';
}

export function priceHtml(p) {
  if (!p.price) return `<div class="price ask">${esc(p.priceNote || '요금 상담')}</div>`;
  return `<div class="price">${won(p.price)}<small>1인${p.category === 'membership' ? '' : ' · 2인 1실 기준'}</small></div>`;
}

export function productCard(p, site) {
  const catName = (site.menus.find(m => m.id === p.category) || {}).name || '';
  const src = p.images && p.images[0] && pick(p.images[0], 'sm', 'md');
  return `<a class="pcard" href="#/p/${esc(p.id)}">
    <div class="pimg">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<div class="ph"><small>${esc(p.country)} · ${esc(p.city)}</small><strong>${esc(p.city || p.title)}</strong></div>`}
      <span class="tag">${esc(catName)}</span></div>
    <div class="pbody"><h3>${esc(p.title)}</h3><div class="loc">${esc([p.country, p.city].filter(Boolean).join(' · '))}${p.nights ? ` · ${p.nights}박` : ''}</div>
      ${p.summary ? `<div class="sum">${esc(p.summary)}</div>` : ''}${priceHtml(p)}</div></a>`;
}

const CAT_DESC = { unlimited: '원하는 만큼 라운드', month: '시니어 장기 체류', trip: '맞춤 골프 일정', membership: '선불권 · 회원권' };

// ctx: { site, products, notices }
export function renderBlocks(blocks, ctx) {
  const { site } = ctx;
  let hasHero = false;
  const html = (blocks || []).map((b, idx) => {
    const sec = (inner, alt) => `<section class="section blk${alt ? ' alt' : ''}" data-blk="${idx}"><div class="wrap">${inner}</div></section>`;
    switch (b.type) {
      case 'hero': hasHero = true; return `<section class="hero" data-blk="${idx}" data-hero></section>`;
      case 'categories': {
        const cats = site.menus.filter(m => m.visible !== false);
        const after = (blocks[idx - 1] || {}).type === 'hero';
        return `<div class="wrap" data-blk="${idx}" style="${after ? '' : 'padding-top:40px'}"><div class="cats" style="${after ? '' : 'margin-top:0'}">${cats.map((c, i) => `<a class="cat" href="#/c/${c.id}"><i>${i + 1}</i><b>${esc(c.name)}</b><span>${esc(CAT_DESC[c.id] || '')}</span></a>`).join('')}</div></div>`;
      }
      case 'heading': return sec(`<div class="blk-head"><h2>${esc(b.text)}</h2>${b.sub ? `<p>${esc(b.sub)}</p>` : ''}</div>`);
      case 'text': return sec(`<div class="blk-text">${esc(b.text)}</div>`);
      case 'image': {
        const src = pick(b.img, 'lg', 'md', 'sm');
        return sec(`<figure class="blk-img">${src ? `<img src="${esc(src)}" alt="${esc(b.caption || '')}" loading="lazy">` : '<div class="blk-noimg">사진이 아직 없습니다</div>'}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`);
      }
      case 'imageText': {
        const src = pick(b.img, 'md', 'lg', 'sm');
        return sec(`<div class="blk-it ${b.side === 'right' ? 'rev' : ''}"><div class="blk-it-img">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : '<div class="blk-noimg">사진이 아직 없습니다</div>'}</div><div><h3>${esc(b.title)}</h3><div class="blk-text">${esc(b.text)}</div></div></div>`);
      }
      case 'products': {
        let list = ctx.products || [];
        if (b.category) list = list.filter(p => p.category === b.category);
        list = list.slice(0, Number(b.limit) || 6);
        return sec(`${b.title ? `<div class="sec-head"><h2>${esc(b.title)}</h2>${b.category ? `<a href="#/c/${esc(b.category)}">전체 보기</a>` : ''}</div>` : ''}<div class="grid">${list.map(p => productCard(p, site)).join('') || '<div class="empty">곧 상품이 올라옵니다.</div>'}</div>`);
      }
      case 'button': return sec(`<div style="text-align:${b.align === 'left' ? 'left' : 'center'}"><a class="btn accent" href="${esc(linkHref(b.link, site))}" ${/^https?:/.test(linkHref(b.link, site)) ? 'target="_blank" rel="noopener"' : ''}>${esc(b.label)}</a></div>`);
      case 'notices': {
        const list = (ctx.notices || []).slice(0, Number(b.limit) || 5);
        return sec(`<div class="sec-head"><h2>${esc(b.title || '공지사항')}</h2><a href="#/notice">전체 보기</a></div>
          <div class="notice-list">${list.map(n => `<a href="#/notice/${esc(n.id)}">${n.pinned ? '<span class="pin">필독</span>' : ''}<span class="t">${esc(n.title)}</span><span class="d">${fmtDate(n.createdAt)}</span></a>`).join('') || '<div class="empty">공지사항이 없습니다.</div>'}</div>`, true);
      }
      case 'contact': return sec(`<div class="contact-band"><div><h2>${esc(b.title || '상담 안내')}</h2><p>${esc(site.hours)} · 전화 ${esc(site.tel)} · 카카오톡 채널 ${esc(site.brand)}</p></div>
        <div class="acts"><a class="btn kk" href="${esc(linkHref('kakao', site))}" target="_blank" rel="noopener">카카오톡 상담</a><a class="btn" href="tel:${esc(site.tel)}">전화 상담</a></div></div>`);
      case 'divider': return `<div class="blk-div" data-blk="${idx}"></div>`;
      default: return '';
    }
  }).join('');
  return { html, hasHero };
}

// 메인 배너 그리기 (여러 장이면 자동으로 넘어감). 정리 함수 반환
export function mountHero(root, site) {
  const el = root.querySelector('[data-hero]');
  if (!el) return () => {};
  const banners = site.heroBanners && site.heroBanners.length ? site.heroBanners : [{ title: site.brand, sub: site.tagline }];
  let i = 0;
  const show = () => {
    const b = banners[i];
    const src = pick(b.img, 'lg', 'md', 'sm');
    el.innerHTML = `${src ? `<img src="${esc(src)}" alt="">` : '<div class="hero-pattern"></div>'}
      <div class="wrap"><h1>${esc(b.title)}</h1><p>${esc(b.sub || '')}</p>${b.link ? `<a class="btn accent" href="${esc(b.link)}">자세히 보기</a>` : ''}
      ${banners.length > 1 ? `<div class="dots">${banners.map((_, k) => `<button aria-label="배너 ${k + 1}" class="${k === i ? 'on' : ''}" data-k="${k}"></button>`).join('')}</div>` : ''}</div>`;
    el.querySelectorAll('.dots button').forEach(btn => btn.onclick = () => { i = +btn.dataset.k; show(); });
  };
  show();
  if (banners.length < 2) return () => {};
  const t = setInterval(() => { if (!el.isConnected) return clearInterval(t); i = (i + 1) % banners.length; show(); }, 6000);
  return () => clearInterval(t);
}
