import { useEffect, useState } from 'react'
import { getScopeProjects, type ScopeProject } from '../../../api/sttTermLearning'
import { useProjectStore } from '../../../stores/projectStore'
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

/** 프로젝트와 무관한(전역) 하위 탭 — 선택기를 비활성화한다. */
const GLOBAL_TABS: SubTab[] = ['settings', 'flow']

export const PROJECT_STORAGE_KEY = 'stt_term_learning_project_id'

function readStored(): number | null {
  try {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY)
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function writeStored(id: number) {
  try {
    localStorage.setItem(PROJECT_STORAGE_KEY, String(id))
  } catch {
    /* 저장 불가 환경 — 무시 */
  }
}

export default function SttTermLearningTab() {
  const [sub, setSub] = useState<SubTab>('tree')
  const [projects, setProjects] = useState<ScopeProject[] | null>(null)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [loadError, setLoadError] = useState(false)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)

  // 선택기 옵션 = 서버 AdminScope.projects 와 같은 가시 범위. 기본값: 저장값 → 현재 프로젝트 → 첫 프로젝트.
  useEffect(() => {
    let alive = true
    getScopeProjects()
      .then((list) => {
        if (!alive) return
        const has = (id: number | null) => id != null && list.some((p) => p.id === id)
        const stored = readStored()
        const pick = has(stored) ? stored : has(currentProjectId) ? currentProjectId : (list[0]?.id ?? null)
        setProjects(list)
        setProjectId(pick)
      })
      .catch(() => alive && setLoadError(true))
    return () => {
      alive = false
    }
    // 최초 1회만 기본값을 정한다(이후 currentProjectId 변화에 선택을 뺏기지 않게).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const choose = (id: number) => {
    setProjectId(id)
    writeStored(id)
  }

  const globalTab = GLOBAL_TABS.includes(sub)
  const scoped = projectId != null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="stt-term-project" className="text-sm font-medium">프로젝트</label>
        <select
          id="stt-term-project"
          aria-label="프로젝트 선택"
          value={projectId ?? ''}
          disabled={globalTab || !projects || projects.length === 0}
          onChange={(e) => choose(Number(e.target.value))}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm min-w-[180px] disabled:opacity-50"
        >
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {globalTab ? '이 탭은 프로젝트와 무관하게 전체에 적용됩니다.' : '전역(공용) 용어는 모든 프로젝트에 적용되어 함께 표시됩니다.'}
        </span>
        {loadError && <span className="text-xs text-red-600">프로젝트 목록을 불러오지 못했습니다.</span>}
      </div>
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
      {sub === 'settings' && <LearningSettingsView />}
      {sub === 'flow' && <FlowGuideView />}
      {/* 프로젝트 목록 확정 전에는 데이터 뷰를 띄우지 않는다(전체→선택 이중 호출 방지). 선택 가능한 프로젝트가 없으면 전체 보기. */}
      {!globalTab && projects && (
        <div key={scoped ? projectId : 'all'}>
          {sub === 'tree' && <LevelTreeView projectId={projectId} />}
          {sub === 'runs' && <RunHistoryView projectId={projectId} />}
          {sub === 'misrecognitions' && <MisrecognitionsView projectId={projectId} />}
          {sub === 'all' && <AllTermsView projectId={projectId} />}
        </div>
      )}
    </div>
  )
}
