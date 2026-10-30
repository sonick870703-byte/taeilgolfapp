@echo off
chcp 65001 >nul
title Taeil Golf ERP admin password
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; irm 'https://raw.githubusercontent.com/sonick870703-byte/taeilgolfapp/claude/project-thread-8bxa3u/web/deploy/windows-reset-admin.ps1' | iex"
pause
