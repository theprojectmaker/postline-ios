#!/usr/bin/env bash
# One-time Gmail sign-in on the VM. Starts a virtual screen + Chromium (plain, not automated, so Google accepts the login)
# and a browser-based remote view on localhost:6080 that you reach through an SSH tunnel (see README.md).
# Sign in to the school Gmail, wait for the inbox, then press Ctrl+C here.
set -euo pipefail
PROFILE="$HOME/postline/bridge/profile"
CHROME=$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)
[ -x "$CHROME" ] || { echo "Chromium not found - run setup.sh first"; exit 1; }
sudo systemctl stop postline-bridge 2>/dev/null || true
export DISPLAY=:99
Xvfb :99 -screen 0 1280x900x24 &  XV=$!
sleep 2
x11vnc -display :99 -localhost -nopw -forever -quiet &  VN=$!
websockify --web /usr/share/novnc 6080 localhost:5900 &  WS=$!
trap 'kill $XV $VN $WS $CH 2>/dev/null || true' EXIT
"$CHROME" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check --no-sandbox --password-store=basic --window-size=1280,900 https://mail.google.com/ &  CH=$!
echo "Ready. Open http://localhost:6080/vnc.html through your SSH tunnel, click Connect, sign in to Gmail."
wait $CH
