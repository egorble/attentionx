#!/bin/bash
###############################################################################
# AttentionX — Production Deployment Script
# Domain: app.attnx.fun
#
# First deploy:
#   1. Create .env:  sudo mkdir -p /opt/attentionx && sudo nano /opt/attentionx/.env
#   2. Run:          sudo bash scripts/deploy-server.sh
#
# Update from GitHub:
#   sudo bash /opt/attentionx/scripts/update.sh
#
# What it does:
#   - Installs Node.js 20, nginx, certbot
#   - Creates attentionx user and directory structure
#   - Builds frontend, installs backend deps
#   - Configures nginx with SSL (Let's Encrypt)
#   - Sets up systemd services with auto-restart
#   - Configures DB backups, health checks, log rotation
#
# Safe to re-run (idempotent).
###############################################################################

set -euo pipefail

# ─── Configuration ───
DOMAIN="app.attnx.fun"
APP_DIR="/opt/attentionx"
APP_USER="attentionx"
ENV_FILE="${APP_DIR}/.env"
CERTBOT_WEBROOT="/var/www/certbot"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# ─── Pre-flight checks ───
if [ "$(id -u)" -ne 0 ]; then
    err "This script must be run as root (sudo)"
fi

# Detect project root (where this script lives: scripts/deploy-server.sh)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ ! -f "${PROJECT_DIR}/server/index.js" ]; then
    err "Cannot find project at ${PROJECT_DIR}. Run this script from the project directory."
fi

log "Project directory: ${PROJECT_DIR}"
log "Target directory: ${APP_DIR}"
log "Domain: ${DOMAIN}"

###############################################################################
# STEP 1: Install system dependencies
###############################################################################
step "1/10 — Installing system dependencies"

# Update package list
apt-get update -qq

# Install essentials
apt-get install -y -qq curl gnupg2 ca-certificates lsb-release software-properties-common rsync

# Node.js 20.x (skip if already installed)
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* && "$(node -v)" != v22* ]]; then
    log "Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
else
    log "Node.js $(node -v) already installed"
fi

# nginx
if ! command -v nginx &>/dev/null; then
    log "Installing nginx..."
    apt-get install -y -qq nginx
else
    log "nginx already installed"
fi

# certbot
if ! command -v certbot &>/dev/null; then
    log "Installing certbot..."
    apt-get install -y -qq certbot python3-certbot-nginx
else
    log "certbot already installed"
fi

log "Node: $(node -v) | npm: $(npm -v) | nginx: $(nginx -v 2>&1 | cut -d/ -f2)"

###############################################################################
# STEP 2: Create app user
###############################################################################
step "2/10 — Setting up app user"

if id "$APP_USER" &>/dev/null; then
    log "User '$APP_USER' already exists"
else
    useradd --system --shell /bin/false --home-dir "$APP_DIR" --create-home "$APP_USER"
    log "Created system user '$APP_USER'"
fi

###############################################################################
# STEP 3: Create directory structure
###############################################################################
step "3/10 — Creating directory structure"

mkdir -p "${APP_DIR}"/{server,backend,front,backups,logs,deploy}
mkdir -p "${APP_DIR}/server/db"
mkdir -p "${APP_DIR}/server/data"
mkdir -p "${APP_DIR}/server/logs"
mkdir -p "$CERTBOT_WEBROOT"

log "Directories created at ${APP_DIR}"

###############################################################################
# STEP 4: Clone/pull from GitHub
###############################################################################
step "4/10 — Fetching code from GitHub"

REPO="https://github.com/egorble/attentionx"

apt-get install -y -qq git
git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true

if [ -d "${APP_DIR}/.git" ]; then
    log "Repo exists — pulling latest..."
    cd "${APP_DIR}"
    git stash --include-untracked 2>/dev/null || true
    git pull origin main
    git stash pop 2>/dev/null || true
else
    log "Cloning repo into ${APP_DIR}..."
    # Save .env and db before clone
    TEMP_DIR=$(mktemp -d)
    [ -f "${APP_DIR}/.env" ] && cp "${APP_DIR}/.env" "${TEMP_DIR}/.env"
    [ -f "${APP_DIR}/server/db/attentionx.db" ] && cp "${APP_DIR}/server/db/attentionx.db" "${TEMP_DIR}/attentionx.db"

    git clone "$REPO" "${APP_DIR}_tmp"
    cp -a "${APP_DIR}_tmp/." "${APP_DIR}/"
    rm -rf "${APP_DIR}_tmp"

    # Restore .env and db
    [ -f "${TEMP_DIR}/.env" ] && cp "${TEMP_DIR}/.env" "${APP_DIR}/.env"
    [ -f "${TEMP_DIR}/attentionx.db" ] && mkdir -p "${APP_DIR}/server/db" && cp "${TEMP_DIR}/attentionx.db" "${APP_DIR}/server/db/attentionx.db"
    rm -rf "$TEMP_DIR"
fi

log "Code synced from GitHub"

###############################################################################
# STEP 5: Environment variables
###############################################################################
step "5/10 — Configuring environment"

if [ -f "$ENV_FILE" ]; then
    log "Environment file found at ${ENV_FILE}"
else
    err "Environment file not found at ${ENV_FILE}
Create it manually before running this script:

  sudo mkdir -p ${APP_DIR}
  sudo nano ${ENV_FILE}

Required variables:
  NODE_ENV=production
  PORT=3007
  PRIVATE_KEY=<your_blockchain_signing_key>
  ADMIN_API_KEY=<your_admin_api_key>
  SCORE_HMAC_SECRET=<your_hmac_secret>
  SERVER_URL=https://${DOMAIN}/metadata
  NFT_CONTRACT_ADDRESS=<your_nft_contract_address>
  RPC_URL=https://testnet.riselabs.xyz"
fi

chmod 600 "$ENV_FILE"
chown "$APP_USER":"$APP_USER" "$ENV_FILE"

###############################################################################
# STEP 6: Install dependencies & build
###############################################################################
step "6/10 — Installing dependencies & building frontend"

# Server dependencies
log "Installing server dependencies..."
cd "${APP_DIR}/server"
npm ci --production --silent 2>&1 | tail -1 || npm install --production --silent 2>&1 | tail -1
log "Server deps installed"

# Backend (metadata) dependencies
log "Installing metadata server dependencies..."
cd "${APP_DIR}/backend"
npm ci --production --silent 2>&1 | tail -1 || npm install --production --silent 2>&1 | tail -1
log "Metadata deps installed"

# Frontend build
log "Building frontend..."
cd "${APP_DIR}/front"
npm ci --silent 2>&1 | tail -1 || npm install --silent 2>&1 | tail -1
npm run build
log "Frontend built at ${APP_DIR}/front/dist"

# Set ownership
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

###############################################################################
# STEP 7: Configure nginx
###############################################################################
step "7/10 — Configuring nginx"

NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

# First, install a temporary HTTP-only config for certbot
# (certbot needs a running server to verify domain ownership)
if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    log "No SSL cert yet — installing temporary HTTP config for certbot..."
    cat > "$NGINX_CONF" << TMPNGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
        allow all;
    }

    location / {
        return 200 'AttentionX setup in progress...';
        add_header Content-Type text/plain;
    }
}
TMPNGINX
else
    log "SSL cert exists — installing full nginx config..."
    cp "${APP_DIR}/deploy/nginx.conf" "$NGINX_CONF"
fi

# Enable site
ln -sf "$NGINX_CONF" "$NGINX_ENABLED"

# Remove default site if it exists
rm -f /etc/nginx/sites-enabled/default

# Test & reload
nginx -t
systemctl reload nginx
log "nginx configured and reloaded"

###############################################################################
# STEP 8: SSL Certificate (Let's Encrypt)
###############################################################################
step "8/10 — SSL Certificate"

if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    log "SSL certificate already exists for ${DOMAIN}"

    # Check expiry
    EXPIRY=$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" | cut -d= -f2)
    log "Certificate expires: ${EXPIRY}"

    # Attempt renewal if close to expiry
    certbot renew --quiet --no-self-upgrade 2>/dev/null || true
else
    log "Requesting SSL certificate for ${DOMAIN}..."
    certbot certonly \
        --webroot \
        --webroot-path="$CERTBOT_WEBROOT" \
        --domain "$DOMAIN" \
        --non-interactive \
        --agree-tos \
        --email "admin@attnx.fun" \
        --no-eff-email

    if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
        log "SSL certificate obtained!"

        # Now install the full nginx config with SSL
        cp "${APP_DIR}/deploy/nginx.conf" "$NGINX_CONF"
        nginx -t
        systemctl reload nginx
        log "nginx updated with SSL config"
    else
        err "Failed to obtain SSL certificate. Check DNS: dig ${DOMAIN} should point to this server's IP."
    fi
fi

# Setup certbot auto-renewal timer
systemctl enable --now certbot.timer 2>/dev/null || true

###############################################################################
# STEP 9: Install systemd services
###############################################################################
step "9/10 — Installing systemd services"

# RISE services
cp "${APP_DIR}/deploy/attentionx-api.service" /etc/systemd/system/
cp "${APP_DIR}/deploy/attentionx-metadata.service" /etc/systemd/system/

# Clean up legacy MegaETH services if they exist
systemctl stop attentionx-megaeth-api 2>/dev/null || true
systemctl stop attentionx-megaeth-metadata 2>/dev/null || true
systemctl disable attentionx-megaeth-api 2>/dev/null || true
systemctl disable attentionx-megaeth-metadata 2>/dev/null || true
rm -f /etc/systemd/system/attentionx-megaeth-api.service
rm -f /etc/systemd/system/attentionx-megaeth-metadata.service

systemctl daemon-reload

# Enable services (start on boot)
systemctl enable attentionx-api
systemctl enable attentionx-metadata

# Stop services first, kill stale processes, then start clean
systemctl stop attentionx-api 2>/dev/null || true
systemctl stop attentionx-metadata 2>/dev/null || true
sleep 2
fuser -k 3007/tcp 2>/dev/null || true
fuser -k 3006/tcp 2>/dev/null || true
sleep 1

# Start services
systemctl start attentionx-api
systemctl start attentionx-metadata

log "Services installed and started"

# Wait for startup
sleep 3

# Check status
for svc in attentionx-api attentionx-metadata; do
    if systemctl is-active --quiet "$svc"; then
        log "${svc}: RUNNING"
    else
        warn "${svc}: NOT RUNNING — check: journalctl -u ${svc} -n 50"
    fi
done

###############################################################################
# STEP 10: Cron jobs & log rotation
###############################################################################
step "10/10 — Cron jobs & log rotation"

# Make scripts executable
chmod +x "${APP_DIR}/deploy/backup-db.sh"
chmod +x "${APP_DIR}/deploy/healthcheck.sh"

# Install cron jobs (idempotent — removes old entries first)
CRON_TAG="# attentionx-managed"
(crontab -l 2>/dev/null | grep -v "$CRON_TAG") | {
    cat
    echo "0 3 * * * ${APP_DIR}/deploy/backup-db.sh ${CRON_TAG}"
    echo "*/5 * * * * ${APP_DIR}/deploy/healthcheck.sh ${CRON_TAG}"
} | crontab -

log "Cron installed: DB backup (03:00 daily), health check (every 5min)"

# Install logrotate config
cp "${APP_DIR}/deploy/logrotate.conf" /etc/logrotate.d/attentionx
log "Log rotation configured"

###############################################################################
# Verification
###############################################################################
step "Deployment Complete!"

echo ""
log "Domain: https://${DOMAIN}"
log "API:    https://${DOMAIN}/api/tournaments/active"
log "WS:     wss://${DOMAIN}/ws/token-leagues"
log "Meta:   https://${DOMAIN}/metadata/1"
echo ""

# Quick health check
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:3007/health" 2>/dev/null || echo "000")
META_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:3006/metadata/1" 2>/dev/null || echo "000")

echo -e "  ${CYAN}RISE Testnet:${NC}"
echo -e "  API health:           ${API_STATUS} $([ "$API_STATUS" = "200" ] && echo "${GREEN}OK${NC}" || echo "${RED}FAIL${NC}")"
echo -e "  Metadata health:      ${META_STATUS} $([ "$META_STATUS" = "200" ] && echo "${GREEN}OK${NC}" || echo "${RED}FAIL${NC}")"
echo ""

# Useful commands
echo -e "${CYAN}Useful commands:${NC}"
echo "  sudo bash /opt/attentionx/scripts/update.sh  # Update from GitHub"
echo "  systemctl status attentionx-api         # API status"
echo "  systemctl status attentionx-metadata    # Metadata status"
echo "  journalctl -u attentionx-api -f         # API logs (live)"
echo "  journalctl -u attentionx-metadata -f    # Metadata logs (live)"
echo "  systemctl restart attentionx-api        # Restart API"
echo "  systemctl restart attentionx-metadata   # Restart metadata"
echo "  nginx -t && systemctl reload nginx     # Reload nginx"
echo "  certbot renew --dry-run                # Test cert renewal"
echo "  ls /opt/attentionx/backups/             # DB backups"
echo "  cat /opt/attentionx/logs/healthcheck.log # Health check log"
echo ""
echo -e "${YELLOW}If services fail, check:${NC}"
echo "  - Secrets in ${ENV_FILE}"
echo "  - DNS: dig ${DOMAIN} → should return this server's IP"
echo "  - Firewall: ports 80, 443 open"
echo ""
