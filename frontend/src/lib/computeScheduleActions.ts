import type { ScheduledMeeting } from '../api/meetings/types'

/** 예약 시각 도달 후 자동시작을 허용하는 유예 구간(ms). 폴링 간격(30s)보다 커야
 *  주기 폴이 윈도우 안에 반드시 한 번 떨어진다. 이 상한을 넘기면 "놓침"으로 본다. */
const GRACE_MS = 60_000

/** manual 모드에서 예약 시각보다 미리 확인 프롬프트를 띄우는 선행 구간(ms). */
const MANUAL_LEAD_MS = 60_000

export interface ScheduleAction {
  meetingId: number
  mode: 'auto' | 'manual'
}

export interface ScheduleContext {
  /** 사용자가 /live 페이지에 있는지. true면 진행 중 세션을 끊지 않도록 전부 건너뛴다. */
  isOnLivePage: boolean
  /** 이번 세션에서 이미 트리거한 회의 id. 인플라이트 창의 중복 발화 가드. */
  alreadyTriggered: Set<number>
}

/**
 * "지금 시작해야 할 예약 회의"를 판정하는 순수 함수(부수효과 없음).
 *
 * 윈도우 정의(둘 다 상한 배타 — 상한을 넘기면 missed로 보고 자동/프롬프트 발화 안 함):
 * - auto:   `[scheduledMs,            scheduledMs + GRACE_MS)`
 * - manual: `[scheduledMs - LEAD_MS,  scheduledMs + GRACE_MS)`
 *
 * auto의 상한 배타가 §2.2 가드다 — 앱이 예약 시각에 닫혀 있다가 한참 뒤 열려도
 * 목록엔 pending으로 남아 있지만(서버 권위) 윈도우 밖이라 무음 자동녹음을 안 한다.
 * 발화 판정은 오직 scheduledMs 산술로만 한다(목록의 missed 플래그에 의존하지 않음 —
 * missed는 strict-past라 정각 직후 폴부터 true가 되어 auto가 영영 안 뜬다).
 */
export function computeScheduleActions(
  meetings: ScheduledMeeting[],
  nowMs: number,
  ctx: ScheduleContext,
): ScheduleAction[] {
  // 라이브 세션 보호: /live에 있으면 어떤 회의도 트리거하지 않는다.
  if (ctx.isOnLivePage) return []

  const actions: ScheduleAction[] = []
  for (const m of meetings) {
    const mode = m.auto_start_mode
    if (!m.scheduled_start_time || (mode !== 'auto' && mode !== 'manual')) continue
    if (ctx.alreadyTriggered.has(m.id)) continue

    const scheduledMs = Date.parse(m.scheduled_start_time)
    if (Number.isNaN(scheduledMs)) continue

    const lowerMs = mode === 'manual' ? scheduledMs - MANUAL_LEAD_MS : scheduledMs
    const upperMs = scheduledMs + GRACE_MS
    if (nowMs >= lowerMs && nowMs < upperMs) {
      actions.push({ meetingId: m.id, mode })
    }
  }
  return actions
}
