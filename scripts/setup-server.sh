#!/usr/bin/env bash
set -Eeuo pipefail

# Idempotent Ubuntu/Debian VPS bootstrap. It does not touch DNS or mail records.
[[ "${EUID}" -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
APP_DIR=/opt/salimvand
if command -v dnf >/dev/null 2>&1; then
  dnf update -y
  dnf install -y ca-certificates curl git nginx postgresql postgresql-server redis redis-tools certbot python3-certbot-nginx gnupg firewalld
  systemctl enable --now firewalld
else
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git nginx postgresql postgresql-contrib redis-server redis-tools certbot python3-certbot-nginx gnupg ufw
fi

id -u salimvand >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin salimvand
install -d -o salimvand -g salimvand "$APP_DIR/uploads/products"
install -d -o root -g root -m 0750 /var/backups/salimvand

# Node 20 and pnpm are intentionally installed by the host's approved runtime policy.
command -v node >/dev/null || { echo 'Install Node.js 20+ before running this script.' >&2; exit 1; }
node -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)" || { echo 'Node.js 20+ is required.' >&2; exit 1; }
if command -v corepack >/dev/null 2>&1; then corepack enable; fi
command -v pnpm >/dev/null 2>&1 || echo "pnpm is not installed yet; install it before deploy."
install -m 0644 deploy/nginx/salimvand.conf /etc/nginx/sites-available/salimvand.conf
ln -sfn /etc/nginx/sites-available/salimvand.conf /etc/nginx/sites-enabled/salimvand.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if command -v postgresql-setup >/dev/null 2>&1; then
  [[ -f /var/lib/pgsql/data/PG_VERSION ]] || postgresql-setup --initdb
  systemctl enable --now postgresql
fi
if systemctl list-unit-files | grep -q '^redis.service'; then
  systemctl enable --now redis
elif systemctl list-unit-files | grep -q '^redis-server.service'; then
  systemctl enable --now redis-server
fi

install -m 0644 deploy/systemd/salimvand-api.service /etc/systemd/system/
install -m 0644 deploy/systemd/salimvand-website.service /etc/systemd/system/
install -m 0644 deploy/systemd/salimvand-worker.service /etc/systemd/system/
install -m 0644 deploy/systemd/salimvand-backup.service /etc/systemd/system/
install -m 0644 deploy/systemd/salimvand-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable salimvand-api.service salimvand-website.service salimvand-worker.service salimvand-backup.timer
systemctl start salimvand-backup.timer
if command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-service=ssh || true
  firewall-cmd --permanent --add-service=http || true
  firewall-cmd --permanent --add-service=https || true
  firewall-cmd --reload || true
elif command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH || true
  ufw allow 'Nginx Full' || true
  ufw --force enable || true
fi
echo 'Server bootstrap complete. Configure /opt/salimvand/.env, then run scripts/deploy.sh.'
