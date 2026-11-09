package com.depositrequests.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final int RETRY_MS = 15_000;

    private WebView web;
    private String dashboardUrl;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        dashboardUrl = getString(R.string.dashboard_url);

        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.background));
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);

        // The dashboard looks for `window.desktop`. Alerts come from WatchService
        // instead, so they still arrive while this screen is closed.
        web.addJavascriptInterface(new Bridge(), "desktop");
        web.setWebViewClient(new Client());

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(dashboardUrl);
        }

        askForPermissions();
        WatchService.start(this);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
        WatchService.saveCookie(this, dashboardUrl);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        web.destroy();
        super.onDestroy();
    }

    private void askForPermissions() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 1);
            return;
        }
        askToIgnoreBatteryOptimizations();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        askToIgnoreBatteryOptimizations();
    }

    /** Without this, Android may pause the watcher for minutes at a time while the screen is off. */
    private void askToIgnoreBatteryOptimizations() {
        SharedPreferences prefs = getSharedPreferences("app", MODE_PRIVATE);
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power.isIgnoringBatteryOptimizations(getPackageName()) || prefs.getBoolean("askedBattery", false)) {
            return;
        }
        prefs.edit().putBoolean("askedBattery", true).apply();
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        } catch (Exception ignored) {
            // Some vendors hide this screen; the watcher still runs, just less punctually.
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (url.getHost() != null && url.getHost().equals(Uri.parse(dashboardUrl).getHost())) {
                return false;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (Exception ignored) {
                // No app can open it.
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
            WatchService.saveCookie(MainActivity.this, dashboardUrl);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) {
                return;
            }
            String page = "<html><body style=\"background:#060a17;color:#e8edf9;font-family:sans-serif;padding:32px\">"
                    + "<h2>Can't reach the dashboard</h2>"
                    + "<p style=\"color:#8b95b2\">Check your connection. Retrying in 15 seconds.</p></body></html>";
            view.loadDataWithBaseURL(null, page, "text/html", "utf-8", null);
            handler.removeCallbacksAndMessages(null);
            handler.postDelayed(() -> view.loadUrl(dashboardUrl), RETRY_MS);
        }
    }

    private class Bridge {
        @JavascriptInterface
        public void notify(String title, String body) {
            // WatchService raises the alerts, so the page does not.
        }

        @JavascriptInterface
        public void setPendingCount(int count) {
            // WatchService keeps its own count from the same endpoint.
        }

        @JavascriptInterface
        public boolean copy(String text) {
            handler.post(() -> {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(ClipData.newPlainText("Copied", text));
            });
            return true;
        }
    }
}
