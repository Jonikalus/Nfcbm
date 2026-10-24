#!/usr/bin/env node
/*
 * Builds app/src/main/assets/index.html from the plugin's web app (host-app/dashboard.php)
 * so the Android app always has the same screens as the website version.
 *
 *   node scripts/make-www.js [path/to/nfc-event-badges/host-app/dashboard.php]
 *
 * Run it again whenever you update the plugin's dashboard.php, then rebuild the APK.
 */
const fs = require('fs');
const path = require('path');

const src = process.argv[2] || path.join(__dirname, '..', '..', 'nfc-event-badges', 'host-app', 'dashboard.php');
const out = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'index.html');
const shim = fs.readFileSync(path.join(__dirname, 'app-shim.js'), 'utf8');

let h = fs.readFileSync(src, 'utf8');
function must(re, repl, label) {
	if (!re.test(h)) { console.error('Could not find: ' + label + ' - is dashboard.php a different version?'); process.exit(1); }
	h = h.replace(re, repl);
}

must(/^<\?php[\s\S]*?\?><!doctype html>/, '<!doctype html>', 'PHP header');
must(/<html lang="<\?php[^>]*\?>">/, '<html lang="en">', 'html lang');
const qrFile = path.join(path.dirname(src), '..', 'assets', 'neb-qr.js');
const qr = fs.readFileSync(fs.existsSync(qrFile) ? qrFile : path.join(__dirname, 'neb-qr.js'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'neb-qr.js'), qr);
must(/<script src="<\?php echo esc_url\( \$qr_url \); \?>"><\/script>/, () => '<script>\n' + qr + '\n</script>', 'QR script');
must(/<link rel="manifest"[^\n]*\n/, '', 'manifest link');
must(/<title>[\s\S]*?<\/title>/, '<title>Badge Host</title>', 'title');
must(/var API = <\?php[^\n]*\n/, 'var API = NEBAPP.api;\n', 'API constant');
must(/var SITE = <\?php[^\n]*\n/, 'var SITE = NEBAPP.name;\n', 'SITE constant');
must(/var HAS_NFC = [^\n]*\n/, "var HAS_NFC = !!(window.NebNative && NebNative.hasNfc());\n", 'HAS_NFC');
must(/function startScan\([\s\S]*?\n}\nfunction stopScan\(\)[^\n]*\n/, 'NATIVE_SCAN_FUNCTIONS\n', 'scan functions');
must(/function render\(\) \{\n\tvar app = \$\('app'\);\n/, "function render() {\n\tvar app = $('app');\n\tif (!NEBAPP.api) { app.innerHTML = connectView(); return; }\n", 'render()');
h = h.replace(/Chip sign-in needs Chrome on Android\. Use your password below\./g, 'This phone has no NFC, or it is switched off. Use your password below.');
h = h.replace(/NFC (scanning )?needs Chrome on Android\./g, 'NFC is not available on this phone (or switched off).');
must(/'<button data-act="pwLogin">Sign in<\/button><\/div><p class="sub" id="l-err"><\/p>'/, "'<button data-act=\"pwLogin\">Sign in</button></div><p class=\"sub\" id=\"l-err\"></p><button class=\"sec\" data-act=\"changeSite\">Change site</button>'", 'login button');
must(/'<button class="danger" data-act="logout">Sign out<\/button>'/, "'<button class=\"sec\" data-act=\"changeSite\">Change site</button><button class=\"danger\" data-act=\"logout\">Sign out</button>'", 'sign out button');
if (/<\?php/.test(h)) { console.error('Leftover PHP found in output.'); process.exit(1); }

// the app's own code goes in a separate script that runs first
h = h.replace('<script>\n(function () {', '<script>\n' + shim.split('/*@@APP_SCRIPT@@*/')[0] + '\n</script>\n<script>\n(function () {');
h = h.replace('NATIVE_SCAN_FUNCTIONS', shim.split('/*@@APP_SCRIPT@@*/')[1].trim());
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, h);
console.log('Wrote ' + out + ' (' + h.length + ' bytes)');
