/**
 * TSK-04-01: 터치 타겟 및 호버 미디어 쿼리 적용 테스트
 *
 * Acceptance Criteria:
 * 1. 모든 인터랙티브 요소: 최소 44x44px 터치 영역 (min-h-[44px] min-w-[44px] or padding)
 * 2. 인접 버튼 최소 8px 간격 (gap-2)
 * 3. 호버 효과: hover 가능 디바이스에서만 적용 (hover-hide, hover-show-parent 유틸리티)
 * 4. 전사/요약 텍스트: 선택 가능 유지 (select-text)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// ── 1. CSS 유틸리티 존재 확인 ──
import indexCssContent from '../../../src/index.css?raw'

describe('index.css 유틸리티', () => {
  it('hover-hide @utility가 정의되어 있다', () => {
    expect(indexCssContent).toContain('@utility hover-hide')
  })

  it('hover-show-parent @utility가 정의되어 있다', () => {
    expect(indexCssContent).toContain('@utility hover-show-parent')
  })

  it('hover-tooltip @utility가 정의되어 있다', () => {
    expect(indexCssContent).toContain('@utility hover-tooltip')
  })

  it('select-text 클래스가 정의되어 있다', () => {
    expect(indexCssContent).toContain('.select-text')
    expect(indexCssContent).toContain('user-select: text')
  })
})

// ── 2. Switch 터치 타겟 ──
import { Switch } from '../ui/Switch'

describe('Switch 터치 타겟', () => {
  it('label에 min-h-[44px] 클래스가 적용되어 있다', () => {
    const { container } = render(
      <Switch checked={false} onChange={vi.fn()} label="테스트" />
    )
    const label = container.querySelector('label')
    expect(label?.className).toContain('min-h-[44px]')
  })
})

// ── 3. Tooltip 호버 분기 ──
import { Tooltip } from '../ui/Tooltip'

describe('Tooltip 호버 분기', () => {
  it('tooltip span에 hover-tooltip 클래스가 적용되어 있다', () => {
    render(
      <Tooltip text="테스트 툴팁">
        <button>버튼</button>
      </Tooltip>
    )
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.className).toContain('hover-tooltip')
  })

  it('group-hover/tooltip:opacity-100 클래스가 제거되었다', () => {
    render(
      <Tooltip text="테스트 툴팁">
        <button>버튼</button>
      </Tooltip>
    )
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.className).not.toContain('group-hover/tooltip:opacity-100')
  })
})

// ── 4. TranscriptPanel 텍스트 선택 + 터치 타겟 ──
import { TranscriptPanel } from '../meeting/TranscriptPanel'

const mockTranscripts = [
  {
    id: 1,
    speaker_label: 'SPEAKER_00',
    content: '첫 번째 발화입니다.',
    started_at_ms: 0,
    ended_at_ms: 3000,
    sequence_number: 1,
  },
]

describe('TranscriptPanel 터치 최적화', () => {
  it('전사 텍스트에 select-text 클래스가 적용되어 있다', () => {
    render(
      <TranscriptPanel
        transcripts={mockTranscripts}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    )
    const content = screen.getByText('첫 번째 발화입니다.')
    expect(content.className).toContain('select-text')
  })

  it('전사 항목에 min-h-[44px] 클래스가 적용되어 있다', () => {
    render(
      <TranscriptPanel
        transcripts={mockTranscripts}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    )
    const item = screen.getByText('첫 번째 발화입니다.').closest('[data-highlighted]')
    expect(item?.className).toContain('min-h-[44px]')
  })
})

// ── 5. AudioPlayer 터치 타겟 ──
// AudioPlayer는 useAudioPlayer hook에 의존하므로 mock
vi.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => ({
    isReady: true,
    isPlaying: false,
    hasAudio: true,
    audioLoaded: true,
    currentTimeMs: 0,
    durationMs: 60000,
    playbackRate: 1,
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
    setPlaybackRate: vi.fn(),
    download: vi.fn(),
  }),
}))

import { AudioPlayer } from '../meeting/AudioPlayer'

describe('AudioPlayer 터치 타겟', () => {
  it('재생 버튼이 w-11 h-11 (44px) 크기를 갖는다', () => {
    const { container } = render(
      <AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />
    )
    // 재생 버튼은 Play 아이콘을 감싸는 button
    const playButton = container.querySelector('button')
    expect(playButton?.className).toContain('w-11')
    expect(playButton?.className).toContain('h-11')
  })

  it('배속 버튼에 min-h-[44px] 클래스가 적용되어 있다', () => {
    render(
      <AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />
    )
    const speedButton = screen.getByText('1x')
    expect(speedButton.className).toContain('min-h-[44px]')
  })

  it('프로그레스 바 thumb에 hover-hide 클래스가 적용되어 있다', () => {
    const { container } = render(
      <AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />
    )
    // progress bar의 thumb 요소 (absolute positioned div with rounded-full shadow)
    const thumbs = container.querySelectorAll('.rounded-full.shadow')
    const thumb = Array.from(thumbs).find((el) => el.className.includes('absolute'))
    expect(thumb?.className).toContain('hover-hide')
    expect(thumb?.className).toContain('hover-show-parent')
  })
})

// ── 6. ShareButton 터치 타겟 ──
vi.mock('../../stores/sharingStore', () => ({
  useSharingStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ shareCode: null, isLoading: false, participants: [] }),
}))
vi.mock('../../api/meetings', () => ({
  shareMeeting: vi.fn(),
  stopSharing: vi.fn(),
}))

import { ShareButton } from '../meeting/ShareButton'

describe('ShareButton 터치 타겟', () => {
  it('공유 버튼에 min-h-[44px] 클래스가 적용되어 있다', () => {
    render(<ShareButton meetingId={1} />)
    const button = screen.getByText('공유').closest('button')
    expect(button?.className).toContain('min-h-[44px]')
  })
})

// ── 7. ExportButton 터치 타겟 ──
import { ExportButton } from '../meeting/ExportButton'

describe('ExportButton 터치 타겟', () => {
  it('내보내기 버튼에 min-h-[44px] 클래스가 적용되어 있다', () => {
    render(<ExportButton meetingId={1} />)
    const button = screen.getByText('내보내기').closest('button')
    expect(button?.className).toContain('min-h-[44px]')
  })
})

// ── 8. ShareLinkButton 터치 타겟 ──
import { ShareLinkButton } from '../meeting/ShareLinkButton'

describe('ShareLinkButton 터치 타겟', () => {
  it('링크 복사 버튼에 min-h-[44px] 클래스가 적용되어 있다', () => {
    render(<ShareLinkButton meetingId={1} />)
    const button = screen.getByText('링크 복사').closest('button')
    expect(button?.className).toContain('min-h-[44px]')
  })
})

// ── 9. RecordTabPanel 터치 타겟 ──
// RecordTabPanel에서 LiveRecord와 FullRecord를 mock
vi.mock('../meeting/LiveRecord', () => ({
  LiveRecord: () => <div>live record mock</div>,
}))
vi.mock('../meeting/FullRecord', () => ({
  FullRecord: () => <div>full record mock</div>,
}))

import { RecordTabPanel } from '../meeting/RecordTabPanel'

describe('RecordTabPanel 터치 타겟', () => {
  it('탭 버튼에 min-h-[44px] 클래스가 적용되어 있다', () => {
    render(<RecordTabPanel meetingId={1} />)
    const liveTab = screen.getByText('라이브 기록')
    expect(liveTab.className).toContain('min-h-[44px]')
    const allTab = screen.getByText('전체 기록')
    expect(allTab.className).toContain('min-h-[44px]')
  })
})

// ── 10. FolderTree group-hover 분기 ──
// FolderTree는 복잡한 의존성이 있으므로 className 패턴만 확인
// 이 테스트 파일에서는 소스 코드의 클래스 문자열을 확인
import FolderTreeSource from '../folder/FolderTree?raw'

describe('FolderTree 호버 분기', () => {
  it('group-hover:block 대신 hover-show-block-parent 유틸리티를 사용한다', () => {
    // "hidden group-hover:block" 패턴이 "hover-show-block-parent"로 교체
    expect(FolderTreeSource).not.toContain('"hidden group-hover:block')
  })

  it('group-hover:hidden 대신 hover-hide-parent 유틸리티를 사용한다', () => {
    expect(FolderTreeSource).not.toContain('group-hover:hidden')
  })

  it('hover-show-block-parent 유틸리티를 사용한다', () => {
    expect(FolderTreeSource).toContain('hover-show-block-parent')
  })
})

// ── 11. AiSummaryPanel select-text ──
import AiSummarySrc from '../meeting/AiSummaryPanel?raw'

describe('AiSummaryPanel 텍스트 선택', () => {
  it('BlockNoteView 래퍼에 select-text 클래스가 적용되어 있다', () => {
    expect(AiSummarySrc).toContain('select-text')
  })
})

// ── 12. SpeakerPanel 터치 타겟 ──
import SpeakerPanelSrc from '../meeting/SpeakerPanel?raw'

describe('SpeakerPanel 터치 타겟', () => {
  it('초기화 버튼에 min-h-[44px]이 적용되어 있다', () => {
    expect(SpeakerPanelSrc).toContain('min-h-[44px]')
  })
})

// ── 13. Sidebar 터치 타겟 ──
import SidebarSrc from '../layout/Sidebar?raw'

describe('Sidebar 터치 타겟', () => {
  it('NavLink py-2.5 로 높이 확보', () => {
    expect(SidebarSrc).toContain('py-2.5')
  })

  it('닫기 버튼 p-2.5 로 터치 타겟 확보', () => {
    expect(SidebarSrc).toContain('p-2.5')
  })
})

// ── 14. AppLayout 터치 타겟 ──
import AppLayoutSrc from '../layout/AppLayout?raw'

describe('AppLayout 터치 타겟', () => {
  it('사이드바 토글 버튼에 p-2.5 적용', () => {
    expect(AppLayoutSrc).toContain('p-2.5')
  })
})

// ── 15. ViewerHeader 터치 타겟 ──
import ViewerHeaderSrc from '../meeting/ViewerHeader?raw'

describe('ViewerHeader 터치 타겟', () => {
  it('나가기 버튼에 p-2.5 적용', () => {
    expect(ViewerHeaderSrc).toContain('p-2.5')
  })

  it('나가기 텍스트 버튼에 min-h-[44px] 적용', () => {
    expect(ViewerHeaderSrc).toContain('min-h-[44px]')
  })
})

// ── 16. AttachmentCard 호버 분기 ──
import AttachmentCardSrc from '../meeting/AttachmentCard?raw'

describe('AttachmentCard 호버 분기', () => {
  it('group-hover:flex 대신 hover-show-flex-parent 또는 항상 표시로 변경', () => {
    // "hidden group-hover:flex"가 없어야 한다
    expect(AttachmentCardSrc).not.toContain('hidden group-hover:flex')
  })
})

// ── 17. UserManagementPanel 호버 분기 ──
import UserMgmtSrc from '../settings/UserManagementPanel?raw'

describe('UserManagementPanel 호버 분기', () => {
  it('삭제 버튼에 hover-hide hover-show-parent가 적용되어 있다', () => {
    expect(UserMgmtSrc).toContain('hover-hide')
    expect(UserMgmtSrc).toContain('hover-show-parent')
  })
})

// ── 18. DashboardPage active 터치 피드백 ──
import DashboardSrc from '../../pages/DashboardPage?raw'

describe('DashboardPage 터치 피드백', () => {
  it('통계 카드에 active:bg-muted/50이 적용되어 있다', () => {
    expect(DashboardSrc).toContain('active:bg-muted/50')
  })

  it('전체 보기 링크에 min-h-[44px] 적용', () => {
    expect(DashboardSrc).toContain('min-h-[44px]')
  })
})

// ── 19. SearchPage 터치 타겟 ──
import SearchPageSrc from '../../pages/SearchPage?raw'

describe('SearchPage 터치 타겟', () => {
  it('검색 버튼에 min-h-[44px]이 적용되어 있다', () => {
    expect(SearchPageSrc).toContain('min-h-[44px]')
  })

  it('필터 버튼에 min-h-[44px] min-w-[44px]이 적용되어 있다', () => {
    expect(SearchPageSrc).toContain('min-h-[44px]')
    expect(SearchPageSrc).toContain('min-w-[44px]')
  })

  it('검색 결과 카드에 active:bg-accent/50이 적용되어 있다', () => {
    expect(SearchPageSrc).toContain('active:bg-accent/50')
  })

  it('페이지네이션 버튼에 p-2.5 적용', () => {
    expect(SearchPageSrc).toContain('p-2.5')
  })
})

// ── 20. SettingsModal 터치 타겟 ──
import SettingsModalSrc from '../settings/SettingsModal?raw'

describe('SettingsModal 터치 타겟', () => {
  it('닫기 버튼에 p-2.5 적용', () => {
    expect(SettingsModalSrc).toContain('p-2.5')
  })

  it('탭 버튼에 min-h-[44px] 적용', () => {
    expect(SettingsModalSrc).toContain('min-h-[44px]')
  })
})

// ── 21. MeetingPage 터치 타겟 ──
import MeetingPageSrc from '../../pages/MeetingPage?raw'

describe('MeetingPage 터치 타겟', () => {
  it('뒤로가기 버튼에 p-2.5 적용', () => {
    expect(MeetingPageSrc).toContain('p-2.5')
  })

  it('북마크 삭제 버튼에 hover-hide hover-show-parent가 적용되어 있다', () => {
    expect(MeetingPageSrc).toContain('hover-hide')
    expect(MeetingPageSrc).toContain('hover-show-parent')
  })

  it('확인/취소 다이얼로그 버튼에 min-h-[44px] 적용', () => {
    // STT 재생성 확인 다이얼로그 등의 버튼
    expect(MeetingPageSrc).toContain('min-h-[44px]')
  })
})

// ── 22. DecisionList 터치 타겟 ──
import DecisionListSrc from '../decision/DecisionList?raw'

describe('DecisionList 터치 타겟', () => {
  it('수정/삭제 버튼에 min-h-[44px] 적용', () => {
    expect(DecisionListSrc).toContain('min-h-[44px]')
  })
})

// ── 23. ActionItemList 터치 타겟 ──
import ActionItemListSrc from '../action-item/ActionItemList?raw'

describe('ActionItemList 터치 타겟', () => {
  it('수정/삭제 버튼에 min-h-[44px] 적용', () => {
    expect(ActionItemListSrc).toContain('min-h-[44px]')
  })
})

// ── 24. DecisionForm 터치 타겟 ──
import DecisionFormSrc from '../decision/DecisionForm?raw'

describe('DecisionForm 터치 타겟', () => {
  it('버튼에 min-h-[44px] 적용', () => {
    expect(DecisionFormSrc).toContain('min-h-[44px]')
  })
})

// ── 25. ActionItemForm 터치 타겟 ──
import ActionItemFormSrc from '../action-item/ActionItemForm?raw'

describe('ActionItemForm 터치 타겟', () => {
  it('버튼에 min-h-[44px] 적용', () => {
    expect(ActionItemFormSrc).toContain('min-h-[44px]')
  })
})

// ── 26. ParticipantList 터치 타겟 ──
import ParticipantListSrc from '../meeting/ParticipantList?raw'

describe('ParticipantList 터치 타겟', () => {
  it('넘기기 버튼에 min-h-[44px] 적용', () => {
    expect(ParticipantListSrc).toContain('min-h-[44px]')
  })
})
