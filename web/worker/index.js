// 태일골프 홈페이지 + ERP : Cloudflare Workers 판 (사무실 PC가 꺼져 있어도 24시간 동작)
// server.js 와 같은 업무 로직(public/shared/core.js)을 쓰고, 저장소만 바뀝니다.
//   데이터 : D1 (binding DB, 표 docs)      사진 : KV (binding UPLOADS)
//   화면 파일 : Workers Static Assets (binding ASSETS, ../public)
// 비밀 값 (wrangler secret): PASSPORT_KEY (base64 32바이트), ADMIN_PASSWORD
// 일반 값 (vars): ADMIN_EMAIL, ERP_HOSTS (예: erp.tigc.co.kr)
import crypto from 'node:crypto';
import { createApi, seed } from '../public/shared/core.js';

function makeStore(db) {
  return {
    async all(col) { const r = await db.prepare('SELECT json FROM docs WHERE col = ?').bind(col).all(); return r.results.map(x => JSON.parse(x.json)); },
    async get(col, id) { const r = await db.prepare('SELECT json FROM docs WHERE col = ? AND id = ?').bind(col, String(id)).first(); return r ? JSON.parse(r.json) : null; },
    async put(col, doc) { await db.prepare('INSERT INTO docs (col, id, json) VALUES (?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET json = excluded.json').bind(col, String(doc.id), JSON.stringify(doc)).run(); return doc; },
    async del(col, id) { await db.prepare('DELETE FROM docs WHERE col = ? AND id = ?').bind(col, String(id)).run(); },
  };
}

function makeDeps(env) {
  const key = env.PASSPORT_KEY ? Buffer.from(env.PASSPORT_KEY, 'base64') : null;
  const needKey = () => { if (!key || key.length !== 32) throw Object.assign(new Error('여권 암호 열쇠(PASSPORT_KEY)가 설정되지 않았습니다.'), { status: 500 }); };
  return {
    httpFetch: (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(30000) }),
    now: () => Date.now(),
    randomId: n => crypto.randomBytes(n).toString('base64url').slice(0, n),
    // 무료 요금제의 짧은 계산 시간에 맞춰 새 비밀번호는 가벼운 scrypt(N=2048)로 저장합니다 ('w.' 표시).
    // 사무실 PC에서 옮겨 온 비밀번호(표시 없음)는 처음 로그인할 때 한 번만 원래 방식으로 확인하고 바꿔 저장합니다.
    saltPrefix: 'w.',
    hash: (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 32, salt.startsWith('w.') ? { N: 2048 } : {}, (e, k) => (e ? no(e) : ok(k.toString('hex'))))),
    seal(text) {
      needKey();
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
      return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
    },
    unseal(box) {
      needKey();
      const [, iv, tag, data] = String(box).split(':');
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
    },
    async saveImage(dataUrl, size) {
      const m = /^data:image\/(webp|jpeg|png);base64,(.+)$/.exec(dataUrl || '');
      if (!m) throw Object.assign(new Error('사진 형식을 확인해 주세요.'), { status: 400 });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 3 * 1024 * 1024) throw Object.assign(new Error('사진이 너무 큽니다.'), { status: 400 });
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const name = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}-${size}.${ext}`;
      await env.UPLOADS.put(name, buf, { metadata: { type: 'image/' + m[1] } });
      return '/uploads/' + name;
    },
  };
}

// 한 번 켜진 작업 공간(isolate)에서는 api 를 다시 만들지 않습니다
let ready = null;
function init(env) {
  if (!ready) ready = (async () => {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (col, id))').run();
    const store = makeStore(env.DB), deps = makeDeps(env);
    await seed(store, deps, { adminEmail: env.ADMIN_EMAIL || 'admin@tigc.co.kr', adminPassword: env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url'), demo: false });
    return { api: createApi(store, deps), store };
  })().catch(e => { ready = null; throw e; });
  return ready;
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

async function erpHosts(env, store) {
  const s = await store.get('settings', 'site');
  const fromSettings = ((s && s.domains) || []).filter(d => d.purpose === 'erp').map(d => d.host.toLowerCase());
  return new Set([...(env.ERP_HOSTS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean), ...fromSettings]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const { api, store } = await init(env);
      if (url.pathname.startsWith('/api/')) {
        let body = {};
        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
          const text = await request.text();
          if (text.length > 12 * 1024 * 1024) return json(413, { error: '요청이 너무 큽니다.' });
          try { body = text ? JSON.parse(text) : {}; } catch { return json(400, { error: '잘못된 요청입니다.' }); }
        }
        const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || null;
        const out = await api.handle({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, token });
        return json(200, out);
      }
      if (url.pathname.startsWith('/uploads/')) {
        const name = url.pathname.slice('/uploads/'.length);
        if (!/^[\w.-]+$/.test(name)) return new Response('없는 파일입니다.', { status: 404 });
        const { value, metadata } = await env.UPLOADS.getWithMetadata(name, 'arrayBuffer');
        if (!value) return new Response('없는 파일입니다.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
        return new Response(value, { headers: { 'Content-Type': (metadata && metadata.type) || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
      }
      // erp 주소로 들어오면 ERP 화면
      let p = url.pathname;
      if ((await erpHosts(env, store)).has(url.hostname.toLowerCase()) && !/^\/(erp|shared|assets|vendor)(\/|$)/.test(p)) {
        p = '/erp' + p;
        const u2 = new URL(url); u2.pathname = p;
        return env.ASSETS.fetch(new Request(u2, request));
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return json(status, { error: status === 500 ? '서버 오류가 났습니다. 잠시 후 다시 시도해 주세요.' : e.message });
    }
  },
};
