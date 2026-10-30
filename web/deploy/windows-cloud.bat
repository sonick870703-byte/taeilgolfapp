@echo off
chcp 65001 >nul
title Taeil Golf ERP cloud
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; irm -Headers @{Accept='application/vnd.github.raw'; 'User-Agent'='taeil'} 'https://api.github.com/repos/sonick870703-byte/taeilgolfapp/contents/web/deploy/windows-cloud.ps1?ref=claude/project-thread-8bxa3u' | iex"
pause
