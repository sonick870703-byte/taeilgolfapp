// 사진 자동 크기 조정: 올린 사진을 자리 비율에 맞게 가운데를 잘라내고 크기별로 줄입니다.
export const SLOTS = {
  banner: { aspect: 16 / 7, sizes: { lg: 1920, md: 1080, sm: 640 }, label: '배너 (16:7)' },
  product: { aspect: 4 / 3, sizes: { lg: 1400, md: 800, sm: 400 }, label: '상품 사진 (4:3)' },
  logo: { aspect: null, sizes: { md: 480 }, label: '로고' },
};

function loadImage(file) {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('사진을 읽지 못했습니다. JPG, PNG, WEBP 사진을 올려 주세요.')); };
    img.src = url;
  });
}

function supportsWebp() {
  try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); } catch { return false; }
}

export async function resizeForSlot(file, slotName) {
  const slot = SLOTS[slotName];
  const img = await loadImage(file);
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (slot.aspect) {
    if (sw / sh > slot.aspect) { const w = Math.round(sh * slot.aspect); sx = Math.round((sw - w) / 2); sw = w; }
    else { const h = Math.round(sw / slot.aspect); sy = Math.round((sh - h) / 2); sh = h; }
  }
  const type = supportsWebp() ? 'image/webp' : 'image/jpeg';
  const out = {};
  for (const [name, maxW] of Object.entries(slot.sizes)) {
    const w = Math.min(maxW, sw);
    const h = Math.round(w * sh / sw);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    out[name] = c.toDataURL(type, 0.82);
  }
  return out;
}
