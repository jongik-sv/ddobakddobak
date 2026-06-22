import { useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { IS_TAURI, getMode } from '../config'
import { confirmDialog } from '../lib/confirmDialog'
import { getScheduledMeetings } from '../api/meetings'
import type { ScheduledMeeting } from '../api/meetings/types'
import { computeScheduleActions } from '../lib/computeScheduleActions'

const POLL_INTERVAL_MS = 30_000

/**
 * 전역 예약 회의 워처(부수효과 담당). 인증된 앱이 열려 있는 동안만 동작한다
 * (<ScheduledMeetingWatcher/>가 GatedApp 안에서 마운트). "지금 무엇을 시작할지" 판정은
 * 순수 함수 computeScheduleActions에 위임하고, 여기서는 폴링·네비게이션·확인 다이얼로그만 한다.
 *
 * - 30초 폴링(+마운트 1회). getScheduledMeetings 실패는 조용히 무시(다음 폴에서 재시도) — 오프라인 정상.
 * - 트리거된 회의는 alreadyTriggered에 기록해 인플라이트 창 중복 발화를 막는다.
 * - 동시에 두 confirm이 쌓이지 않도록 prompting 가드를 둔다.
 * - auto+데스크톱: 무클릭 자동 네비게이트. auto+웹: 브라우저 autoplay 정책(제스처 필요) 때문에
 *   원탭 confirm으로 강등(§2.3) — Yes여야 제스처가 생겨 오디오가 무음이 되지 않는다.
 * - manual: 양 플랫폼 모두 confirm 후 Yes에만 네비게이트.
 */
export function useScheduledMeetings() {
  const navigate = useNavigate()
  const location = useLocation()
  // location은 effect 내부 폴 콜백에서 최신값이 필요하므로 ref로 미러링한다.
  const pathnameRef = useRef(location.pathname)
  pathnameRef.current = location.pathname

  const alreadyTriggeredRef = useRef<Set<number>>(new Set())
  const promptingRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    const goLive = (id: number) => {
      navigate(`/meetings/${id}/live`, { state: { autoStart: true } })
    }

    // 데스크톱 로컬: Rust 스케줄러가 트리거 소유 → JS 폴 비활성, 이벤트만 수신.
    if (IS_TAURI && getMode() === 'local') {
      let unlisten: (() => void) | undefined
      let disposed = false
      ;(async () => {
        const { listen } = await import('@tauri-apps/api/event')
        const un = await listen<{ meetingId: number; mode: 'auto' | 'manual' }>(
          'scheduled-meeting-trigger',
          (e) => {
            if (cancelled) return
            if (pathnameRef.current.includes('/live')) return // 진행 중 세션 보호
            // 백그라운드 자동시작 알림 + 창 표시
            import('@tauri-apps/api/core')
              .then(({ invoke }) => invoke('show_main_window'))
              .catch(() => {})
            import('@tauri-apps/plugin-notification')
              .then(async ({ isPermissionGranted, requestPermission, sendNotification }) => {
                let granted = await isPermissionGranted()
                if (!granted) granted = (await requestPermission()) === 'granted'
                if (granted) sendNotification({ title: '또박또박', body: '녹음 중: 예약 회의' })
              })
              .catch(() => {})
            goLive(e.payload.meetingId)
          },
        )
        if (disposed) un()
        else unlisten = un
      })()
      return () => {
        cancelled = true
        disposed = true
        unlisten?.()
      }
    }

    const handle = async (m: ScheduledMeeting, mode: 'auto' | 'manual') => {
      const title = m.title
      if (mode === 'auto' && IS_TAURI) {
        // 데스크톱: 네이티브 레코더가 OS 마이크를 직접 열어 제스처가 불필요 → 완전 자동.
        alreadyTriggeredRef.current.add(m.id)
        goLive(m.id)
        return
      }
      // 그 외(auto+웹, manual 전부)는 확인 다이얼로그가 필요하다.
      if (promptingRef.current) return // 다른 confirm이 열려 있으면 이번 폴은 건너뛴다(재평가됨).
      promptingRef.current = true
      alreadyTriggeredRef.current.add(m.id)
      try {
        const msg =
          mode === 'auto'
            ? `「${title}」 회의를 시작합니다. 지금 시작할까요?`
            : `「${title}」 회의를 시작하시겠습니까?`
        const ok = await confirmDialog(msg)
        if (ok && !cancelled) goLive(m.id)
        // No/무응답이면 시작하지 않는다(시간이 지나면 missed). 재프롬프트 폭주 방지를 위해
        // alreadyTriggered에는 남겨 둔다.
      } finally {
        promptingRef.current = false
      }
    }

    const poll = async () => {
      let meetings: ScheduledMeeting[]
      try {
        meetings = await getScheduledMeetings()
      } catch {
        return // 네트워크 에러는 조용히 무시(오프라인 등). 다음 폴에서 재시도.
      }
      if (cancelled) return
      const actions = computeScheduleActions(meetings, Date.now(), {
        isOnLivePage: pathnameRef.current.includes('/live'),
        alreadyTriggered: alreadyTriggeredRef.current,
      })
      for (const { meetingId, mode } of actions) {
        const m = meetings.find((x) => x.id === meetingId)
        if (!m) continue
        // confirm 경로는 await가 길어질 수 있으므로 순차 처리(prompting 가드로 중첩 방지).
        await handle(m, mode)
        if (cancelled) return
      }
    }

    void poll()
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
    // navigate는 react-router에서 안정적이라 의존성 변화로 재구독되지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate])
}
