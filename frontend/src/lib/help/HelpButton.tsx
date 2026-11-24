import { CircleHelp } from 'lucide-react'
import { openHelp } from './openHelp'

/** 작은 아이콘 전용 매뉴얼 버튼 (사이드바 없는 화면용). */
export function HelpIconButton({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => void openHelp()}
      title="매뉴얼 (F1)"
      aria-label="매뉴얼 (F1)"
      className={`p-2 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground ${className}`}
    >
      <CircleHelp className="w-5 h-5" />
    </button>
  )
}
