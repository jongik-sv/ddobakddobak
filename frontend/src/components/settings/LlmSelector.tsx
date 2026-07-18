import { CLI_PRESETS } from './llmServicePresets'
import type { LlmProfile } from '../../api/llmProfiles'

export type LlmSelectorValue =
  | { type: 'special'; id: string }
  | { type: 'cli'; presetId: string; model: string }
  | { type: 'profile'; profileId: number }

export interface LlmSelectorProps {
  title: string
  idPrefix: string
  specialOptions: readonly { id: string; label: string; description: string }[]
  profiles: readonly LlmProfile[]
  cliAllowed: boolean
  value: LlmSelectorValue
  onChange: (v: LlmSelectorValue) => void
  onManageProfiles: () => void
  onCreateProfile: () => void
}

const optCls = (active: boolean) =>
  `rounded-lg border p-3 text-left transition-all ${active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-border hover:border-blue-300 hover:bg-accent'}`

export function LlmSelector({ title, idPrefix, specialOptions, profiles, cliAllowed, value, onChange, onManageProfiles, onCreateProfile }: LlmSelectorProps) {
  const selectValue =
    value.type === 'profile' ? `profile:${value.profileId}` :
    value.type === 'cli' ? `cli:${value.presetId}` : ''
  const cliPreset = value.type === 'cli' ? CLI_PRESETS.find((p) => p.id === value.presetId) : undefined

  const handleSelect = (raw: string) => {
    if (raw === '__new__') { onCreateProfile(); return }
    if (raw.startsWith('profile:')) { onChange({ type: 'profile', profileId: Number(raw.slice(8)) }); return }
    if (raw.startsWith('cli:')) {
      const presetId = raw.slice(4)
      const preset = CLI_PRESETS.find((p) => p.id === presetId)
      onChange({ type: 'cli', presetId, model: preset?.suggestedModels[0] ?? '' })
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4" data-testid={`${idPrefix}-selector`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button type="button" onClick={onManageProfiles}
          className="text-xs font-semibold text-blue-600 border rounded-md px-3 py-1 hover:bg-blue-50">프로필 관리</button>
      </div>
      <div className="flex gap-2 flex-wrap mb-3">
        {specialOptions.map((opt) => {
          const active = value.type === 'special' && value.id === opt.id
          return (
            <button key={opt.id || '__none__'} type="button" aria-pressed={active} onClick={() => onChange({ type: 'special', id: opt.id })} className={optCls(active)}>
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{opt.description}</p>
            </button>
          )
        })}
        <button type="button" aria-pressed={value.type !== 'special'}
          onClick={() => { if (value.type === 'special') handleSelect(profiles[0] ? `profile:${profiles[0].id}` : (cliAllowed && CLI_PRESETS[0] ? `cli:${CLI_PRESETS[0].id}` : '__new__')) }}
          className={optCls(value.type !== 'special')}>
          <p className="text-sm font-medium">직접 선택</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">CLI·내 프로필에서 선택</p>
        </button>
      </div>
      {/* 드롭다운은 special 상태에서도 항상 노출한다(직접 선택 버튼 없이도 프로필/CLI로 바로 전환 가능해야 함) */}
      <label htmlFor={`${idPrefix}-profile-select`} className="block text-xs font-semibold text-muted-foreground mb-1">프로필</label>
      <select id={`${idPrefix}-profile-select`} aria-label={`${title} 프로필`} value={selectValue} onChange={(e) => handleSelect(e.target.value)}
        className="w-full rounded-md border px-3 py-2 text-sm bg-card min-h-[44px]">
        {selectValue === '' && <option value="">선택하세요</option>}
        {cliAllowed && (
          <optgroup label="시스템 CLI">
            {CLI_PRESETS.map((p) => <option key={p.id} value={`cli:${p.id}`}>{p.name}</option>)}
          </optgroup>
        )}
        <optgroup label="내 프로필">
          {profiles.map((p) => <option key={p.id} value={`profile:${p.id}`}>{p.name}{p.model ? ` — ${p.model}` : ''}</option>)}
        </optgroup>
        <option value="__new__">＋ 새 프로필 만들기…</option>
      </select>
      {value.type === 'cli' && cliPreset && (
        <div className="mt-3">
          <label htmlFor={`${idPrefix}-cli-model`} className="block text-sm font-medium mb-1">CLI 모델</label>
          <select id={`${idPrefix}-cli-model`} aria-label={`${title} CLI 모델`} value={value.model}
            onChange={(e) => onChange({ type: 'cli', presetId: value.presetId, model: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm bg-card font-mono min-h-[44px]">
            {(value.model && !cliPreset.suggestedModels.includes(value.model)
              ? [ ...cliPreset.suggestedModels, value.model ] : cliPreset.suggestedModels).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <p className="text-xs text-muted-foreground mt-1">CLI는 키·URL이 필요 없어 프로필 없이 바로 사용합니다.</p>
        </div>
      )}
    </div>
  )
}
