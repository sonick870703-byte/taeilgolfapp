// 태일골프 라운지(대기실) 서버
//  - 회원 확인: 홈페이지 서버(taeil-erp)의 /api/login, /api/me 를 그대로 사용 (회원 정보는 여기 저장하지 않음)
//  - Room  : 방 하나 = Durable Object 하나 (광장 hub / 동네 dong-… / 모임 meet-…). 실시간 위치·채팅·파티
//  - Board : 라운지 전체에 하나. 닉네임·동네, 소모임 글·참가자, 신고, 이용 제한(SQLite)
// 위치(GPS)는 받지 않습니다. 동네는 회원이 시·군·구를 직접 고릅니다.
import { DurableObject } from 'cloudflare:workers';

const PREFIX = '/lounge';
const ROOM_RE = /^(hub|dong-[0-9A-Za-z가-힣_-]{1,40}|meet-\d{1,9})$/;
const STAFF = r => r === 'admin' || r === 'staff';
const now = () => Date.now();
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS } });
const fail = (status, error) => { throw Object.assign(new Error(error), { status }); };

// ---- 욕설·비하 표현 가리기 (완벽하지 않으므로 신고·제한과 함께 씀) ----
const BAD = ['씨발', '시발', '씨바', '씨빨', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '븅신', '개새', '좆', '존나', 'ㅈㄴ', '니애미', '느금', '엠창', '닥쳐', '꺼져', '미친놈', '미친년', '지랄', 'fuck', 'shit', 'bitch'];
const BAD_RE = new RegExp(BAD.map(w => w.split('').map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s._\\-*0-9]*')).join('|'), 'gi');
export const clean = s => s.replace(BAD_RE, m => '♡'.repeat(Math.min(4, [...m].length)));
// 전화번호·계좌처럼 보이는 숫자는 공개 채팅에서 가림 (사기·개인정보 노출 방지)
const PII_RE = /(01[016789][\s.-]?\d{3,4}[\s.-]?\d{4})|(\d{2,6}-\d{2,6}-\d{2,8})/g;
const maskPii = s => s.replace(PII_RE, '***-****-****');

// ---- 회원 확인 (홈페이지 서버에 물어봄) ----
async function erp(env, path, init = {}) {
  const req = new Request('https://tigc.co.kr' + path, init);
  const r = env.ERP ? await env.ERP.fetch(req) : await fetch((env.ERP_URL || 'https://tigc.co.kr') + path, init);
  let body = null;
  try { body = await r.json(); } catch { /* not json */ }
  return { status: r.status, body };
}
const userCache = new Map(); // token -> { user, exp }
async function userFrom(env, token) {
  if (!token || !/^[\w-]{10,80}$/.test(token)) return null;
  const c = userCache.get(token);
  if (c && c.exp > now()) return c.user;
  const r = await erp(env, '/api/me', { headers: { authorization: 'Bearer ' + token } });
  const u = r.status === 200 && r.body && r.body.user ? r.body.user : null;
  const user = u ? { id: String(u.id), name: str(u.name, 40), role: u.role || 'member' } : null;
  if (userCache.size > 2000) userCache.clear();
  userCache.set(token, { user, exp: now() + (user ? 5 * 60e3 : 20e3) });
  return user;
}
const board = env => env.BOARD.get(env.BOARD.idFromName('main'));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    let p = url.pathname;
    if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length) || '/';
    try {
      if (p === '/health') return json(200, { ok: true, server: 'taeil-lounge', at: now() });

      // 로그인: 홈페이지 회원 아이디(이메일)·비밀번호를 그대로 홈페이지 서버로 넘김
      if (p === '/api/login' && request.method === 'POST') {
        let b = {};
        try { b = await request.json(); } catch { fail(400, '잘못된 요청입니다.'); }
        const r = await erp(env, '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: str(b.email, 120), password: String(b.password || '').slice(0, 200) }) });
        if (r.status !== 200 || !r.body || !r.body.token) return json(r.status === 200 ? 401 : r.status, { error: (r.body && r.body.error) || '로그인하지 못했습니다.' });
        const u = r.body.user || {};
        return json(200, { token: r.body.token, user: { id: u.id, name: u.name, role: u.role } });
      }

      const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';

      // 실시간 방 접속 (WebSocket)
      if (p === '/ws') {
        if (request.headers.get('Upgrade') !== 'websocket') return json(426, { error: 'websocket only' });
        const room = url.searchParams.get('room') || 'hub';
        if (!ROOM_RE.test(room)) return json(400, { error: '없는 방입니다.' });
        const user = await userFrom(env, token);
        if (!user) return json(401, { error: '로그인이 필요합니다.' });
        const B = board(env);
        const ban = await B.banOf(user.id);
        if (ban) return json(403, { error: '이용이 제한된 계정입니다.', until: ban.until });
        const prof = await B.profile(user.id);
        if (!prof || !prof.nick) return json(409, { error: '닉네임을 먼저 정해 주세요.' });
        if (room.startsWith('meet-')) {
          const m = await B.meetup(+room.slice(5), user.id);
          if (!m || (!m.joined && m.host !== user.id && !STAFF(user.role))) return json(403, { error: '모임에 참가한 회원만 들어갈 수 있어요.' });
        }
        const stub = env.ROOM.get(env.ROOM.idFromName(room));
        const fwd = new Request(request);
        fwd.headers.set('x-lounge-user', encodeURIComponent(JSON.stringify({ id: user.id, role: user.role, nick: prof.nick, dong: prof.sgg ? `${prof.sido} ${prof.sgg}` : '', room })));
        return stub.fetch(fwd);
      }

      if (!p.startsWith('/api/')) return json(404, { error: 'not found' });
      const user = await userFrom(env, token);
      if (!user) return json(401, { error: '로그인이 필요합니다.' });
      const B = board(env);
      let body = {};
      if (request.method === 'POST') { try { body = await request.json(); } catch { body = {}; } }
      const ban = await B.banOf(user.id);
      if (ban && request.method === 'POST') return json(403, { error: '이용이 제한된 계정입니다.', until: ban.until });
      const q = url.searchParams;
      let m;
      if (p === '/api/me') return json(200, { user, profile: await B.profile(user.id), ban });
      if (p === '/api/profile' && request.method === 'POST') return json(200, { profile: await B.setProfile(user.id, body) });
      if (p === '/api/meetups' && request.method === 'GET') return json(200, { meetups: await B.meetups(str(q.get('sido'), 20), str(q.get('sgg'), 30), user.id) });
      if (p === '/api/meetups' && request.method === 'POST') return json(200, { meetup: await B.createMeetup(user.id, body) });
      if ((m = /^\/api\/meetups\/(\d+)$/.exec(p))) return json(200, { meetup: await B.meetup(+m[1], user.id, true) });
      if ((m = /^\/api\/meetups\/(\d+)\/(join|leave|close|delete)$/.exec(p)) && request.method === 'POST') return json(200, { meetup: await B.meetupAction(+m[1], m[2], user, body) });
      if (p === '/api/report' && request.method === 'POST') return json(200, await B.report(user.id, body, ''));
      if (p === '/api/rooms') return json(200, { rooms: await B.roomCounts() });
      // 관리 (홈페이지 ERP 관리자·직원 계정)
      if (p.startsWith('/api/admin/')) {
        if (!STAFF(user.role)) return json(403, { error: '관리자만 쓸 수 있어요.' });
        if (p === '/api/admin/reports') return json(200, { reports: await B.reports(), bans: await B.bans() });
        if (p === '/api/admin/ban' && request.method === 'POST') return json(200, await B.ban(str(body.uid, 60), +body.hours || 0, str(body.reason, 200), user.id));
        if (p === '/api/admin/unban' && request.method === 'POST') return json(200, await B.unban(str(body.uid, 60)));
        if (p === '/api/admin/report-done' && request.method === 'POST') return json(200, await B.reportDone(+body.id));
      }
      return json(404, { error: 'not found' });
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e && e.stack || e);
      return json(status, { error: status === 500 ? '서버 오류가 났어요. 잠시 후 다시 해 주세요.' : e.message });
    }
  },
};

// =====================================================================================
// Board: 닉네임·동네, 소모임, 신고, 이용 제한
// =====================================================================================
export class Board extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS profiles (uid TEXT PRIMARY KEY, nick TEXT, nick_l TEXT UNIQUE, sido TEXT, sgg TEXT, color TEXT, updated INTEGER);
      CREATE TABLE IF NOT EXISTS meetups (id INTEGER PRIMARY KEY AUTOINCREMENT, sido TEXT, sgg TEXT, kind TEXT, title TEXT, date TEXT, time TEXT, place TEXT, max INTEGER, body TEXT,
        host TEXT, host_nick TEXT, created INTEGER, status TEXT DEFAULT 'open');
      CREATE INDEX IF NOT EXISTS meetups_area ON meetups (sido, sgg, date);
      CREATE TABLE IF NOT EXISTS mm (mid INTEGER, uid TEXT, nick TEXT, at INTEGER, PRIMARY KEY (mid, uid));
      CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, reporter TEXT, reporter_nick TEXT, target TEXT, target_nick TEXT, reason TEXT, room TEXT, log TEXT, status TEXT DEFAULT 'new');
      CREATE TABLE IF NOT EXISTS bans (uid TEXT PRIMARY KEY, until INTEGER, reason TEXT, by TEXT, at INTEGER);
      CREATE TABLE IF NOT EXISTS rooms (room TEXT PRIMARY KEY, n INTEGER, at INTEGER);
    `);
  }
  one(q, ...a) { const r = this.sql.exec(q, ...a).toArray(); return r[0] || null; }
  all(q, ...a) { return this.sql.exec(q, ...a).toArray(); }

  banOf(uid) {
    const b = this.one('SELECT until, reason FROM bans WHERE uid = ?', uid);
    if (!b) return null;
    if (b.until && b.until < now()) { this.sql.exec('DELETE FROM bans WHERE uid = ?', uid); return null; }
    return b;
  }
  profile(uid) {
    const p = this.one('SELECT nick, sido, sgg, color FROM profiles WHERE uid = ?', uid);
    return p ? { nick: p.nick, sido: p.sido || '', sgg: p.sgg || '', color: p.color || '' } : null;
  }
  setProfile(uid, b) {
    const old = this.profile(uid) || {};
    const nick = b.nick !== undefined ? clean(str(b.nick, 12)) : old.nick;
    if (!nick || nick.length < 2) fail(400, '닉네임은 2~12자로 정해 주세요.');
    if (/♡|운영자|관리자|태일골프|admin/i.test(nick)) fail(400, '쓸 수 없는 닉네임이에요.');
    const taken = this.one('SELECT uid FROM profiles WHERE nick_l = ? AND uid <> ?', nick.toLowerCase(), uid);
    if (taken) fail(409, '이미 쓰는 닉네임이에요.');
    const sido = b.sido !== undefined ? str(b.sido, 20) : old.sido || '';
    const sgg = b.sgg !== undefined ? str(b.sgg, 30) : old.sgg || '';
    const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : old.color || '';
    this.sql.exec(`INSERT INTO profiles (uid, nick, nick_l, sido, sgg, color, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET nick = excluded.nick, nick_l = excluded.nick_l, sido = excluded.sido, sgg = excluded.sgg, color = excluded.color, updated = excluded.updated`,
      uid, nick, nick.toLowerCase(), sido, sgg, color, now());
    if (nick !== old.nick) { this.sql.exec('UPDATE mm SET nick = ? WHERE uid = ?', nick, uid); this.sql.exec('UPDATE meetups SET host_nick = ? WHERE host = ?', nick, uid); }
    return this.profile(uid);
  }

  // ---- 소모임 ----
  pub(m, uid, full) {
    const members = this.all('SELECT uid, nick FROM mm WHERE mid = ? ORDER BY at', m.id);
    const o = { id: m.id, sido: m.sido, sgg: m.sgg, kind: m.kind, title: m.title, date: m.date, time: m.time, place: m.place, max: m.max, body: m.body,
      hostNick: m.host_nick, mine: m.host === uid, host: m.host === uid ? uid : undefined, created: m.created, status: m.status,
      count: members.length, joined: members.some(x => x.uid === uid) };
    if (full) o.members = members.map(x => x.nick);
    return o;
  }
  meetups(sido, sgg, uid) {
    const today = new Date(now() + 9 * 3600e3).toISOString().slice(0, 10);
    const rows = sido
      ? (sgg ? this.all("SELECT * FROM meetups WHERE sido = ? AND sgg = ? AND date >= ? AND status <> 'deleted' ORDER BY date, time LIMIT 100", sido, sgg, today)
        : this.all("SELECT * FROM meetups WHERE sido = ? AND date >= ? AND status <> 'deleted' ORDER BY date, time LIMIT 100", sido, today))
      : this.all("SELECT * FROM meetups WHERE date >= ? AND status <> 'deleted' ORDER BY date, time LIMIT 100", today);
    return rows.map(m => this.pub(m, uid));
  }
  meetup(id, uid, full) {
    const m = this.one("SELECT * FROM meetups WHERE id = ? AND status <> 'deleted'", id);
    return m ? this.pub(m, uid, full) : null;
  }
  createMeetup(uid, b) {
    const prof = this.profile(uid);
    if (!prof || !prof.nick) fail(409, '닉네임을 먼저 정해 주세요.');
    const sido = str(b.sido, 20), sgg = str(b.sgg, 30);
    const title = clean(str(b.title, 40)), place = clean(str(b.place, 60)), body = maskPii(clean(str(b.body, 500)));
    const date = str(b.date, 10), time = str(b.time, 5), kind = str(b.kind, 10) || '골프';
    const max = Math.max(2, Math.min(50, Math.round(+b.max || 4)));
    if (!sido || !sgg) fail(400, '동네(시·군·구)를 골라 주세요.');
    if (title.length < 2) fail(400, '모임 이름을 적어 주세요.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, '날짜를 골라 주세요.');
    const today = new Date(now() + 9 * 3600e3).toISOString().slice(0, 10);
    if (date < today) fail(400, '오늘 이후 날짜로 골라 주세요.');
    if (time && !/^\d{2}:\d{2}$/.test(time)) fail(400, '시간 형식을 확인해 주세요.');
    if (!place) fail(400, '만날 장소를 적어 주세요. (공개된 장소 권장)');
    const recent = this.one('SELECT COUNT(*) AS n FROM meetups WHERE host = ? AND created > ?', uid, now() - 86400e3);
    if (recent && recent.n >= 5) fail(429, '모임은 하루 5개까지 만들 수 있어요.');
    const r = this.one(`INSERT INTO meetups (sido, sgg, kind, title, date, time, place, max, body, host, host_nick, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      sido, sgg, kind, title, date, time, place, max, body, uid, prof.nick, now());
    this.sql.exec('INSERT OR IGNORE INTO mm (mid, uid, nick, at) VALUES (?, ?, ?, ?)', r.id, uid, prof.nick, now());
    return this.meetup(r.id, uid, true);
  }
  meetupAction(id, act, user, b) {
    const m = this.one("SELECT * FROM meetups WHERE id = ? AND status <> 'deleted'", id);
    if (!m) fail(404, '모임을 찾을 수 없어요.');
    const uid = user.id;
    if (act === 'join') {
      if (m.status !== 'open') fail(400, '모집이 끝난 모임이에요.');
      const prof = this.profile(uid);
      if (!prof || !prof.nick) fail(409, '닉네임을 먼저 정해 주세요.');
      const n = this.one('SELECT COUNT(*) AS n FROM mm WHERE mid = ?', id).n;
      if (n >= m.max) fail(400, '자리가 다 찼어요.');
      this.sql.exec('INSERT OR IGNORE INTO mm (mid, uid, nick, at) VALUES (?, ?, ?, ?)', id, uid, prof.nick, now());
    } else if (act === 'leave') {
      if (m.host === uid) fail(400, '모임장은 나갈 수 없어요. 모임을 닫거나 지워 주세요.');
      this.sql.exec('DELETE FROM mm WHERE mid = ? AND uid = ?', id, uid);
    } else if (act === 'close') {
      if (m.host !== uid && !STAFF(user.role)) fail(403, '모임장만 할 수 있어요.');
      this.sql.exec("UPDATE meetups SET status = CASE status WHEN 'open' THEN 'closed' ELSE 'open' END WHERE id = ?", id);
    } else if (act === 'delete') {
      if (m.host !== uid && !STAFF(user.role)) fail(403, '모임장만 할 수 있어요.');
      this.sql.exec("UPDATE meetups SET status = 'deleted' WHERE id = ?", id);
      return null;
    }
    return this.meetup(id, uid, true);
  }

  // ---- 신고·제한 ----
  report(reporter, b, log) {
    const me = this.profile(reporter) || {};
    const reason = str(b.reason, 300);
    if (!reason) fail(400, '신고 이유를 적어 주세요.');
    const recent = this.one('SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND at > ?', reporter, now() - 3600e3);
    if (recent && recent.n >= 10) fail(429, '신고가 너무 많아요. 잠시 후 다시 해 주세요.');
    let target = str(b.target, 60), tnick = str(b.targetNick, 20);
    if (!target && b.meetup) { const m = this.one('SELECT host, host_nick FROM meetups WHERE id = ?', +b.meetup); if (m) { target = m.host; tnick = m.host_nick; } }
    if (target && !tnick) tnick = (this.profile(target) || {}).nick || '';
    this.sql.exec('INSERT INTO reports (at, reporter, reporter_nick, target, target_nick, reason, room, log) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      now(), reporter, me.nick || '', target, tnick, reason, str(b.room || (b.meetup ? 'meet-' + b.meetup : ''), 60), String(log || '').slice(0, 8000));
    return { ok: true };
  }
  reports() { return this.all('SELECT * FROM reports ORDER BY id DESC LIMIT 200'); }
  reportDone(id) { this.sql.exec("UPDATE reports SET status = 'done' WHERE id = ?", id); return { ok: true }; }
  bans() { return this.all('SELECT b.*, p.nick FROM bans b LEFT JOIN profiles p ON p.uid = b.uid ORDER BY at DESC'); }
  ban(uid, hours, reason, by) {
    if (!uid) fail(400, '대상을 골라 주세요.');
    const until = hours > 0 ? now() + hours * 3600e3 : 0; // 0 = 영구
    this.sql.exec('INSERT INTO bans (uid, until, reason, by, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET until = excluded.until, reason = excluded.reason, by = excluded.by, at = excluded.at', uid, until, reason, by, now());
    return { ok: true, until };
  }
  unban(uid) { this.sql.exec('DELETE FROM bans WHERE uid = ?', uid); return { ok: true }; }

  // 방별 접속 인원 (방이 알려 줌)
  roomCount(room, n) { if (n > 0) this.sql.exec('INSERT INTO rooms (room, n, at) VALUES (?, ?, ?) ON CONFLICT(room) DO UPDATE SET n = excluded.n, at = excluded.at', room, n, now()); else this.sql.exec('DELETE FROM rooms WHERE room = ?', room); }
  roomCounts() { return this.all('SELECT room, n FROM rooms WHERE at > ? ORDER BY n DESC LIMIT 50', now() - 10 * 60e3); }
}

// =====================================================================================
// Room: 실시간 방 (위치 10Hz 묶음 전송, 채팅, 파티, 신고, 직원 강퇴)
// =====================================================================================
const PARTY_MAX = { golf: 8 };
const GAMES = new Set(['golf', 'billiards']);
const ROOM_CAP = 50;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map(); // id -> player
    this.parties = {};
    this.nextId = 1;
    this.msgId = 1;
    this.log = []; // 최근 채팅 (신고 근거용, 메모리에만)
    this.tick = null;
  }
  send(p, m) { try { p.ws.send(JSON.stringify(m)); } catch { /* closed */ } }
  broadcast(m, except) { const s = JSON.stringify(m); for (const p of this.players.values()) if (p !== except) { try { p.ws.send(s); } catch { /* closed */ } } }
  pub(p) { return { id: p.id, uid: p.uid, name: p.nick, color: p.color, country: 'KR', dong: p.dong, staff: STAFF(p.role), s: p.state }; }
  party(g) { return this.parties[g] || (this.parties[g] = { slots: [], state: null }); }
  partyInfo(g) { const p = this.party(g); return { t: 'party', game: g, slots: p.slots, state: p.state }; }
  count() { this.ctx.waitUntil(board(this.env).roomCount(this.roomName, this.players.size).catch(() => {})); }

  async fetch(request) {
    const info = JSON.parse(decodeURIComponent(request.headers.get('x-lounge-user') || '%7B%7D'));
    if (!info.id) return new Response('no user', { status: 400 });
    this.roomName = info.room;
    if (this.players.size >= ROOM_CAP) return json(503, { error: '방이 가득 찼어요. 잠시 후 다시 들어와 주세요.' });
    const pair = new WebSocketPair();
    const ws = pair[1];
    ws.accept();
    // 같은 회원이 다른 창에서 또 들어오면 예전 접속을 닫음
    for (const old of this.players.values()) if (old.uid === info.id) { try { old.ws.close(4000, 'other'); } catch { /* */ } }
    const me = { id: this.nextId++, uid: info.id, role: info.role, nick: info.nick, dong: info.dong, ws, color: '#4aa3ff', state: null, dirty: false, chats: [] };
    ws.addEventListener('message', ev => this.onMessage(me, ev.data));
    const bye = () => this.leave(me);
    ws.addEventListener('close', bye);
    ws.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  leave(me) {
    if (!this.players.has(me.id) || this.players.get(me.id) !== me) return;
    this.players.delete(me.id);
    for (const g of Object.keys(this.parties)) {
      const p = this.parties[g], n = p.slots.length;
      p.slots = p.slots.filter(s => s.owner !== me.id);
      if (p.slots.length !== n) { if (!p.slots.length) p.state = null; this.broadcast(this.partyInfo(g)); }
    }
    this.broadcast({ t: 'leave', id: me.id });
    if (!this.players.size) { clearInterval(this.tick); this.tick = null; this.parties = {}; }
    this.count();
  }

  onMessage(me, raw) {
    if (typeof raw !== 'string' || raw.length > 16000) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'hello') {
      if (this.players.has(me.id)) return;
      me.color = /^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : me.color;
      this.players.set(me.id, me);
      this.send(me, { t: 'welcome', id: me.id, room: this.roomName, me: { uid: me.uid, name: me.nick, staff: STAFF(me.role) },
        players: [...this.players.values()].filter(p => p !== me).map(p => this.pub(p)), parties: Object.keys(this.parties).map(g => this.partyInfo(g)) });
      this.broadcast({ t: 'join', p: this.pub(me) }, me);
      if (!this.tick) this.tick = setInterval(() => this.flush(), 100);
      this.count();
      return;
    }
    if (!this.players.has(me.id)) return;
    switch (m.t) {
      case 'state': me.state = m.s; me.dirty = true; break;
      case 'chat': {
        let text = str(m.text, 200);
        if (!text) return;
        const t = now();
        me.chats = me.chats.filter(x => t - x < 10000);
        if (me.chats.length >= 6) return this.send(me, { t: 'sys', key: 'slowDown' });
        me.chats.push(t);
        text = maskPii(clean(text));
        this.log.push({ at: t, uid: me.uid, nick: me.nick, text });
        if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
        this.broadcast({ t: 'chat', id: this.msgId++, from: me.id, name: me.nick, lang: 'ko', text });
        break;
      }
      case 'event': this.broadcast({ t: 'event', from: me.id, name: me.nick, e: m.e }); break;
      case 'report': { // 방 안의 사람 신고: 서버가 가진 최근 대화를 근거로 붙임
        const target = [...this.players.values()].find(p => p.id === m.id) || null;
        const uid = target ? target.uid : str(m.uid, 60);
        const lines = this.log.filter(x => x.uid === uid || x.uid === me.uid).slice(-40).map(x => `${new Date(x.at + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')} ${x.nick}: ${x.text}`).join('\n');
        board(this.env).report(me.uid, { target: uid, targetNick: target ? target.nick : str(m.nick, 20), reason: m.reason, room: this.roomName }, lines)
          .then(() => this.send(me, { t: 'sys', key: 'reported' }), e => this.send(me, { t: 'sys', text: e.message || '신고하지 못했어요.' }));
        break;
      }
      case 'kick': { // 직원·관리자만: 내보내고 (선택) 이용 제한
        if (!STAFF(me.role)) return;
        const target = [...this.players.values()].find(p => p.id === m.id);
        if (!target) return;
        const hours = Math.max(0, Math.min(24 * 365, +m.hours || 0));
        const done = () => { this.send(target, { t: 'kicked', hours }); try { target.ws.close(4003, 'kicked'); } catch { /* */ } this.leave(target); };
        if (m.ban) board(this.env).ban(target.uid, hours, str(m.reason, 200) || '라운지 운영 정책 위반', me.uid).then(done, done); else done();
        this.send(me, { t: 'sys', text: `${target.nick}님을 내보냈어요.` });
        break;
      }
      case 'party_join': {
        if (!GAMES.has(m.game)) return;
        const p = this.party(m.game);
        if (p.slots.length >= (PARTY_MAX[m.game] || 4)) return this.send(me, { t: 'sys', key: 'partyFull' });
        const guest = m.guest ? clean(str(m.guest, 12)) : '';
        if (!guest && p.slots.some(s => s.owner === me.id && !s.guest)) return;
        p.slots.push({ owner: me.id, name: guest || me.nick, guest: !!guest });
        this.broadcast(this.partyInfo(m.game));
        break;
      }
      case 'party_leave': {
        if (!GAMES.has(m.game)) return;
        const p = this.party(m.game);
        p.slots = p.slots.filter((s, i) => s.owner !== me.id || (Number.isInteger(m.slot) && i !== m.slot));
        if (!p.slots.length) p.state = null;
        this.broadcast(this.partyInfo(m.game));
        break;
      }
      case 'party_state': {
        if (!GAMES.has(m.game)) return;
        const p = this.party(m.game);
        if (!p.slots.some(s => s.owner === me.id)) return;
        if (JSON.stringify(m.state ?? null).length > 12000) return;
        p.state = m.state ?? null;
        this.broadcast(this.partyInfo(m.game));
        break;
      }
      case 'party_msg': {
        if (!GAMES.has(m.game)) return;
        if (!this.party(m.game).slots.some(s => s.owner === me.id)) return;
        this.broadcast({ t: 'party_msg', game: m.game, from: me.id, d: m.d }, me);
        break;
      }
    }
  }

  flush() {
    const changed = [];
    for (const p of this.players.values()) if (p.dirty) { changed.push([p.id, p.state]); p.dirty = false; }
    if (changed.length) this.broadcast({ t: 'states', s: changed });
  }
}
