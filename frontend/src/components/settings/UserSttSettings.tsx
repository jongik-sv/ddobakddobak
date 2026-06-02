import { IS_MOBILE, IS_TAURI } from '../../config'
import { useAppSettingsStore } from '../../stores/appSettingsStore'
import ModelManager from '../stt/ModelManager'

/**
 * 온디바이스(로컬) STT 모드 토글 — 클라이언트-디바이스 로컬 설정(서버 무전송).
 * Android(Tauri 모바일)에서만 의미가 있으므로 그 외 플랫폼에선 숨긴다.
 *
 * per-device localStorage(appSettingsStore.sttMode)로 영속하며 서버에 전송하지 않는다.
 * 모델 다운로드·관리(ModelManager)도 이 패널 안에 포함된다.
 */
export default function UserSttSettings() {
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
    <div className="rounded-lg border bg-card p-6">
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
