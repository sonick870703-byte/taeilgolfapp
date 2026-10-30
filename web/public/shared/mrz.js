// 여권 맨 아래 두 줄(MRZ, 44자 × 2줄)을 읽어 이름·여권번호·날짜로 바꿉니다.
// OCR이 헷갈리기 쉬운 글자(O↔0, I↔1 등)는 검증 숫자(check digit)로 맞는 쪽을 고릅니다.

const W = [7, 3, 1];
const val = c => (c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
export const checkDigit = s => String([...s].reduce((sum, c, i) => sum + val(c) * W[i % 3], 0) % 10);

const TO_DIGIT = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', T: '1', Z: '2', S: '5', B: '8', G: '6', A: '4' };
const TO_ALPHA = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 8: 'B', 6: 'G', 4: 'A' };
const LOOKS_LIKE = { 0: '86', 1: '7', 2: '7', 3: '85', 5: '6', 6: '850', 7: '12', 8: '3609', 9: '8' };
const digits = s => s.replace(/[A-Z<]/g, c => TO_DIGIT[c] || c);
const alphas = s => s.replace(/\d/g, c => TO_ALPHA[c] || c);

function clean(line) {
  return line.toUpperCase().replace(/[«‹(\[{]/g, '<').replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, '');
}

// 검증 숫자가 맞을 때까지 헷갈리는 글자를 하나씩 바꿔 봅니다 (여권번호처럼 글자·숫자가 섞인 칸).
function fixMixed(field, check) {
  if (checkDigit(field) === check) return { v: field, ok: true };
  const swaps = { ...TO_DIGIT, ...TO_ALPHA };
  for (let i = 0; i < field.length; i++) {
    const alt = swaps[field[i]];
    if (!alt) continue;
    const f = field.slice(0, i) + alt + field.slice(i + 1);
    if (checkDigit(f) === check) return { v: f, ok: true };
  }
  // 숫자끼리 비슷한 모양(3↔8 등)을 바꿔 봐서 검증 숫자가 맞는 답이 하나뿐일 때만 고칩니다.
  const found = new Set();
  for (let i = 0; i < field.length; i++) {
    for (const alt of LOOKS_LIKE[field[i]] || '') {
      const f = field.slice(0, i) + alt + field.slice(i + 1);
      if (checkDigit(f) === check) found.add(f);
    }
  }
  if (found.size === 1) return { v: [...found][0], ok: true };
  return { v: field, ok: false };
}

function ymd(s, future) {
  if (!/^\d{6}$/.test(s)) return '';
  const yy = Number(s.slice(0, 2)), cur = new Date().getFullYear() % 100;
  const y = future ? 2000 + yy : (yy > cur ? 1900 : 2000) + yy;
  const m = s.slice(2, 4), d = s.slice(4, 6);
  if (m < '01' || m > '12' || d < '01' || d > '31') return '';
  return `${y}-${m}-${d}`;
}

const fit = s => (s + '<'.repeat(44)).slice(0, 44);

// OCR 결과 글 전체를 받아 여권(TD3) 두 줄을 찾습니다. 못 찾으면 null.
export function parseMRZ(text) {
  const lines = String(text || '').split(/\n+/).map(clean).filter(l => l.length >= 30);
  let i = lines.findIndex((l, n) => /^P[A-Z<]/.test(l) && l.includes('<<') && lines[n + 1]);
  if (i < 0) i = lines.findIndex((l, n) => l.includes('<<') && lines[n + 1] && /\d{6}/.test(lines[n + 1]));
  if (i < 0) return null;
  const l1 = fit(lines[i]), l2 = fit(lines[i + 1]);

  const no = fixMixed(l2.slice(0, 9), digits(l2[9]));
  const nat = alphas(l2.slice(10, 13)).replace(/</g, '');
  const birthRaw = digits(l2.slice(13, 19)), expRaw = digits(l2.slice(21, 27));
  const sexC = l2[20] === 'M' || l2[20] === 'F' ? l2[20] : ({ H: 'M', N: 'M', P: 'F', E: 'F' }[l2[20]] || '');
  const names = alphas(l1.slice(5)).replace(/<+$/, '');
  const [surname, ...rest] = names.split('<<');
  // 이름 뒤 채움 글자(<)를 L·K·I 로 잘못 읽는 경우가 많아, 그런 글자가 4개 넘게 이어지면 거기서 자릅니다.
  const given = rest.join('<<').replace(/[<LKI]{4,}.*$/, '').replace(/</g, ' ').replace(/\s+/g, ' ').trim();

  return {
    surname: surname.replace(/</g, ' ').trim(),
    given,
    passportNo: no.v.replace(/</g, ''),
    nationality: nat,
    birth: ymd(birthRaw, false),
    sex: sexC,
    expiry: ymd(expRaw, true),
    checks: {
      passportNo: no.ok,
      birth: checkDigit(birthRaw) === digits(l2[19]),
      expiry: checkDigit(expRaw) === digits(l2[27]),
    },
  };
}
