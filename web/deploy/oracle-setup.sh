#!/usr/bin/env bash
# 태일골프 홈페이지 + ERP 서버 설치 (오라클 클라우드 무료 서버, Ubuntu 22.04/24.04)
#
# 서버에 접속한 뒤 이 한 줄을 붙여 넣으면 됩니다:
#   curl -fsSL https://raw.githubusercontent.com/sonick870703-byte/taeilgolfapp/claude/project-thread-8bxa3u/web/deploy/oracle-setup.sh | sudo bash
#
# 주소를 붙일 때는(도메인 DNS를 이 서버 IP로 바꾼 뒤) 다시 실행하면서 주소를 넣습니다:
#   ... | sudo SITE_DOMAIN=new.tigc.co.kr ERP_DOMAIN=erp.tigc.co.kr bash
#
# 다시 실행해도 데이터(/opt/taeil/data)는 그대로 두고 프로그램만 최신으로 바꿉니다.
set -euo pipefail

REPO=https://github.com/sonick870703-byte/taeilgolfapp.git
BRANCH=${BRANCH:-claude/project-thread-8bxa3u}
APP=/opt/taeil
SITE_DOMAIN=${SITE_DOMAIN:-}
ERP_DOMAIN=${ERP_DOMAIN:-}

[ "$(id -u)" = 0 ] || { echo "sudo 로 실행해 주세요."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "== 1/5 필요한 프로그램 설치 =="
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== 2/5 프로그램 받기 =="
id taeil >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin taeil
if [ -d "$APP/src/.git" ]; then
  git -C "$APP/src" fetch --depth 1 origin "$BRANCH" && git -C "$APP/src" reset --hard FETCH_HEAD
else
  mkdir -p "$APP" && git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP/src"
fi
mkdir -p "$APP/data"

echo "== 3/5 관리자 계정 =="
ENV_FILE=/etc/taeil.env
if [ ! -f "$ENV_FILE" ]; then
  ADMIN_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14)
  printf 'PORT=8080\nDATA_DIR=%s/data\nADMIN_EMAIL=admin@tigc.co.kr\nADMIN_PASSWORD=%s\n' "$APP" "$ADMIN_PASSWORD" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  FIRST_PW=$ADMIN_PASSWORD
fi
sed -i '/^ERP_HOSTS=/d' "$ENV_FILE"
[ -n "$ERP_DOMAIN" ] && echo "ERP_HOSTS=$ERP_DOMAIN" >> "$ENV_FILE"
chown -R taeil:taeil "$APP"

echo "== 4/5 서버 등록 (켜질 때 자동 시작) =="
cat > /etc/systemd/system/taeil.service <<EOF
[Unit]
Description=Taeil Golf homepage + ERP
After=network.target
[Service]
User=taeil
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP/src/web
ExecStart=/usr/bin/node server.js
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable taeil >/dev/null
systemctl restart taeil

echo "== 5/5 인터넷 연결 (https 자동) =="
if [ -n "$SITE_DOMAIN$ERP_DOMAIN" ]; then
  HOSTS=$(echo "$SITE_DOMAIN $ERP_DOMAIN" | xargs | tr ' ' ',')
  printf '%s {\n  encode gzip\n  reverse_proxy 127.0.0.1:8080\n}\n' "$HOSTS" > /etc/caddy/Caddyfile
else
  printf ':80 {\n  encode gzip\n  reverse_proxy 127.0.0.1:8080\n}\n' > /etc/caddy/Caddyfile
fi
systemctl reload caddy 2>/dev/null || systemctl restart caddy
# 오라클 Ubuntu는 기본으로 80·443을 막아 둡니다
for p in 80 443; do
  iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport $p -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true

IP=$(curl -fsS https://api.ipify.org || echo "서버IP")
echo
echo "================ 설치 완료 ================"
echo " 홈페이지 : ${SITE_DOMAIN:+https://$SITE_DOMAIN}${SITE_DOMAIN:-http://$IP}"
echo " ERP     : ${ERP_DOMAIN:+https://$ERP_DOMAIN}${ERP_DOMAIN:-http://$IP/erp/}"
echo " 관리자   : admin@tigc.co.kr"
if [ -n "${FIRST_PW:-}" ]; then
  echo " 처음 비밀번호 : $FIRST_PW   (지금 꼭 적어 두세요)"
else
  echo " 비밀번호 : 처음 설치 때 받은 비밀번호 그대로입니다"
fi
echo "==========================================="
