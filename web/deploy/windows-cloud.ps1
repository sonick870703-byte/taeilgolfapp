# 태일골프 홈페이지 + ERP : Cloudflare(무료)로 옮기기 / 업데이트
# 처음 실행: 사무실 PC의 데이터(예약·회원·사진·여권 열쇠)를 Cloudflare로 옮기고, 사무실 PC 서버는 끕니다.
# 다시 실행: 최신 프로그램만 Cloudflare에 올립니다 (데이터는 건드리지 않음).
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo    = 'sonick870703-byte/taeilgolfapp'
$Branch  = 'claude/project-thread-8bxa3u'
$Root    = 'C:\TaeilERP'
$Data    = "$Root\data"
$NodeDir = "$Root\node"
$Node    = "$NodeDir\node.exe"
$Cloud   = "$Root\cloud"
$Site    = "$Cloud\site"
$Moved   = "$Root\클라우드로_옮김.txt"
$ErpHost = 'erp.tigc.co.kr'

function Step($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Green }
function Fail($t) { Write-Host ""; Write-Host " $t" -ForegroundColor Red; Write-Host ' 이 화면을 캡처해서 보내 주세요.'; exit 1 }
if (-not (Test-Path $Node)) { Fail '먼저 태일ERP 설치를 실행해 주세요 (C:\TaeilERP\node 가 없습니다).' }
$first = -not (Test-Path $Moved)
$env:Path = "$NodeDir;$env:Path"
$env:WRANGLER_SEND_METRICS = 'false'

Step '1/6 최신 프로그램 받기'
# 브랜치 주소는 몇 분 동안 옛 내용이 나올 수 있어, 가장 최근 커밋 번호로 받습니다
$sha = $Branch
try { $sha = (Invoke-RestMethod "https://api.github.com/repos/$Repo/commits/$Branch" -Headers @{ 'User-Agent' = 'taeil' }).sha } catch {}
$Raw = "https://raw.githubusercontent.com/$Repo/$sha/web"
if (Test-Path $Site) { Remove-Item $Site -Recurse -Force }
$list = (Invoke-WebRequest "$Raw/deploy/files.txt" -UseBasicParsing).Content -split "`n" | Where-Object { $_.Trim() }
foreach ($f in $list) {
  $f = $f.Trim(); $dest = Join-Path $Site ($f -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Invoke-WebRequest "$Raw/$f" -OutFile $dest -UseBasicParsing
}
if (-not (Test-Path "$Site\worker\index.js")) { Fail '프로그램 파일을 받지 못했습니다.' }
Write-Host "  파일 $($list.Count)개 ($($sha.Substring(0, [Math]::Min(7, $sha.Length))))"

Step '2/6 Cloudflare 도구(wrangler) 준비'
$W = "$Cloud\tools\node_modules\.bin\wrangler.cmd"
if (-not (Test-Path $W)) {
  New-Item -ItemType Directory -Force -Path "$Cloud\tools" | Out-Null
  & "$NodeDir\npm.cmd" install --prefix "$Cloud\tools" wrangler@4 --no-fund --no-audit --loglevel=error | Out-Host
}
if (-not (Test-Path $W)) { Fail 'Cloudflare 도구 설치에 실패했습니다.' }

Step '3/6 Cloudflare 로그인'
Push-Location $Site
$authed = { $o = (& $W whoami 2>&1) -join "`n"; ($o -match 'associated with the email|Account ID') -and ($o -notmatch 'not authenticated|You are not') }
if (-not (& $authed)) {
  Write-Host ' 잠시 뒤 브라우저가 열리면 Cloudflare(taeilgolf@naver.com)로 로그인하고 "Allow(허용)"을 눌러 주세요.' -ForegroundColor Yellow
  Write-Host ' 브라우저가 안 열리면 아래에 나오는 https://dash.cloudflare.com/oauth2/... 주소를 복사해 크롬 주소창에 붙여 넣으세요.'
  & $W login 2>&1 | Out-Host
}
if (-not (& $authed)) { & $W whoami 2>&1 | Out-Host; Pop-Location; Fail 'Cloudflare 로그인이 끝나지 않았습니다. 다시 실행해 주세요.' }
Write-Host ' 로그인 확인'

Step '4/6 저장 공간 만들기 (데이터베이스 · 사진)'
& $W d1 create taeil --update-config=false 2>&1 | Out-Null
$d1 = (& $W d1 list --json 2>$null | Out-String | ConvertFrom-Json) | Where-Object { $_.name -eq 'taeil' } | Select-Object -First 1
& $W kv namespace create UPLOADS --update-config=false 2>&1 | Out-Null
$kvList = & $W kv namespace list 2>$null | Out-String | ConvertFrom-Json
$kv = $kvList | Where-Object { $_.title -eq 'UPLOADS' -or $_.title -like '*-UPLOADS' } | Select-Object -First 1
if (-not $d1 -or -not $kv) { Pop-Location; Fail '데이터베이스나 사진 저장소를 만들지 못했습니다.' }
$cfg = [IO.File]::ReadAllText("$Site\wrangler.template.jsonc").Replace('__D1_ID__', $d1.uuid).Replace('__KV_ID__', $kv.id)
[IO.File]::WriteAllText("$Site\wrangler.jsonc", $cfg, (New-Object Text.UTF8Encoding $false))
Write-Host " 데이터베이스 $($d1.uuid)"

if ($first) {
  Step '5/6 사무실 PC 데이터 옮기기'
  # 옮기는 동안 새 데이터가 생기지 않도록 사무실 PC 서버를 먼저 끕니다
  Get-Process node, cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Root\node*" -or $_.Path -like "$Root\cloudflared*" } | Stop-Process -Force
  Start-Sleep 2
  $exp = "$Cloud\export"
  if (Test-Path $exp) { Remove-Item $exp -Recurse -Force }
  & $Node "$Site\deploy\export-cloud.mjs" $Data $exp 2>$null | Out-Host
  if (-not (Test-Path "$exp\docs.sql")) { Pop-Location; Fail '사무실 PC 데이터를 읽지 못했습니다.' }
  & $W d1 execute taeil --remote --yes --file "$exp\docs.sql" | Out-Host
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail '데이터를 Cloudflare에 넣지 못했습니다.' }
  foreach ($f in Get-ChildItem $exp -Filter 'uploads-*.json') { & $W kv bulk put $f.FullName --namespace-id $kv.id --remote | Out-Host }
} else {
  Step '5/6 데이터는 Cloudflare에 이미 있습니다 (건너뜀)'
}

Step '6/6 Cloudflare에 올리기'
& $W deploy | Out-Host
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'Cloudflare에 올리지 못했습니다.' }
if ($first) {
  # 여권번호 암호 열쇠는 사무실 PC 것을 그대로 씁니다 (그래야 저장된 여권번호를 읽을 수 있음)
  if (Test-Path "$Data\passport.key") { (Get-Content "$Data\passport.key" -Raw).Trim() | & $W secret put PASSPORT_KEY | Out-Host }
  else { $k = [Convert]::ToBase64String((1..32 | ForEach-Object { [byte](Get-Random -Max 256) })); $k | & $W secret put PASSPORT_KEY | Out-Host }
  $ap = -join ((1..20) | ForEach-Object { 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'[(Get-Random -Max 56)] })
  $ap | & $W secret put ADMIN_PASSWORD | Out-Host
}
Pop-Location

$ok = $false
for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
  Start-Sleep 3
  try { $r = Invoke-WebRequest "https://$ErpHost/api/health" -UseBasicParsing -TimeoutSec 10; $ok = $r.Headers['X-Taeil-Server'] -eq 'cloudflare' } catch {}
}

if ($first -and $ok) {
  # 사무실 PC 서버는 이제 쓰지 않습니다 (자동 시작 해제)
  Unregister-ScheduledTask -TaskName 'TaeilERP' -Confirm:$false -ErrorAction SilentlyContinue
  Set-Content $Moved -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm') 에 Cloudflare로 옮겼습니다. 사무실 PC 서버는 쓰지 않습니다.`r`n예전 데이터 백업: $Data"
  # 바탕화면 '태일ERP 업데이트' 를 Cloudflare 업데이트로 바꿈
  $upd = "$Root\update.cmd"
  Set-Content $upd -Encoding ASCII -Value "@echo off`r`nchcp 65001 >nul`r`npowershell -NoProfile -ExecutionPolicy Bypass -Command `"[Console]::OutputEncoding=[Text.Encoding]::UTF8; irm -Headers @{Accept='application/vnd.github.raw'; 'User-Agent'='taeil'} 'https://api.github.com/repos/$Repo/contents/web/deploy/windows-cloud.ps1?ref=$Branch' | iex`"`r`npause"
}

Write-Host ""
Write-Host "================ Cloudflare 연결 ================" -ForegroundColor Cyan
Write-Host " ERP : https://$ErpHost" -ForegroundColor Yellow
if ($ok) {
  Write-Host ' 상태 : 정상 (Cloudflare에서 동작 중)'
  Write-Host ' 이제 사무실 PC를 꺼도 ERP가 계속 열립니다.'
  Write-Host ' 계정과 비밀번호는 사무실 PC에서 쓰던 그대로입니다.'
} else {
  Write-Host ' 상태 : 아직 확인되지 않았습니다. 이 화면을 캡처해서 보내 주세요.' -ForegroundColor Red
  if ($first) { Write-Host ' (사무실 PC 서버는 꺼 두었습니다. 다시 켜려면 바탕화면의 "태일ERP 업데이트" 대신 C:\TaeilERP\start-hidden.vbs 를 실행하세요.)' }
}
Write-Host "================================================="
