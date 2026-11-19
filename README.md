# Postline

Your Gmail on a Wi-Fi that only allows Apple. An Expo iOS app that reads and sends Gmail by relaying through Apple CloudKit's public
database; a Node bridge on a PC (open network) syncs Gmail <-> CloudKit. See `bridge/README.md` for setup.

- `src/` app (iPad: sidebar + list + conversation; iPhone: stacked) · `src/cloudcore.js` signed CloudKit REST · `src/seed.js` filled by CI
- `bridge/` PC bridge (Gmail API, OAuth refresh token kept locally) · `scripts/` icon, seed, tests
- CI: `.github/workflows/ios-testflight.yml` (secrets: EXPO_TOKEN, CF_SEED, ARTIFACT_KEY, ASC_KEY_ID, ASC_ISSUER_ID, ASC_API_KEY; variable ASC_APP_ID)
