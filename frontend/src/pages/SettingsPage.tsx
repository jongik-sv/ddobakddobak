import { useState, useEffect } from 'react'
import { HTTPError } from 'ky'
import { getSttSettings, updateSttEngine, getLlmSettings, updateLlmSettings, getHfSettings, updateHfToken } from '../api/settings'
import type { SttSettings, LlmSettings, HfSettings } from '../api/settings'
import { useAppSettingsStore, AUDIO_DEFAULTS, DIARIZATION_DEFAULTS } from '../stores/appSettingsStore'
import { ENGINE_LABELS, SUMMARY_INTERVAL_OPTIONS, AUDIO, DIARIZATION, LANGUAGES } from '../config'

function SettingSlider({
  label,
  description,
  value,
  defaultValue,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  description: string
  value: number
  defaultValue: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  const isModified = value !== defaultValue
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-800">{label}</label>
        <span className={`text-sm tabular-nums font-mono ${isModified ? 'text-blue-600 font-semibold' : 'text-gray-500'}`}>
          {value}{unit ?? ''}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-600 h-2"
      />
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{min}{unit ?? ''}</span>
        <span>{max}{unit ?? ''}</span>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SttSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      getSttSettings().catch(() => null),
      getLlmSettings().catch(() => null),
      getHfSettings().catch(() => null),
    ]).then(([stt, llm, hf]) => {
      if (stt) setSettings(stt)
      else setError('설정을 불러오지 못했습니다.')
      if (llm) {
        setLlmSettings(llm)
        setLlmForm({ provider: llm.provider || 'anthropic', auth_token: '', base_url: llm.base_url, model: llm.model })
      }
      if (hf) setHfSettings(hf)
    }).finally(() => setLoading(false))
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

  // LLM 설정
  const [llmSettings, setLlmSettings] = useState<LlmSettings | null>(null)
  const [llmForm, setLlmForm] = useState({ provider: 'anthropic', auth_token: '', base_url: '', model: '' })
  const [llmSaving, setLlmSaving] = useState(false)
  const [llmSuccess, setLlmSuccess] = useState<string | null>(null)
  const [llmError, setLlmError] = useState<string | null>(null)

  const handleLlmSave = async () => {
    setLlmSaving(true)
    setLlmError(null)
    setLlmSuccess(null)
    try {
      const params: Record<string, string> = {}
      if (llmForm.provider !== llmSettings?.provider) params.provider = llmForm.provider
      if (llmForm.auth_token) params.auth_token = llmForm.auth_token
      if (llmForm.base_url !== llmSettings?.base_url) params.base_url = llmForm.base_url
      if (llmForm.model !== llmSettings?.model) params.model = llmForm.model
      if (Object.keys(params).length === 0) {
        setLlmSaving(false)
        return
      }
      const result = await updateLlmSettings(params)
      setLlmSettings(result)
      setLlmForm((f) => ({ ...f, auth_token: '' }))
      setLlmSuccess('AI 설정이 저장되었습니다.')
    } catch {
      setLlmError('AI 설정 저장에 실패했습니다.')
    } finally {
      setLlmSaving(false)
    }
  }

  // HuggingFace 설정
  const [hfSettings, setHfSettings] = useState<HfSettings | null>(null)
  const [hfToken, setHfToken] = useState('')
  const [hfSaving, setHfSaving] = useState(false)
  const [hfSuccess, setHfSuccess] = useState<string | null>(null)
  const [hfError, setHfError] = useState<string | null>(null)

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

  const summaryIntervalSec = useAppSettingsStore((s) => s.summaryIntervalSec)
  const setSummaryIntervalSec = useAppSettingsStore((s) => s.setSummaryIntervalSec)

  const selectedLanguages = useAppSettingsStore((s) => s.selectedLanguages)
  const toggleLanguage = useAppSettingsStore((s) => s.toggleLanguage)

  const audioOverrides = useAppSettingsStore((s) => s.audioOverrides)
  const setAudioOverride = useAppSettingsStore((s) => s.setAudioOverride)
  const resetAudioOverrides = useAppSettingsStore((s) => s.resetAudioOverrides)

  const diarizationEnabled = useAppSettingsStore((s) => s.diarizationEnabled)
  const setDiarizationEnabled = useAppSettingsStore((s) => s.setDiarizationEnabled)

  const diarizationOverrides = useAppSettingsStore((s) => s.diarizationOverrides)
  const setDiarizationOverride = useAppSettingsStore((s) => s.setDiarizationOverride)
  const resetDiarizationOverrides = useAppSettingsStore((s) => s.resetDiarizationOverrides)

  // 현재 유효값: 오버라이드가 있으면 오버라이드, 없으면 config.yaml 기본값
  const av = (key: keyof typeof AUDIO) => (audioOverrides as Record<string, number>)[key] ?? AUDIO[key]
  const dv = (key: keyof typeof DIARIZATION) => (diarizationOverrides as Record<string, number>)[key] ?? DIARIZATION[key]

  const hasAudioOverrides = Object.keys(audioOverrides).length > 0
  const hasDiarizationOverrides = Object.keys(diarizationOverrides).length > 0

  return (
    <div className="min-h-screen bg-background p-8">
      <h1 className="text-2xl font-bold mb-6">설정</h1>

      <div className="max-w-lg space-y-6">
        {/* STT 모델 설정 */}
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

        {/* 회의 언어 설정 */}
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-1">회의 언어</h2>
          <p className="text-sm text-muted-foreground mb-4">
            회의에서 사용되는 언어를 선택합니다. 여러 언어를 동시에 선택할 수 있습니다.
          </p>

          <div className="space-y-2">
            {LANGUAGES.map((lang) => {
              const checked = selectedLanguages.includes(lang.code)
              const isOnly = checked && selectedLanguages.length === 1
              return (
                <label
                  key={lang.code}
                  className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isOnly}
                    onChange={() => toggleLanguage(lang.code)}
                    className="accent-blue-600 w-4 h-4"
                  />
                  <span className="text-sm font-medium">{lang.label}</span>
                  <span className="text-xs text-muted-foreground">({lang.code})</span>
                </label>
              )
            })}
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            선택한 언어의 음성만 인식됩니다. 최소 1개 이상 선택해야 합니다.
          </p>
        </div>

        {/* AI (LLM) 설정 */}
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-1">AI 요약 모델</h2>
          <p className="text-sm text-muted-foreground mb-4">
            회의록 요약에 사용할 AI API 설정입니다.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">API 유형</label>
              <div className="flex gap-3">
                {([['anthropic', 'Anthropic 호환'], ['openai', 'OpenAI 호환']] as const).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="llm_provider"
                      value={value}
                      checked={llmForm.provider === value}
                      onChange={() => setLlmForm((f) => ({ ...f, provider: value }))}
                      className="accent-primary"
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {llmForm.provider === 'anthropic'
                  ? 'Anthropic, ZAI(智谱), Amazon Bedrock 등 Anthropic API 호환 서비스'
                  : 'OpenAI, Ollama, vLLM, LiteLLM 등 OpenAI API 호환 서비스'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">API Base URL</label>
              <input
                type="text"
                value={llmForm.base_url}
                onChange={(e) => setLlmForm((f) => ({ ...f, base_url: e.target.value }))}
                placeholder="https://api.anthropic.com"
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">API Key</label>
              <input
                type="password"
                value={llmForm.auth_token}
                onChange={(e) => setLlmForm((f) => ({ ...f, auth_token: e.target.value }))}
                placeholder={llmSettings?.auth_token_masked || '토큰을 입력하세요'}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
              />
              {llmSettings?.auth_token_masked && !llmForm.auth_token && (
                <p className="text-xs text-muted-foreground mt-1">현재: {llmSettings.auth_token_masked}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">모델명</label>
              <input
                type="text"
                value={llmForm.model}
                onChange={(e) => setLlmForm((f) => ({ ...f, model: e.target.value }))}
                placeholder="claude-sonnet-4-6"
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
              />
            </div>
            <button
              onClick={handleLlmSave}
              disabled={llmSaving}
              className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {llmSaving ? '저장 중...' : '저장'}
            </button>
            {llmError && <p className="text-sm text-red-600">{llmError}</p>}
            {llmSuccess && <p className="text-sm text-green-600">{llmSuccess}</p>}
            {llmSettings?.offline && (
              <p className="text-sm text-yellow-600">Sidecar 연결 불가 — 오프라인 상태</p>
            )}
          </div>
        </div>

        {/* HuggingFace 설정 */}
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-1">HuggingFace</h2>
          <p className="text-sm text-muted-foreground mb-4">
            화자 분리(pyannote) 모델 다운로드에 필요한 토큰입니다.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">HF Token</label>
              <input
                type="password"
                value={hfToken}
                onChange={(e) => setHfToken(e.target.value)}
                placeholder={hfSettings?.hf_token_masked || 'hf_...'}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
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
              className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
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

        {/* AI 회의록 적용 주기 설정 */}
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-1">AI 회의록 적용 주기</h2>
          <p className="text-sm text-muted-foreground mb-4">
            라이브 기록을 AI 회의록에 반영하는 간격을 설정합니다.
          </p>

          <div className="flex flex-wrap gap-2">
            {SUMMARY_INTERVAL_OPTIONS.map((opt) => {
              const selected = summaryIntervalSec === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => setSummaryIntervalSec(opt.value)}
                  className={`
                    px-4 py-2 rounded-full text-sm font-medium border transition-all
                    ${selected
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600'
                    }
                  `}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            주기가 짧을수록 회의록이 자주 갱신되지만, AI 처리 부하가 높아질 수 있습니다.
          </p>
        </div>

        {/* 음성 청킹 설정 */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold">음성 청킹 설정</h2>
            {hasAudioOverrides && (
              <button
                onClick={resetAudioOverrides}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                기본값으로 초기화
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            음성 감지 및 청크 분할을 세밀하게 조정합니다. 변경사항은 다음 녹음부터 적용됩니다.
          </p>

          <div className="space-y-5">
            <SettingSlider
              label="음성 감지 민감도"
              description="RMS 에너지 기준값. 낮을수록 작은 소리도 음성으로 인식합니다. 주변 소음이 많으면 높이세요."
              value={av('silence_threshold')}
              defaultValue={AUDIO_DEFAULTS.silence_threshold}
              min={0.01} max={0.10} step={0.01}
              onChange={(v) => setAudioOverride('silence_threshold', v)}
            />
            <SettingSlider
              label="음성 복귀 기준"
              description="무음 판정 후 다시 음성으로 전환되는 기준값. 음성 감지 민감도보다 높아야 합니다."
              value={av('speech_threshold')}
              defaultValue={AUDIO_DEFAULTS.speech_threshold}
              min={0.02} max={0.20} step={0.01}
              onChange={(v) => setAudioOverride('speech_threshold', v)}
            />
            <SettingSlider
              label="무음 지속 시간"
              description="이 시간만큼 무음이 지속되면 하나의 청크로 전송합니다. 짧으면 빠른 응답, 길면 자연스러운 문장 단위."
              value={av('silence_duration_ms')}
              defaultValue={AUDIO_DEFAULTS.silence_duration_ms}
              min={300} max={2000} step={100}
              unit="ms"
              onChange={(v) => setAudioOverride('silence_duration_ms', v)}
            />
            <SettingSlider
              label="최대 청크 길이"
              description="연속 발화 시 강제로 분할하는 최대 시간. 너무 길면 STT 처리가 느려질 수 있습니다."
              value={av('max_chunk_sec')}
              defaultValue={AUDIO_DEFAULTS.max_chunk_sec}
              min={5} max={30} step={1}
              unit="초"
              onChange={(v) => setAudioOverride('max_chunk_sec', v)}
            />
            <SettingSlider
              label="최소 청크 길이"
              description="이보다 짧은 음성 구간은 무시됩니다. 짧은 소음이나 기침 등을 필터링합니다."
              value={av('min_chunk_sec')}
              defaultValue={AUDIO_DEFAULTS.min_chunk_sec}
              min={1} max={5} step={0.5}
              unit="초"
              onChange={(v) => setAudioOverride('min_chunk_sec', v)}
            />
            <SettingSlider
              label="프리롤"
              description="음성이 시작되기 전에 포함되는 여유 시간. 첫 음절이 잘리는 것을 방지합니다."
              value={av('preroll_ms')}
              defaultValue={AUDIO_DEFAULTS.preroll_ms}
              min={100} max={500} step={50}
              unit="ms"
              onChange={(v) => setAudioOverride('preroll_ms', v)}
            />
            <SettingSlider
              label="청크 간 겹침"
              description="이전 청크의 끝부분을 다음 청크에 포함시킵니다. 청크 경계에서 음절이 잘리는 것을 방지합니다."
              value={av('overlap_ms')}
              defaultValue={AUDIO_DEFAULTS.overlap_ms}
              min={0} max={500} step={50}
              unit="ms"
              onChange={(v) => setAudioOverride('overlap_ms', v)}
            />
          </div>
        </div>

        {/* 화자 분리 설정 */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold">화자 분리 설정</h2>
            <div className="flex items-center gap-3">
              {hasDiarizationOverrides && (
                <button
                  onClick={resetDiarizationOverrides}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  기본값으로 초기화
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3 mb-5">
            <div>
              <p className="text-sm font-medium">화자 분리 사용</p>
              <p className="text-xs text-muted-foreground">비활성화하면 화자 구분 없이 빠르게 녹음됩니다.</p>
            </div>
            <button
              onClick={() => setDiarizationEnabled(!diarizationEnabled)}
              className={`
                relative w-11 h-6 rounded-full transition-colors
                ${diarizationEnabled ? 'bg-blue-600' : 'bg-gray-300'}
              `}
            >
              <span
                className={`
                  absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform
                  ${diarizationEnabled ? 'translate-x-5' : 'translate-x-0'}
                `}
              />
            </button>
          </div>

          {!diarizationEnabled && (
            <p className="text-sm text-yellow-600 mb-4">
              화자 분리가 비활성화되어 있습니다. 모든 발화가 하나의 화자로 기록됩니다.
            </p>
          )}

          <div className={`space-y-5 ${!diarizationEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <SettingSlider
              label="화자 매칭 기준"
              description="임베딩 유사도가 이 값 이상이면 기존 화자로 인식합니다. 낮을수록 같은 화자로 쉽게 매칭되고, 높을수록 새 화자로 분리됩니다."
              value={dv('similarity_threshold')}
              defaultValue={DIARIZATION_DEFAULTS.similarity_threshold}
              min={0.05} max={0.50} step={0.05}
              onChange={(v) => setDiarizationOverride('similarity_threshold', v)}
            />
            <SettingSlider
              label="화자 병합 기준"
              description="처리 후 유사한 화자를 하나로 합치는 기준값. 높을수록 병합이 까다로워져 화자가 많아집니다."
              value={dv('merge_threshold')}
              defaultValue={DIARIZATION_DEFAULTS.merge_threshold}
              min={0.10} max={0.70} step={0.05}
              onChange={(v) => setDiarizationOverride('merge_threshold', v)}
            />
            <SettingSlider
              label="화자당 최대 임베딩 수"
              description="화자를 식별하기 위해 보관하는 음성 샘플 수. 많을수록 정확하지만 메모리를 더 사용합니다."
              value={dv('max_embeddings_per_speaker')}
              defaultValue={DIARIZATION_DEFAULTS.max_embeddings_per_speaker}
              min={3} max={20} step={1}
              unit="개"
              onChange={(v) => setDiarizationOverride('max_embeddings_per_speaker', v)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
