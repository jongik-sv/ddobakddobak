import { useState, useEffect } from 'react'
import { LANGUAGES } from '../../config'
import {
  getUserLanguageSettings,
  updateUserLanguageSettings,
} from '../../api/userLanguageSettings'
import type { UserLanguageSettingsResponse } from '../../api/userLanguageSettings'

type Mode = 'single' | 'multi'

export default function UserLanguageSettings() {
  const [settings, setSettings] = useState<UserLanguageSettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const [mode, setMode] = useState<Mode>('single')
  const [languages, setLanguages] = useState<string[]>(['ko'])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    getUserLanguageSettings()
      .then((data) => {
        setSettings(data)
        // 개인 설정이 있으면 그 값, 없으면 서버 기본값으로 폼 초기화
        const src = data.language_settings.configured ? data.language_settings : data.server_default
        setMode(src.mode)
        setLanguages(src.languages.length ? src.languages : ['ko'])
      })
      .catch(() => setError('설정을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  const singleLanguage = languages[0] ?? 'ko'

  const handleSetSingle = (code: string) => {
    setMode('single')
    setLanguages([code])
    setSuccess(null)
  }

  const toggleMulti = (code: string) => {
    setSuccess(null)
    setLanguages((prev) => {
      if (prev.includes(code)) {
        if (prev.length <= 1) return prev
        return prev.filter((c) => c !== code)
      }
      return [...prev, code]
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const payload = mode === 'single' ? [singleLanguage] : languages
      const result = await updateUserLanguageSettings({
        language_settings: { mode, languages: payload },
      })
      setSettings(result)
      setSuccess('저장되었습니다.')
    } catch {
      setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-1">회의 언어</h2>
      <p className="text-sm text-muted-foreground mb-4">
        내가 생성한 회의의 음성 인식에 사용할 언어 방식입니다. 이 설정은 내 계정에 저장됩니다.
      </p>

      {loading && (
        <p className="text-sm text-muted-foreground" role="status">불러오는 중...</p>
      )}

      {!loading && error && !settings && (
        <p className="text-sm text-red-600" role="alert">{error}</p>
      )}

      {!loading && settings && (
        <>
          <div className="space-y-2">
            <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="user_language_mode"
                checked={mode === 'single'}
                onChange={() => setMode('single')}
                className="accent-blue-600 w-4 h-4 mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium">단일 언어 (정확) — 권장</span>
                <span className="block text-xs text-muted-foreground">한 가지 언어로 고정 인식. 인식 정확도가 가장 높습니다.</span>
              </span>
            </label>

            {mode === 'single' && (
              <div className="ml-7">
                <select
                  aria-label="단일 언어 선택"
                  value={singleLanguage}
                  onChange={(e) => handleSetSingle(e.target.value)}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>{lang.label} ({lang.code})</option>
                  ))}
                </select>
              </div>
            )}

            <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="user_language_mode"
                checked={mode === 'multi'}
                onChange={() => setMode('multi')}
                className="accent-blue-600 w-4 h-4 mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium">다국어 자동감지</span>
                <span className="block text-xs text-muted-foreground">선택한 언어들을 자동 감지. 목록 밖 언어는 걸러냅니다.</span>
              </span>
            </label>

            {mode === 'multi' && (
              <div className="ml-7 space-y-2">
                {LANGUAGES.map((lang) => {
                  const checked = languages.includes(lang.code)
                  const isOnly = checked && languages.length === 1
                  return (
                    <label key={lang.code} className="flex items-center gap-3 rounded-md border p-2 cursor-pointer hover:bg-muted/50 transition-colors">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isOnly}
                        onChange={() => toggleMulti(lang.code)}
                        className="accent-blue-600 w-4 h-4"
                      />
                      <span className="text-sm font-medium">{lang.label}</span>
                      <span className="text-xs text-muted-foreground">({lang.code})</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            ℹ️ 한국어로만 진행하는 회의는 <strong>단일 언어(한국어)</strong>를 선택하면 인식 정확도가 더 높습니다.
            다국어 모드는 다른 언어가 섞여 인식될 수 있습니다.
          </p>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            {success && <span className="text-sm text-green-600" role="status">{success}</span>}
            {error && settings && <span className="text-sm text-red-600" role="alert">{error}</span>}
          </div>
        </>
      )}
    </div>
  )
}
