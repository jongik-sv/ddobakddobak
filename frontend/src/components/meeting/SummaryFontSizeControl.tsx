import { useUiStore, SUMMARY_FONT_DEFAULT, SUMMARY_FONT_STEP } from '../../stores/uiStore'

const BTN =
  'p-1.5 min-h-[44px] flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
// 숫자 readout은 A± 버튼보다 좁되 터치 타깃은 그대로(min-h-[44px]는 BTN과 공유).
const READOUT =
  'min-h-[44px] min-w-[2rem] px-1 flex items-center justify-center rounded text-xs font-medium tabular-nums text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer select-none'

/**
 * AI 회의록 본문 글자크기 조절 — A− / 숫자 readout(현재 px, 클릭=기본 리셋) / A+ 3버튼.
 * 패턴은 mdview(~/project/mdview/src/main.ts:626-659)에서 이식.
 *
 * 중요: 더블클릭 리셋은 쓰지 않는다 — A± 버튼 위에서 dblclick은 두 번의 빠른 단일 클릭과
 * 같은 이벤트 시퀀스라, 연타 중에 기본값 리셋이 섞여 "줄었다가 16으로 튀었다가 다시 줄어드는"
 * 현상이 발생한다(mdview 실전 교훈). 따라서 스텝은 A± 가 유일한 역할로 두고, 리셋은 별도
 * 엘리먼트인 숫자 readout 클릭으로만 한다 — 연타 중 dblclick 오발동을 원천 차단.
 *
 * uiStore 전역 값으로 패널(회의상세)과 전체보기 모달이 같은 글자크기를 공유한다.
 */
export function SummaryFontSizeControl() {
  const summaryFontSize = useUiStore((s) => s.summaryFontSize)
  const setSummaryFontSize = useUiStore((s) => s.setSummaryFontSize)

  return (
    <div
      className="flex items-center gap-0.5"
      role="group"
      aria-label="회의록 글자 크기"
    >
      <button
        type="button"
        onClick={() => setSummaryFontSize(summaryFontSize - SUMMARY_FONT_STEP)}
        aria-label="글자 크기 줄이기"
        title="글자 작게"
        className={BTN}
      >
        <span className="text-sm font-semibold leading-none" aria-hidden="true">
          A<span className="text-[0.6em] align-baseline">−</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => setSummaryFontSize(SUMMARY_FONT_DEFAULT)}
        aria-label={`글자 크기 ${summaryFontSize}px, 클릭하면 기본(${SUMMARY_FONT_DEFAULT}px)으로`}
        title={`글자 크기 ${summaryFontSize}px · 클릭하면 기본(${SUMMARY_FONT_DEFAULT}px)`}
        className={READOUT}
      >
        {summaryFontSize}
      </button>
      <button
        type="button"
        onClick={() => setSummaryFontSize(summaryFontSize + SUMMARY_FONT_STEP)}
        aria-label="글자 크기 키우기"
        title="글자 크게"
        className={BTN}
      >
        <span className="text-base font-semibold leading-none" aria-hidden="true">
          A<span className="text-[0.7em] align-baseline">+</span>
        </span>
      </button>
    </div>
  )
}
