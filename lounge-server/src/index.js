// 태일골프 라운지(대기실) 서버
//  - 회원 확인: 홈페이지 서버(taeil-erp)의 /api/login, /api/me 를 그대로 사용 (회원 정보는 여기 저장하지 않음)
//  - Room  : 방 하나 = Durable Object 하나 (광장 hub / 동네 dong-… / 모임 meet-…). 실시간 위치·채팅·파티
//  - Board : 라운지 전체에 하나. 닉네임·동네, 동호회(가입·운영진·게시판·정모), 신고, 이용 제한(SQLite)
// 위치(GPS)는 받지 않습니다. 동네는 회원이 시·군·구를 직접 고릅니다.
// 여권 안전 등록 (회원 별도 동의): 입장 전에 여권 사진을 받아 기기에서 기계판독줄(MRZ)을 읽고,
//   서버에는 ① 여권번호 대신 되돌릴 수 없는 암호값(HMAC) ② 만료 연월·성인 여부 ③ 여권 사진(AES-GCM 암호화)만 저장.
//   비밀 키는 이 서버(Durable Object) 안에서 처음 한 번 만들어 보관하며 코드·저장소에는 없음.
//   사진은 관리자만, 이유를 적어야 볼 수 있고 볼 때마다 기록이 남음. 등록을 지우면 바로 파기 (이용 제한자는 제한 종료 후 1년).
//   쓰임 = 성인 본인 확인, 한 여권 = 한 계정, 이용 제한자 재가입 차단, 범죄·사고 시 법에 따른 요청 대응.
import { DurableObject } from 'cloudflare:workers';

const PREFIX = '/lounge';
const ROOM_RE = /^(hub|dong-[0-9A-Za-z가-힣_-]{1,40}|meet-\d{1,9}|club-\d{1,9}|course-m?\d{1,6}_m?\d{1,6})$/;
const STAFF = r => r === 'admin' || r === 'staff';
// 프로그램 관리자 모드 (1.4.71): 지구본 첫 화면에서 관리자 비밀번호로 들어오면, 프로그램 안에 암호화돼 있던 관리자 키로
// 라운지 관리자 세션을 받음. 저장소에는 키의 SHA-256 값만 있음 (키 자체는 없음).
const ADMIN_KEY_SHA256 = '6e98594b52fbc7639367b3d2ddd79e910d06982a43dac2d41275913fb5f6442e';
const ADMIN_UID = 'taeil-admin', ADMIN_NICK = '태일골프 관리자';
const sha256hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
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
  if (token.startsWith('adm_')) {
    const ok = await board(env).adminSession(token);
    const user = ok ? { id: ADMIN_UID, name: ADMIN_NICK, role: 'admin' } : null;
    userCache.set(token, { user, exp: now() + (user ? 5 * 60e3 : 20e3) });
    return user;
  }
  const r = await erp(env, '/api/me', { headers: { authorization: 'Bearer ' + token } });
  const u = r.status === 200 && r.body && r.body.user ? r.body.user : null;
  const user = u ? { id: String(u.id), name: str(u.name, 40), role: u.role || 'member' } : null;
  if (userCache.size > 2000) userCache.clear();
  userCache.set(token, { user, exp: now() + (user ? 5 * 60e3 : 20e3) });
  return user;
}
const board = env => env.BOARD.get(env.BOARD.idFromName('main'));
const PASS_CONSENT = '2026-11-01';
const today = () => new Date(now() + 9 * 3600e3).toISOString().slice(0, 10);
const CLUB_CATS = ['골프', '스크린골프', '파크골프', '연습장', '골프여행', '당구', '낚시', '운동·산책', '친목', '기타'];
const CLUB_EMOJI = ['⛳', '🏌', '🏌️‍♀️', '🎯', '🏆', '✈', '🎱', '🎣', '🚶', '☕', '🌳', '🔥', '⭐', '🍀', '🐯', '🦅'];
const AGES = ['누구나', '20·30대', '30·40대', '40·50대', '50·60대', '60대 이상'];

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

      // 프로그램 관리자 모드 → 라운지 관리자 세션 (30일)
      if (p === '/api/admin-login' && request.method === 'POST') {
        let b = {};
        try { b = await request.json(); } catch { fail(400, '잘못된 요청입니다.'); }
        const key = String(b.key || '').slice(0, 200);
        if (!key || (await sha256hex(key)) !== ADMIN_KEY_SHA256) return json(401, { error: '관리자 키가 맞지 않습니다.' });
        const t = await board(env).adminLogin();
        return json(200, { token: t, user: { id: ADMIN_UID, name: ADMIN_NICK, role: 'admin' } });
      }
      if (p === '/api/admin-logout' && request.method === 'POST') {
        const t = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
        if (t.startsWith('adm_')) { userCache.delete(t); await board(env).adminLogout(t); }
        return json(200, { ok: true });
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
        if (!STAFF(user.role) && !(await B.passport(user.id)).ok) return json(428, { error: '여권 안전 등록을 먼저 해 주세요.', need: 'passport' });
        const prof = await B.profile(user.id);
        if (!prof || !prof.nick) return json(409, { error: '닉네임을 먼저 정해 주세요.' });
        if (room.startsWith('meet-')) {
          const m = await B.meetup(+room.slice(5), user.id);
          if (!m || (!m.joined && m.host !== user.id && !STAFF(user.role))) return json(403, { error: '모임에 참가한 회원만 들어갈 수 있어요.' });
        }
        if (room.startsWith('club-')) {
          const role = await B.clubRole(+room.slice(5), user.id);
          if ((!role || role === 'pending') && !STAFF(user.role)) return json(403, { error: '동호회 회원만 들어갈 수 있어요.' });
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
      if (p === '/api/me') return json(200, { user, profile: await B.profile(user.id), ban, passport: await B.passport(user.id) });
      // 라운지 설정 (공지·포인트 규칙·상점 가격): 누구나 읽고, 관리자만 바꿈
      if (p === '/api/config') return json(200, { config: await B.config() });
      if (p === '/api/passport' && request.method === 'POST') return json(200, { passport: await B.setPassport(user.id, body) });
      if (p === '/api/passport/delete' && request.method === 'POST') return json(200, await B.delPassport(user.id));
      // 여기부터는 여권 안전 등록을 마친 회원만
      if (p !== '/api/profile' && p !== '/api/report' && !STAFF(user.role) && !(await B.passport(user.id)).ok) return json(428, { error: '여권 안전 등록을 먼저 해 주세요.', need: 'passport' });
      if (p === '/api/profile' && request.method === 'POST') return json(200, { profile: await B.setProfile(user.id, body) });
      if (p === '/api/meetups' && request.method === 'GET') return json(200, { meetups: await B.meetups(str(q.get('sido'), 20), str(q.get('sgg'), 30), user.id) });
      if (p === '/api/meetups' && request.method === 'POST') return json(200, { meetup: await B.createMeetup(user.id, body) });
      if ((m = /^\/api\/meetups\/(\d+)$/.exec(p))) return json(200, { meetup: await B.meetup(+m[1], user.id, true) });
      if ((m = /^\/api\/meetups\/(\d+)\/(join|leave|close|delete)$/.exec(p)) && request.method === 'POST') return json(200, { meetup: await B.meetupAction(+m[1], m[2], user, body) });
      // 동호회 (가입해서 계속 활동하는 동네 모임)
      if (p === '/api/clubs' && request.method === 'GET') return json(200, { clubs: await B.clubs({ sido: str(q.get('sido'), 20), sgg: str(q.get('sgg'), 30), cat: str(q.get('cat'), 12), q: str(q.get('q'), 20), mine: q.get('mine') === '1', sort: str(q.get('sort'), 8) }, user.id) });
      if (p === '/api/clubs' && request.method === 'POST') return json(200, { club: await B.createClub(user.id, body) });
      if ((m = /^\/api\/clubs\/(\d+)$/.exec(p))) return json(200, { club: await B.club(+m[1], user, true) });
      if ((m = /^\/api\/clubs\/(\d+)\/(join|leave|edit|delete|member|post|unpost|meetup)$/.exec(p)) && request.method === 'POST') return json(200, await B.clubAction(+m[1], m[2], user, body));
      if (p === '/api/report' && request.method === 'POST') return json(200, await B.report(user.id, body, ''));
      if (p === '/api/rooms') return json(200, { rooms: await B.roomCounts() });
      // 관리 (홈페이지 ERP 관리자·직원 계정)
      if (p.startsWith('/api/admin/')) {
        if (!STAFF(user.role)) return json(403, { error: '관리자만 쓸 수 있어요.' });
        if (p === '/api/admin/reports') return json(200, { reports: await B.reports(), bans: await B.bans(), pass: await B.passStats() });
        if (p === '/api/admin/passport-photo' && request.method === 'POST') return json(200, await B.adminPhoto(user.id, str(body.uid, 60), str(body.reason, 200)));
        if (p === '/api/admin/ban' && request.method === 'POST') return json(200, await B.ban(str(body.uid, 60), +body.hours || 0, str(body.reason, 200), user.id));
        if (p === '/api/admin/unban' && request.method === 'POST') return json(200, await B.unban(str(body.uid, 60)));
        if (p === '/api/admin/report-done' && request.method === 'POST') return json(200, await B.reportDone(+body.id));
        if (p === '/api/admin/config' && request.method === 'POST') return json(200, { config: await B.setConfig(body) });
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
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS passports (uid TEXT PRIMARY KEY, h TEXT UNIQUE, exp TEXT, adult INTEGER, at INTEGER, cv TEXT, seen INTEGER);
      CREATE TABLE IF NOT EXISTS banned_h (h TEXT PRIMARY KEY, until INTEGER, at INTEGER);
      CREATE TABLE IF NOT EXISTS pphoto (uid TEXT PRIMARY KEY, iv TEXT, data TEXT, at INTEGER, keep INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS plog (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, admin TEXT, target TEXT, reason TEXT);
      CREATE TABLE IF NOT EXISTS clubs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, name_l TEXT UNIQUE, cat TEXT, sido TEXT, sgg TEXT, intro TEXT, question TEXT,
        mode TEXT DEFAULT 'open', max INTEGER, emoji TEXT, color TEXT, ages TEXT, owner TEXT, created INTEGER, active INTEGER, status TEXT DEFAULT 'on');
      CREATE INDEX IF NOT EXISTS clubs_area ON clubs (sido, sgg);
      CREATE TABLE IF NOT EXISTS cm (cid INTEGER, uid TEXT, nick TEXT, role TEXT, at INTEGER, msg TEXT, PRIMARY KEY (cid, uid));
      CREATE INDEX IF NOT EXISTS cm_uid ON cm (uid);
      CREATE TABLE IF NOT EXISTS cposts (id INTEGER PRIMARY KEY AUTOINCREMENT, cid INTEGER, uid TEXT, nick TEXT, notice INTEGER DEFAULT 0, body TEXT, created INTEGER);
      CREATE INDEX IF NOT EXISTS cposts_c ON cposts (cid, id);
    `);
    // 예전 표에 동호회 번호 칸 추가 (이미 있으면 그냥 넘어감)
    try { this.sql.exec('ALTER TABLE meetups ADD COLUMN club INTEGER'); } catch { /* exists */ }
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
    if (uid !== ADMIN_UID && /♡|운영자|관리자|태일골프|admin/i.test(nick)) fail(400, '쓸 수 없는 닉네임이에요.');
    const taken = this.one('SELECT uid FROM profiles WHERE nick_l = ? AND uid <> ?', nick.toLowerCase(), uid);
    if (taken) fail(409, '이미 쓰는 닉네임이에요.');
    const sido = b.sido !== undefined ? str(b.sido, 20) : old.sido || '';
    const sgg = b.sgg !== undefined ? str(b.sgg, 30) : old.sgg || '';
    const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : old.color || '';
    this.sql.exec(`INSERT INTO profiles (uid, nick, nick_l, sido, sgg, color, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET nick = excluded.nick, nick_l = excluded.nick_l, sido = excluded.sido, sgg = excluded.sgg, color = excluded.color, updated = excluded.updated`,
      uid, nick, nick.toLowerCase(), sido, sgg, color, now());
    if (nick !== old.nick) { for (const t of ['mm', 'cm', 'cposts']) this.sql.exec(`UPDATE ${t} SET nick = ? WHERE uid = ?`, nick, uid); this.sql.exec('UPDATE meetups SET host_nick = ? WHERE host = ?', nick, uid); }
    return this.profile(uid);
  }

  // ---- 소모임 ----
  pub(m, uid, full) {
    const members = this.all('SELECT uid, nick FROM mm WHERE mid = ? ORDER BY at', m.id);
    const o = { id: m.id, sido: m.sido, sgg: m.sgg, kind: m.kind, title: m.title, date: m.date, time: m.time, place: m.place, max: m.max, body: m.body,
      club: m.club || 0, hostNick: m.host_nick, mine: m.host === uid, host: m.host === uid ? uid : undefined, created: m.created, status: m.status,
      count: members.length, joined: members.some(x => x.uid === uid) };
    if (full) o.members = members.map(x => x.nick);
    return o;
  }
  meetups(sido, sgg, uid) {
    const today = new Date(now() + 9 * 3600e3).toISOString().slice(0, 10);
    const rows = sido
      ? (sgg ? this.all("SELECT * FROM meetups WHERE sido = ? AND sgg = ? AND date >= ? AND status <> 'deleted' AND club IS NULL ORDER BY date, time LIMIT 100", sido, sgg, today)
        : this.all("SELECT * FROM meetups WHERE sido = ? AND date >= ? AND status <> 'deleted' AND club IS NULL ORDER BY date, time LIMIT 100", sido, today))
      : this.all("SELECT * FROM meetups WHERE date >= ? AND status <> 'deleted' AND club IS NULL ORDER BY date, time LIMIT 100", today);
    return rows.map(m => this.pub(m, uid));
  }
  meetup(id, uid, full) {
    const m = this.one("SELECT * FROM meetups WHERE id = ? AND status <> 'deleted'", id);
    return m ? this.pub(m, uid, full) : null;
  }
  createMeetup(uid, b, club = null) {
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
    const r = this.one(`INSERT INTO meetups (sido, sgg, kind, title, date, time, place, max, body, host, host_nick, created, club) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      sido, sgg, kind, title, date, time, place, max, body, uid, prof.nick, now(), club);
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
      if (m.club) { const r = this.clubRole(m.club, uid); if (!r || r === 'pending') fail(403, '동호회 회원만 참석할 수 있어요.'); }
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
      if (m.host !== uid && !STAFF(user.role) && !(m.club && /owner|manager/.test(this.clubRole(m.club, uid) || ''))) fail(403, '모임장만 할 수 있어요.');
      this.sql.exec("UPDATE meetups SET status = 'deleted' WHERE id = ?", id);
      return null;
    }
    return this.meetup(id, uid, true);
  }

  // ---- 동호회 ----
  // 역할: owner(모임장) · manager(운영진) · member · pending(가입 신청 중)
  clubRole(cid, uid) { const r = this.one('SELECT role FROM cm WHERE cid = ? AND uid = ?', cid, uid); return r ? r.role : null; }
  clubRow(cid) { return this.one("SELECT * FROM clubs WHERE id = ? AND status = 'on'", cid); }
  clubPub(c, uid) {
    const n = c.n ?? this.one("SELECT COUNT(*) AS n FROM cm WHERE cid = ? AND role <> 'pending'", c.id).n;
    const next = this.one("SELECT date, time, title FROM meetups WHERE club = ? AND status <> 'deleted' AND date >= ? ORDER BY date, time LIMIT 1", c.id, today());
    return { id: c.id, name: c.name, cat: c.cat, sido: c.sido, sgg: c.sgg, intro: c.intro, mode: c.mode, max: c.max, emoji: c.emoji, color: c.color, ages: c.ages,
      count: n, created: c.created, active: c.active, role: uid ? this.clubRole(c.id, uid) : null, next };
  }
  clubs(f, uid) {
    let rows;
    const N = "(SELECT COUNT(*) FROM cm WHERE cm.cid = c.id AND cm.role <> 'pending') AS n";
    if (f.mine) rows = this.all(`SELECT c.*, ${N} FROM clubs c JOIN cm ON cm.cid = c.id AND cm.uid = ? WHERE c.status = 'on' ORDER BY c.active DESC LIMIT 60`, uid);
    else {
      const w = ["c.status = 'on'"], a = [];
      if (f.sido) { w.push('c.sido = ?'); a.push(f.sido); }
      if (f.sgg) { w.push('c.sgg = ?'); a.push(f.sgg); }
      if (f.cat) { w.push('c.cat = ?'); a.push(f.cat); }
      if (f.q) { w.push('(c.name_l LIKE ? OR c.intro LIKE ?)'); a.push(`%${f.q.toLowerCase()}%`, `%${f.q}%`); }
      const order = f.sort === 'new' ? 'c.created DESC' : f.sort === 'big' ? 'n DESC' : 'c.active DESC';
      rows = this.all(`SELECT c.*, ${N} FROM clubs c WHERE ${w.join(' AND ')} ORDER BY ${order} LIMIT 80`, ...a);
    }
    return rows.map(c => this.clubPub(c, uid));
  }
  club(cid, user, full) {
    const c = this.clubRow(cid);
    if (!c) return null;
    const o = this.clubPub(c, user.id);
    o.question = c.question;
    const member = (o.role && o.role !== 'pending') || STAFF(user.role);
    const mgr = /owner|manager/.test(o.role || '') || STAFF(user.role);
    o.staff = STAFF(user.role);
    const ms = this.all("SELECT uid, nick, role, at, msg FROM cm WHERE cid = ? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, at", cid);
    o.leaders = ms.filter(x => x.role === 'owner' || x.role === 'manager').map(x => ({ nick: x.nick, role: x.role }));
    // 공지는 누구나, 나머지 글·회원·일정은 회원만
    o.notices = this.all('SELECT id, nick, body, created FROM cposts WHERE cid = ? AND notice = 1 ORDER BY id DESC LIMIT 3', cid);
    if (full && member) {
      o.members = ms.filter(x => x.role !== 'pending').map(x => ({ uid: mgr ? x.uid : undefined, nick: x.nick, role: x.role, at: x.at, me: x.uid === user.id }));
      if (mgr) o.pending = ms.filter(x => x.role === 'pending').map(x => ({ uid: x.uid, nick: x.nick, at: x.at, msg: x.msg }));
      o.posts = this.all('SELECT id, uid, nick, notice, body, created FROM cposts WHERE cid = ? ORDER BY id DESC LIMIT 50', cid)
        .map(p => ({ id: p.id, nick: p.nick, notice: p.notice, body: p.body, created: p.created, mine: p.uid === user.id }));
      o.meetups = this.all("SELECT * FROM meetups WHERE club = ? AND status <> 'deleted' AND date >= ? ORDER BY date, time LIMIT 20", cid, today()).map(m => this.pub(m, user.id, true));
    }
    return o;
  }
  clubFields(b, old = {}) {
    const name = clean(str(b.name ?? old.name, 20));
    if ([...name].length < 2) fail(400, '동호회 이름은 2~20자로 지어 주세요.');
    if (/♡|운영자|관리자|태일골프|공식/.test(name)) fail(400, '쓸 수 없는 이름이에요.');
    const sido = str(b.sido ?? old.sido, 20), sgg = str(b.sgg ?? old.sgg, 30);
    if (!sido || !sgg) fail(400, '활동 동네(시·군·구)를 골라 주세요.');
    const intro = maskPii(clean(str(b.intro ?? old.intro, 1000)));
    if ([...intro].length < 10) fail(400, '동호회 소개를 10자 이상 적어 주세요.');
    return {
      name, sido, sgg, intro,
      cat: CLUB_CATS.includes(b.cat) ? b.cat : old.cat || '골프',
      question: maskPii(clean(str(b.question ?? old.question ?? '', 100))),
      mode: b.mode === 'approve' || b.mode === 'open' ? b.mode : old.mode || 'open',
      max: Math.max(5, Math.min(300, Math.round(+(b.max ?? old.max) || 100))),
      emoji: CLUB_EMOJI.includes(b.emoji) ? b.emoji : old.emoji || '⛳',
      color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : old.color || '#2b8a3e',
      ages: AGES.includes(b.ages) ? b.ages : old.ages || '누구나',
    };
  }
  createClub(uid, b) {
    const prof = this.profile(uid);
    if (!prof || !prof.nick) fail(409, '닉네임을 먼저 정해 주세요.');
    const own = this.one("SELECT COUNT(*) AS n FROM cm JOIN clubs c ON c.id = cm.cid AND c.status = 'on' WHERE cm.uid = ? AND cm.role = 'owner'", uid).n;
    if (own >= 3) fail(400, '동호회는 한 사람이 3개까지 만들 수 있어요.');
    const f = this.clubFields(b);
    if (this.one("SELECT id FROM clubs WHERE name_l = ?", f.name.toLowerCase())) fail(409, '같은 이름의 동호회가 있어요. 다른 이름으로 지어 주세요.');
    const r = this.one(`INSERT INTO clubs (name, name_l, cat, sido, sgg, intro, question, mode, max, emoji, color, ages, owner, created, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      f.name, f.name.toLowerCase(), f.cat, f.sido, f.sgg, f.intro, f.question, f.mode, f.max, f.emoji, f.color, f.ages, uid, now(), now());
    this.sql.exec("INSERT INTO cm (cid, uid, nick, role, at) VALUES (?, ?, ?, 'owner', ?)", r.id, uid, prof.nick, now());
    return this.club(r.id, { id: uid }, true);
  }
  touch(cid) { this.sql.exec('UPDATE clubs SET active = ? WHERE id = ?', now(), cid); }
  clubAction(cid, act, user, b) {
    const c = this.clubRow(cid);
    if (!c) fail(404, '없어진 동호회예요.');
    const uid = user.id, role = this.clubRole(cid, uid), staff = STAFF(user.role);
    const owner = role === 'owner' || staff, mgr = owner || role === 'manager', member = (role && role !== 'pending') || staff;
    const prof = this.profile(uid);
    if (act === 'join') {
      if (!prof || !prof.nick) fail(409, '닉네임을 먼저 정해 주세요.');
      if (role) fail(400, role === 'pending' ? '가입 신청을 이미 했어요. 운영진 승인을 기다려 주세요.' : '이미 가입한 동호회예요.');
      const mine = this.one("SELECT COUNT(*) AS n FROM cm WHERE uid = ?", uid).n;
      if (mine >= 30) fail(400, '동호회는 30개까지 가입할 수 있어요.');
      const n = this.one("SELECT COUNT(*) AS n FROM cm WHERE cid = ? AND role <> 'pending'", cid).n;
      if (n >= c.max) fail(400, '정원이 다 찼어요.');
      const msg = maskPii(clean(str(b.msg, 200)));
      this.sql.exec('INSERT INTO cm (cid, uid, nick, role, at, msg) VALUES (?, ?, ?, ?, ?, ?)', cid, uid, prof.nick, c.mode === 'approve' ? 'pending' : 'member', now(), msg);
      if (c.mode !== 'approve') this.touch(cid);
    } else if (act === 'leave') {
      if (!role) fail(400, '가입하지 않은 동호회예요.');
      if (role === 'owner') fail(400, '모임장은 다른 회원에게 모임장을 넘긴 뒤 나갈 수 있어요.');
      this.sql.exec('DELETE FROM cm WHERE cid = ? AND uid = ?', cid, uid);
    } else if (act === 'edit') {
      if (!owner) fail(403, '모임장만 바꿀 수 있어요.');
      const f = this.clubFields(b, c);
      if (f.name !== c.name && this.one('SELECT id FROM clubs WHERE name_l = ? AND id <> ?', f.name.toLowerCase(), cid)) fail(409, '같은 이름의 동호회가 있어요.');
      this.sql.exec('UPDATE clubs SET name = ?, name_l = ?, cat = ?, sido = ?, sgg = ?, intro = ?, question = ?, mode = ?, max = ?, emoji = ?, color = ?, ages = ? WHERE id = ?',
        f.name, f.name.toLowerCase(), f.cat, f.sido, f.sgg, f.intro, f.question, f.mode, f.max, f.emoji, f.color, f.ages, cid);
    } else if (act === 'delete') {
      if (!owner) fail(403, '모임장만 없앨 수 있어요.');
      this.sql.exec("UPDATE clubs SET status = 'deleted', name_l = NULL WHERE id = ?", cid);
      this.sql.exec('DELETE FROM cm WHERE cid = ?', cid);
      this.sql.exec("UPDATE meetups SET status = 'deleted' WHERE club = ?", cid);
      return { club: null };
    } else if (act === 'member') {
      // 운영진: 승인·거절·내보내기 / 모임장: 운영진 지정·해제, 모임장 넘기기
      if (!mgr) fail(403, '운영진만 할 수 있어요.');
      const t = str(b.uid, 60), tr = this.clubRole(cid, t), a = str(b.act, 12);
      if (!tr) fail(404, '회원을 찾을 수 없어요.');
      if (tr === 'owner') fail(400, '모임장에게는 할 수 없어요.');
      if (a === 'approve' || a === 'reject') {
        if (tr !== 'pending') fail(400, '가입 신청한 회원이 아니에요.');
        if (a === 'approve') {
          const n = this.one("SELECT COUNT(*) AS n FROM cm WHERE cid = ? AND role <> 'pending'", cid).n;
          if (n >= c.max) fail(400, '정원이 다 찼어요.');
          this.sql.exec("UPDATE cm SET role = 'member', at = ? WHERE cid = ? AND uid = ?", now(), cid, t); this.touch(cid);
        } else this.sql.exec('DELETE FROM cm WHERE cid = ? AND uid = ?', cid, t);
      } else if (a === 'kick') {
        if (tr === 'manager' && !owner) fail(403, '운영진은 모임장만 내보낼 수 있어요.');
        this.sql.exec('DELETE FROM cm WHERE cid = ? AND uid = ?', cid, t);
      } else if (a === 'manager' || a === 'member') {
        if (!owner) fail(403, '모임장만 할 수 있어요.');
        if (tr === 'pending') fail(400, '먼저 가입을 승인해 주세요.');
        if (a === 'manager' && this.one("SELECT COUNT(*) AS n FROM cm WHERE cid = ? AND role = 'manager'", cid).n >= 10) fail(400, '운영진은 10명까지예요.');
        this.sql.exec('UPDATE cm SET role = ? WHERE cid = ? AND uid = ?', a, cid, t);
      } else if (a === 'owner') {
        if (role !== 'owner') fail(403, '모임장만 넘길 수 있어요.');
        if (tr === 'pending') fail(400, '가입한 회원에게만 넘길 수 있어요.');
        this.sql.exec("UPDATE cm SET role = 'manager' WHERE cid = ? AND uid = ?", cid, uid);
        this.sql.exec("UPDATE cm SET role = 'owner' WHERE cid = ? AND uid = ?", cid, t);
        this.sql.exec('UPDATE clubs SET owner = ? WHERE id = ?', t, cid);
      } else fail(400, '알 수 없는 요청이에요.');
    } else if (act === 'post') {
      if (!member) fail(403, '동호회 회원만 글을 쓸 수 있어요.');
      const body = maskPii(clean(str(b.body, 1000)));
      if (!body) fail(400, '내용을 적어 주세요.');
      const recent = this.one('SELECT COUNT(*) AS n FROM cposts WHERE uid = ? AND created > ?', uid, now() - 3600e3).n;
      if (recent >= 30) fail(429, '글이 너무 많아요. 잠시 후 다시 써 주세요.');
      this.sql.exec('INSERT INTO cposts (cid, uid, nick, notice, body, created) VALUES (?, ?, ?, ?, ?, ?)', cid, uid, (prof || {}).nick || '', b.notice && mgr ? 1 : 0, body, now());
      this.touch(cid);
    } else if (act === 'unpost') {
      const p = this.one('SELECT uid FROM cposts WHERE id = ? AND cid = ?', +b.id, cid);
      if (!p) fail(404, '지워진 글이에요.');
      if (p.uid !== uid && !mgr) fail(403, '쓴 사람이나 운영진만 지울 수 있어요.');
      this.sql.exec('DELETE FROM cposts WHERE id = ?', +b.id);
    } else if (act === 'meetup') {
      if (!member) fail(403, '동호회 회원만 일정을 만들 수 있어요.');
      if (c.mode === 'approve' && !mgr) fail(403, '이 동호회는 운영진만 정모 일정을 만들 수 있어요.');
      this.createMeetup(uid, { ...b, sido: b.sido || c.sido, sgg: b.sgg || c.sgg, kind: c.cat }, cid);
      this.touch(cid);
    }
    return { club: this.club(cid, user, true) };
  }

  // ---- 여권 안전 등록 ----
  // 비밀 키: 처음 한 번 이 서버(Durable Object) 안에서 만들어 보관. 코드·저장소에는 없음.
  pepper() {
    const r = this.one("SELECT v FROM kv WHERE k = 'pepper'");
    if (r) return r.v;
    const b = crypto.getRandomValues(new Uint8Array(32)), v = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    this.sql.exec("INSERT OR IGNORE INTO kv (k, v) VALUES ('pepper', ?)", v);
    return this.one("SELECT v FROM kv WHERE k = 'pepper'").v;
  }
  async passHash(no, birth) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.pepper()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${no}|${birth}`));
    return [...new Uint8Array(sig)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  passport(uid) {
    if (!this._sw || this._sw < now() - 36e5) { this._sw = now(); this.sweep(); }
    const r = this.one('SELECT exp, adult, at, seen FROM passports WHERE uid = ?', uid);
    if (!r) return { ok: false };
    if (!r.seen || r.seen < now() - 864e5) this.sql.exec('UPDATE passports SET seen = ? WHERE uid = ?', now(), uid);
    const valid = r.exp >= today().slice(0, 7);
    return { ok: valid && !!r.adult, exp: r.exp, at: r.at, expired: !valid };
  }
  async setPassport(uid, b) {
    const no = String(b.no || '').toUpperCase().replace(/[\s-]/g, '');
    const birth = str(b.birth, 10), exp = str(b.exp, 10);
    if (!(b.agree && b.agreeId)) fail(400, '필수 동의 두 가지에 모두 체크해 주세요.');
    const photo = String(b.photo || '');
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo)) fail(400, '여권 사진을 찍어 올려 주세요.');
    if (photo.length > 1_600_000) fail(413, '사진이 너무 커요. 다시 찍어 주세요.');
    if (!/^[A-Z0-9]{7,9}$/.test(no) || !/[0-9]/.test(no)) fail(400, '여권번호를 여권에 적힌 그대로 넣어 주세요. (예: M12345678)');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || !/^\d{4}-\d{2}-\d{2}$/.test(exp)) fail(400, '생년월일과 여권 만료일을 골라 주세요.');
    const t = today();
    if (exp < t) fail(400, '만료된 여권은 등록할 수 없어요. 유효한 여권으로 등록해 주세요.');
    const [y, m, d] = birth.split('-').map(Number), [ty, tm, td] = t.split('-').map(Number);
    const age = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
    if (age < 0 || age > 120) fail(400, '생년월일을 확인해 주세요.');
    if (age < 19) fail(403, '대기실은 회원끼리 직접 만나는 곳이라 만 19세 이상만 이용할 수 있어요.');
    const h = await this.passHash(no, birth);
    const ban = this.one('SELECT until FROM banned_h WHERE h = ?', h);
    if (ban && (!ban.until || ban.until > now())) fail(403, '이용이 제한된 여권이에요. 문의는 태일골프 카카오톡 채널로 해 주세요.');
    const other = this.one('SELECT uid FROM passports WHERE h = ? AND uid <> ?', h, uid);
    if (other) fail(409, '이 여권은 이미 다른 계정에 등록돼 있어요. 한 여권은 한 계정에만 등록할 수 있어요.');
    this.sql.exec('INSERT INTO passports (uid, h, exp, adult, at, cv, seen) VALUES (?, ?, ?, 1, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET h = excluded.h, exp = excluded.exp, adult = 1, at = excluded.at, cv = excluded.cv, seen = excluded.seen',
      uid, h, exp.slice(0, 7), now(), PASS_CONSENT, now());
    const enc = await this.seal(photo);
    this.sql.exec('INSERT INTO pphoto (uid, iv, data, at, keep) VALUES (?, ?, ?, ?, 0) ON CONFLICT(uid) DO UPDATE SET iv = excluded.iv, data = excluded.data, at = excluded.at, keep = 0', uid, enc.iv, enc.data, now());
    return this.passport(uid);
  }
  delPassport(uid) {
    // 이용 제한 중이면 사진·암호값은 제한이 끝나고 1년까지 남김 (영구 제한은 5년+1년), 아니면 바로 파기
    const ban = this.banOf(uid);
    this.sql.exec('DELETE FROM passports WHERE uid = ?', uid);
    if (ban) this.sql.exec('UPDATE pphoto SET keep = ? WHERE uid = ?', (ban.until || now() + 5 * 365 * 864e5) + 365 * 864e5, uid);
    else this.sql.exec('DELETE FROM pphoto WHERE uid = ?', uid);
    return { ok: true };
  }
  // 오래된 기록 정리: 끝난 지 1년 지난 이용 제한 암호값(영구 제한은 5년)·보관 기간 끝난 사진·1년 동안 대기실을 안 쓴 회원의 여권 정보 파기
  sweep() {
    const Y = 365 * 864e5;
    this.sql.exec('DELETE FROM banned_h WHERE (until > 0 AND until < ?) OR (until = 0 AND at < ?)', now() - Y, now() - 5 * Y);
    for (const r of this.all('SELECT uid FROM passports WHERE seen < ?', now() - Y)) this.delPassport(r.uid);
    this.sql.exec('DELETE FROM pphoto WHERE keep > 0 AND keep < ? AND uid NOT IN (SELECT uid FROM passports)', now());
  }
  // 사진 암호화 (AES-GCM, 키는 이 서버 안에서만)
  async aes() {
    let r = this.one("SELECT v FROM kv WHERE k = 'photokey'");
    if (!r) { const b = crypto.getRandomValues(new Uint8Array(32)); this.sql.exec("INSERT OR IGNORE INTO kv (k, v) VALUES ('photokey', ?)", btoa(String.fromCharCode(...b))); r = this.one("SELECT v FROM kv WHERE k = 'photokey'"); }
    return crypto.subtle.importKey('raw', Uint8Array.from(atob(r.v), c => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async seal(text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.aes(), new TextEncoder().encode(text)));
    let bin = ''; for (let i = 0; i < ct.length; i += 0x8000) bin += String.fromCharCode(...ct.subarray(i, i + 0x8000));
    return { iv: btoa(String.fromCharCode(...iv)), data: btoa(bin) };
  }
  // 관리자: 사진 보기 (이유 필수, 기록 남김)
  async adminPhoto(admin, uid, reason) {
    if (!reason || reason.length < 4) fail(400, '열람 이유를 적어 주세요. (예: 신고 #12 확인)');
    const r = this.one('SELECT iv, data, at FROM pphoto WHERE uid = ?', uid);
    if (!r) fail(404, '저장된 여권 사진이 없어요.');
    this.sql.exec('INSERT INTO plog (at, admin, target, reason) VALUES (?, ?, ?, ?)', now(), admin, uid, reason);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(atob(r.iv), c => c.charCodeAt(0)) }, await this.aes(), Uint8Array.from(atob(r.data), c => c.charCodeAt(0)));
    const p = this.one('SELECT exp, at FROM passports WHERE uid = ?', uid) || {};
    return { photo: new TextDecoder().decode(pt), at: r.at, exp: p.exp || '', nick: (this.profile(uid) || {}).nick || '' };
  }
  passStats() {
    return { count: this.one('SELECT COUNT(*) AS n FROM passports').n, kept: this.one('SELECT COUNT(*) AS n FROM pphoto WHERE keep > 0').n,
      log: this.all('SELECT l.*, p.nick AS tnick FROM plog l LEFT JOIN profiles p ON p.uid = l.target ORDER BY l.id DESC LIMIT 50') };
  }

  // ---- 신고·제한 ----
  report(reporter, b, log) {
    const me = this.profile(reporter) || {};
    const reason = str(b.reason, 300);
    if (!reason) fail(400, '신고 이유를 적어 주세요.');
    const recent = this.one('SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND at > ?', reporter, now() - 3600e3);
    if (recent && recent.n >= 10) fail(429, '신고가 너무 많아요. 잠시 후 다시 해 주세요.');
    let target = str(b.target, 60), tnick = str(b.targetNick, 20);
    if (!target && b.club) { const c = this.one('SELECT owner FROM clubs WHERE id = ?', +b.club); if (c) target = c.owner; }
    if (!target && b.meetup) { const m = this.one('SELECT host, host_nick FROM meetups WHERE id = ?', +b.meetup); if (m) { target = m.host; tnick = m.host_nick; } }
    if (target && !tnick) tnick = (this.profile(target) || {}).nick || '';
    this.sql.exec('INSERT INTO reports (at, reporter, reporter_nick, target, target_nick, reason, room, log) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      now(), reporter, me.nick || '', target, tnick, reason, str(b.room || (b.club ? 'club-' + b.club : b.meetup ? 'meet-' + b.meetup : ''), 60), String(log || '').slice(0, 8000));
    return { ok: true };
  }
  // ---- 프로그램 관리자 세션 ----
  adminLogin() {
    const t = 'adm_' + [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
    this.sql.exec("DELETE FROM kv WHERE k LIKE 'adm:%' AND CAST(v AS INTEGER) < ?", now());
    this.sql.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', 'adm:' + t, String(now() + 30 * 86400e3));
    if (!this.profile(ADMIN_UID)) this.sql.exec('INSERT OR IGNORE INTO profiles (uid, nick, nick_l, sido, sgg, color, updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ADMIN_UID, ADMIN_NICK, ADMIN_NICK.toLowerCase(), '서울', '종로구', '#2b8a3e', now());
    return t;
  }
  adminSession(t) { const r = this.one('SELECT v FROM kv WHERE k = ?', 'adm:' + t); return !!r && +r.v > now(); }
  adminLogout(t) { this.sql.exec('DELETE FROM kv WHERE k = ?', 'adm:' + t); return { ok: true }; }
  // ---- 라운지 설정 (관리자가 바꿈) ----
  config() { const r = this.one("SELECT v FROM kv WHERE k = 'cfg'"); try { return r ? JSON.parse(r.v) : {}; } catch { return {}; } }
  setConfig(b) {
    const old = this.config(), c = {};
    const int = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    c.notice = clean(str(b.notice ?? old.notice, 300));
    c.dayCap = int(b.dayCap ?? old.dayCap, 0, 100000, 30);
    c.start = int(b.start ?? old.start, 0, 10000000, 100);
    c.mul = Math.max(0, Math.min(100, +(b.mul ?? old.mul) || 0)) || 1;
    c.shop = {};
    const src = b.shop && typeof b.shop === 'object' ? b.shop : old.shop || {};
    for (const [id, v] of Object.entries(src).slice(0, 200)) {
      if (!/^[a-z]{1,4}\d{1,3}$/.test(id) || !v || typeof v !== 'object') continue;
      const o = {};
      if (v.price !== undefined && v.price !== '' && v.price !== null) o.price = int(v.price, 0, 100000000, 0);
      if (v.ko) o.ko = clean(str(v.ko, 30));
      if (v.hidden) o.hidden = 1;
      if (Object.keys(o).length) c.shop[id] = o;
    }
    c.at = now();
    this.sql.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', 'cfg', JSON.stringify(c));
    return c;
  }
  reports() { return this.all('SELECT * FROM reports ORDER BY id DESC LIMIT 200'); }
  reportDone(id) { this.sql.exec("UPDATE reports SET status = 'done' WHERE id = ?", id); return { ok: true }; }
  bans() { return this.all('SELECT b.*, p.nick FROM bans b LEFT JOIN profiles p ON p.uid = b.uid ORDER BY at DESC'); }
  ban(uid, hours, reason, by) {
    if (!uid) fail(400, '대상을 골라 주세요.');
    const until = hours > 0 ? now() + hours * 3600e3 : 0; // 0 = 영구
    this.sql.exec('INSERT INTO bans (uid, until, reason, by, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET until = excluded.until, reason = excluded.reason, by = excluded.by, at = excluded.at', uid, until, reason, by, now());
    // 같은 여권으로 새 계정을 만들어 다시 들어오지 못하게
    const pp = this.one('SELECT h FROM passports WHERE uid = ?', uid);
    if (pp) this.sql.exec('INSERT INTO banned_h (h, until, at) VALUES (?, ?, ?) ON CONFLICT(h) DO UPDATE SET until = excluded.until, at = excluded.at', pp.h, until, now());
    this.sweep();
    return { ok: true, until };
  }
  unban(uid) {
    this.sql.exec('DELETE FROM bans WHERE uid = ?', uid);
    const pp = this.one('SELECT h FROM passports WHERE uid = ?', uid);
    if (pp) this.sql.exec('DELETE FROM banned_h WHERE h = ?', pp.h);
    return { ok: true };
  }

  // 방별 접속 인원 (방이 알려 줌)
  roomCount(room, n) { if (n > 0) this.sql.exec('INSERT INTO rooms (room, n, at) VALUES (?, ?, ?) ON CONFLICT(room) DO UPDATE SET n = excluded.n, at = excluded.at', room, n, now()); else this.sql.exec('DELETE FROM rooms WHERE room = ?', room); }
  roomCounts() { return this.all('SELECT room, n FROM rooms WHERE at > ? ORDER BY n DESC LIMIT 50', now() - 10 * 60e3); }
}

// =====================================================================================
// Room: 실시간 방 (위치 10Hz 묶음 전송, 채팅, 파티, 신고, 직원 강퇴)
// =====================================================================================
const PARTY_MAX = { golf: 8 };
const GAMES = new Set(['golf', 'billiards']);
// 게임 자리: 'golf' (방 전체가 같이 쓰는 자리) 또는 'golf~3' (3번 파티만의 자리)
const gameOf = k => { const [g, id] = String(k || '').split('~'); return GAMES.has(g) && (id === undefined || /^\d{1,6}$/.test(id)) ? g : null; };
const GROUP_MAX = 8;
const ROOM_CAP = 50;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map(); // id -> player
    this.parties = {};
    this.groups = new Map(); // 파티(같이 노는 무리): id -> { id, leader, members: [playerId] }
    this.nextGid = 1;
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
    const me = { id: this.nextId++, uid: info.id, role: info.role, nick: info.nick, dong: info.dong, ws, color: '#4aa3ff', state: null, dirty: false, chats: [], gid: 0, invites: new Map(), sent: new Map() };
    ws.addEventListener('message', ev => this.onMessage(me, ev.data));
    const bye = () => this.leave(me);
    ws.addEventListener('close', bye);
    ws.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  leave(me) {
    if (!this.players.has(me.id) || this.players.get(me.id) !== me) return;
    this.players.delete(me.id);
    this.groupLeave(me, true);
    for (const g of Object.keys(this.parties)) {
      const p = this.parties[g], n = p.slots.length;
      p.slots = p.slots.filter(s => s.owner !== me.id);
      if (p.slots.length !== n) { if (!p.slots.length) p.state = null; this.partySend(g, this.partyInfo(g)); }
    }
    this.broadcast({ t: 'leave', id: me.id });
    if (!this.players.size) { clearInterval(this.tick); this.tick = null; this.parties = {}; this.groups.clear(); }
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
        players: [...this.players.values()].filter(p => p !== me).map(p => this.pub(p)), parties: Object.keys(this.parties).filter(g => !g.includes('~')).map(g => this.partyInfo(g)) });
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
      // ---- 파티: 초대 → 수락/거절, 나가기, 내보내기, 파티 채팅, 같이 게임 시작 ----
      case 'ginv': {
        const to = this.players.get(+m.id);
        if (!to || to === me) return;
        const g = this.groups.get(me.gid);
        if (g && g.members.includes(to.id)) return this.send(me, { t: 'sys', text: `${to.nick}님은 이미 같은 파티예요.` });
        if (g && g.members.length >= GROUP_MAX) return this.send(me, { t: 'sys', text: `파티는 ${GROUP_MAX}명까지예요.` });
        const last = me.sent.get(to.id) || 0;
        if (now() - last < 15000) return this.send(me, { t: 'sys', text: '잠시 후 다시 초대해 주세요.' });
        me.sent.set(to.id, now());
        to.invites.set(me.id, now());
        this.send(to, { t: 'ginv', from: me.id, name: me.nick, n: g ? g.members.length : 1 });
        this.send(me, { t: 'sys', text: `${to.nick}님에게 파티 초대를 보냈어요.` });
        break;
      }
      case 'gans': {
        const from = this.players.get(+m.from);
        const at = me.invites.get(+m.from);
        me.invites.delete(+m.from);
        if (!from || !at || now() - at > 90000) return this.send(me, { t: 'sys', text: '지난 초대예요.' });
        if (!m.ok) return this.send(from, { t: 'sys', text: `${me.nick}님이 파티 초대를 거절했어요.` });
        let g = this.groups.get(from.gid);
        if (!g) { g = { id: this.nextGid++, leader: from.id, members: [from.id] }; this.groups.set(g.id, g); from.gid = g.id; }
        if (g.members.length >= GROUP_MAX) return this.send(me, { t: 'sys', text: '파티 자리가 다 찼어요.' });
        if (me.gid && me.gid !== g.id) this.groupLeave(me);
        if (!g.members.includes(me.id)) g.members.push(me.id);
        me.gid = g.id;
        this.groupSend(g, { t: 'sys', text: `🎉 ${me.nick}님이 파티에 들어왔어요.` });
        this.groupInfo(g);
        break;
      }
      case 'gleave': this.groupLeave(me); break;
      case 'gkick': {
        const g = this.groups.get(me.gid), t = this.players.get(+m.id);
        if (!g || g.leader !== me.id || !t || t.gid !== g.id || t === me) return;
        this.send(t, { t: 'sys', text: '파티에서 나가게 됐어요.' });
        this.groupLeave(t);
        break;
      }
      case 'glead': {
        const g = this.groups.get(me.gid);
        if (!g || g.leader !== me.id || !g.members.includes(+m.id)) return;
        g.leader = +m.id; this.groupInfo(g);
        break;
      }
      case 'gchat': {
        const g = this.groups.get(me.gid);
        let text = str(m.text, 200);
        if (!g || !text) return;
        const t = now();
        me.chats = me.chats.filter(x => t - x < 10000);
        if (me.chats.length >= 6) return this.send(me, { t: 'sys', key: 'slowDown' });
        me.chats.push(t);
        text = maskPii(clean(text));
        this.log.push({ at: t, uid: me.uid, nick: me.nick, text: '(파티) ' + text });
        this.groupSend(g, { t: 'chat', id: this.msgId++, from: me.id, name: me.nick, lang: 'ko', text, party: true });
        break;
      }
      case 'gplay': { // 파티장이 게임을 고르면 파티원 모두 같은 게임 자리로
        const g = this.groups.get(me.gid);
        if (!g || g.leader !== me.id || !GAMES.has(m.game)) return;
        const key = `${m.game}~${g.id}`, p = this.party(key);
        if (p.state) return this.send(me, { t: 'sys', text: '파티가 이미 게임 중이에요.' });
        this.groupSend(g, { t: 'gplay', game: m.game, key, by: me.nick });
        break;
      }
      case 'party_join': {
        if (!gameOf(m.game)) return;
        if (!this.partyOk(me, m.game)) return;
        const p = this.party(m.game);
        if (p.slots.length >= (PARTY_MAX[gameOf(m.game)] || 4)) return this.send(me, { t: 'sys', key: 'partyFull' });
        const guest = m.guest ? clean(str(m.guest, 12)) : '';
        if (!guest && p.slots.some(s => s.owner === me.id && !s.guest)) return;
        p.slots.push({ owner: me.id, name: guest || me.nick, guest: !!guest });
        this.partySend(m.game, this.partyInfo(m.game));
        break;
      }
      case 'party_leave': {
        if (!gameOf(m.game)) return;
        const p = this.party(m.game);
        p.slots = p.slots.filter((s, i) => s.owner !== me.id || (Number.isInteger(m.slot) && i !== m.slot));
        if (!p.slots.length) p.state = null;
        this.partySend(m.game, this.partyInfo(m.game));
        break;
      }
      case 'party_state': {
        if (!gameOf(m.game)) return;
        const p = this.party(m.game);
        if (!p.slots.some(s => s.owner === me.id)) return;
        if (JSON.stringify(m.state ?? null).length > 12000) return;
        p.state = m.state ?? null;
        this.partySend(m.game, this.partyInfo(m.game));
        break;
      }
      case 'party_msg': {
        if (!gameOf(m.game)) return;
        if (!this.party(m.game).slots.some(s => s.owner === me.id)) return;
        this.partySend(m.game, { t: 'party_msg', game: m.game, from: me.id, d: m.d }, me);
        break;
      }
    }
  }

  // 파티 자리(golf~3)는 그 파티원에게만, 공용 자리는 방 전체에
  partyOk(me, key) { const id = String(key).split('~')[1]; return id === undefined || me.gid === +id; }
  partySend(key, msg, except) {
    const id = String(key).split('~')[1];
    if (id === undefined) return this.broadcast(msg, except);
    const g = this.groups.get(+id);
    if (g) for (const pid of g.members) { const p = this.players.get(pid); if (p && p !== except) this.send(p, msg); }
  }
  groupSend(g, msg) { for (const pid of g.members) { const p = this.players.get(pid); if (p) this.send(p, msg); } }
  groupInfo(g) {
    const info = { t: 'group', g: { id: g.id, leader: g.leader, members: g.members.map(id => ({ id, name: (this.players.get(id) || {}).nick || '?' })) } };
    this.groupSend(g, info);
    const key = Object.keys(this.parties).filter(k => k.endsWith('~' + g.id));
    for (const k of key) this.groupSend(g, this.partyInfo(k));
  }
  groupLeave(me, gone) {
    const g = this.groups.get(me.gid);
    me.gid = 0;
    if (!g) return;
    g.members = g.members.filter(id => id !== me.id);
    // 파티 게임 자리에서도 빠짐
    for (const k of Object.keys(this.parties)) if (k.endsWith('~' + g.id)) {
      const p = this.parties[k], n = p.slots.length;
      p.slots = p.slots.filter(s => s.owner !== me.id);
      if (!p.slots.length) { delete this.parties[k]; } else if (p.slots.length !== n) this.partySend(k, this.partyInfo(k));
    }
    if (!gone) this.send(me, { t: 'group', g: null });
    if (g.members.length <= 1) {
      for (const id of g.members) { const p = this.players.get(id); if (p) { p.gid = 0; this.send(p, { t: 'group', g: null }); this.send(p, { t: 'sys', text: '파티가 끝났어요.' }); } }
      for (const k of Object.keys(this.parties)) if (k.endsWith('~' + g.id)) delete this.parties[k];
      this.groups.delete(g.id);
      return;
    }
    if (g.leader === me.id) g.leader = g.members[0];
    this.groupSend(g, { t: 'sys', text: `${me.nick}님이 파티에서 나갔어요.` });
    this.groupInfo(g);
  }

  flush() {
    const changed = [];
    for (const p of this.players.values()) if (p.dirty) { changed.push([p.id, p.state]); p.dirty = false; }
    if (changed.length) this.broadcast({ t: 'states', s: changed });
  }
}
