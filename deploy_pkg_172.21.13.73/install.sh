#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo " Deploying Linkx CDR Frontend on 172.21.13.73"
echo " Backend target: http://172.21.13.70:8000"
echo "=========================================================="

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: Please run this script with sudo: sudo bash install.sh"
    exit 1
fi

# 1. Install Nginx if missing
if ! command -v nginx >/dev/null 2>&1; then
    echo "--> Installing Nginx..."
    apt-get update -y
    apt-get install -y nginx
fi

# 2. Setup target web directory
echo "--> Deploying files to /var/www/linkx-frontend..."
mkdir -p /var/www/linkx-frontend
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cp -a "${SCRIPT_DIR}/linkxCDR2026" /var/www/linkx-frontend/
cp -a "${SCRIPT_DIR}/src" /var/www/linkx-frontend/ 2>/dev/null || true
cp -a "${SCRIPT_DIR}/public" /var/www/linkx-frontend/ 2>/dev/null || true
cp -a "${SCRIPT_DIR}/package.json" "${SCRIPT_DIR}/package-lock.json" "${SCRIPT_DIR}/vite.config.js" "${SCRIPT_DIR}/index.html" "${SCRIPT_DIR}/.env" /var/www/linkx-frontend/ 2>/dev/null || true

chown -R www-data:www-data /var/www/linkx-frontend
chmod -R 755 /var/www/linkx-frontend

# 3. Setup SSL Certificates
echo "--> Configuring SSL certificates..."
mkdir -p /etc/nginx/certs
if [ ! -f /etc/nginx/certs/linkx.crt ] || [ ! -f /etc/nginx/certs/linkx.key ]; then
    echo "--> Generating self-signed SSL certificate for 172.21.13.73..."
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout /etc/nginx/certs/linkx.key \
        -out /etc/nginx/certs/linkx.crt \
        -subj "/C=ET/ST=AddisAbaba/L=AddisAbaba/O=Linkx/OU=CDR/CN=172.21.13.73"
    chmod 600 /etc/nginx/certs/linkx.key
    chmod 644 /etc/nginx/certs/linkx.crt
fi

# 4. Install Nginx configuration
echo "--> Installing Nginx configuration..."
cp "${SCRIPT_DIR}/linkx-cdr.conf" /etc/nginx/sites-available/linkx-cdr.conf
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/linkx-cdr.conf /etc/nginx/sites-enabled/linkx-cdr.conf

# 5. Test and Restart Nginx
echo "--> Testing Nginx configuration..."
nginx -t
echo "--> Restarting Nginx service..."
systemctl enable nginx
systemctl restart nginx

echo ""
echo "=========================================================="
echo " ✅ Deployment Complete!"
echo " Access Linkx CDR at:"
echo "    https://172.21.13.73/linkxCDR2026/"
echo "=========================================================="
