import { useState, useEffect } from 'react'
import { getHfSettings, updateHfToken } from '../../api/settings'
import type { HfSettings } from '../../api/settings'
import { PasswordInput } from '../ui/PasswordInput'

/** HuggingFace 토큰(화자 분리 모델 다운로드용) 설정 카드. */
export function HuggingFacePanel() {
  const [hfSettings, setHfSettings] = useState<HfSettings | null>(null)
  const [hfToken, setHfToken] = useState('')
  const [hfSaving, setHfSaving] = useState(false)
  const [hfSuccess, setHfSuccess] = useState<string | null>(null)
  const [hfError, setHfError] = useState<string | null>(null)

  useEffect(() => {
    getHfSettings().then(setHfSettings).catch(() => {})
  }, [])

  const handleHfSave = async () => {
    if (!hfToken.trim()) return
    setHfSaving(true)
    setHfError(null)
    setHfSuccess(null)
    try {
      const result = await updateHfToken(hfToken.trim())
      setHfSettings(result)
      setHfToken('')
      setHfSuccess('HuggingFace 토큰이 저장되었습니다.')
    } catch {
      setHfError('HuggingFace 토큰 저장에 실패했습니다.')
    } finally {
      setHfSaving(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-1">HuggingFace</h2>
      <p className="text-sm text-muted-foreground mb-4">
        화자 분리(pyannote) 모델 다운로드에 필요한 토큰입니다.
      </p>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">HF Token</label>
          <PasswordInput
            value={hfToken}
            onChange={(e) => setHfToken(e.target.value)}
            placeholder={hfSettings?.hf_token_masked || 'hf_...'}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono min-h-[44px]"
          />
          {hfSettings?.has_token && !hfToken && (
            <p className="text-xs text-muted-foreground mt-1">현재: {hfSettings.hf_token_masked}</p>
          )}
          {hfSettings && !hfSettings.has_token && (
            <p className="text-xs text-yellow-600 mt-1">토큰 미설정 — 화자 분리 기능이 비활성화됩니다.</p>
          )}
        </div>
        <button
          onClick={handleHfSave}
          disabled={hfSaving || !hfToken.trim()}
          className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]"
        >
          {hfSaving ? '저장 중...' : '저장'}
        </button>
        {hfError && <p className="text-sm text-red-600">{hfError}</p>}
        {hfSuccess && <p className="text-sm text-green-600">{hfSuccess}</p>}
        {hfSettings?.offline && (
          <p className="text-sm text-yellow-600">Sidecar 연결 불가 — 오프라인 상태</p>
        )}
      </div>
    </div>
  )
}
