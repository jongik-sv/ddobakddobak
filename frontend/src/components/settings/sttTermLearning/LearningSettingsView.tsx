import { useEffect, useState } from 'react'
import { getSettings, updateSettings, type SttLearningSettings } from '../../../api/sttTermLearning'
import { apiErrorMessage } from './apiError'

export default function LearningSettingsView() {
  const [form, setForm] = useState<SttLearningSettings | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSettings().then(setForm).catch(() => setLoadError(true))
  }, [])

  if (loadError) return <p className="text-sm text-red-600">설정을 불러오지 못했습니다.</p>
  if (!form) return <p className="text-sm text-muted-foreground">불러오는 중…</p>

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const saved = await updateSettings(form)
      setForm(saved)
      setMsg({ ok: true, text: '저장했습니다.' })
    } catch (err) {
      setMsg({ ok: false, text: await apiErrorMessage(err, '저장하지 못했습니다.') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          aria-label="자동 추출·등록 사용"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="mt-1"
        />
        <span>
          <span className="block text-sm font-medium">자동 추출·등록 사용</span>
          <span className="block text-xs text-muted-foreground">끄면 AI 원본 보관만 하고 추출하지 않습니다.</span>
        </span>
      </label>

      <label className="block">
        <span className="block text-sm font-medium">실행 시점 (마지막 사람 수정 후 대기 분)</span>
        <input
          type="number"
          aria-label="대기 분"
          min={5}
          max={1440}
          value={form.idle_minutes}
          onChange={(e) => setForm({ ...form, idle_minutes: Number(e.target.value) })}
          className="mt-1 w-28 rounded border px-2 py-1 text-sm"
        />
        <span className="ml-2 text-xs text-muted-foreground">5~1440분. 그 사이 다시 고치면 타이머가 재시작됩니다.</span>
      </label>

      <label className="block">
        <span className="block text-sm font-medium">최소 confidence</span>
        <input
          type="number"
          aria-label="최소 confidence"
          min={0}
          max={1}
          step={0.05}
          value={form.min_confidence}
          onChange={(e) => setForm({ ...form, min_confidence: Number(e.target.value) })}
          className="mt-1 w-28 rounded border px-2 py-1 text-sm"
        />
        <span className="ml-2 text-xs text-muted-foreground">0.0~1.0. 이보다 낮은 후보는 등록하지 않습니다.</span>
      </label>

      <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
        <div><span className="font-medium text-foreground">등록 기본 위치</span> 회의의 가장 가까운 폴더 (폴더가 없으면 프로젝트)</div>
        <div><span className="font-medium text-foreground">등록 조건</span> 오인식 표기가 전사에 있음. 표현 다듬기·내용 보충은 제외</div>
        <div><span className="font-medium text-foreground">추출 LLM</span> 회의 생성자의 요약 LLM 설정을 따릅니다. 회의 1건당 1회 호출</div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          저장
        </button>
        {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}
