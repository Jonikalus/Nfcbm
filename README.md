# Badge Host: Android app for NFC Event Badges

A small Android app (no third-party libraries) that wraps the plugin's host/member screens and adds what a website can't do reliably: **native NFC tag reading**, pairing with your site, and camera permission for scanning pre-registration QR passes.

- Hosts and moderators: deliver badges, read chips, run events, check people in (by chip or by QR pass), set up spare member cards.
- Everyone else: sign in with a password to see points, badges, events, passes and PIN.
- Needs the plugin from `nfc-event-badges.zip` (version with *Event Badges → Connect app*) on a site that uses **HTTPS**.

## Connect it to your site
1. In WordPress open **Event Badges → Connect app**. It shows a QR code and your site address.
2. Install the app, then scan that code with the phone camera (it opens the app with the address filled in), or type the address in the app.
3. Sign in with your normal WordPress account (hosts can also use chip + PIN after setting it up under *Me*).

## Build the APK
This folder is a ready Android Studio / Gradle project. Building needs the Android SDK, which downloads from Google, so it has to happen on your computer or a build service (it could not be built where this project was written).

**Option A, GitHub (no installs):** create a repository, upload everything in this folder, open **Actions → Build APK → Run workflow**. When it finishes, download `badge-host-apk` (contains `app-debug.apk`).

**Option B, Android Studio:** *Open* this folder, wait for Gradle to sync, then **Build → Build APK(s)**. Output: `app/build/outputs/apk/debug/app-debug.apk`.

**Option C, command line:** install JDK 17 and the Android SDK (`ANDROID_HOME` set), then `./gradlew assembleDebug` (Windows: `gradlew.bat assembleDebug`).

Install on a phone: copy the APK over and allow "install unknown apps" for your file manager or browser. A debug APK is signed with a debug key, which is fine for your own hosts. Put the file in your Media Library and paste its link under **Connect app** to give hosts a download button.

### Signed release build (optional, for sharing widely or the Play Store)
```
keytool -genkeypair -v -keystore badge-host.jks -alias badge -keyalg RSA -keysize 2048 -validity 10000
NEB_KEYSTORE=badge-host.jks NEB_KEYSTORE_PASSWORD=... NEB_KEY_ALIAS=badge NEB_KEY_PASSWORD=... ./gradlew assembleRelease
```
Keep the keystore safe: you need the same one for every update. Raise `versionCode` in `app/build.gradle` for each update.

## Updating the screens
The app's screens are generated from the plugin's `host-app/dashboard.php`, so the website app and the Android app stay identical. After updating the plugin run `node scripts/make-www.js` (it looks for `../nfc-event-badges/host-app/dashboard.php`, or pass the path), then rebuild.

## How it works
- `app/src/main/assets/index.html`: the generated screens. `scripts/app-shim.js` adds pairing, a native network layer (so your site needs no CORS settings) and the NFC bridge.
- `MainActivity.java`: a WebView, NFC reader mode (reads the chip's UID, nothing is written), deep link `nebbadges://connect?site=...`, camera and location permissions.
- Chips: the plugin never stores UIDs in plain text; the app only sends the UID of the tapped chip.

## Known limits
- Not compiled or run on a real phone by the author: expect to fix small things on first build. The screens themselves were exercised in a headless browser against a mock.
- Reading works with chips whose UID the phone exposes (NTAG and most MIFARE). Some phones randomise UIDs for emulated cards only, not for real stickers.
- QR scanning of passes uses the WebView's `BarcodeDetector`; if a phone lacks it the host can type the pass code.
- Android only. iPhones can use the website version at `/badge-host/` (no NFC tapping).
