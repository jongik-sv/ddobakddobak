# 화자 라벨 클릭 → 발화 위치 이동 (speaker-click-seek)

## 목적
화자 패널에서 화자 이름을 넣으려면 누구 목소리인지 들어봐야 한다. 현재는 뒤쪽에서 말한 화자의 발화로 이동하기 어렵다.
"화자 N" 배지를 누르면 그 화자의 발화 위치로 오디오를 이동(seek)+재생해서 들려준다. 계속 누르면 그 화자의 다음 발화로 아래로 내려가며 들려준다.

## 동작 규칙
- "화자 N" 배지 클릭 → 해당 화자(speaker_label) 발화 중 **현재 재생 위치(currentTimeMs)보다 뒤(>)** 의 첫 발화로 seek+자동재생.
- 재생 중이 아니고 커서가 없으면(아직 한 번도 안 들음) → 그 화자의 **첫 발화**로 이동.
- 반복 클릭 → seek가 currentTimeMs를 앞으로 옮기므로 자연히 다음 발화로 진행. 빠른 연타로 timeupdate가 아직 안 온 경우를 대비해 `lastJumpMsRef`(전역, 마지막 점프 ms)로 base 보강: `base = max(currentTimeMs, lastJumpMs)`.
- 마지막 발화 도달 후 클릭 → **첫 발화로 wrap** (정지 대신 순환; 라벨 확인용으로 더 유용).
- 화자 발화 0개 → no-op.
- scroll: 별도 코드 불필요. seek → currentTimeMs 변경 → TranscriptPanel이 highlighted row를 자동 scrollIntoView.

## 점프 로직 — 순수 함수로 분리 (테스트 용이성)
시간/엣지 로직(콜드스타트, started_at_ms===0, 재생중 진행, 연타 가드, wrap)을 순수 함수로 빼서 직접 테스트한다. SpeakerPanel은 ref/store/콜백만 엮는다.

`frontend/src/components/meeting/speakerSeek.ts` (신규):
```ts
import type { TranscriptFinalData } from '../../channels/transcription'

/** speaker의 발화들(asc 정렬 가정) 중 다음에 이동할 발화를 고른다. 없으면 null. */
export function pickSpeakerTarget(
  utts: TranscriptFinalData[],
  opts: { currentTimeMs: number; isPlaying: boolean; lastJumpMs: number },
): TranscriptFinalData | null {
  if (utts.length === 0) return null
  const cur = opts.currentTimeMs
  // 커서: 재생중 || 재생위치 존재 || 이미 한 번 점프함
  const hasCursor = opts.isPlaying || cur > 0 || opts.lastJumpMs >= 0
  if (!hasCursor) return utts[0] // 콜드스타트(started_at_ms===0 포함) → 첫 발화
  const base = Math.max(cur, opts.lastJumpMs)
  return utts.find((u) => u.started_at_ms > base) ?? utts[0] // 끝이면 wrap
}
```

SpeakerPanel 내부:
```ts
const lastJumpMsRef = useRef<number>(-1)
function jumpToSpeaker(speakerId: string) {
  if (!onSpeakerSeek) return
  const utts = finals.filter((f) => f.speaker_label === speakerId) // store는 started_at_ms asc 유지
  const target = pickSpeakerTarget(utts, {
    currentTimeMs: currentTimeMs ?? 0,
    isPlaying: !!isPlaying,
    lastJumpMs: lastJumpMsRef.current,
  })
  if (!target) return
  lastJumpMsRef.current = target.started_at_ms
  onSpeakerSeek(target.started_at_ms)
}
```

### "재생 안 함 → 첫 발화" 해석 (의도적 deviation, lock)
사용자 문구는 "재생 안 하면 첫 발화"지만, 일시정지 후 클릭이 매번 맨 위로 튀면 "계속 아래로"와 모순. 그래서 `hasCursor`(재생중 OR 재생위치>0 OR 이미점프)로 대체 — 커서 있으면 일시정지여도 다음으로 진행. 콜드스타트만 첫 발화. 테스트로 고정(가역적, 추후 strict로 1줄 전환 가능).

## seek 경로 확인 (완료)
AudioPlayer.tsx:28-33 — `if (seekMs !== null) { seekTo(seekMs); if (autoPlayOnSeek) play() }`. MeetingPage가 `autoPlayOnSeek` 전달 → seek 시 **자동 재생됨**(들려줌, 요구 충족). 단 effect가 `seekMs` 값변화로만 fire → 같은 ms 재설정은 no-op. 발화 여러 개면 클릭마다 ms가 달라 정상 진행. **단일 발화 화자 재클릭 시 재생 안 됨(기존 공유 seek 한계, 모든 seek 소비처 동일) — 본 작업 범위 밖, 문서화만.**

## 변경 파일 (4 + 테스트)
0. **frontend/src/components/meeting/speakerSeek.ts** (신규) — `pickSpeakerTarget` 순수 함수.
1. **frontend/src/components/meeting/SpeakerPanel.tsx**
   - props 추가(모두 optional): `currentTimeMs?: number`, `isPlaying?: boolean`, `onSpeakerSeek?: (ms: number) => void`.
   - `lastJumpMsRef` + `jumpToSpeaker` 추가.
   - 배지(현 `<span>{speaker.id}</span>`, 124-128): `onSpeakerSeek` 있으면 `<button type="button" onClick={() => jumpToSpeaker(speaker.id)} title="이 화자 발화로 이동">` 로 렌더(같은 색 클래스 + cursor-pointer + 가벼운 hover). 없으면 기존 `<span>` 유지.

2. **frontend/src/components/meeting/meetingDetailTabs.tsx** (모바일)
   - `BuildMeetingDetailTabsArgs`에 `isPlaying: boolean` 추가, 구조분해.
   - line 85 SpeakerPanel에 `currentTimeMs={currentTimeMs} isPlaying={isPlaying} onSpeakerSeek={onSeek}` 전달.

3. **frontend/src/pages/MeetingPage.tsx**
   - line 497(데스크톱) SpeakerPanel에 `currentTimeMs={currentTimeMs} isPlaying={audio.isPlaying} onSpeakerSeek={handleSeek}` 전달.
   - `buildMeetingDetailTabs({...})`(344-365)에 `isPlaying: audio.isPlaying,` 추가.

## 영향 없음 보장
- 새 props 전부 optional. `onSpeakerSeek` 미전달 페이지(MeetingViewerPage, MeetingLivePage, useLiveMobileTabs, 기존 SpeakerPanel.test)는 배지가 그대로 비대화형 `<span>` → 동작 무변경. 라이브 녹음 화면은 재생할 오디오가 없으므로 의도적으로 제외.

## 테스트 (TDD)
- 기존 SpeakerPanel.test.tsx 6케이스 GREEN 유지(배지 클릭 비활성).
- 신규: store에 finals 주입 + `onSpeakerSeek` mock 전달 후
  - 정지/커서없음 클릭 → 첫 발화 ms로 호출.
  - `isPlaying` + `currentTimeMs`가 발화1·발화2 사이 → 발화2 ms로 호출.
  - 연속 클릭 → 다음 발화로 진행(lastJump 보강 확인).
  - 마지막 발화 이후 클릭 → 첫 발화로 wrap.
- 회귀: touchTarget.test / MeetingPage.responsive.test / 풀 vitest GREEN, `vite build` 통과.

## 리스크
- touchTarget 테스트가 배지 button(px-2 py-0.5, <44px)을 잡을 수 있음 → 테스트 스캐너 범위 확인, 필요 시 min-h/min-w 보강.
