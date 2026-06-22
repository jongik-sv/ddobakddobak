const DEFAULT_THRESHOLD_MS = 5 * 60_000

export interface SilenceState {
  silentMs: number
  done: boolean
}

export function newSilenceState(): SilenceState {
  return { silentMs: 0, done: false }
}

/** 무음 청크 누적, 유음이면 리셋. 임계 최초 도달 시에만 true(한 번). */
export function tickSilence(
  s: SilenceState,
  chunkMs: number,
  hasSound: boolean,
  thresholdMs: number = DEFAULT_THRESHOLD_MS,
): boolean {
  if (hasSound) {
    s.silentMs = 0
    return false
  }
  if (s.done) return false
  s.silentMs += chunkMs
  if (s.silentMs >= thresholdMs) {
    s.done = true
    return true
  }
  return false
}
