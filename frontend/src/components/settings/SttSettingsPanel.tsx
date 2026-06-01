import { useState, useEffect } from 'react'
import { HTTPError } from 'ky'
import { getSttSettings, updateSttEngine } from '../../api/settings'
import type { SttSettings } from '../../api/settings'
import { ENGINE_LABELS, IS_MOBILE, IS_TAURI } from '../../config'
import { useAppSettingsStore } from '../../stores/appSettingsStore'
import ModelManager from '../stt/ModelManager'

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

      <OnDeviceSttSettings />
    </div>
  )
}

/**
 * 온디바이스(로컬) STT 모드 토글 — 클라이언트-디바이스 로컬 설정(서버 무전송).
 * Android(Tauri 모바일)에서만 의미가 있으므로 그 외 플랫폼에선 숨긴다.
 */
function OnDeviceSttSettings() {
  const sttMode = useAppSettingsStore((s) => s.sttMode)
  const setSttMode = useAppSettingsStore((s) => s.setSttMode)
  const localUploadEnabled = useAppSettingsStore((s) => s.localUploadEnabled)
  const setLocalUploadEnabled = useAppSettingsStore((s) => s.setLocalUploadEnabled)

  // 온디바이스 STT는 Android(Tauri 모바일)에서만 가능.
  if (!(IS_TAURI && IS_MOBILE)) return null

  const MODES: { value: 'server' | 'local' | 'auto'; label: string; desc: string }[] = [
    { value: 'auto', label: '자동', desc: '서버 연결 안 되면 자동으로 온디바이스 전사' },
    { value: 'server', label: '서버', desc: '항상 서버에서 전사(화자분리·다국어·태국어 지원)' },
    { value: 'local', label: '온디바이스', desc: '항상 폰에서 전사(오프라인, 단일언어·화자분리 없음)' },
  ]

  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="text-base font-semibold mb-1">전사 위치 (온디바이스)</h3>
      <p className="text-sm text-muted-foreground mb-3">
        서버 없이 폰 안에서 전사할지 선택합니다. 온디바이스는 한국어 등 단일 언어만
        지원하며 화자분리·태국어·다국어 자동감지는 서버 모드가 필요합니다.
      </p>

      {/* 모델 다운로드·관리 게이트 (~2.7GB) */}
      <ModelManager className="mb-4" />

      <div className="space-y-2">
        {MODES.map((m) => (
          <label
            key={m.value}
            className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
          >
            <input
              type="radio"
              name="stt_mode"
              value={m.value}
              checked={sttMode === m.value}
              onChange={() => setSttMode(m.value)}
              className="accent-primary"
            />
            <div>
              <p className="text-sm font-medium">{m.label}</p>
              <p className="text-xs text-muted-foreground">{m.desc}</p>
            </div>
          </label>
        ))}
      </div>

      <label className="mt-3 flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
        <input
          type="checkbox"
          checked={localUploadEnabled}
          onChange={(e) => setLocalUploadEnabled(e.target.checked)}
          className="accent-primary"
        />
        <div>
          <p className="text-sm font-medium">로컬 회의 서버로 전송</p>
          <p className="text-xs text-muted-foreground">
            온디바이스로 만든 회의의 기록과 오디오를 서버로 올려 공유·검색·요약을 활성화합니다.
          </p>
        </div>
      </label>
    </div>
  )
}
