package com.ddobakddobak.app

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.JavascriptInterface
import androidx.core.content.ContextCompat

/**
 * webview JS → 녹음 포그라운드 서비스 브릿지.
 * MainActivity.onWebViewCreate에서 window.AndroidRecordingService로 주입된다.
 * JS 인터페이스 메서드는 백그라운드 스레드에서 호출됨 — startForegroundService는 스레드 무관.
 */
class RecordingServiceBridge(private val activity: Activity) {
  @JavascriptInterface
  fun start() {
    // Android 13+ 알림 권한: 거부돼도 FGS 자체는 동작(알림만 숨겨짐). 사용자 인지용으로 1회 요청.
    if (Build.VERSION.SDK_INT >= 33 &&
      activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 9001)
    }
    ContextCompat.startForegroundService(
      activity,
      Intent(activity, RecordingForegroundService::class.java),
    )
  }

  @JavascriptInterface
  fun stop() {
    activity.stopService(Intent(activity, RecordingForegroundService::class.java))
  }
}
