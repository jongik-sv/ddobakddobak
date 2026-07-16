/**
 * 전사 하이라이트 대상 세그먼트 인덱스를 해석한다.
 *
 * 기존엔 `currentTimeMs`를 [started_at_ms, ended_at_ms)로 엄격 포함하는 세그먼트만 찾았다.
 * 그래서 회의록 시간태그(⟦t:..⟧) 클릭으로 seek한 ms가 어떤 구간에도 안 들어가면
 * (무음 갭, mm:ss 절삭으로 초 미만 손실, 첫 발화 이전/마지막 발화 이후 등) 오디오는
 * 재생되는데 전사는 선택되지 않았다. 화자 배지 색을 정하는 speakerAtMs(citationMarkers.ts)는
 * 이미 "가장 가까운 started_at_ms" 폴백을 갖고 있으므로, 하이라이트도 동일 규칙으로 맞춘다.
 *
 * 1) currentTimeMs를 포함하는 구간이 있으면 그 중 started_at_ms가 가장 큰 것
 *    (오디오 overlap으로 구간이 겹칠 때 가장 늦게 시작한 발화 — speakerAtMs와 동일).
 * 2) 포함 구간이 없고 재생/탐색 위치가 있으면(currentTimeMs > 0) started_at_ms가 가장 가까운 구간.
 * 3) currentTimeMs가 0 이하(초기·미재생)면 선택하지 않는다(기존 동작 보존).
 */
export interface HighlightSegment {
  started_at_ms: number
  ended_at_ms: number | null
}

export function resolveHighlightIndex(
  segments: HighlightSegment[],
  currentTimeMs: number,
): number {
  if (segments.length === 0) return -1

  let contain = -1
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    const inRange =
      currentTimeMs >= s.started_at_ms &&
      (s.ended_at_ms == null ? currentTimeMs === s.started_at_ms : currentTimeMs < s.ended_at_ms)
    if (inRange && (contain === -1 || s.started_at_ms > segments[contain].started_at_ms)) {
      contain = i
    }
  }
  if (contain !== -1) return contain

  if (currentTimeMs <= 0) return -1

  let nearest = 0
  let bestDiff = Math.abs(segments[0].started_at_ms - currentTimeMs)
  for (let i = 1; i < segments.length; i++) {
    const diff = Math.abs(segments[i].started_at_ms - currentTimeMs)
    if (diff < bestDiff) {
      bestDiff = diff
      nearest = i
    }
  }
  return nearest
}
