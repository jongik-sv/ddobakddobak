import { PanelRightOpen } from 'lucide-react'
import { Tooltip } from './Tooltip'

interface PanelExpandStripProps {
  onExpand: () => void
}

/**
 * 우측 패널이 접혔을 때 다시 펼치는 엣지 어포던스 — 사이드바 접힘 상태(AppLayout.tsx)와
 * 동일한 패턴(w-10 슬림 스트립 + 상단 고정 버튼). Panel 안에 넣으면 PanelGroup의
 * overflow:hidden에 잘려 안 보이므로 PanelGroup 밖의 flex 형제로 둔다.
 * (MeetingPage.tsx ↔ MeetingLivePage.tsx 공용)
 */
export function PanelExpandStrip({ onExpand }: PanelExpandStripProps) {
  return (
    <div className="flex flex-col items-center w-10 border-l border-border bg-card shrink-0 pt-3">
      <Tooltip text="패널 펼치기" position="left">
        <button
          onClick={onExpand}
          aria-label="패널 펼치기"
          className="p-2.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
      </Tooltip>
    </div>
  )
}
