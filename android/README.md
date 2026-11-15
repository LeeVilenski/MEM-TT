# Publishing MEM Table Tennis on Google Play

The Play Store version wraps the live website in a **Trusted Web Activity (TWA)**:
a real Android app that opens the game full-screen with no browser bar. Game updates
go live as soon as you deploy the website; you only rebuild the app to change its
name, icon or version.

## You need
- The game deployed on a public **HTTPS** domain (e.g. your Vercel URL).
- A Google Play developer account (one-off US$25 fee): https://play.google.com/console
- Node.js. Bubblewrap downloads Java and the Android SDK for you on first run.

## 1. Fill in your domain
In `android/twa-manifest.json`, replace every `YOUR-GAME-DOMAIN.example` with your
domain (no `https://` in `host`). Optionally change `packageId`: it's permanent once
published.

## 2. Build the app
```bash
npm i -g @bubblewrap/cli
cd android
bubblewrap update            # generates the Android project from twa-manifest.json
bubblewrap build             # creates the signing key on first run, then builds
```
This makes `app-release-bundle.aab` (upload this to Play) and `app-release-signed.apk`
(for testing on your phone).

**Back up `android/android.keystore` and its passwords somewhere safe.** If you lose
it you can never update the app. It's git-ignored on purpose.

## 3. Prove you own the website (removes the browser bar)
```bash
bubblewrap fingerprint list   # or: keytool -list -v -keystore android.keystore
```
1. Copy `android/assetlinks.template.json` to `public/.well-known/assetlinks.json`.
2. Paste the SHA-256 fingerprint in.
3. Deploy the website and check that `https://<your-domain>/.well-known/assetlinks.json` loads.

If you use **Play App Signing** (the default), also add the fingerprint shown in
Play Console → *Test and release → App integrity*, as a second entry in the
`sha256_cert_fingerprints` list.

## 4. Upload
In Play Console, create the app, upload the `.aab` to *Internal testing* first,
install it from the test link, then promote it to Production. Play also asks for
screenshots, a short description, a privacy policy URL and a content rating.

## Updating
Bump `appVersionCode` (and `appVersionName`) in `twa-manifest.json`, then run
`bubblewrap update && bubblewrap build` and upload the new `.aab`.
