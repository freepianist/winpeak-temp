package com.depositrequests.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Checks the dashboard for new deposit requests and raises a notification for
 * each one, whether or not the app is open. Uses the session cookie the
 * dashboard set when staff signed in inside the app.
 */
public class WatchService extends Service {
    private static final String ALERTS = "alerts";
    private static final String STATUS = "status";
    private static final int STATUS_ID = 1;
    private static final int SIGNED_OUT_ID = 2;
    private static final int POLL_SECONDS = 15;

    private ScheduledExecutorService executor;
    private PowerManager.WakeLock wakeLock;
    private Set<String> known;
    private boolean signedOutShown;
    private int nextAlertId = 100;
    private String lastStatus = "";

    public static void start(Context context) {
        Intent intent = new Intent(context, WatchService.class);
        if (Build.VERSION.SDK_INT >= 26) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        startForeground(STATUS_ID, statusNotification("Watching for deposit requests"));

        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DepositRequests:watch");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();

        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(this::poll, 0, POLL_SECONDS, TimeUnit.SECONDS);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        executor.shutdownNow();
        if (wakeLock.isHeld()) {
            wakeLock.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void poll() {
        try {
            String base = getString(R.string.dashboard_url);
            String cookie = readCookie(this, base);
            if (cookie == null || cookie.isEmpty()) {
                setStatus("Open the app and sign in to get alerts");
                return;
            }

            HttpURLConnection connection = (HttpURLConnection) new URL(base + "/api/pending").openConnection();
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("Cache-Control", "no-store");
            connection.setUseCaches(false);
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);

            int code = connection.getResponseCode();
            if (code == 401) {
                known = null;
                setStatus("Signed out");
                if (!signedOutShown) {
                    signedOutShown = true;
                    alert(SIGNED_OUT_ID, "Signed out", "Open the app and sign in to keep getting deposit alerts.");
                }
                connection.disconnect();
                return;
            }
            if (code != 200) {
                setStatus("Reconnecting…");
                connection.disconnect();
                return;
            }

            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    body.append(line);
                }
            }
            connection.disconnect();

            JSONArray deposits = new JSONObject(body.toString()).getJSONArray("deposits");
            Set<String> ids = new HashSet<>();
            List<JSONObject> arrived = new ArrayList<>();
            for (int i = 0; i < deposits.length(); i++) {
                JSONObject deposit = deposits.getJSONObject(i);
                String id = deposit.getString("id");
                ids.add(id);
                if (known != null && !known.contains(id)) {
                    arrived.add(deposit);
                }
            }

            // The first successful check only learns what is already waiting; the
            // dashboard itself shows those, so only later arrivals are announced.
            known = ids;
            if (signedOutShown) {
                signedOutShown = false;
                notificationManager().cancel(SIGNED_OUT_ID);
            }

            if (arrived.size() == 1) {
                JSONObject deposit = arrived.get(0);
                alert(nextAlertId++, "New deposit request",
                        deposit.optString("name") + " · " + shortHash(deposit.optString("txHash")));
            } else if (arrived.size() > 1) {
                StringBuilder names = new StringBuilder();
                for (JSONObject deposit : arrived) {
                    if (names.length() > 0) names.append(", ");
                    names.append(deposit.optString("name"));
                }
                alert(nextAlertId++, arrived.size() + " new deposit requests", names.toString());
            }

            int count = ids.size();
            setStatus(count == 0 ? "No pending deposits" : count + " pending deposit" + (count == 1 ? "" : "s"));
        } catch (Exception error) {
            setStatus("Reconnecting…");
        }
    }

    /** Copies the WebView session cookie where the watcher can read it even before any WebView exists. */
    public static void saveCookie(Context context, String base) {
        String cookie = CookieManager.getInstance().getCookie(base);
        context.getSharedPreferences("app", MODE_PRIVATE).edit().putString("cookie", cookie).apply();
    }

    private static String readCookie(Context context, String base) {
        try {
            String cookie = CookieManager.getInstance().getCookie(base);
            if (cookie != null) {
                return cookie;
            }
        } catch (Exception ignored) {
            // WebView can be unavailable right after boot.
        }
        return context.getSharedPreferences("app", MODE_PRIVATE).getString("cookie", null);
    }

    private static String shortHash(String hash) {
        return hash.length() > 20 ? hash.substring(0, 10) + "…" + hash.substring(hash.length() - 8) : hash;
    }

    private NotificationManager notificationManager() {
        return (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) {
            return;
        }
        NotificationChannel alerts = new NotificationChannel(
                ALERTS, getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_HIGH);
        alerts.enableVibration(true);
        alerts.enableLights(true);
        alerts.setLightColor(getColor(R.color.accent));

        NotificationChannel status = new NotificationChannel(
                STATUS, getString(R.string.channel_status), NotificationManager.IMPORTANCE_MIN);
        status.setShowBadge(false);

        notificationManager().createNotificationChannel(alerts);
        notificationManager().createNotificationChannel(status);
    }

    private PendingIntent openApp() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification.Builder builder(String channel) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, channel)
                : new Notification.Builder(this);
        return builder
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(getColor(R.color.accent))
                .setContentIntent(openApp());
    }

    private Notification statusNotification(String text) {
        return builder(STATUS)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(text)
                .setOngoing(true)
                .setShowWhen(false)
                .build();
    }

    private void setStatus(String text) {
        if (text.equals(lastStatus)) {
            return;
        }
        lastStatus = text;
        notificationManager().notify(STATUS_ID, statusNotification(text));
    }

    @SuppressWarnings("deprecation")
    private void alert(int id, String title, String text) {
        Notification.Builder builder = builder(ALERTS)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE);
        if (Build.VERSION.SDK_INT < 26) {
            builder.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        }
        notificationManager().notify(id, builder.build());
    }
}
