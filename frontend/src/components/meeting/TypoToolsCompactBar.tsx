import { useState } from 'react'
import type { TermCorrection } from '../../api/meetings'
import { useGlossary } from '../../hooks/useGlossary'
import { TermCorrectionDetails } from './TermCorrectionDetails'
import { GlossaryPanelContent } from './GlossaryPanel'

interface TypoToolsCompactBarProps {
  meetingId: number
  corrections: TermCorrection[]
  status: string
  isApplying: boolean
  onUpdate: (index: number, field: 'from' | 'to', value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onApply: () => void
}

/**
 * 모바일 전용 — "오타 수정"·"오타 사전" 접기 섹션을 한 줄 토글 바로 병합.
 * 두 섹션이 접힌 채로 헤더 2줄(~95px)을 상시 점유하던 문제 대응. 데스크톱은 여전히
 * TermCorrectionDetails/GlossaryPanel을 각자 <details>로 개별 렌더(변경 없음) —
 * 이 컴포넌트는 모바일 요약 탭(belowSummary)에만 쓰인다.
 *
 * 아코디언(한 번에 하나만 열림): 탭 버튼을 다시 누르면 닫힘. 오타사전은 useGlossary를
 * 여기서 직접 호출해(GlossaryPanel 내부 훅과 별도 인스턴스 아님 — 데스크톱/모바일은
 * 항상 배타적으로만 마운트되므로 중복 fetch가 발생하지 않는다) view 로딩 전에는
 * "오타 사전" 탭 자체를 숨긴다.
 */
export function TypoToolsCompactBar({
  meetingId,
  corrections,
  status,
  isApplying,
  onUpdate,
  onAdd,
  onRemove,
  onApply,
}: TypoToolsCompactBarProps) {
  const [open, setOpen] = useState<'typo' | 'glossary' | null>(null)
  const glossary = useGlossary(meetingId)
  const glossaryReady = !!glossary.view

  function toggle(section: 'typo' | 'glossary') {
    setOpen((cur) => (cur === section ? null : section))
  }

  // 이 병합 탭 바는 헤더 액션 버튼(ExportButton 등, actionButtonStyles.ACTION_NEUTRAL ~30px
  // 알약)과 같은 "컴팩트 헤더 컨트롤" 부류로 44px 터치 정책의 예외 대상이다 — 시각 높이를
  // 최소화(py-0.5, text-xs)하고 min-h-[28px]만 바닥으로 둔다(사용자 결정, 2026-08).
  const tabButtonClass = (active: boolean) =>
    `flex-1 min-h-[28px] min-w-0 flex items-center justify-center gap-1 py-0.5 px-3 text-xs font-semibold transition-colors ${
      active ? 'text-foreground bg-muted/60' : 'text-muted-foreground'
    }`

  return (
    // 접힘 = shrink-0(바 높이만). 펼침 = shrink-0 + max-h-full(부모 flex-col 컨테이너 높이 전체가
    // 상한) — 컨텐츠가 필요로 하는 만큼 자라 남는 빈 공간을 흡수하고, AiSummaryPanel(flex-1
    // min-h-0)이 그만큼 줄어든다. flex-1로 둘을 균등 분할(50/50)하면 글로서리 항목이 많을 때
    // 여전히 잘리면서 동시에 요약 영역은 필요 이상으로 넓게 남는 문제가 재발하므로 채택하지
    // 않았다 — 내용이 짧으면 그만큼만, 길면 max-h-full까지 자라고 그 안에서 overflow-y-auto로
    // 스스로 스크롤한다.
    <div className={`border-t bg-card ${open ? 'flex flex-col shrink-0 max-h-full' : 'shrink-0'}`}>
      <div className="flex divide-x divide-border shrink-0">
        <button
          type="button"
          aria-expanded={open === 'typo'}
          onClick={() => toggle('typo')}
          className={tabButtonClass(open === 'typo')}
        >
          <span className={`transition-transform ${open === 'typo' ? 'rotate-90' : ''}`}>&rsaquo;</span>
          오타 수정
          {status && <span className="text-blue-500 truncate">{status}</span>}
        </button>
        {glossaryReady && (
          <button
            type="button"
            aria-expanded={open === 'glossary'}
            onClick={() => toggle('glossary')}
            className={tabButtonClass(open === 'glossary')}
          >
            <span className={`transition-transform ${open === 'glossary' ? 'rotate-90' : ''}`}>&rsaquo;</span>
            오타 사전
            {glossary.status && <span className="text-blue-500 truncate">{glossary.status}</span>}
          </button>
        )}
      </div>

      {open && (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 border-t border-border">
          {open === 'typo' && (
            <TermCorrectionDetails
              variant="bare"
              corrections={corrections}
              status={status}
              isApplying={isApplying}
              onUpdate={onUpdate}
              onAdd={onAdd}
              onRemove={onRemove}
              onApply={onApply}
            />
          )}
          {open === 'glossary' && glossary.view && (
            <GlossaryPanelContent
              variant="bare"
              view={glossary.view}
              status={glossary.status}
              addMeetingEntry={glossary.addMeetingEntry}
              addFolderEntry={glossary.addFolderEntry}
              editEntry={glossary.editEntry}
              removeEntry={glossary.removeEntry}
              reapply={glossary.reapply}
              applyEntry={glossary.applyEntry}
            />
          )}
        </div>
      )}
    </div>
  )
}
