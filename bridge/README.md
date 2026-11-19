# Postline bridge (runs on the PC, on the open network)

Copies Gmail into Apple CloudKit and carries the iPad's requests (send, reply, archive, …) back to Gmail.

## One-time setup
1. **Google OAuth client** (needs a human, ~3 min): https://console.cloud.google.com → new project → *APIs & Services* → enable **Gmail API** →
   *OAuth consent screen* (External; add your Gmail as a test user, then **Publish app** so the login does not expire after 7 days) →
   *Credentials* → **Create credentials → OAuth client ID → Desktop app**. Put the ID and secret in `bridge/config.json`:
   `{ "google": { "clientId": "…", "clientSecret": "…" } }`
2. `node bridge/auth.mjs` — Google sign-in in your browser; saves the refresh token to `bridge/.secrets/gmail.json` (gitignored).
3. `node bridge/bridge.mjs --once` — one test pass. Then `powershell -File bridge/install-task.ps1` to keep it running at every login.

CloudKit defaults to the Classroom Feed container and key on this PC (`../classroom-bot/.ck`); Postline's records are all named `pl-*`.
Override with `"ck": { container, environment, keyId, pemPath }` in config.json. Nothing in this folder's config/secrets is committed.
