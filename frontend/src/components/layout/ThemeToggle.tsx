import { Sun, Moon, Monitor } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'

const LABELS = { light: '라이트', dark: '다크', system: '시스템' } as const

export default function ThemeToggle() {
  const theme = useUiStore((s) => s.theme)
  const cycleTheme = useUiStore((s) => s.cycleTheme)

  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  const label = LABELS[theme]

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground w-full"
      title={`테마: ${label} (클릭하여 전환)`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  )
}
