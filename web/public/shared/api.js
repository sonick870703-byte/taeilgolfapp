// 화면에서 쓰는 API 연결.
// 서버가 있으면 서버(/api)로, 없으면(미리보기) 브라우저 안의 데모 저장소로 같은 업무 로직을 돌립니다.
import { createApi, seed } from './core.js';

const TOKEN_KEY = 'taeil.token';
const mem = {};
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch { delete mem[k]; } },
};

let mode = null; // 'server' | 'demo'
let demoApi = null;

async function detect() {
  if (mode) return mode;
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const j = await r.json();
    mode = j && j.ok ? 'server' : 'demo';
  } catch { mode = 'demo'; }
  if (mode === 'demo') await initDemo();
  return mode;
}

async function initDemo() {
  const KEY = 'taeil.demo.v1';
  let data = {};
  try { data = JSON.parse(ls.get(KEY) || '{}'); } catch { data = {}; }
  const save = () => { try { ls.set(KEY, JSON.stringify(data)); } catch { /* 저장 공간 부족 시 메모리에만 유지 */ } };
  const store = {
    async all(col) { return Object.values(data[col] || {}).map(x => structuredClone(x)); },
    async get(col, id) { const v = (data[col] || {})[id]; return v ? structuredClone(v) : null; },
    async put(col, doc) { (data[col] = data[col] || {})[doc.id] = structuredClone(doc); save(); return doc; },
    async del(col, id) { if (data[col]) delete data[col][id]; save(); },
  };
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const deps = {
    now: () => Date.now(),
    randomId: n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(x => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join(''); },
    hash: async (pw, salt) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pw))),
  };
  await seed(store, deps, { adminEmail: 'admin@tigc.co.kr', adminPassword: 'demo1234', demo: !data.bookings });
  demoApi = createApi(store, deps);
}

export function resetDemo() { ls.del('taeil.demo.v1'); ls.del(TOKEN_KEY); location.reload(); }
export const getToken = () => ls.get(TOKEN_KEY);
export const setToken = t => (t ? ls.set(TOKEN_KEY, t) : ls.del(TOKEN_KEY));
export async function isDemo() { return (await detect()) === 'demo'; }

export async function call(method, path, body) {
  await detect();
  const [p, qs] = path.split('?');
  const token = getToken();
  if (mode === 'demo') {
    try {
      const out = await demoApi.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body: body ? structuredClone(body) : {}, token });
      return structuredClone(out);
    } catch (e) {
      if (e.status === 401 && token) setToken(null);
      throw e;
    }
  }
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && token) setToken(null);
    throw Object.assign(new Error(j.error || '요청을 처리하지 못했습니다.'), { status: r.status });
  }
  return j;
}

export const api = {
  get: p => call('GET', p),
  post: (p, b) => call('POST', p, b || {}),
  put: (p, b) => call('PUT', p, b || {}),
  patch: (p, b) => call('PATCH', p, b || {}),
  del: p => call('DELETE', p),
};
