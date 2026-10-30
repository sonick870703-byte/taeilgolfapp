# 태일골프 ERP : 관리자 비밀번호 새로 정하기 (사무실 PC)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = 'C:\TaeilERP'
$Node = "$Root\node\node.exe"
$Raw = 'https://raw.githubusercontent.com/sonick870703-byte/taeilgolfapp/claude/project-thread-8bxa3u/web'
if (-not (Test-Path $Node)) { throw '먼저 태일ERP 설치를 실행해 주세요 (C:\TaeilERP 가 없습니다).' }
# 비밀번호를 바꾸는 작은 프로그램 (deploy/reset-admin.mjs 와 같은 내용)
Set-Content "$Root\reset-admin.mjs" -Encoding UTF8 -Value @'
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
'@

$plain = { param($s) [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }
Write-Host ''
Write-Host ' 관리자 계정 : admin@tigc.co.kr' -ForegroundColor Yellow
Write-Host ' 새 비밀번호는 영문과 숫자를 섞어 8자 이상 (입력하는 글자는 화면에 안 보입니다)'
for ($i = 0; $i -lt 3; $i++) {
  $a = & $plain (Read-Host ' 새 비밀번호' -AsSecureString)
  $b = & $plain (Read-Host ' 한 번 더' -AsSecureString)
  if ($a -ne $b) { Write-Host ' 두 번 입력한 비밀번호가 다릅니다. 다시 입력해 주세요.' -ForegroundColor Red; continue }
  & $Node "$Root\reset-admin.mjs" "$Root\data" 'admin@tigc.co.kr' $a
  if ($LASTEXITCODE -eq 0) {
    Set-Content "$Root\관리자_비밀번호.txt" -Value "ERP 관리자: admin@tigc.co.kr`r`n비밀번호는 $(Get-Date -Format 'yyyy-MM-dd HH:mm') 에 새로 정했습니다 (여기에는 적지 않습니다)."
    Write-Host ''
    Write-Host ' 완료! https://erp.tigc.co.kr 에서 admin@tigc.co.kr 과 새 비밀번호로 로그인하세요.' -ForegroundColor Cyan
    break
  }
}
Remove-Item "$Root\reset-admin.mjs" -Force -ErrorAction SilentlyContinue
