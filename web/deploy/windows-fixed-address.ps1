# 태일골프 ERP : 고정 주소(erp.tigc.co.kr) 연결
# 먼저 tigc.co.kr 을 Cloudflare 무료 계정에 추가하고, 도메인 업체(닷홈)의 네임서버를 Cloudflare 것으로 바꿔 둔 상태여야 합니다.
# windows-setup.ps1 로 C:\TaeilERP 에 설치된 PC에서 실행합니다. 다시 실행해도 됩니다.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$Root = 'C:\TaeilERP'
$Cf   = "$Root\cloudflared.exe"
$Port = 8787
$Name = 'taeil-erp'
$ErpHost  = if ($env:ERP_HOST)  { $env:ERP_HOST }  else { 'erp.tigc.co.kr' }
$SiteHost = if ($env:SITE_HOST) { $env:SITE_HOST } else { 'new.tigc.co.kr' }
$CfDir = Join-Path $env:USERPROFILE '.cloudflared'

function Step($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Green }
if (-not (Test-Path $Cf)) { throw '먼저 태일ERP 설치를 실행해 주세요 (C:\TaeilERP 가 없습니다).' }

Step '1/4 Cloudflare 로그인'
if (-not (Test-Path "$CfDir\cert.pem")) {
  Write-Host ' 브라우저가 열리면 Cloudflare에 로그인하고 tigc.co.kr 을 누른 뒤 "Authorize(승인)"를 눌러 주세요.' -ForegroundColor Yellow
  & $Cf tunnel login
  if (-not (Test-Path "$CfDir\cert.pem")) { throw 'Cloudflare 승인이 끝나지 않았습니다. 다시 실행해 주세요.' }
} else { Write-Host ' 이미 로그인되어 있습니다.' }

Step '2/4 터널 만들기'
$list = & $Cf tunnel list --output json 2>$null | ConvertFrom-Json
$t = $list | Where-Object { $_.name -eq $Name } | Select-Object -First 1
if (-not $t) {
  & $Cf tunnel create $Name | Out-Host
  $t = (& $Cf tunnel list --output json | ConvertFrom-Json) | Where-Object { $_.name -eq $Name } | Select-Object -First 1
}
$id = $t.id
$cred = "$CfDir\$id.json"
if (-not (Test-Path $cred)) { throw "터널 열쇠 파일($cred)이 없습니다. Cloudflare 화면에서 '$Name' 터널을 지우고 다시 실행해 주세요." }
Write-Host " 터널: $Name ($id)"

Step '3/4 주소 연결'
foreach ($h in @($ErpHost, $SiteHost)) { & $Cf tunnel route dns --overwrite-dns $Name $h | Out-Host }
Set-Content "$Root\config.yml" -Encoding ASCII -Value @"
tunnel: $id
credentials-file: $cred
ingress:
  - hostname: $ErpHost
    service: http://localhost:$Port
  - hostname: $SiteHost
    service: http://localhost:$Port
  - service: http_status:404
"@
Set-Content "$Root\fixed-host.txt" -Encoding ASCII -Value $ErpHost
# 서버가 erp 주소로 들어오면 바로 ERP 화면을 보여 주도록
$settings = "$Root\settings.cmd"
$lines = (Get-Content $settings) | Where-Object { $_ -notmatch '^@set ERP_HOSTS=' }
Set-Content $settings -Encoding ASCII -Value (($lines + "@set ERP_HOSTS=$ErpHost") -join "`r`n")
Set-Content "$Root\접속주소.txt" -Value "ERP: https://$ErpHost`r`n새 홈페이지(확인용): https://$SiteHost"

Step '4/4 다시 켜기'
Get-Process node, cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Root*" } | Stop-Process -Force
Start-Sleep 1
Start-Process wscript.exe "`"$Root\start-hidden.vbs`""
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  Start-Sleep 2
  try { $ok = (Invoke-WebRequest "https://$ErpHost/api/health" -UseBasicParsing -TimeoutSec 5).Content -match 'ok' } catch {}
}

Write-Host ""
Write-Host "================ 고정 주소 연결 완료 ================" -ForegroundColor Cyan
Write-Host " ERP           : https://$ErpHost" -ForegroundColor Yellow
Write-Host " 새 홈페이지   : https://$SiteHost  (기존 tigc.co.kr 은 그대로)"
if ($ok) { Write-Host ' 연결 확인     : 정상' } else { Write-Host ' 연결 확인     : 아직 응답이 없습니다. 5~10분 뒤 주소를 열어 보세요.' }
Write-Host ' 이제 PC를 다시 켜도 주소가 바뀌지 않습니다.'
Write-Host "====================================================="
