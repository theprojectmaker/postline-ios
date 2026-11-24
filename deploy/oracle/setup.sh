#!/usr/bin/env bash
# Postline cloud standby, one-time setup on a fresh Ubuntu 22.04/24.04 Oracle Always Free VM (ARM Ampere A1 or AMD micro).
# Run as the default user (ubuntu):   bash setup.sh
# Needs ~/postline-secrets.tar.gz (made on the PC by deploy/oracle/pack-secrets.ps1 and copied up with scp).
set -euo pipefail
cd ~
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates xvfb x11vnc novnc websockify fonts-liberation
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
[ -d postline ] || git clone https://github.com/theprojectmaker/postline-ios.git postline
cd postline && git pull --ff-only
cd bridge && npm install --no-audit --no-fund
npx playwright-core install --with-deps chromium          # Playwright's own Chromium (Google Chrome has no Linux ARM build)
[ -f ~/postline-secrets.tar.gz ] || { echo "Missing ~/postline-secrets.tar.gz - copy it up with scp first"; exit 1; }
tar -xzf ~/postline-secrets.tar.gz -C ~/postline/bridge   # config.json (role cloud + keys) and ck-private.pem
chmod 600 ~/postline/bridge/config.json ~/postline/bridge/ck-private.pem
rm -f ~/postline-secrets.tar.gz
# keep the VM from being reclaimed as "idle": a little steady CPU use is normal for a running bridge, nothing extra needed.
sed "s#__USER__#$USER#g; s#__HOME__#$HOME#g; s#__NODE__#$(command -v node)#g" ~/postline/deploy/oracle/postline-bridge.service | sudo tee /etc/systemd/system/postline-bridge.service >/dev/null
sudo systemctl daemon-reload
echo
echo "Setup done. NEXT: sign in to Gmail once with  bash ~/postline/deploy/oracle/login.sh  (see README.md), then:"
echo "  sudo systemctl enable --now postline-bridge"
