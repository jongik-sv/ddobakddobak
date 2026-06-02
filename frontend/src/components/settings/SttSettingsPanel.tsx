import { useState, useEffect } from 'react'
import { HTTPError } from 'ky'
import { getSttSettings, updateSttEngine } from '../../api/settings'
import type { SttSettings } from '../../api/settings'
import { ENGINE_LABELS } from '../../config'

/** STT(음성 인식) 엔진 선택 카드. */
export function SttSettingsPanel() {
  const [settings, setSettings] = useState<SttSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    getSttSettings()
      .then(setSettings)
      .catch(() => setError('설정을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  const handleEngineChange = async (engine: string) => {
    if (!settings || engine === settings.stt_engine) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await updateSttEngine(engine)
      setSettings((prev) => prev ? { ...prev, stt_engine: result.stt_engine, model_loaded: result.model_loaded } : prev)
      setSuccess(`STT 모델이 "${ENGINE_LABELS[engine] ?? engine}"으로 변경되었습니다.`)
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = await err.response.json().catch(() => ({})) as Record<string, string>
        setError(body.error ?? body.detail ?? 'STT 모델 변경에 실패했습니다.')
      } else {
        setError('STT 모델 변경에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-1">STT 모델</h2>
      <p className="text-sm text-muted-foreground mb-4">음성 인식에 사용할 엔진을 선택합니다. 파일 업로드 시에는 Whisper가 자동 선택됩니다.</p>

      {loading && (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      )}

      {!loading && settings && (
        <div className="space-y-2">
          {settings.available_engines.map((engine) => (
            <label
              key={engine}
              className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <input
                type="radio"
                name="stt_engine"
                value={engine}
                checked={settings.stt_engine === engine}
                onChange={() => handleEngineChange(engine)}
                disabled={saving}
                className="accent-primary"
              />
              <div>
                <p className="text-sm font-medium">{ENGINE_LABELS[engine] ?? engine}</p>
                {settings.stt_engine === engine && (
                  <p className="text-xs text-muted-foreground">
                    {settings.model_loaded ? '모델 로드됨' : '모델 로드 중...'}
                  </p>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      {saving && (
        <p className="mt-3 text-sm text-blue-600">모델 변경 중... (모델에 따라 시간이 걸릴 수 있습니다)</p>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      )}
      {success && (
        <p className="mt-3 text-sm text-green-600">{success}</p>
      )}
    </div>
  )
}
