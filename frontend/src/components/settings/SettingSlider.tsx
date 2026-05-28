interface SettingSliderProps {
  label: string
  description: string
  value: number
  defaultValue: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}

/** 기본값 대비 변경 여부를 강조 표시하는 범위 슬라이더. 오디오/화자분리 설정에서 재사용. */
export function SettingSlider({
  label,
  description,
  value,
  defaultValue,
  min,
  max,
  step,
  unit,
  onChange,
}: SettingSliderProps) {
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
