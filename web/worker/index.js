// 태일골프 홈페이지 + ERP : Cloudflare Workers 판 (사무실 PC가 꺼져 있어도 24시간 동작)
// server.js 와 같은 업무 로직(public/shared/core.js)을 쓰고, 저장소만 바뀝니다.
//   데이터 : D1 (binding DB, 표 docs)      사진 : KV (binding UPLOADS)
//   화면 파일 : Workers Static Assets (binding ASSETS, ../public)
// 비밀 값 (wrangler secret): PASSPORT_KEY (base64 32바이트), ADMIN_PASSWORD
// 일반 값 (vars): ADMIN_EMAIL, ERP_HOSTS (예: erp.tigc.co.kr)
import crypto from 'node:crypto';
import { createApi, seed } from '../public/shared/core.js';
import PostalMime from './vendor/postal-mime/postal-mime.js';

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
    // 메일 본문·첨부 보관 (KV, 'mail/…' 이름은 /uploads/ 로 공개되지 않음)
    blobPut: (key, val, type) => env.UPLOADS.put(key, val, type ? { metadata: { type } } : undefined),
    blobGet: (key, kind) => env.UPLOADS.get(key, kind),
    toBase64: buf => Buffer.from(buf).toString('base64'),
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

// 사무실 PC 데이터 옮기기: 설치 프로그램이 KV에 올린 묶음(__import__/...)을 D1에 넣습니다.
// 진행 상황은 D1(meta 표)에 남겨, 여러 곳에서 동시에 실행돼도 같은 묶음을 두 번 넣지 않습니다.
// 한 번에 몇 묶음씩만 넣고, 남아 있으면 503(옮기는 중)으로 답해 다음 접속에서 이어 갑니다.
const PER_REQUEST = 8;
async function importFromKv(env) {
  const meta = await env.UPLOADS.get('__import__/meta', 'json');
  if (!meta) return true;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)').run();
  const key = 'import:' + meta.id;
  const row = await env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind(key).first();
  let done = row ? Number(row.v) : 0;
  for (let n = 0; n < PER_REQUEST && done < meta.parts; n++) {
    const part = await env.UPLOADS.get(`__import__/${meta.id}/${done + 1}`);
    if (part == null) throw new Error(`옮길 데이터 ${done + 1}번 묶음이 없습니다.`);
    await env.DB.batch([
      env.DB.prepare("INSERT OR REPLACE INTO docs (col, id, json) SELECT json_extract(value, '$.col'), json_extract(value, '$.id'), json_extract(value, '$.json') FROM json_each(?)").bind(part),
      env.DB.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(key, String(++done)),
    ]);
  }
  if (done < meta.parts) return false;
  // 다 넣었으면 KV의 임시 묶음은 지웁니다 (지우기가 늦게 퍼져도 meta 표 덕분에 다시 넣지 않음)
  for (let i = 1; i <= meta.parts; i++) await env.UPLOADS.delete(`__import__/${meta.id}/${i}`).catch(() => {});
  await env.UPLOADS.delete('__import__/meta').catch(() => {});
  return true;
}

// 한 번 켜진 작업 공간(isolate)에서는 api 를 다시 만들지 않습니다
let ready = null;
function init(env) {
  if (!ready) ready = (async () => {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (col, id))').run();
    if (!(await importFromKv(env))) throw Object.assign(new Error('사무실 PC 데이터를 옮기는 중입니다. 잠시 후 다시 열어 주세요.'), { status: 503 });
    const store = makeStore(env.DB), deps = makeDeps(env);
    await seed(store, deps, { adminEmail: env.ADMIN_EMAIL || 'admin@tigc.co.kr', adminPassword: env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url'), demo: false });
    return { api: createApi(store, deps), store };
  })().catch(e => { ready = null; throw e; });
  return ready;
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Taeil-Server': 'cloudflare' } });

async function erpHosts(env, store) {
  const s = await store.get('settings', 'site');
  const fromSettings = ((s && s.domains) || []).filter(d => d.purpose === 'erp').map(d => d.host.toLowerCase());
  return new Set([...(env.ERP_HOSTS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean), ...fromSettings]);
}

// ----- 회사 메일 받기: Cloudflare 메일 라우팅 → 이 Worker → ERP 메일함 -----
const strip = (h = '') => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
async function receiveMail(message, env) {
  const { store } = await init(env);
  const raw = await new Response(message.raw).arrayBuffer();
  const mail = await PostalMime.parse(raw);
  const id = 'm_' + crypto.randomBytes(10).toString('hex');
  const atts = [];
  for (const [n, a] of (mail.attachments || []).entries()) {
    const size = a.content ? a.content.byteLength : 0;
    if (!size || size > 20 * 1024 * 1024 || n >= 20) continue;
    const key = `mail/${id}/att${n}`;
    await env.UPLOADS.put(key, a.content, { metadata: { type: a.mimeType || 'application/octet-stream' } });
    atts.push({ key, name: a.filename || `첨부${n + 1}`, type: a.mimeType || 'application/octet-stream', size });
  }
  const text = (mail.text || strip(mail.html)).slice(0, 200000);
  await env.UPLOADS.put(`mail/${id}/body`, JSON.stringify({ text, html: (mail.html || '').slice(0, 1000000) }));
  await store.put('mails', { id, at: Date.now(), folder: 'inbox', read: false,
    from: { name: (mail.from && mail.from.name) || '', address: (mail.from && mail.from.address) || message.from },
    to: [message.to], subject: (mail.subject || '(제목 없음)').slice(0, 300), snippet: text.replace(/\s+/g, ' ').trim().slice(0, 140), messageId: mail.messageId || '', atts });
  // 백업 사본 (Cloudflare에서 '확인된 주소'로 등록한 곳만 가능)
  if (env.MAIL_FORWARD) await message.forward(env.MAIL_FORWARD).catch(e => console.error('forward', e && e.message));
}

export default {
  async email(message, env) {
    try { await receiveMail(message, env); }
    catch (e) {
      console.error('mail', e);
      if (env.MAIL_FORWARD) { await message.forward(env.MAIL_FORWARD); return; }
      // 읽기에 실패해도 메일을 돌려보내지 않고, 메일함에 '열 수 없는 메일'로 남깁니다
      try {
        const { store } = await init(env);
        await store.put('mails', { id: 'm_' + crypto.randomBytes(10).toString('hex'), at: Date.now(), folder: 'inbox', read: false,
          from: { name: '', address: message.from }, to: [message.to], subject: message.headers.get('subject') || '(제목 없음)',
          snippet: '메일 내용을 읽지 못했습니다: ' + String(e && e.message || e).slice(0, 100), messageId: '', atts: [] });
      } catch (e2) { console.error('mail fallback', e2); throw e; }
    }
  },
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
        const res = json(200, out);
        // ERP '도메인 연결'의 연결 확인이 다른 주소(tigc.co.kr 등)에서 읽을 수 있게 합니다
        if (url.pathname === '/api/health') res.headers.set('Access-Control-Allow-Origin', '*');
        return res;
      }
      if (url.pathname.startsWith('/uploads/')) {
        const name = url.pathname.slice('/uploads/'.length);
        if (!/^[\w.-]+$/.test(name)) return new Response('없는 파일입니다.', { status: 404 });
        const { value, metadata } = await env.UPLOADS.getWithMetadata(name, 'arrayBuffer');
        if (!value) return new Response('없는 파일입니다.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
        return new Response(value, { headers: { 'Content-Type': (metadata && metadata.type) || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'X-Taeil-Server': 'cloudflare' } });
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
