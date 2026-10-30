// 관리자 비밀번호 새로 정하기 (사무실 PC 서버용)
//   node deploy/reset-admin.mjs <DATA_DIR> <이메일> <새 비밀번호>
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [dataDir, email, pw] = process.argv.slice(2);
if (!dataDir || !email || !pw) { console.error('사용법: node reset-admin.mjs <DATA_DIR> <이메일> <새 비밀번호>'); process.exit(1); }
if (pw.length < 8 || !/[0-9]/.test(pw) || !/[a-zA-Z]/.test(pw)) { console.error('비밀번호는 영문과 숫자를 섞어 8자 이상으로 정해 주세요.'); process.exit(2); }

const db = new DatabaseSync(path.join(dataDir, 'taeil.db'));
const users = db.prepare("SELECT id, json FROM docs WHERE col = 'users'").all().map(r => JSON.parse(r.json));
let u = users.find(x => x.email === email.toLowerCase());
const salt = crypto.randomBytes(16).toString('base64url').slice(0, 16);
const hash = crypto.scryptSync(pw, salt, 32).toString('hex');
if (!u) u = { id: 'u_' + crypto.randomBytes(12).toString('base64url').slice(0, 12), email: email.toLowerCase(), name: '관리자', phone: '', role: 'admin', createdAt: Date.now() };
Object.assign(u, { salt, hash, role: u.role === 'member' ? 'admin' : u.role });
db.prepare('INSERT INTO docs (col, id, json) VALUES (?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET json = excluded.json').run('users', u.id, JSON.stringify(u));
// 예전 로그인은 모두 끊습니다
db.prepare("DELETE FROM docs WHERE col = 'sessions' AND json LIKE ?").run(`%"userId":"${u.id}"%`);
console.log('OK ' + u.email);
