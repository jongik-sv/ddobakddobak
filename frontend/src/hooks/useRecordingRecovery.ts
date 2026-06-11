import { useEffect } from 'react'
import { IS_TAURI, IS_MOBILE } from '../config'
import { getMeeting, promoteAudio } from '../api/meetings'

/** base64 WAV → Blob(audio/wav). */
function b64ToWavBlob(b64: string): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: 'audio/wav' })
}

/**
 * 강제종료 복구 스윕 — 데스크톱 네이티브 녹음 전용.
 *
 * 녹음은 `recordings/<meetingId>.wav`에 연속 기록되지만, 서버 업로드는 정상 종료 시점에만
 * 일어난다. 앱이 강제종료/재시작되면 파일은 남고 업로드만 누락된다. 인증 직후 한 번 실행해
 * 미업로드 파일을 회의에 매칭·업로드하고, 이미 오디오가 있으면 정리한다.
 */
export function useRecordingRecovery() {
  useEffect(() => {
    if (!IS_TAURI || IS_MOBILE) return
    let cancelled = false

    ;(async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const ids = await invoke<number[]>('list_orphan_recordings')
        for (const id of ids) {
          if (cancelled) return
          try {
            const meeting = await getMeeting(id)
            if (meeting.has_audio_file) {
              // 이미 업로드됨(정상 종료 후 정리만 실패한 케이스) → 파일만 정리
              await invoke('delete_recording', { meetingId: id })
              continue
            }
            const b64 = await invoke<string>('read_recording', { meetingId: id })
            await promoteAudio(id, b64ToWavBlob(b64))
            await invoke('delete_recording', { meetingId: id })
            console.info('[recovery] 회의', id, '오디오 복구 업로드 완료')
          } catch (err) {
            // 회의 삭제/권한 없음/오프라인 등 → 파일 보존하고 다음 기회에 재시도
            console.warn('[recovery] 회의', id, '복구 보류', err)
          }
        }
      } catch (err) {
        console.warn('[recovery] 스윕 실패', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])
}
