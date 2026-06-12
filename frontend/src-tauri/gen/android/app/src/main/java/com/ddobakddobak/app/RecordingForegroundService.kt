package com.ddobakddobak.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * 녹음 중 화면이 꺼져도(슬립) 마이크 캡처·STT 업로드가 계속되도록 하는
 * 포그라운드 서비스 (microphone 타입).
 *
 * - partial wake lock: 화면 off 시 CPU 정지 방지 (webview 오디오 파이프라인 유지)
 * - wifi lock: 화면 off 시 와이파이 절전으로 인한 청크 업로드 끊김 방지
 * - FGS microphone 타입: Android 9+ 백그라운드 마이크 차단 정책 우회 (순정 API — 전 제조사 공통)
 *
 * 시작/종료는 webview JS 브릿지(window.AndroidRecordingService)가 호출한다.
 * Android 14+ 규칙: mic 타입 FGS는 앱이 포그라운드일 때만 시작 가능 —
 * 녹음 시작 버튼을 누르는 시점은 항상 포그라운드이므로 충족.
 */
class RecordingForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    createChannel()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    acquireLocks()
    // 시스템에 의해 죽으면 webview 캡처도 이미 끊긴 상태 — 재시작해도 의미 없음
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    releaseLocks()
    super.onDestroy()
  }

  private fun acquireLocks() {
    if (wakeLock == null) {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ddobakddobak:recording").apply {
        setReferenceCounted(false)
        acquire(12 * 60 * 60 * 1000L) // 안전 상한 12시간 (해제 누락 대비)
      }
    }
    if (wifiLock == null) {
      val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        WifiManager.WIFI_MODE_FULL_LOW_LATENCY
      } else {
        @Suppress("DEPRECATION")
        WifiManager.WIFI_MODE_FULL_HIGH_PERF
      }
      wifiLock = wm.createWifiLock(mode, "ddobakddobak:recording").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
  }

  private fun releaseLocks() {
    wakeLock?.takeIf { it.isHeld }?.release()
    wakeLock = null
    wifiLock?.takeIf { it.isHeld }?.release()
    wifiLock = null
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "녹음",
        NotificationManager.IMPORTANCE_LOW, // 무음·상태바 전용
      ).apply { description = "회의 녹음 진행 중 표시" }
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(): Notification {
    val launchIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val contentIntent = PendingIntent.getActivity(
      this, 0, launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("또박또박 녹음 중")
      .setContentText("화면이 꺼져도 녹음이 계속됩니다")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(contentIntent)
      .setOngoing(true)
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "recording"
    private const val NOTIFICATION_ID = 1001
  }
}
