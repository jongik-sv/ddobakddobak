import { useState } from 'react'
import LevelTreeView from './LevelTreeView'
import RunHistoryView from './RunHistoryView'
import LearningSettingsView from './LearningSettingsView'
import MisrecognitionsView from './MisrecognitionsView'
import FlowGuideView from './FlowGuideView'
import AllTermsView from './AllTermsView'

const SUB_TABS = [
  { id: 'tree', label: '레벨별 용어' },
  { id: 'runs', label: '처리 내역' },
  { id: 'settings', label: '설정' },
  { id: 'misrecognitions', label: '오인식 기록' },
  { id: 'flow', label: '등록 흐름' },
  { id: 'all', label: '전체 용어' },
] as const

type SubTab = (typeof SUB_TABS)[number]['id']

export default function SttTermLearningTab() {
  const [sub, setSub] = useState<SubTab>('tree')
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="STT 용어 학습 하위 탭" className="flex gap-1 border-b overflow-x-auto">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={sub === t.id}
            onClick={() => setSub(t.id)}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 text-sm border-b-2 -mb-px ${
              sub === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'tree' && <LevelTreeView />}
      {sub === 'runs' && <RunHistoryView />}
      {sub === 'settings' && <LearningSettingsView />}
      {sub === 'misrecognitions' && <MisrecognitionsView />}
      {sub === 'flow' && <FlowGuideView />}
      {sub === 'all' && <AllTermsView />}
    </div>
  )
}
