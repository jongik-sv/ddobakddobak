import { useAppSettingsStore, DIARIZATION_DEFAULTS } from '../../stores/appSettingsStore'
import { DIARIZATION } from '../../config'
import { SettingSlider } from './SettingSlider'

/** 화자 분리 on/off + 임계값 설정 카드. 값은 appSettingsStore 오버라이드, 미설정 시 config.yaml 기본값. */
export function DiarizationPanel() {
  const diarizationEnabled = useAppSettingsStore((s) => s.diarizationEnabled)
  const setDiarizationEnabled = useAppSettingsStore((s) => s.setDiarizationEnabled)
  const diarizationOverrides = useAppSettingsStore((s) => s.diarizationOverrides)
  const setDiarizationOverride = useAppSettingsStore((s) => s.setDiarizationOverride)
  const resetDiarizationOverrides = useAppSettingsStore((s) => s.resetDiarizationOverrides)

  const dv = (key: keyof typeof DIARIZATION) => (diarizationOverrides as Record<string, number>)[key] ?? DIARIZATION[key]
  const hasDiarizationOverrides = Object.keys(diarizationOverrides).length > 0

  return (
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
        <div className="rounded-md border border-blue-100 bg-blue-50/50 p-3 mb-2">
          <p className="text-xs text-blue-700">
            <span className="font-semibold">스트리밍 엔진</span> — 롤링 버퍼 방식으로 긴 컨텍스트에서 화자를 분리합니다.
            파일 업로드 시에는 WhisperX 배치 처리로 최고 정확도를 제공합니다.
          </p>
        </div>
        <SettingSlider
          label="화자 매칭 기준"
          description="임베딩 유사도가 이 값 이상이면 기존 화자로 인식합니다. 낮을수록 같은 화자로 쉽게 매칭되고, 높을수록 새 화자로 분리됩니다."
          value={dv('similarity_threshold')}
          defaultValue={DIARIZATION_DEFAULTS.similarity_threshold}
          min={0.10} max={0.60} step={0.05}
          onChange={(v) => setDiarizationOverride('similarity_threshold', v)}
        />
        <SettingSlider
          label="화자 병합 기준"
          description="처리 후 유사한 화자를 하나로 합치는 기준값. 높을수록 병합이 까다로워져 화자가 많아집니다."
          value={dv('merge_threshold')}
          defaultValue={DIARIZATION_DEFAULTS.merge_threshold}
          min={0.20} max={0.80} step={0.05}
          onChange={(v) => setDiarizationOverride('merge_threshold', v)}
        />
        <SettingSlider
          label="화자당 최대 임베딩 수"
          description="화자를 식별하기 위해 보관하는 음성 샘플 수. 많을수록 정확하지만 메모리를 더 사용합니다."
          value={dv('max_embeddings_per_speaker')}
          defaultValue={DIARIZATION_DEFAULTS.max_embeddings_per_speaker}
          min={3} max={25} step={1}
          unit="개"
          onChange={(v) => setDiarizationOverride('max_embeddings_per_speaker', v)}
        />
      </div>
    </div>
  )
}
