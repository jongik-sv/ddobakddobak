import { useEffect } from 'react'

/**
 * 녹음 클라 생존 하트비트.
 * active(= 이 클라가 활성 녹음 중)일 때만 즉시 1회 + 15초마다 sendHeartbeat.
 *
 * 침묵 중인 라이브 녹음은 audio_chunk bump가 없으므로 이 하트비트가 유일한 생명선이다.
 * (서버의 stale-recording 90s 자동종결을 막는다.) active=false(시청자·idle·녹음거부)면 0회 —
 * 안 그러면 2번째 탭/기기가 owner 롤로 keep-alive를 보내 자동종결이 무력화된다.
 */
export function useRecorderHeartbeat(active: boolean, sendHeartbeat: () => void): void {
  useEffect(() => {
    if (!active) return
    sendHeartbeat() // 즉시 1회 (시작 직후 공백 제거)
    const id = setInterval(() => sendHeartbeat(), 15_000)
    return () => clearInterval(id)
  }, [active, sendHeartbeat])
}
