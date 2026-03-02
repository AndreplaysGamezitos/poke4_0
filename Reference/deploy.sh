#!/bin/bash
# PokeFodase v2.0 - Deployment Script
# Run this on the server after pushing new code to GitHub
set -e

echo "========================================="
echo "  PokeFodase v2.0 - Deploy"
echo "========================================="

cd /var/www/pokefodase

# Pull latest code from main branch
echo ""
echo "[1/4] Pulling latest code from GitHub..."
git pull origin main

# Install/update WebSocket server dependencies
echo ""
echo "[2/4] Updating Node.js dependencies..."
cd websocket
npm install --production
cd ..

# Restart WebSocket server via PM2
echo ""
echo "[3/4] Restarting WebSocket server..."
pm2 restart pokefodase-ws

# Restart PHP-FPM to clear opcache
echo ""
echo "[4/4] Restarting PHP-FPM..."
sudo systemctl restart php8.1-fpm

echo ""
echo "========================================="
echo "  Deploy complete!"
echo "========================================="
echo ""
echo "Verify:"
echo "  pm2 status"
echo "  curl http://localhost:3001/health"
echo "  sudo systemctl status php8.1-fpm"
echo ""
