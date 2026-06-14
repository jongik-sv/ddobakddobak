import { useAppSettingsStore, DIARIZATION_DEFAULTS } from '../../stores/appSettingsStore'
import { SettingSlider } from './SettingSlider'

/** 화자 분리 on/off 설정 카드. 값은 appSettingsStore 오버라이드, 미설정 시 config.yaml 기본값. */
export function DiarizationPanel() {
  const diarizationEnabled = useAppSettingsStore((s) => s.diarizationEnabled)
  const setDiarizationEnabled = useAppSettingsStore((s) => s.setDiarizationEnabled)
  const diarizationOverrides = useAppSettingsStore((s) => s.diarizationOverrides)
  const setDiarizationOverride = useAppSettingsStore((s) => s.setDiarizationOverride)

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold">화자 분리 설정</h2>
      </div>

      <div className="flex items-center justify-between rounded-md border p-3 mb-5">
        <div>
          <p className="text-sm font-medium">화자 분리 사용</p>
          <p className="text-xs text-muted-foreground">파일 업로드·STT 재생성 시 화자를 구분해 라벨을 붙입니다.</p>
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

      <div className={!diarizationEnabled ? 'opacity-50 pointer-events-none' : ''}>
        <div className="mb-5">
          <SettingSlider
            label="화자 구분 민감도"
            description="낮을수록 화자를 더 많이 나눕니다. 여러 명이 한 화자로 뭉치면 값을 낮추세요. 파일 업로드·STT 재생성·'화자분리만 재실행' 시 적용됩니다."
            value={(diarizationOverrides as Record<string, number>)['ahc_threshold'] ?? DIARIZATION_DEFAULTS.ahc_threshold}
            defaultValue={DIARIZATION_DEFAULTS.ahc_threshold}
            min={0.2}
            max={0.8}
            step={0.1}
            onChange={(v) => setDiarizationOverride('ahc_threshold', v)}
          />
        </div>
        <div className="rounded-md border border-blue-100 bg-blue-50/50 p-3">
          <p className="text-xs text-blue-700">
            <span className="font-semibold">배치 분석</span> — 파일 업로드와 STT 재생성 시 전체 오디오를 한 번에 분석해 화자를 구분합니다.
            실시간 전사 중에는 화자 라벨이 붙지 않으며, 녹음한 회의는 종료 후 STT 재생성으로 화자 분리를 적용할 수 있습니다.
            회의 정보의 '참여 인원'을 입력하면 그 인원수 ±2명 범위로 화자를 맞춥니다.
          </p>
        </div>
      </div>
    </div>
  )
}
