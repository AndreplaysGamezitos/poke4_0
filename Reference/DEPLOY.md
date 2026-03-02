# PokeFodase v2.0 — Shipping & Deployment Guide

> Complete step-by-step guide to take PokeFodase from local dev to a live production server.
>
> **Your setup**: Hostinger VPS (Ubuntu 22.04, `72.61.43.131`) already running another game server. This guide covers deploying PokeFodase **alongside** the existing project on the same VPS using subdomain-based virtual hosting.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Multi-Site Architecture (Shared VPS)](#2-multi-site-architecture-shared-vps)
3. [VPS Initial Setup](#3-vps-initial-setup)
4. [Server Software Installation](#4-server-software-installation)
5. [Subdomain & SSL Setup](#5-subdomain--ssl-setup)
6. [Database Setup](#6-database-setup)
7. [Deploy Application Code](#7-deploy-application-code)
8. [Production Configuration Changes](#8-production-configuration-changes)
9. [WebSocket Server (PM2)](#9-websocket-server-pm2)
10. [Nginx Configuration (Multi-Site)](#10-nginx-configuration-multi-site)
11. [Firewall & Security](#11-firewall--security)
12. [GitHub Integration](#12-github-integration)
13. [Launch Checklist](#13-launch-checklist)
14. [Monitoring & Maintenance](#14-monitoring--maintenance)
15. [Rollback Plan](#15-rollback-plan)
16. [Cost Estimate](#16-cost-estimate)

---

## 1. Prerequisites

### What You Already Have (Confirmed)

| Item | Your Setup | Status |
|------|-----------|--------|
| **VPS** | Hostinger KVM 1 — Ubuntu 22.04 LTS, IP `72.61.43.131` | ✅ Running |
| **Nginx** | v1.18.0 — listening on port 80 | ✅ Installed |
| **Node.js** | v20.19.6 | ✅ Installed |
| **npm** | v10.8.2 | ✅ Installed |
| **PM2** | v6.0.14 — running `umbra-server` on port 3000 | ✅ Installed |
| **Existing game** | `umbra-server` — files at `/var/www/u/`, port 3000 | ✅ Running |
| **Domain** | `umbra` subdomain A record → `72.61.43.131` | ✅ Configured |
| **GitHub repo** | `AndreplaysGamezitos/pokefds` — code already uploaded | ✅ Ready |

### What You Still Need to Install / Configure

| Item | Details | Section |
|------|---------|---------|
| **PHP 8.1 + FPM** | Not installed on server — PokeFodase needs it for the API | [§4.1](#41-install-php-81--fpm-required) |
| **MySQL / MariaDB Server** | Not installed — needed for the database | [§4.2](#42-install-mariadb-required) |
| **Certbot** | For free SSL on the new subdomain | [§5.2](#52-get-ssl-certificate-for-the-new-subdomain) |
| **New DNS subdomain** | A new A record for PokeFodase (e.g. `poke.labzts.fun`) | [§5.1](#51-create-a-new-subdomain-for-pokefodase) |
| **Free port** | PokeFodase WS uses **port 3001** (port 3000 is taken by `umbra-server`) | [§8](#8-production-configuration-changes) |

---

## 2. Multi-Site Architecture (Shared VPS)

### How It Works

Nginx acts as a **reverse proxy / traffic router**. When a request arrives at your VPS on port 80/443, Nginx looks at the **subdomain** in the request and routes it to the correct project:

```
                        ┌─────────────────────────────────┐
                        │         YOUR VPS (72.61.43.131) │
                        │                                 │
  umbra.labzts.fun ────►│  Nginx ──► /var/www/u/          │  (existing game)
                        │       │                         │
  poke.labzts.fun ─────►│       └──► /var/www/pokefodase/ │  (PokeFodase)
                        │                                 │
  wss://poke.labzts.    │  Nginx /ws ──► Node.js :3001    │  (WebSocket)
       fun/ws ─────────►│                                 │
                        └─────────────────────────────────┘
```

### Key Isolation Rules

| Resource | Umbra (existing) | PokeFodase (new) |
|----------|--------------|------------|
| **Web root** | `/var/www/u/` | `/var/www/pokefodase/` |
| **Nginx config** | existing config in `sites-enabled/` | `/etc/nginx/sites-available/pokefodase` |
| **Database** | (Umbra doesn't use MySQL) | `pokefodase` (new DB) |
| **Node.js port** | **3000** (`umbra-server`) | **3001** (different port!) |
| **PM2 process** | `umbra-server` (id 0) | `pokefodase-ws` (id 1) |
| **SSL cert** | Its own cert | Its own cert (Certbot handles this) |
| **Subdomain** | `umbra.labzts.fun` | `poke.labzts.fun` |

> **⚠️ Confirmed**: Port `3000` is in use by `umbra-server`. PokeFodase **must** use port `3001`.

---

## 3. VPS Initial Setup

### 3.1 SSH Into Your Server

```powershell
# From your Windows machine:
ssh root@72.61.43.131
```

### 3.2 Server State (Already Checked ✅)

You've already run the checks. Here's what we confirmed:

```
✅ nginx       → v1.18.0 (listening on port 80)
❌ php         → NOT installed (need php8.1-fpm + extensions)
❌ mysql       → NOT installed (need mariadb-server)
✅ node        → v20.19.6
✅ npm         → v10.8.2
✅ pm2         → v6.0.14
✅ umbra-server → online on port 3000, running from /var/www/u/
```

**Ports currently in use:**

| Port | Service |
|------|---------|
| 22 | SSH |
| 53 | systemd-resolve (DNS) |
| 80 | Nginx |
| 3000 | umbra-server (Node.js) |
| 65529 | monarx-agent |

**Port 3001 is free** → PokeFodase WebSocket will use it.

---

## 4. Server Software Installation

> Nginx, Node.js, npm, and PM2 are already installed. You only need **PHP** and **MariaDB**.

### 4.1 Install PHP 8.1 + FPM (**Required**)

PHP is not installed on your server. PokeFodase needs it for all the API endpoints:

```bash
sudo apt update
sudo add-apt-repository ppa:ondrej/php -y
sudo apt update
sudo apt install -y php8.1-fpm php8.1-mysql php8.1-curl php8.1-mbstring php8.1-xml php8.1-cli

# Enable and start PHP-FPM
sudo systemctl enable php8.1-fpm
sudo systemctl start php8.1-fpm

# Verify
php -v                # Should show PHP 8.1.x
php -m | grep pdo     # Should show pdo_mysql
sudo systemctl status php8.1-fpm   # Should show "active (running)"
```

### 4.2 Install MariaDB (**Required**)

MySQL/MariaDB is not installed. PokeFodase needs it for the game database:

```bash
sudo apt install -y mariadb-server mariadb-client
sudo systemctl enable mariadb
sudo systemctl start mariadb

# Secure the installation
sudo mysql_secure_installation
# → Set root password: YES (pick a strong one, write it down)
# → Remove anonymous users: YES
# → Disallow root login remotely: YES
# → Remove test database: YES
# → Reload privilege tables: YES

# Verify
mysql --version   # Should show MariaDB 10.6.x
sudo systemctl status mariadb   # Should show "active (running)"
```

### 4.3 Install Certbot for SSL (**Required**)

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### Already Installed — Skip These

| Software | Version | Notes |
|----------|---------|-------|
| ~~Nginx~~ | v1.18.0 | ✅ Already running |
| ~~Node.js~~ | v20.19.6 | ✅ Already installed |
| ~~npm~~ | v10.8.2 | ✅ Already installed |
| ~~PM2~~ | v6.0.14 | ✅ Already running `umbra-server` |

---

## 5. Subdomain & SSL Setup

### 5.1 Create a New Subdomain for PokeFodase

In your **Hostinger DNS panel** (the same place you set up `umbra`), add a new A record:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `poke` | `72.61.43.131` | 3600 |

This creates `poke.labzts.fun` pointing to your VPS.

> **✅ Already done** — your DNS panel shows both records configured:
> - `umbra.labzts.fun` → existing game
> - `poke.labzts.fun` → PokeFodase v2.0

Wait for DNS propagation (5-30 minutes). Test with:

```bash
# From your local machine:
ping poke.labzts.fun
# Should resolve to 72.61.43.131
```

### 5.2 Get SSL Certificate for the New Subdomain

```bash
# On the server — this will NOT affect your existing game's cert:
sudo certbot --nginx -d poke.labzts.fun

# Test auto-renewal:
sudo certbot renew --dry-run
```

> Certbot manages each subdomain's certificate independently. Your existing `umbra` cert is untouched.

---

## 6. Database Setup

### 6.1 Create a SEPARATE Database and User

Your existing game has its own database. PokeFodase gets a completely separate one:

```bash
sudo mysql -u root -p
```

```sql
-- This does NOT affect your existing game's database
CREATE DATABASE pokefodase CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'pokefodase_user'@'localhost' IDENTIFIED BY 'YOUR_STRONG_DB_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON pokefodase.* TO 'pokefodase_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> **Safe**: This creates a new DB and user. Your existing game's database is untouched. The `pokefodase_user` can ONLY access the `pokefodase` database.

### 6.2 Import the Database Schema

After deploying code (Section 7), import your schema:

> **⚠️ Note**: `migration_v2.sql` uses `ALTER TABLE` on tables like `players`, `rooms`, `player_pokemon`, `pokemon_dex`, and `town_actions`. If this is a fresh install (no existing base tables), you'll need to create the base schema first. Check if you have base SQL files from the earlier version of the project, or create the base tables manually before running the migration.

```bash
cd /var/www/pokefodase

# Run the v2.0 migration (the only SQL file in the repo)
sudo mysql -u pokefodase_user -p pokefodase < database/migration_v2.sql
```

### 6.3 Verify Migration

```bash
sudo mysql -u pokefodase_user -p pokefodase -e "SHOW TABLES;"
```

You should see: `accounts`, `elo_history`, `game_placements`, `ranked_queue`, `game_events`, `game_rooms`, `player_pokemon`, `players`, `pokemon_dex`, `route_pokemon`, `routes`

---

## 7. Deploy Application Code

### 7.1 Create the Web Root

Your existing game lives in `/var/www/u/`. PokeFodase goes in a completely separate folder:

```bash
sudo mkdir -p /var/www/pokefodase
sudo chown -R root:root /var/www/pokefodase
```

### 7.2 Deploy via GitHub (Recommended)

Your repo is already on GitHub at `AndreplaysGamezitos/pokefds`. The game files are inside a `Web_Experiment_2.0/` subfolder in the repo, so you need to clone and then move them up to the web root:

```bash
cd /var/www/pokefodase
git clone https://github.com/AndreplaysGamezitos/pokefds.git temp
mv temp/Web_Experiment_2.0/* .
mv temp/Web_Experiment_2.0/.* . 2>/dev/null   # hidden files like .gitignore (ignore errors)
rm -rf temp
```

Verify the structure is correct — `index.html` should be at the root:

```bash
ls /var/www/pokefodase/
# Should show: api/  config.php  css/  database/  fonts/  Guidelines/  index.html  js/  README.md  websocket/
```

> **⚠️ Important**: Do NOT leave the files inside a subfolder. Nginx's `root` points to `/var/www/pokefodase`, so `index.html` must be directly there, not in `/var/www/pokefodase/Web_Experiment_2.0/`.

### 7.3 Deploy via SCP (Alternative)

From your **local Windows machine**:

```powershell
# Upload everything via SCP
scp -r "D:\Game Dev\PokemonFDS\Web_Experiment_2.0\*" root@72.61.43.131:/var/www/pokefodase/
```

### 7.4 Install WebSocket Server Dependencies

On the **server**:

```bash
cd /var/www/pokefodase/websocket
npm install --production
```

### 7.5 Set Permissions

```bash
sudo chown -R root:www-data /var/www/pokefodase
sudo chmod -R 755 /var/www/pokefodase

# PHP needs to write session files, nothing else
# Make sure config.php is not world-readable
chmod 640 /var/www/pokefodase/config.php
```

---

## 8. Production Configuration Changes

> **⚠️ PORT 3000 IS TAKEN**: Confirmed — `umbra-server` is running on port 3000. PokeFodase uses port **`3001`**. Be consistent across all config files below.

### 8.1 `config.php` — Database Credentials & Security

```php
// CHANGE THESE to your production database credentials:
define('DB_HOST', 'localhost');
define('DB_NAME', 'pokefodase');
define('DB_USER', 'pokefodase_user');
define('DB_PASS', 'YOUR_STRONG_DB_PASSWORD_HERE');

// DISABLE error display in production:
ini_set('display_errors', 0);   // Change from 1 to 0
ini_set('log_errors', 1);       // Keep logging to server log
```

### 8.2 `api/broadcast.php` — WebSocket Endpoint & Secret

```php
// Use port 3001 to avoid conflicts with existing game server:
define('WS_SERVER_URL', 'http://localhost:3001/broadcast');

// CHANGE to a strong, random secret (32+ characters):
define('WS_BROADCAST_SECRET', 'YOUR_STRONG_RANDOM_SECRET_32_CHARS');

// ENABLE WebSocket mode:
define('WS_ENABLED', true);
```

### 8.3 `js/game.js` — WebSocket Client URL

```javascript
const WS_CONFIG = {
    // Use wss:// with your subdomain (Nginx proxies /ws → Node.js on port 3001)
    url: 'wss://poke.labzts.fun/ws',
    enabled: true,       // ← CHANGE from false to true
    reconnectDelay: 3000,
    maxReconnectAttempts: 10
};
```

### 8.4 `websocket/server.js` — Environment Variables

Set via PM2 ecosystem file (see Section 9) — no code changes needed, just env vars:

```
PORT=3001
BROADCAST_SECRET=YOUR_STRONG_RANDOM_SECRET_32_CHARS   # Must match broadcast.php
```

### 8.5 Summary of All Values to Change

| File | Setting | Dev Value | Production Value |
|------|---------|-----------|------------------|
| `config.php` | `DB_HOST` | `localhost` | `localhost` |
| `config.php` | `DB_NAME` | `u141652417_pokeweb` | `pokefodase` |
| `config.php` | `DB_USER` | `u141652417_pokewebuser` | `pokefodase_user` |
| `config.php` | `DB_PASS` | `Poke1b2c3**` | **strong random password** |
| `config.php` | `display_errors` | `1` | `0` |
| `broadcast.php` | `WS_SERVER_URL` | `http://localhost:3000/broadcast` | `http://localhost:3001/broadcast` |
| `broadcast.php` | `WS_BROADCAST_SECRET` | `pokefodase_secret_key...` | **strong random secret** |
| `broadcast.php` | `WS_ENABLED` | `true` | `true` |
| `game.js` | `WS_CONFIG.url` | `ws://localhost:3000` | `wss://poke.labzts.fun/ws` |
| `game.js` | `WS_CONFIG.enabled` | `false` | `true` |

> **⚠️ IMPORTANT**: Never commit production secrets to GitHub. Use a `.env` file or edit `config.php` directly on the server after deployment.

---

## 9. WebSocket Server (PM2)

> PM2 can run multiple apps side by side. Your existing game's PM2 process is unaffected.

### 9.1 Create PM2 Ecosystem File

Create `/var/www/pokefodase/websocket/ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'pokefodase-ws',
    script: 'server.js',
    cwd: '/var/www/pokefodase/websocket',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,  // ← Use 3001 to avoid conflict with existing game
      BROADCAST_SECRET: 'YOUR_STRONG_RANDOM_SECRET_32_CHARS'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/var/log/pokefodase-ws/error.log',
    out_file: '/var/log/pokefodase-ws/out.log',
    merge_logs: true
  }]
};
```

### 9.2 Create Log Directory & Start

```bash
sudo mkdir -p /var/log/pokefodase-ws

cd /var/www/pokefodase/websocket
pm2 start ecosystem.config.js

# Save process list so PM2 restarts BOTH apps on reboot
pm2 save
pm2 startup  # Follow the output instructions (run the generated sudo command)
```

### 9.3 Verify Both PM2 Processes

```bash
pm2 status
# You should see BOTH umbra-server AND pokefodase-ws running:
#  ┌─────────────────┬────┬─────────┬────────┬─────────┐
#  │ name            │ id │ mode    │ status │ user    │
#  ├─────────────────┼────┼─────────┼────────┼─────────┤
#  │ umbra-server    │ 0  │ fork    │ online │ root    │
#  │ pokefodase-ws   │ 1  │ fork    │ online │ root    │
#  └─────────────────┴────┴─────────┴────────┴─────────┘

pm2 logs pokefodase-ws      # View PokeFodase logs only
pm2 restart pokefodase-ws   # Restart PokeFodase only (umbra-server unaffected)
pm2 stop pokefodase-ws      # Stop PokeFodase only (umbra-server unaffected)
pm2 monit                   # Real-time monitoring
```

---

## 10. Nginx Configuration (Multi-Site)

> **Key concept**: Each site gets its own Nginx config file with its own `server_name`. Nginx uses the subdomain in the request to decide which config block to use. Your existing Umbra game's config is **completely untouched**.

### 10.1 Check Your Existing Nginx Config

```bash
# See what sites are currently enabled:
ls -la /etc/nginx/sites-enabled/

# Look at the existing umbra config to understand the pattern:
cat /etc/nginx/sites-enabled/*
```

### 10.2 Create PokeFodase Site Configuration

Create a **new, separate** file `/etc/nginx/sites-available/pokefodase`:

```nginx
server {
    listen 80;
    server_name poke.labzts.fun;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name poke.labzts.fun;

    # SSL (Certbot will fill these in, or set them manually)
    ssl_certificate /etc/letsencrypt/live/poke.labzts.fun/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/poke.labzts.fun/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # PokeFodase web root (separate from Umbra at /var/www/u/)
    root /var/www/pokefodase;
    index index.html index.php;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Hide sensitive files
    location ~ /\. {
        deny all;
    }
    location ~ config\.php$ {
        deny all;
    }
    location ~ /database/ {
        deny all;
    }
    location ~ /Guidelines/ {
        deny all;
    }
    location ~ /websocket/ {
        deny all;
    }

    # PHP processing
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.1-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }

    # WebSocket proxy (client connections: wss://poke.labzts.fun/ws)
    # Routes to port 3001 (PokeFodase), NOT 3000 (umbra-server)
    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;    # 24h - keep WS connections alive
        proxy_send_timeout 86400;
    }

    # WebSocket broadcast endpoint (PHP → Node.js, internal only)
    location /broadcast {
        # Only allow PHP (localhost) to hit this
        allow 127.0.0.1;
        deny all;
        proxy_pass http://127.0.0.1:3001/broadcast;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SSE endpoint — allow long-lived connections
    location = /api/sse.php {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.1-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_read_timeout 300;        # 5 min timeout for SSE
        fastcgi_buffering off;           # Don't buffer SSE events
        proxy_buffering off;
    }

    # Static file caching
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 256;
}
```

### 10.3 Enable the Site

```bash
# Create symlink to enable the site (does NOT touch Umbra's config)
sudo ln -s /etc/nginx/sites-available/pokefodase /etc/nginx/sites-enabled/

# Do NOT remove the default or Umbra's config!
# Just add pokefodase alongside them.

# Test ALL configs (both your existing game and PokeFodase):
sudo nginx -t

# If test passes, reload (zero-downtime for existing connections):
sudo systemctl reload nginx
```

### 10.4 Verify Both Sites Work

```bash
# Umbra should still work:
curl -I https://umbra.labzts.fun

# PokeFodase should now also work:
curl -I https://poke.labzts.fun

# WebSocket health (internal):
curl http://localhost:3001/health
```

---

## 11. Firewall & Security

### 11.1 UFW Firewall

Your VPS doesn't appear to have firewall rules set yet. Set up UFW:

```bash
# Check current state
sudo ufw status

# If inactive, set it up:
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # Allows both 80 and 443
# Do NOT open port 3001 — Nginx proxies it via /ws
# Do NOT open port 3000 — Nginx should proxy umbra-server too
sudo ufw enable
sudo ufw status
```

> **⚠️ Important**: Make sure you `allow OpenSSH` BEFORE enabling UFW, or you'll lock yourself out!

### 11.2 Fail2Ban (Brute-Force Protection)

```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 11.3 PHP Security (php.ini)

Edit `/etc/php/8.1/fpm/php.ini`:

```ini
expose_php = Off
session.cookie_httponly = 1
session.cookie_secure = 1
session.use_strict_mode = 1
```

Then restart PHP-FPM:

```bash
sudo systemctl restart php8.1-fpm
```

### 11.4 MySQL Security

- The DB user (`pokefodase_user`) is restricted to `localhost` only
- Root login is disabled remotely (from `mysql_secure_installation`)
- **Never expose port 3306 to the internet**

---

## 12. GitHub Integration

### 12.1 Your Repo Is Already Set Up

Your code is already at `github.com/AndreplaysGamezitos/pokefds`. The `.gitignore` in the project root ensures secrets and `node_modules` aren't committed.

When you make changes locally, push them:

```powershell
cd "D:\Game Dev\PokemonFDS\Web_Experiment_2.0"
git add .
git commit -m "Description of changes"
git push origin main
```

### 12.2 Simple Server Deploy Script

Create `/var/www/pokefodase/deploy.sh` (on the server):

```bash
#!/bin/bash
set -e

echo "=== PokeFodase Deploy ==="
cd /var/www/pokefodase

# Pull latest code
echo "Pulling latest code..."
git pull origin main

# Install/update WebSocket dependencies
echo "Updating Node.js dependencies..."
cd websocket
npm install --production
cd ..

# Restart WebSocket server
echo "Restarting WebSocket server..."
pm2 restart pokefodase-ws

# Restart PHP-FPM (clears opcache)
echo "Restarting PHP-FPM..."
sudo systemctl restart php8.1-fpm

echo "=== Deploy complete! ==="
echo "Check status: pm2 status && sudo systemctl status php8.1-fpm"
```

```bash
chmod +x /var/www/pokefodase/deploy.sh
```

### 12.3 Deploy Workflow

Every time you push a new commit:

```bash
# On the server:
cd /var/www/pokefodase
./deploy.sh
```

### 12.4 (Optional) GitHub Actions Auto-Deploy

Create `.github/workflows/deploy.yml` in your repo:

```yaml
name: Deploy to VPS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /var/www/pokefodase
            ./deploy.sh
```

Set these GitHub repo secrets (Settings → Secrets → Actions):

| Secret | Value |
|--------|-------|
| `VPS_HOST` | `72.61.43.131` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | Contents of your private SSH key |

---

## 13. Launch Checklist

Run through this checklist before going live:

### Infrastructure
- [ ] VPS is provisioned and accessible via SSH
- [ ] Subdomain DNS `poke.labzts.fun` is pointing to VPS IP (`72.61.43.131`)
- [ ] SSL certificate is installed and auto-renewing
- [ ] Firewall allows only SSH (22), HTTP (80), HTTPS (443)
- [ ] Port 3001 is **NOT** exposed to the internet (Nginx proxies it)
- [ ] `umbra-server` still works after all changes (`pm2 status` shows online)
- [ ] Umbra site still loads normally

### Database
- [ ] MySQL is running
- [ ] Production database & user created
- [ ] All schema SQL files imported
- [ ] `migration_v2.sql` executed successfully
- [ ] Tables verified: `accounts`, `elo_history`, `ranked_queue`, `game_placements`, etc.
- [ ] DB password is strong and NOT the dev default

### Application Code
- [ ] Code deployed to `/var/www/pokefodase`
- [ ] File permissions are correct (755 dirs, 644 files, 640 for config.php)
- [ ] `config.php` has production DB credentials
- [ ] `config.php` has `display_errors = 0`
- [ ] `api/broadcast.php` has strong `WS_BROADCAST_SECRET`
- [ ] `api/broadcast.php` has `WS_ENABLED = true`
- [ ] `js/game.js` `WS_CONFIG.url` points to `wss://poke.labzts.fun/ws`
- [ ] `js/game.js` `WS_CONFIG.enabled` is `true`

### WebSocket Server
- [ ] `npm install --production` completed in `websocket/`
- [ ] `ecosystem.config.js` has matching `BROADCAST_SECRET`
- [ ] PM2 is running: `pm2 status` shows `pokefodase-ws` as `online`
- [ ] PM2 startup configured: `pm2 startup && pm2 save`
- [ ] WebSocket health check works: `curl http://localhost:3001/health`

### Nginx
- [ ] Site config is in `/etc/nginx/sites-enabled/`
- [ ] `nginx -t` passes
- [ ] HTTPS works: `https://poke.labzts.fun` loads the game
- [ ] WebSocket proxy works: browser console shows `[WS] Connected`
- [ ] Sensitive files blocked: `/config.php`, `/database/`, `/websocket/` return 403

### Functional Tests
- [ ] Can create an account (nickname + code)
- [ ] Can login with existing code
- [ ] Can create a casual room
- [ ] Can join a room with code
- [ ] Two players can complete a full catch → town → tournament cycle
- [ ] Stat items can be purchased and show in team view
- [ ] Leaderboard loads
- [ ] SSE fallback works when WebSocket is disabled

---

## 14. Monitoring & Maintenance

### 14.1 Log Locations

| Service | Log Path |
|---------|----------|
| Nginx access | `/var/log/nginx/access.log` |
| Nginx errors | `/var/log/nginx/error.log` |
| PHP-FPM | `/var/log/php8.1-fpm.log` |
| WebSocket (PM2) | `/var/log/pokefodase-ws/out.log` |
| WebSocket errors (PM2) | `/var/log/pokefodase-ws/error.log` |
| MySQL | `/var/log/mysql/error.log` |

### 14.2 Quick Health Checks

```bash
# All services running?
sudo systemctl status nginx php8.1-fpm mariadb
pm2 status

# PokeFodase WebSocket alive? (port 3001)
curl http://localhost:3001/health

# PokeFodase WebSocket stats?
curl http://localhost:3001/stats

# Existing game's WS still alive? (umbra-server on port 3000)
curl http://localhost:3000/health

# Database responsive?
mysql -u pokefodase_user -p pokefodase -e "SELECT COUNT(*) FROM accounts;"

# Disk space?
df -h

# Memory usage?
free -h

# Active connections?
ss -tlnp | grep -E '(80|443|3000|3001)'
```

### 14.3 Database Backup (Cron Job)

```bash
# Create backup script
sudo mkdir -p /var/backups/pokefodase

cat << 'EOF' | sudo tee /var/backups/pokefodase/backup.sh
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/pokefodase"
mysqldump -u pokefodase_user -p'YOUR_DB_PASSWORD' pokefodase | gzip > "${BACKUP_DIR}/pokefodase_${TIMESTAMP}.sql.gz"
# Keep only last 14 days of backups
find ${BACKUP_DIR} -name "*.sql.gz" -mtime +14 -delete
echo "Backup complete: pokefodase_${TIMESTAMP}.sql.gz"
EOF

sudo chmod +x /var/backups/pokefodase/backup.sh

# Add to cron (daily at 3am)
(sudo crontab -l 2>/dev/null; echo "0 3 * * * /var/backups/pokefodase/backup.sh >> /var/log/pokefodase-backup.log 2>&1") | sudo crontab -
```

### 14.4 Log Rotation

PM2 handles its own log rotation. For extra safety:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## 15. Rollback Plan

If something goes wrong after a deploy:

### Quick Rollback (Git)

```bash
cd /var/www/pokefodase

# See recent commits
git log --oneline -10

# Revert to previous commit
git checkout HEAD~1

# Restart services
pm2 restart pokefodase-ws
sudo systemctl restart php8.1-fpm
```

### Database Rollback

```bash
# Restore from latest backup
gunzip < /var/backups/pokefodase/pokefodase_LATEST.sql.gz | mysql -u pokefodase_user -p pokefodase
```

---

## 16. Cost Estimate

| Item | Monthly Cost |
|------|-------------|
| VPS (already have it — shared with other game) | **$0 extra** |
| Domain (already have it — new subdomain is free) | **$0 extra** |
| SSL (Let's Encrypt) | **Free** |
| GitHub (public or free private) | **Free** |
| **Total additional cost** | **$0/month** |

---

## Quick-Start Summary (TL;DR)

Your VPS has Nginx, Node.js, npm, PM2 already. You need PHP and MariaDB. Here's the shortest path:

```bash
# 1. SSH into your VPS
ssh root@72.61.43.131

# 2. Install PHP and MariaDB (the only things missing)
sudo add-apt-repository ppa:ondrej/php -y && sudo apt update
sudo apt install -y php8.1-fpm php8.1-mysql php8.1-curl php8.1-mbstring php8.1-xml php8.1-cli
sudo apt install -y mariadb-server mariadb-client
sudo apt install -y certbot python3-certbot-nginx
sudo systemctl enable php8.1-fpm mariadb
sudo systemctl start php8.1-fpm mariadb
sudo mysql_secure_installation

# 3. Create PokeFodase database (separate from your other game's DB)
sudo mysql -e "CREATE DATABASE pokefodase CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'pf_user'@'localhost' IDENTIFIED BY 'STRONG_PASS'; GRANT ALL ON pokefodase.* TO 'pf_user'@'localhost';"

# 4. Clone repo into a NEW folder (your other game is untouched)
sudo mkdir -p /var/www/pokefodase
cd /var/www/pokefodase
git clone https://github.com/AndreplaysGamezitos/pokefds.git temp
mv temp/Web_Experiment_2.0/* . && mv temp/Web_Experiment_2.0/.* . 2>/dev/null; rm -rf temp
# Verify: ls should show index.html, config.php, api/, js/, etc.

# 5. Import database (migration_v2.sql needs base tables — see §6.2)
mysql -u pf_user -p pokefodase < database/migration_v2.sql

# 6. Edit config files ON THE SERVER (don't commit secrets!)
#    config.php       → production DB creds, display_errors=0
#    api/broadcast.php → WS_SERVER_URL=http://localhost:3001/broadcast, strong secret
#    js/game.js        → WS_CONFIG.url='wss://poke.labzts.fun/ws', enabled=true

# 7. Start WebSocket on port 3001 (umbra-server keeps port 3000)
cd websocket && npm install --production
PORT=3001 BROADCAST_SECRET='your_secret' pm2 start server.js --name pokefodase-ws
pm2 save && pm2 startup

# 8. Add new subdomain DNS record: poke → 72.61.43.131 (already done ✅)

# 9. Create Nginx config for poke.labzts.fun (Section 10)
#    Points to /var/www/pokefodase, proxies /ws to port 3001

# 10. Get SSL
sudo certbot --nginx -d poke.labzts.fun

# 11. Open browser → https://poke.labzts.fun 🎮
#     Umbra at https://umbra.labzts.fun still works ✅
```

---

*Last updated for PokeFodase v2.0*
