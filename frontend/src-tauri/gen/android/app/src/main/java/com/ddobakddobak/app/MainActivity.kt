package com.ddobakddobak.app

import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // 화면 꺼짐(슬립) 중 녹음 유지용 포그라운드 서비스 브릿지 주입.
  // JS에서 window.AndroidRecordingService.start()/stop()으로 호출.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(RecordingServiceBridge(this), "AndroidRecordingService")
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // targetSdk 35+ 에서는 edge-to-edge 가 강제되어 웹뷰가 상태바/내비게이션 바 밑까지 그려진다.
    // 콘텐츠 뷰에 시스템 바 + 디스플레이 컷아웃 인셋만큼 패딩을 주어 상태표시줄 아래부터 시작하게 한다.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
  }
}
