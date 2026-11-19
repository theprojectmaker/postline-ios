# Postline bridge (runs on the PC, on the open network)

Copies Gmail into Apple CloudKit and carries the iPad's requests (send, reply, archive, ...) back to Gmail.

## Default: Gmail website backend (no Google API approval needed)
Works like the Classroom checker: a headless Chrome with its own profile (`bridge/profile`, gitignored) is signed in to Gmail once.
1. Run `bridge\login-gmail.cmd`, sign in to the Gmail account, wait for the inbox, **close the Chrome window**.
2. `node bridge/probe.mjs` (add `--show` to watch) — checks it can read your inbox.
3. `node bridge/bridge.mjs --once`, then `powershell -File bridge/install-task.ps1` to keep it running at every login.

## Optional: Gmail API backend
Set `"backend": "api"` in `bridge/config.json` plus a Google OAuth Desktop client (`{"google":{"clientId","clientSecret"}}`), then `node bridge/auth.mjs`.
Only possible when the account allows third-party OAuth apps.

CloudKit defaults to the Classroom Feed container and key on this PC (`../classroom-bot/.ck`); Postline's records are all named `pl-*`.
Override with `"ck": { container, environment, keyId, pemPath }` in config.json. Nothing in config/profile/secrets is committed.
