import { type ScheduleFormState, todayLocal } from '../../lib/schedulePayload'

interface ScheduleFieldsProps {
  value: ScheduleFormState
  onChange: (next: ScheduleFormState) => void
}

/**
 * 예약 시작 입력(컨트롤드). CreateMeetingModal 의 인라인 마크업을 그대로 옮긴 것.
 * 동일 className/aria-label 을 유지해 기존 테스트 셀렉터를 보존한다.
 * - ⏰ 예약 시작 토글 → 켜면 날짜(비면 todayLocal 로 채움)/24h 시·분/시작방식/반복 노출
 * - 토글 OFF면 어떤 예약 컨트롤도 렌더링되지 않는다(상위에서 키 미전송).
 */
export function ScheduleFields({ value, onChange }: ScheduleFieldsProps) {
  // 예약 토글: 켤 때 날짜가 비어 있으면 오늘로 채워 예약 시각이 항상 명확하게 한다.
  const toggleSchedule = (enabled: boolean) => {
    onChange({ ...value, enabled, date: enabled && !value.date ? todayLocal() : value.date })
  }

  return (
    <div>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => toggleSchedule(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 accent-blue-600"
          aria-label="예약 시작"
        />
        <span className="text-sm font-medium">⏰ 예약 시작 (지정한 시각에 자동/수동으로 시작)</span>
      </label>

      {value.enabled && (
        <div className="mt-3">
          <label className="block text-sm font-medium mb-1" htmlFor="scheduled-date">
            예약 시각 (24시간)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="scheduled-date"
              type="date"
              value={value.date}
              onChange={(e) => onChange({ ...value, date: e.target.value })}
              aria-label="예약 날짜"
              className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              value={value.hour}
              onChange={(e) => onChange({ ...value, hour: e.target.value })}
              aria-label="시"
              className="rounded-md border px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring bg-white"
            >
              {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')).map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">:</span>
            <select
              value={value.minute}
              onChange={(e) => onChange({ ...value, minute: e.target.value })}
              aria-label="분"
              className="rounded-md border px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring bg-white"
            >
              {Array.from({ length: 60 }, (_, m) => String(m).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* 시작 방식: 예약을 켜는 동안 항상 노출. 기본 수동(안전). */}
          <div className="mt-2">
            <span className="block text-sm font-medium mb-1">시작 방식</span>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="auto-start-mode"
                  value="manual"
                  checked={value.mode === 'manual'}
                  onChange={() => onChange({ ...value, mode: 'manual' })}
                  className="h-4 w-4 accent-blue-600"
                  aria-label="수동"
                />
                <span className="text-sm">수동</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="auto-start-mode"
                  value="auto"
                  checked={value.mode === 'auto'}
                  onChange={() => onChange({ ...value, mode: 'auto' })}
                  className="h-4 w-4 accent-blue-600"
                  aria-label="자동"
                />
                <span className="text-sm">자동</span>
              </label>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              자동: 예약 시각에 자동으로 시작합니다. 수동: 시작 1분 전에 시작할지 물어봅니다.
            </p>
          </div>

          {/* 반복: 체크하면 요일을 골라 매주 같은 시각에 반복 예약한다. 비우면 1회성. */}
          <div className="mt-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={value.recurring}
                onChange={(e) => onChange({ ...value, recurring: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 accent-blue-600"
                aria-label="반복"
              />
              <span className="text-sm font-medium">반복</span>
            </label>
            {value.recurring && (
              <div className="mt-2">
                <span className="block text-sm font-medium mb-1">반복 요일</span>
                <div className="flex gap-1">
                  {['일', '월', '화', '수', '목', '금', '토'].map((label, day) => {
                    const checked = value.days.includes(day)
                    return (
                      <label
                        key={day}
                        className={`flex h-8 w-8 items-center justify-center rounded-md border text-sm cursor-pointer select-none transition-colors ${
                          checked ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            onChange({
                              ...value,
                              days: e.target.checked
                                ? [...value.days, day]
                                : value.days.filter((d) => d !== day),
                            })
                          }
                          className="sr-only"
                          aria-label={label}
                        />
                        {label}
                      </label>
                    )
                  })}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  선택한 요일마다 예약 시각의 시·분에 반복됩니다.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
