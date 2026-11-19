@echo off
rem One-time Gmail sign-in for the Postline bridge. Opens Chrome with the bridge's OWN profile (your normal Chrome is untouched).
rem Sign in to the Gmail account, wait until your inbox shows, then CLOSE the Chrome window.
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%~dp0profile" --no-first-run --no-default-browser-check --disable-background-mode https://mail.google.com/
