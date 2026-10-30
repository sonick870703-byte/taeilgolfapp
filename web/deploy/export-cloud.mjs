// 사무실 PC 데이터를 Cloudflare로 옮기기 위한 파일을 만듭니다.
//   node deploy/export-cloud.mjs <DATA_DIR> <출력 폴더>
// 결과: docs.sql (D1에 넣을 데이터), uploads-N.json (KV에 넣을 사진, 묶음별), passport.key 내용은 출력하지 않음
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [dataDir, outDir] = process.argv.slice(2);
if (!dataDir || !outDir) { console.error('사용법: node export-cloud.mjs <DATA_DIR> <출력 폴더>'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const db = new DatabaseSync(path.join(dataDir, 'taeil.db'), { readOnly: true });
const rows = db.prepare('SELECT col, id, json FROM docs').all();
// 세션(로그인 기록)은 옮기지 않습니다. 옮긴 뒤 다시 로그인하면 됩니다.
const keep = rows.filter(r => r.col !== 'sessions');
const sql = ['CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (col, id));',
  ...keep.map(r => `INSERT OR REPLACE INTO docs (col, id, json) VALUES (${q(r.col)}, ${q(r.id)}, ${q(r.json)});`)];
fs.writeFileSync(path.join(outDir, 'docs.sql'), sql.join('\n') + '\n');

const up = path.join(dataDir, 'uploads');
const files = fs.existsSync(up) ? fs.readdirSync(up).filter(f => /^[\w.-]+$/.test(f)) : [];
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
let part = 0, batch = [], size = 0;
const flush = () => { if (!batch.length) return; fs.writeFileSync(path.join(outDir, `uploads-${++part}.json`), JSON.stringify(batch)); batch = []; size = 0; };
for (const f of files) {
  const buf = fs.readFileSync(path.join(up, f));
  if (size + buf.length > 40 * 1024 * 1024 || batch.length >= 5000) flush();
  batch.push({ key: f, value: buf.toString('base64'), base64: true, metadata: { type: TYPES[f.split('.').pop().toLowerCase()] || 'application/octet-stream' } });
  size += buf.length;
}
flush();

const count = {};
for (const r of keep) count[r.col] = (count[r.col] || 0) + 1;
console.log(JSON.stringify({ docs: keep.length, byCollection: count, uploads: files.length, uploadParts: part }));
