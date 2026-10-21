#!/bin/bash
# deploy.sh — Automates pull + build + permission handoff for Linkx frontend
# Run ON the target server as the dev user (e.g., node18).
#
# Usage:
#   ./deploy.sh              # Build all themes (nbe + cdr)
#   ./deploy.sh cdr          # Build CDR theme only
#   ./deploy.sh nbe          # Build NBE/BDR theme only
set -e

THEME="${1:-all}"
REPO_DIR="/var/www/linkx-frontend"
DEV_USER="$(whoami)"

echo "=== Linkx Frontend Deploy ==="
echo "Theme: $THEME | User: $DEV_USER | Dir: $REPO_DIR"
echo ""

# 1. Take ownership so git and npm can write
echo "[1/4] Taking ownership of $REPO_DIR..."
sudo chown -R "$DEV_USER":"$DEV_USER" "$REPO_DIR"

# 2. Pull latest code
echo "[2/4] Pulling latest code from origin/main..."
cd "$REPO_DIR"
git fetch origin main
git reset --hard origin/main

# Re-apply executable permission to deploy.sh in case git reset altered it
chmod +x "$REPO_DIR/deploy.sh" 2>/dev/null || true

# If this machine is the remote CDR server (172.21.13.73), apply its specific .env
if hostname -I 2>/dev/null | grep -q "172.21.13.73"; then
  if [ -f "$REPO_DIR/deploy_pkg_172.21.13.73/.env" ]; then
    echo "  -> Detected 172.21.13.73 host. Applying deploy_pkg_172.21.13.73/.env..."
    cp -f "$REPO_DIR/deploy_pkg_172.21.13.73/.env" "$REPO_DIR/.env"
  fi
fi

# 3. Build
echo "[3/4] Building..."
if [ "$THEME" = "all" ]; then
  npm run build
  npm run build:cdr
elif [ "$THEME" = "cdr" ]; then
  npm run build:cdr
elif [ "$THEME" = "nbe" ]; then
  npm run build
else
  echo "Unknown theme: $THEME (expected: all, nbe, cdr)"
  exit 1
fi

# 4. Hand built assets back to Nginx
echo "[4/4] Setting Nginx ownership on build output..."
[ -d "$REPO_DIR/linkxDS2026" ]  && sudo chown -R www-data:www-data "$REPO_DIR/linkxDS2026"
[ -d "$REPO_DIR/linkxCDR2026" ] && sudo chown -R www-data:www-data "$REPO_DIR/linkxCDR2026"

echo ""
echo "=== ✅ Deploy complete ($THEME) ==="
