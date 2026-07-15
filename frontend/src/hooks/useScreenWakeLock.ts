import { useEffect, useRef } from 'react'

/**
 * 화면 자동 꺼짐 방지 (Screen Wake Lock API — 웹 브라우저 전용).
 * active(= 녹음 세션 진행 중, 일시정지 포함)인 동안 wake lock을 유지해
 * 화면 꺼짐 → 페이지 suspend → AudioContext 정지·하트비트 중단으로
 * 녹음/STT가 죽는 경로를 원천 차단한다.
 *
 * - 미지원 환경(jsdom·구형 브라우저·Tauri WebView)에서는 완전 no-op.
 *   (Android APK는 FGS+PARTIAL_WAKE_LOCK, macOS Tauri는 caffeinate로 별도 해결.)
 * - 획득 실패(NotAllowedError: 배터리 절약 모드 등)는 warn만 — 녹음은 계속돼야 하므로 절대 throw 금지.
 * - 탭 hidden 전환 시 브라우저가 lock을 자동 해제하므로, visible 복귀 때 재획득한다.
 *   hidden 상태에서는 request 자체가 NotAllowedError라 시도하지 않는다.
 * - visible인 채로 UA가 임의 해제(배터리 세이버 등)하면 release 이벤트에서 즉시 재획득을 시도한다.
 */
export function useScreenWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null)
  // in-flight request 가드: 요청 중복 발사(visibilitychange 연타 등) 방지.
  const pendingRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    // 기능 감지: 미지원이면 완전 no-op (리스너 등록조차 안 함)
    if (!('wakeLock' in navigator)) return
    if (!active) return

    // active=false 전환·언마운트 후 도착한 sentinel 누수 방지 플래그 (effect 실행분마다 별도)
    let cancelled = false

    const request = (): void => {
      if (cancelled || sentinelRef.current) return
      // hidden에서 request하면 NotAllowedError — visible 복귀 리스너에 맡긴다
      if (document.visibilityState !== 'visible') return
      if (pendingRef.current) {
        // 이전 요청이 아직 진행 중 — 끝난 뒤 조건 재평가 (중복 request 레이스 가드)
        void pendingRef.current.then(() => request())
        return
      }
      pendingRef.current = navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (cancelled) {
            // 획득 도중 언마운트/비활성 전환 — 즉시 해제 (lock 누수 방지)
            sentinel.release().catch(() => {})
            return
          }
          sentinelRef.current = sentinel
          // 브라우저 임의 해제(탭 hidden·배터리 세이버 등) 추적 → ref를 비워 재획득 가능하게 하고,
          // visible인 채로 해제됐다면(배터리 세이버 등) visibilitychange가 안 오므로 즉시 재획득 시도.
          // cancelled 확인이 선행돼야 함 — 우리 쪽 release()(비활성 전환·언마운트)도 이 이벤트를
          // 발화시키므로, 없으면 release→재획득→release 무한 루프가 된다. 실패는 request 내부에서 warn.
          sentinel.addEventListener('release', () => {
            if (sentinelRef.current !== sentinel) return
            sentinelRef.current = null
            if (!cancelled && document.visibilityState === 'visible') request()
          })
        })
        .catch((err: unknown) => {
          console.warn('[wakeLock] 화면 꺼짐 방지 획득 실패 (녹음은 계속):', err)
        })
        .finally(() => {
          pendingRef.current = null
        })
    }

    const onVisibilityChange = (): void => {
      // visible 복귀 && 아직 active && 해제됨(sentinelRef 비어 있음) → 재획득
      if (document.visibilityState === 'visible') request()
    }

    request()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      sentinelRef.current?.release().catch(() => {})
      sentinelRef.current = null
    }
  }, [active])
}
