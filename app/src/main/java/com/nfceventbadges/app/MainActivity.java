package com.nfceventbadges.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A thin shell around the plugin's web app (assets/index.html).
 * Native parts: NFC tag reading, network calls (so the site needs no CORS), pairing links and vibration.
 */
public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 41;
    private static final int REQ_CAMERA = 42;
    private static final String PAGE = "file:///android_asset/index.html";

    private WebView web;
    private NfcAdapter nfc;
    private boolean scanning = false;
    private boolean pageReady = false;
    private String pendingLink = null;
    private final ExecutorService net = Executors.newFixedThreadPool(4);

    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private PermissionRequest camRequest;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        nfc = NfcAdapter.getDefaultAdapter(this);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setGeolocationEnabled(true);
        s.setSupportZoom(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                String u = req.getUrl().toString();
                if (u.startsWith("file:///android_asset/")) { return false; }
                try { startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl())); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                pageReady = true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView v, String url, String message, final JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton(android.R.string.ok, (d, w) -> r.confirm())
                    .setOnCancelListener(d -> r.confirm()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView v, String url, String message, final JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton(android.R.string.ok, (d, w) -> r.confirm())
                    .setNegativeButton(android.R.string.cancel, (d, w) -> r.cancel())
                    .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsCamera = false;
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) { wantsCamera = true; }
                    }
                    if (!wantsCamera) { request.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    } else {
                        camRequest = request;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                    }
                });
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    cb.invoke(origin, true, false);
                    return;
                }
                geoCallback = cb;
                geoOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            }
        });
        web.addJavascriptInterface(new Bridge(), "NebNative");

        handleIntent(getIntent());
        web.loadUrl(PAGE);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == REQ_CAMERA && camRequest != null) {
            boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            if (ok) { camRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); } else { camRequest.deny(); }
            camRequest = null;
        }
        if (code == REQ_LOCATION && geoCallback != null) {
            boolean ok = false;
            for (int r : results) { if (r == PackageManager.PERMISSION_GRANTED) { ok = true; } }
            geoCallback.invoke(geoOrigin, ok, false);
            geoCallback = null;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
        if (pageReady && pendingLink != null) {
            js("window.__nebLink && window.__nebLink(" + JSONObject.quote(pendingLink) + ")");
            pendingLink = null;
        }
    }

    private void handleIntent(Intent intent) {
        if (intent == null) { return; }
        Uri data = intent.getData();
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && data != null && "nebbadges".equals(data.getScheme())) {
            pendingLink = data.toString();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (nfc != null && scanning) {
            try { nfc.disableReaderMode(this); } catch (Exception ignored) { }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (nfc != null && scanning) { enableReader(); }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        net.shutdownNow();
    }

    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    private void js(final String code) {
        runOnUiThread(() -> web.evaluateJavascript(code, null));
    }

    private void enableReader() {
        if (nfc == null) { return; }
        int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B | NfcAdapter.FLAG_READER_NFC_F
            | NfcAdapter.FLAG_READER_NFC_V | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;
        nfc.enableReaderMode(this, new NfcAdapter.ReaderCallback() {
            @Override
            public void onTagDiscovered(Tag tag) {
                buzz(30);
                js("window.__nebTagCb && window.__nebTagCb(" + JSONObject.quote(hex(tag.getId())) + ")");
            }
        }, flags, null);
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) { sb.append(String.format("%02X", x)); }
        return sb.toString();
    }

    private void buzz(long ms) {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) { return; }
            if (Build.VERSION.SDK_INT >= 26) { v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)); }
            else { v.vibrate(ms); }
        } catch (Exception ignored) { }
    }

    /** What the web page can call as window.NebNative.* */
    private class Bridge {
        @JavascriptInterface
        public boolean hasNfc() {
            return nfc != null && nfc.isEnabled();
        }

        @JavascriptInterface
        public void startScan() {
            scanning = true;
            runOnUiThread(MainActivity.this::enableReader);
        }

        @JavascriptInterface
        public void stopScan() {
            scanning = false;
            runOnUiThread(() -> {
                if (nfc != null) {
                    try { nfc.disableReaderMode(MainActivity.this); } catch (Exception ignored) { }
                }
            });
        }

        @JavascriptInterface
        public String takeLink() {
            String l = pendingLink;
            pendingLink = null;
            return l == null ? "" : l;
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            buzz(ms);
        }

        @JavascriptInterface
        public void http(final String id, final String method, final String url, final String headersJson, final String body) {
            net.execute(() -> {
                HttpURLConnection c = null;
                try {
                    if (!url.startsWith("https://")) { throw new Exception("Only https:// addresses are allowed."); }
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    boolean hasBody = body != null && !body.isEmpty();
                    String m = method == null ? "GET" : method.toUpperCase();
                    // HttpURLConnection can't send a body with DELETE: tunnel it (WordPress understands this header)
                    if ("DELETE".equals(m) && hasBody) {
                        c.setRequestMethod("POST");
                        c.setRequestProperty("X-HTTP-Method-Override", "DELETE");
                    } else {
                        c.setRequestMethod(m);
                    }
                    JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
                    for (Iterator<String> it = h.keys(); it.hasNext(); ) {
                        String k = it.next();
                        c.setRequestProperty(k, h.getString(k));
                    }
                    c.setRequestProperty("Accept", "application/json");
                    if (hasBody) {
                        c.setDoOutput(true);
                        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                        c.setFixedLengthStreamingMode(bytes.length);
                        OutputStream os = c.getOutputStream();
                        os.write(bytes);
                        os.close();
                    }
                    int code = c.getResponseCode();
                    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    String text = "";
                    if (in != null) {
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); }
                        in.close();
                        text = out.toString("UTF-8");
                    }
                    js("window.__nebHttp(" + JSONObject.quote(id) + "," + code + "," + JSONObject.quote(text) + ")");
                } catch (Exception e) {
                    String msg = e.getMessage() == null ? "Network error" : e.getMessage();
                    js("window.__nebHttp(" + JSONObject.quote(id) + ",-1," + JSONObject.quote(msg) + ")");
                } finally {
                    if (c != null) { c.disconnect(); }
                }
            });
        }
    }
}
