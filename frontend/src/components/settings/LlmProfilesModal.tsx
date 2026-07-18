import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { listLlmProfiles, deleteLlmProfile, type LlmProfile } from '../../api/llmProfiles'
import { LlmProfileForm } from './LlmProfileForm'
import { confirmDialog } from '../../lib/confirmDialog'
import { SERVICE_PRESETS } from './llmServicePresets'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { BREAKPOINTS } from '../../config'

export interface LlmProfilesModalProps {
  scope: 'personal' | 'server'
  open: boolean
  initialCreate?: boolean
  onClose: () => void
  onChanged?: (profiles: LlmProfile[]) => void
}

const CONTAINER_DESKTOP =
  'relative w-full max-w-3xl max-h-[90vh] rounded-xl bg-card shadow-2xl border border-border flex flex-col mx-4'
const CONTAINER_MOBILE = 'fixed inset-0 w-full h-dvh bg-card flex flex-col'

const CLOSE_BTN =
  'p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'

export default function LlmProfilesModal({ scope, open, initialCreate, onClose, onChanged }: LlmProfilesModalProps) {
  const [profiles, setProfiles] = useState<LlmProfile[]>([])
  const [editing, setEditing] = useState<LlmProfile | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isDesktop = useMediaQuery(BREAKPOINTS.lg)

  const reload = async () => {
    const list = await listLlmProfiles(scope)
    setProfiles(list)
    onChanged?.(list)
    return list
  }

  useEffect(() => {
    if (!open) return
    setEditing(initialCreate ? 'new' : null)
    reload().catch(() => setError('프로필 목록을 불러올 수 없습니다.'))
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope])

  if (!open) return null

  const handleDelete = async (p: LlmProfile) => {
    if (!(await confirmDialog(`'${p.name}' 프로필을 삭제할까요? 이 프로필을 쓰는 설정은 해제됩니다.`))) return
    await deleteLlmProfile(p.id)
    await reload()
  }

  const closeButton = (
    <button onClick={onClose} className={CLOSE_BTN} aria-label="닫기">
      <X className="w-5 h-5" />
    </button>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => e.stopPropagation()}
    >
      <div className={isDesktop ? CONTAINER_DESKTOP : CONTAINER_MOBILE}>
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          {!isDesktop && closeButton}
          <h2 className="text-lg font-semibold text-foreground">LLM 프로필 관리</h2>
          {isDesktop && closeButton}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

          {editing ? (
            <LlmProfileForm
              scope={scope}
              initial={editing === 'new' ? null : editing}
              onSaved={async () => { setEditing(null); await reload() }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <>
              <div className="space-y-2">
                {profiles.map((p) => {
                  const presetLabel = SERVICE_PRESETS.find((x) => x.id === p.preset_id)?.name ?? p.preset_id
                  return (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <p className="text-sm font-medium">{p.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span className="rounded bg-accent px-1.5 py-0.5">{presetLabel}</span>
                          {p.model && <span className="font-mono">{p.model}</span>}
                          {p.auth_token_masked && <span className="font-mono">{p.auth_token_masked}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" aria-label={`${p.name} 편집`} onClick={() => setEditing(p)}
                          className="text-xs text-blue-600 hover:text-blue-800">
                          편집
                        </button>
                        <button type="button" aria-label={`${p.name} 삭제`} onClick={() => handleDelete(p)}
                          className="text-xs text-red-600 hover:text-red-800">
                          삭제
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <button type="button" onClick={() => setEditing('new')}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent transition-colors min-h-[44px]">
                ＋ 새 프로필
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
