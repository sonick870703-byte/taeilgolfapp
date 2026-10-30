// 태일골프 홈페이지 + ERP 서버 (Node 22 이상, 추가 설치 없음)
//   node server.js
// 환경 변수: PORT, DATA_DIR, ADMIN_EMAIL, ADMIN_PASSWORD, ERP_HOSTS (예: erp.tigc.co.kr), PASSPORT_KEY (없으면 DATA_DIR/passport.key 자동 생성)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createApi, seed } from './public/shared/core.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const PORT = Number(process.env.PORT || 8080);
fs.mkdirSync(UPLOADS, { recursive: true });

// ---------- 저장소 (SQLite 한 파일) ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'taeil.db'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (col, id))');
const qAll = db.prepare('SELECT json FROM docs WHERE col = ?');
const qGet = db.prepare('SELECT json FROM docs WHERE col = ? AND id = ?');
const qPut = db.prepare('INSERT INTO docs (col, id, json) VALUES (?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET json = excluded.json');
const qDel = db.prepare('DELETE FROM docs WHERE col = ? AND id = ?');
const store = {
  async all(col) { return qAll.all(col).map(r => JSON.parse(r.json)); },
  async get(col, id) { const r = qGet.get(col, String(id)); return r ? JSON.parse(r.json) : null; },
  async put(col, doc) { qPut.run(col, String(doc.id), JSON.stringify(doc)); return doc; },
  async del(col, id) { qDel.run(col, String(id)); },
};

// 여권번호 암호화 열쇠 (AES-256-GCM). 열쇠 파일을 잃으면 저장된 여권번호를 읽을 수 없으니 백업할 때 taeil.db 와 같이 보관하세요.
const KEY_FILE = path.join(DATA_DIR, 'passport.key');
if (!process.env.PASSPORT_KEY && !fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
const PASSPORT_KEY = Buffer.from(process.env.PASSPORT_KEY || fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
if (PASSPORT_KEY.length !== 32) throw new Error('PASSPORT_KEY 는 base64 로 된 32바이트 값이어야 합니다.');

const deps = {
  httpFetch: (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(30000) }),
  now: () => Date.now(),
  seal(text) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', PASSPORT_KEY, iv);
    const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  },
  unseal(box) {
    const [, iv, tag, data] = String(box).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', PASSPORT_KEY, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  },
  randomId: n => crypto.randomBytes(n).toString('base64url').slice(0, n),
  hash: (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 32, (e, k) => (e ? no(e) : ok(k.toString('hex'))))),
  async saveImage(dataUrl, size) {
    const m = /^data:image\/(webp|jpeg|png);base64,(.+)$/.exec(dataUrl || '');
    if (!m) throw Object.assign(new Error('사진 형식을 확인해 주세요.'), { status: 400 });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) throw Object.assign(new Error('사진이 너무 큽니다.'), { status: 400 });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}-${size}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(UPLOADS, name), buf);
    return '/uploads/' + name;
  },
};

const api = createApi(store, deps);
await seed(store, deps, {
  adminEmail: process.env.ADMIN_EMAIL || 'admin@tigc.co.kr',
  adminPassword: process.env.ADMIN_PASSWORD || 'change-me-now',
  demo: process.env.DEMO === '1',
});

// ---------- HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const ERP_HOSTS = (process.env.ERP_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

async function erpHosts() {
  const s = await store.get('settings', 'site');
  const fromSettings = ((s && s.domains) || []).filter(d => d.purpose === 'erp').map(d => d.host.toLowerCase());
  return new Set([...ERP_HOSTS, ...fromSettings]);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers });
  res.end(body);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((ok, no) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { no(Object.assign(new Error('요청이 너무 큽니다.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { no(Object.assign(new Error('잘못된 요청입니다.'), { status: 400 })); } });
    req.on('error', no);
  });
}

function serveFile(res, file, cache) {
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) return send(res, 404, '없는 페이지입니다.', { 'Content-Type': 'text/plain; charset=utf-8' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache || 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  try {
    if (url.pathname.startsWith('/api/')) {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
      const out = await api.handle({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, token });
      return send(res, 200, JSON.stringify(out), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    if (url.pathname.startsWith('/uploads/')) {
      const name = path.basename(url.pathname);
      return serveFile(res, path.join(UPLOADS, name), 'public, max-age=31536000, immutable');
    }
    // erp.tigc.co.kr 로 들어오면 ERP 화면
    let p = decodeURIComponent(url.pathname);
    if ((await erpHosts()).has(host) && !p.startsWith('/erp') && !p.startsWith('/shared') && !p.startsWith('/assets')) p = '/erp' + p;
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(PUBLIC, path.normalize(p));
    if (!file.startsWith(PUBLIC)) return send(res, 403, '');
    if (!path.extname(file)) return serveFile(res, path.join(file, 'index.html'));
    return serveFile(res, file);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    return send(res, status, JSON.stringify({ error: status === 500 ? '서버 오류가 났습니다. 잠시 후 다시 시도해 주세요.' : e.message }), { 'Content-Type': 'application/json; charset=utf-8' });
  }
});

server.listen(PORT, () => console.log(`태일골프 서버: http://localhost:${PORT}  (ERP: http://localhost:${PORT}/erp/)`));
