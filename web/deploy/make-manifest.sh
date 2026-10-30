#!/usr/bin/env bash
# 윈도우 설치용 파일 목록을 만듭니다 (web/ 안의 실행에 필요한 파일만)
cd "$(dirname "$0")/.." && git ls-files server.js package.json public worker wrangler.template.jsonc deploy/export-cloud.mjs | sort > deploy/files.txt
