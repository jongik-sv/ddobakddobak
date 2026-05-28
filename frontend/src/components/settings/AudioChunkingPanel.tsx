import { useAppSettingsStore, AUDIO_DEFAULTS } from '../../stores/appSettingsStore'
import { AUDIO } from '../../config'
import { SettingSlider } from './SettingSlider'

/** 음성 청킹(VAD/청크 분할) 설정 카드. 값은 appSettingsStore 오버라이드, 미설정 시 config.yaml 기본값. */
export function AudioChunkingPanel() {
  const audioOverrides = useAppSettingsStore((s) => s.audioOverrides)
  const setAudioOverride = useAppSettingsStore((s) => s.setAudioOverride)
  const resetAudioOverrides = useAppSettingsStore((s) => s.resetAudioOverrides)

  const av = (key: keyof typeof AUDIO) => (audioOverrides as Record<string, number>)[key] ?? AUDIO[key]
  const hasAudioOverrides = Object.keys(audioOverrides).length > 0

  return (
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
        <SettingSlider
          label="파일 STT 청크 분할"
          description="파일 업로드 및 STT 재생성 시 오디오를 이 길이로 분할하여 처리합니다. 0이면 분할하지 않습니다. 다국어 회의는 10~15초로 짧게 설정하면 언어 감지가 정확해집니다."
          value={av('file_chunk_sec')}
          defaultValue={AUDIO_DEFAULTS.file_chunk_sec}
          min={0} max={60} step={5}
          unit="초"
          onChange={(v) => setAudioOverride('file_chunk_sec', v)}
        />
      </div>
    </div>
  )
}
