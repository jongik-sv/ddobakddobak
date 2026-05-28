import { Monitor, Globe } from 'lucide-react'

interface ServerModeSelectorProps {
  mode: 'local' | 'server' | null
  onSelectLocal: () => void
  onSelectServer: () => void
}

/** 로컬 실행 / 서버 연결 모드 선택 카드 (데스크톱 전용). */
export function ServerModeSelector({ mode, onSelectLocal, onSelectServer }: ServerModeSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-4 mb-6">
      <button
        type="button"
        aria-pressed={mode === 'local'}
        onClick={onSelectLocal}
        className={`flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all cursor-pointer ${
          mode === 'local'
            ? 'border-blue-500 ring-2 ring-blue-500 bg-blue-50'
            : 'border-slate-200 hover:border-slate-300 bg-white'
        }`}
      >
        <Monitor className="w-8 h-8 text-slate-600" />
        <span className="font-semibold text-slate-800">로컬 실행</span>
        <span className="text-sm text-slate-500 text-center">
          이 컴퓨터에서 직접 실행합니다
        </span>
      </button>

      <button
        type="button"
        aria-pressed={mode === 'server'}
        onClick={onSelectServer}
        className={`flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all cursor-pointer ${
          mode === 'server'
            ? 'border-blue-500 ring-2 ring-blue-500 bg-blue-50'
            : 'border-slate-200 hover:border-slate-300 bg-white'
        }`}
      >
        <Globe className="w-8 h-8 text-slate-600" />
        <span className="font-semibold text-slate-800">서버 연결</span>
        <span className="text-sm text-slate-500 text-center">
          원격 서버에 연결하여 사용합니다
        </span>
      </button>
    </div>
  )
}
