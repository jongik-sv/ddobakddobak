interface ProviderRadioOption {
  readonly id: string
  readonly name: string
  readonly description: string
}

/** Provider 선택 라디오 그리드 (내 LLM 설정) */
export function ProviderRadioGroup({
  options,
  selected,
  onSelect,
}: {
  options: readonly ProviderRadioOption[]
  selected: string
  onSelect: (id: string) => void
}) {
  return (
    <fieldset>
      <legend className="block text-sm font-medium mb-2">Provider 선택</legend>
      <div className="grid grid-cols-2 gap-2" role="radiogroup">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected === opt.id}
            onClick={() => onSelect(opt.id)}
            className={`
              rounded-lg border p-3 text-left transition-all
              ${selected === opt.id
                ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
              }
            `}
          >
            <p className="text-sm font-medium">{opt.name}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{opt.description}</p>
          </button>
        ))}
      </div>
    </fieldset>
  )
}
