@echo off
chcp 65001 >nul
title Taeil Golf ERP cloud
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; irm 'https://raw.githubusercontent.com/sonick870703-byte/taeilgolfapp/claude/project-thread-8bxa3u/web/deploy/windows-cloud.ps1' | iex"
pause
