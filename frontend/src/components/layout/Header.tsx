import { LogOut } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { IS_TAURI } from '../../config'

export default function Header() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  return (
    <header className="flex items-center justify-between h-16 px-6 border-b border-border bg-background">
      <div className="text-sm text-muted-foreground">
        {user?.name && (
          <span className="font-medium text-foreground">{user.name}</span>
        )}
      </div>
      {!IS_TAURI && (
        <button
          onClick={logout}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label="로그아웃"
        >
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>
      )}
    </header>
  )
}
