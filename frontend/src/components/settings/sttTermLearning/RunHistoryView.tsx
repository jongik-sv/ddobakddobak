import { useCallback, useEffect, useState } from 'react'
import {
  analyzeMeeting,
  getRun,
  getRuns,
  registerItem,
  rerunRun,
  revertRun,
  type PendingRun,
  type RunDetail,
  type RunSummary,
} from '../../../api/sttTermLearning'
import LineDiffView from '../../ui/LineDiffView'
import { confirmDialog } from '../../../lib/confirmDialog'
import { apiErrorMessage } from './apiError'

const VERDICT_LABEL: Record<string, string> = {
  registered: '새 줄 등록',
  merged_existing: '기존 줄에 병합',
  already_known: '이미 등록됨',
  skipped_excluded: '제외(사용자 제외)',
  skipped_invalid: '제외(형식 부적합)',
  skipped_not_in_transcript: '제외(전사에 없음)',
  skipped_conflict: '제외(충돌)',
  skipped_low_confidence: '제외(낮은 확신)',
  skipped_no_level: '제외(등록할 레벨 없음)',
}

const STATUS_LABEL: Record<string, string> = {
  queued: '대기 중',
  running: '진행 중',
  failed: '실패',
  reverted: '되돌림',
}

function runLabel(r: RunSummary): string {
  if (r.status === 'done') return r.no_change ? '변경 없음' : `등록 ${r.registered_count} · 제외 ${r.skipped_count}`
  if (r.status === 'reverted') return `되돌림 · 등록 ${r.registered_count} · 제외 ${r.skipped_count}`
  return STATUS_LABEL[r.status] ?? r.status
}

function minutesUntil(eta: string): number {
  return Math.max(1, Math.ceil((new Date(eta).getTime() - Date.now()) / 60000))
}

export default function RunHistoryView() {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [pending, setPending] = useState<PendingRun[]>([])
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [skippedIds, setSkippedIds] = useState<number[]>([])

  const load = useCallback(async () => {
    try {
      const res = await getRuns()
      setRuns(res.runs)
      setPending(res.pending)
    } catch {
      setError('처리 내역을 불러오지 못했습니다.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openRun = async (id: number) => {
    setError(null)
    setNotice(null)
    setSkippedIds([])
    try {
      setDetail(await getRun(id))
    } catch {
      setError('처리 내역 상세를 불러오지 못했습니다.')
    }
  }

  const act = async (fn: () => Promise<unknown>, fallback: string, after?: () => Promise<void>) => {
    setError(null)
    setNotice(null)
    try {
      await fn()
      await load()
      if (after) await after()
    } catch (err) {
      setError(await apiErrorMessage(err, fallback))
    }
  }

  const reanalyze = () => detail && act(() => analyzeMeeting(detail.meeting.id), '분석을 시작하지 못했습니다.')
  const rerun = (r: RunSummary) => act(() => rerunRun(r.id), '다시 실행하지 못했습니다.')

  const revert = async () => {
    if (!detail) return
    if (!(await confirmDialog('이 회의에서 등록된 항목을 모두 되돌릴까요?', { title: '되돌리기', kind: 'warning' }))) return
    setError(null)
    setNotice(null)
    try {
      const res = await revertRun(detail.id)
      setSkippedIds(res.skipped_item_ids)
      setNotice(`${res.reverted}건을 되돌렸습니다.`)
      await load()
      setDetail(await getRun(detail.id))
    } catch (err) {
      setError(await apiErrorMessage(err, '되돌리지 못했습니다.'))
    }
  }

  const register = (itemId: number) =>
    detail && act(() => registerItem(detail.id, itemId), '등록하지 못했습니다.', async () => setDetail(await getRun(detail.id)))

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}

      <ul className="divide-y rounded-md border">
        {pending.map((p) => (
          <li key={`p${p.meeting.id}`} className="flex items-center gap-3 p-2 text-sm">
            <span className="font-medium">#{p.meeting.id} {p.meeting.title}</span>
            <span className="text-xs text-muted-foreground">대기 · {minutesUntil(p.eta)}분 후</span>
          </li>
        ))}
        {runs.map((r) => (
          <li key={r.id} className="flex items-center gap-3 p-2 text-sm">
            <button type="button" onClick={() => openRun(r.id)} className="text-left font-medium hover:underline">
              #{r.meeting.id} {r.meeting.title}
            </button>
            <span className="text-xs text-muted-foreground">{runLabel(r)}</span>
            {r.status === 'failed' && (
              <>
                {r.error && <span className="text-xs text-red-600">{r.error}</span>}
                <button type="button" onClick={() => rerun(r)} className="rounded border px-2 py-0.5 text-xs hover:bg-muted">
                  다시 실행
                </button>
              </>
            )}
          </li>
        ))}
        {runs.length === 0 && pending.length === 0 && <li className="p-3 text-sm text-muted-foreground">처리 내역이 없습니다.</li>}
      </ul>

      {detail && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">#{detail.meeting.id} {detail.meeting.title}</h3>
            <span className="text-xs text-muted-foreground">{runLabel(detail)}</span>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={reanalyze} className="rounded border px-2 py-1 text-xs hover:bg-muted">
                지금 다시 분석
              </button>
              {detail.status === 'done' && !detail.no_change && (
                <button type="button" onClick={revert} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                  이 회의 등록 전부 되돌리기
                </button>
              )}
            </div>
          </div>
          {detail.llm_skipped_reason && <p className="text-xs text-muted-foreground">LLM 생략: {detail.llm_skipped_reason}</p>}
          {detail.diff.length > 0 && <LineDiffView ops={detail.diff} collapseEqual />}
          {detail.items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="p-2">쌍</th>
                  <th className="p-2">판정</th>
                  <th className="p-2">근거</th>
                  <th className="p-2">등록 위치</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {detail.items.map((it) => {
                  const skipped = it.verdict.startsWith('skipped_')
                  const revertSkipped = skippedIds.includes(it.id) || it.revert_result === 'skipped_changed'
                  return (
                    <tr key={it.id} className="border-b">
                      <td className="p-2"><span className="text-red-600">{it.wrong}</span> → <span className="text-green-700">{it.correct}</span></td>
                      <td className="p-2 text-xs">
                        {VERDICT_LABEL[it.verdict] ?? it.verdict}
                        {revertSkipped && <span className="ml-1 text-amber-700">사람이 수정해 건너뜀</span>}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">{it.reason ?? ''}</td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {it.domain_file ? `${it.level?.name ?? ''} · ${it.domain_file.name}` : '—'}
                      </td>
                      <td className="p-2">
                        {skipped && (
                          <button
                            type="button"
                            aria-label={`${it.wrong} 등록`}
                            onClick={() => register(it.id)}
                            className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
                          >
                            등록
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
