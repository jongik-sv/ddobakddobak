import { useState } from 'react'
import { createMeetingGlossaryEntry } from '../../api/glossary'
import { errorToMessage } from '../../lib/errors'
import { Dialog } from '../ui/Dialog'

interface AddTypoCorrectionDialogProps {
  meetingId: number
  /** 올바른 용어 (오타사전 to_text로 등록됨) */
  term: string
  /** 이 용어에 등록된 오인식 변형 후보(도메인 파일의 "오인식:" 표기) — 있으면 첫 항목으로 프리필하고, 2개 이상이면 선택 칩을 보여준다 */
  mispronunciations?: string[]
  onClose: () => void
}

/**
 * 도메인 용어 → 오타사전 교정 등록 다리. 잘못 인식되는 표기(from) 입력 시 회의 레벨
 * 오타사전에 from=입력값, to=term으로 등록한다. 기존 glossary API를 그대로 재사용.
 * mispronunciations가 있으면 첫 변형으로 입력값을 프리필해 클릭 한 번으로 등록할 수 있게 한다.
 */
export default function AddTypoCorrectionDialog({ meetingId, term, mispronunciations = [], onClose }: AddTypoCorrectionDialogProps) {
  const [fromText, setFromText] = useState(mispronunciations[0] ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const submit = async () => {
    if (!fromText.trim()) return
    setSaving(true)
    setError('')
    try {
      await createMeetingGlossaryEntry(meetingId, { from_text: fromText.trim(), to_text: term })
      setDone(true)
    } catch (err) {
      setError(await errorToMessage(err, '등록 실패'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onClose={onClose}>
      <h2 className="text-lg font-semibold mb-2">오타 교정 추가</h2>
      <p className="text-xs text-muted-foreground mb-4">
        올바른 용어 <span className="font-semibold text-foreground">{term}</span>(으)로 자동 교정될 잘못된 표기를 등록합니다.
      </p>

      {done ? (
        <>
          <p className="text-sm text-blue-600 mb-4">등록되었습니다</p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
              닫기
            </button>
          </div>
        </>
      ) : (
        <>
          {mispronunciations.length > 1 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {mispronunciations.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFromText(m)}
                  className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    fromText === m
                      ? 'border-blue-500 text-blue-600'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            value={fromText}
            onChange={(e) => setFromText(e.target.value)}
            placeholder="잘못 인식되는 표기"
            className="w-full rounded-md border border-border px-3 py-2 text-sm mb-2"
          />
          {error && <div className="text-[11px] text-red-500 mb-2">{error}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
              취소
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || !fromText.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? '등록 중...' : '등록'}
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}
