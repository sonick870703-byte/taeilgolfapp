# 태일골프 홈페이지 + ERP : 사무실 윈도우 PC 설치 / 업데이트
# 관리자 권한 없이 C:\TaeilERP 한 폴더에 모두 설치합니다. 다시 실행하면 프로그램만 최신으로 바꾸고 데이터는 그대로 둡니다.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Branch  = 'claude/project-thread-8bxa3u'
$Raw     = "https://raw.githubusercontent.com/sonick870703-byte/taeilgolfapp/$Branch/web"
$NodeVer = 'v22.22.0'
$Port    = 8787
$Root    = 'C:\TaeilERP'
$App     = "$Root\app"
$Data    = "$Root\data"
$NodeDir = "$Root\node"
$Node    = "$NodeDir\node.exe"
$Cf      = "$Root\cloudflared.exe"

function Step($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Green }
New-Item -ItemType Directory -Force -Path $Root, $App, $Data | Out-Null

Step '1/5 실행 도구(Node.js) 준비'
if (-not (Test-Path $Node)) {
  $zip = "$env:TEMP\node.zip"
  Invoke-WebRequest "https://nodejs.org/dist/$NodeVer/node-$NodeVer-win-x64.zip" -OutFile $zip
  Expand-Archive $zip -DestinationPath "$env:TEMP\node-x" -Force
  Move-Item "$env:TEMP\node-x\node-$NodeVer-win-x64" $NodeDir
  Remove-Item $zip, "$env:TEMP\node-x" -Recurse -Force
}

Step '2/5 프로그램 받기'
$list = (Invoke-WebRequest "$Raw/deploy/files.txt" -UseBasicParsing).Content -split "`n" | Where-Object { $_.Trim() }
foreach ($f in $list) {
  $f = $f.Trim(); $dest = Join-Path $App ($f -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Invoke-WebRequest "$Raw/$f" -OutFile $dest -UseBasicParsing
}
Write-Host "  파일 $($list.Count)개"

Step '3/5 외부 접속 도구(Cloudflare 터널) 준비'
if (-not (Test-Path $Cf)) {
  Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $Cf
}

Step '4/5 관리자 계정과 자동 시작'
$pwFile = "$Root\관리자_비밀번호.txt"
$envFile = "$Root\settings.cmd"
$firstPw = $null
if (-not (Test-Path $envFile)) {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'.ToCharArray()
  $firstPw = -join (1..14 | ForEach-Object { $chars | Get-Random })
  Set-Content $envFile -Encoding ASCII -Value "@set PORT=$Port`r`n@set DATA_DIR=$Data`r`n@set ADMIN_EMAIL=admin@tigc.co.kr`r`n@set ADMIN_PASSWORD=$firstPw"
  Set-Content $pwFile -Value "ERP 관리자: admin@tigc.co.kr`r`n처음 비밀번호: $firstPw"
}
# 서버와 터널을 창 없이 켜는 파일
Set-Content "$Root\start.cmd" -Encoding ASCII -Value @"
@echo off
call "$envFile"
cd /d "$App"
start "" /b "$Node" server.js > "$Root\server.log" 2>&1
if exist "$Root\tunnel.log" del "$Root\tunnel.log"
start "" /b powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$Root\addr.ps1"
"$Cf" tunnel --no-autoupdate --url http://localhost:$Port --logfile "$Root\tunnel.log"
"@
Set-Content "$Root\start-hidden.vbs" -Encoding ASCII -Value "CreateObject(""WScript.Shell"").Run """"""$Root\start.cmd"""""", 0, False"
# 터널이 새 주소를 받으면 접속주소.txt 에 적어 둠 (PC를 켤 때마다 주소가 바뀜)
Set-Content "$Root\addr.ps1" -Encoding UTF8 -Value @"
for (`$i = 0; `$i -lt 90; `$i++) {
  Start-Sleep 2
  if (Test-Path '$Root\tunnel.log') {
    `$m = Select-String -Path '$Root\tunnel.log' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if (`$m) { `$u = `$m.Matches[0].Value; Set-Content '$Root\접속주소.txt' -Value "홈페이지: `$u`r`nERP: `$u/erp/"; break }
  }
}
"@
# 이미 켜져 있으면 끄고 다시 켬
Get-Process node, cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Root*" } | Stop-Process -Force
Start-Sleep 1
$action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$Root\start-hidden.vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$set     = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'TaeilERP' -Action $action -Trigger $trigger -Settings $set -Force | Out-Null
Remove-Item "$Root\tunnel.log", "$Root\접속주소.txt" -Force -ErrorAction SilentlyContinue
Start-Process wscript.exe "`"$Root\start-hidden.vbs`""

Step '5/5 접속 주소 확인'
$url = $null
for ($i = 0; $i -lt 40 -and -not $url; $i++) {
  Start-Sleep 2
  if (Test-Path "$Root\tunnel.log") {
    $m = Select-String -Path "$Root\tunnel.log" -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}
$ok = $false
try { $ok = (Invoke-WebRequest "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 5).Content -match 'ok' } catch {}

Write-Host ""
Write-Host "================ 설치 완료 ================" -ForegroundColor Cyan
Write-Host (" 이 PC에서 : http://localhost:$Port/erp/   (서버 " + ($(if ($ok) { '정상' } else { '확인 필요: C:\TaeilERP\server.log' })) + ")")
if ($url) { Write-Host " 직원 공유 : $url/erp/" -ForegroundColor Yellow } else { Write-Host ' 직원 공유 주소를 아직 못 받았습니다. 1분 뒤 C:\TaeilERP\tunnel.log 를 확인해 주세요.' }
Write-Host ' 관리자    : admin@tigc.co.kr'
if ($firstPw) { Write-Host " 처음 비밀번호 : $firstPw  (C:\TaeilERP\관리자_비밀번호.txt 에도 저장)" -ForegroundColor Yellow }
else { Write-Host ' 비밀번호  : C:\TaeilERP\관리자_비밀번호.txt' }
Write-Host ' 직원 공유 주소는 PC를 다시 켜면 바뀝니다. 새 주소는 C:\TaeilERP\접속주소.txt 에 있습니다.'
Write-Host "==========================================="
