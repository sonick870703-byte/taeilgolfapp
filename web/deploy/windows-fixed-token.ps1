# 태일골프 ERP : 고정 주소(erp.tigc.co.kr) 연결 - Cloudflare 화면에서 만든 터널 토큰으로 연결
# Cloudflare 대시보드 > Networking > Tunnels 에서 터널을 만들고, 나온 설치 명령(토큰)을 붙여 넣으면 됩니다.
# windows-fixed-address.ps1 의 브라우저 승인(Authorize) 화면이 안 나올 때 쓰는 방법입니다. 다시 실행해도 됩니다.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$Root = 'C:\TaeilERP'
$Port = 8787
$ErpHost = if ($env:ERP_HOST) { $env:ERP_HOST } else { 'erp.tigc.co.kr' }
$Raw = 'https://raw.githubusercontent.com/sonick870703-byte/taeilgolfapp/claude/project-thread-8bxa3u/web'

function Step($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Green }
if (-not (Test-Path "$Root\cloudflared.exe")) { throw '먼저 태일ERP 설치를 실행해 주세요 (C:\TaeilERP 가 없습니다).' }

Step '1/3 터널 토큰 붙여 넣기'
Write-Host ' Cloudflare 화면의 "Install and run a connector" 칸에 있는 명령을 복사(오른쪽 복사 버튼)한 뒤,'
Write-Host ' 이 검은 창에서 마우스 오른쪽 버튼을 눌러 붙여 넣고 Enter 를 누르세요.' -ForegroundColor Yellow
$token = $null
for ($i = 0; $i -lt 3 -and -not $token; $i++) {
  $in = Read-Host ' 붙여 넣기'
  $m = [regex]::Match([string]$in, 'eyJ[A-Za-z0-9_\-=+/]{40,}')
  if ($m.Success) { $token = $m.Value } else { Write-Host ' 토큰을 찾지 못했습니다. "eyJ" 로 시작하는 긴 글자가 들어 있는 명령 전체를 붙여 넣어 주세요.' -ForegroundColor Red }
}
if (-not $token) { throw '토큰이 없어 멈춥니다. 다시 실행해 주세요.' }

Step '2/3 설정 저장'
Set-Content "$Root\tunnel-token.txt" -Encoding ASCII -Value $token -NoNewline
# 예전 방식 설정은 쓰지 않도록 이름을 바꿔 둠
if (Test-Path "$Root\config.yml") { Move-Item "$Root\config.yml" "$Root\config.yml.old" -Force }
Set-Content "$Root\fixed-host.txt" -Encoding ASCII -Value $ErpHost
$settings = "$Root\settings.cmd"
$lines = (Get-Content $settings) | Where-Object { $_ -notmatch '^@set ERP_HOSTS=' }
Set-Content $settings -Encoding ASCII -Value (($lines + "@set ERP_HOSTS=$ErpHost") -join "`r`n")
Set-Content "$Root\접속주소.txt" -Value "ERP: https://$ErpHost"
Write-Host ' 저장했습니다.'

Step '3/3 최신 프로그램으로 다시 켜기'
irm "$Raw/deploy/windows-setup.ps1" | iex

$ok = $false
for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
  Start-Sleep 3
  try { $ok = (Invoke-WebRequest "https://$ErpHost/api/health" -UseBasicParsing -TimeoutSec 5).Content -match 'ok' } catch {}
}
Write-Host ""
Write-Host "================ 고정 주소 연결 ================" -ForegroundColor Cyan
Write-Host " ERP : https://$ErpHost" -ForegroundColor Yellow
if ($ok) { Write-Host ' 연결 확인 : 정상' } else { Write-Host ' 연결 확인 : 아직 응답이 없습니다. Cloudflare 터널 화면의 Route(erp.tigc.co.kr → http://localhost:8787)를 확인하고 5분 뒤 열어 보세요.' }
Write-Host ' 이제 PC를 다시 켜도 주소가 바뀌지 않습니다.'
Write-Host "================================================"
