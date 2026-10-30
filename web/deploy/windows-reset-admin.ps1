# 태일골프 ERP : 관리자 비밀번호 새로 정하기 (사무실 PC)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = 'C:\TaeilERP'
$Node = "$Root\node\node.exe"
$Raw = 'https://raw.githubusercontent.com/sonick870703-byte/taeilgolfapp/claude/project-thread-8bxa3u/web'
if (-not (Test-Path $Node)) { throw '먼저 태일ERP 설치를 실행해 주세요 (C:\TaeilERP 가 없습니다).' }
Invoke-WebRequest "$Raw/deploy/reset-admin.mjs" -OutFile "$Root\reset-admin.mjs" -UseBasicParsing

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
