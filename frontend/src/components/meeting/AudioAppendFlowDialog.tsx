import { useEffect, useRef, useState } from 'react'
import { sortAudioFilesByName, mergeAudioFiles } from '../../lib/audioMerge'
import { promoteAudio, regenerateStt } from '../../api/meetings'
import { errorToMessage } from '../../lib/errors'
import { formatSize } from '../../lib/formatBytes'
import { Dialog } from '../ui/Dialog'
import { AudioFileOrderList } from './AudioFileOrderList'

interface AudioAppendFlowDialogProps {
  open: boolean
  meetingId: number
  files: File[]
  onClose: () => void
  /** 병합 시작 직후 호출 — MeetingPage가 첨부 분류 다이얼로그를 열 트리거로 사용한다. */
  onMergeStarted?: () => void
  /** 업로드(+재전사 트리거 여부 확정) 완료 시 호출. */
  onCompleted?: () => void
}

type Phase = 'select' | 'merging' | 'uploading' | 'ask-retranscribe' | 'retranscribing' | 'error'

/**
 * 오디오 파일들을 병합해 기존 회의 뒤에 이어붙이는 플로우.
 *
 * ① 순서 선택(파일 1개면 리스트 생략) → ② "병합 시작" 클릭 시 모달이 우하단 고정 배너로
 * 축소되며 mergeAudioFiles 실행 → ③ promoteAudio 업로드 → ④ 배너 내 재전사 확인 → 예/아니오.
 * 실패 시 배너에 에러 + 재시도 버튼을 보여준다.
 */
export function AudioAppendFlowDialog({
  open,
  meetingId,
  files,
  onClose,
  onMergeStarted,
  onCompleted,
}: AudioAppendFlowDialogProps) {
  const [orderedFiles, setOrderedFiles] = useState<File[]>(() => sortAudioFilesByName(files))
  const [phase, setPhase] = useState<Phase>('select')
  const [mergeProgress, setMergeProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [banner, setBanner] = useState(false)

  // open이 false→true로 전이될 때만 전체 상태를 리셋한다. files prop이 배너(진행중) 상태에서
  // 바뀌어도(예: 부모 리렌더) 진행 중인 병합/업로드 플로우를 초기화하지 않아야 한다 — 그래서
  // deps를 [open]이 아니라 [open, files]로 둬도 안전하도록 prevOpenRef로 전이 시점만 감지한다.
  const prevOpenRef = useRef(false)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setOrderedFiles(sortAudioFilesByName(files))
      setPhase('select')
      setBanner(false)
      setError('')
      setMergeProgress(null)
    }
    prevOpenRef.current = open
  }, [open, files])

  if (!open) return null

  const handleRemove = (index: number) => {
    setOrderedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const runMergeAndUpload = async () => {
    setError('')
    setBanner(true)
    setPhase('merging')
    onMergeStarted?.()
    try {
      const merged = await mergeAudioFiles(orderedFiles, {
        onProgress: (done, total) => setMergeProgress({ done, total }),
      })
      setPhase('uploading')
      await promoteAudio(meetingId, merged)
      setPhase('ask-retranscribe')
    } catch (err) {
      setError(await errorToMessage(err, '오디오 처리에 실패했습니다.'))
      setPhase('error')
    }
  }

  const finish = () => {
    onCompleted?.()
    onClose()
  }

  const handleRetranscribeChoice = async (yes: boolean) => {
    if (!yes) {
      finish()
      return
    }
    setPhase('retranscribing')
    try {
      await regenerateStt(meetingId)
      finish()
    } catch (err) {
      setError(await errorToMessage(err, '재전사 요청에 실패했습니다.'))
      setPhase('error')
    }
  }

  const handleCancel = () => {
    onClose()
  }

  if (banner) {
    return (
      <div
        role="status"
        data-testid="audio-append-banner"
        className="fixed bottom-4 right-4 z-[80] w-80 rounded-lg border border-border bg-card p-4 shadow-2xl"
      >
        <p className="mb-2 text-sm font-medium text-foreground">오디오 연결</p>

        {phase === 'merging' && (
          <p className="text-xs text-muted-foreground">
            병합 중{mergeProgress ? ` (${mergeProgress.done}/${mergeProgress.total})` : '...'}
          </p>
        )}

        {phase === 'uploading' && <p className="text-xs text-muted-foreground">업로드 중...</p>}

        {phase === 'ask-retranscribe' && (
          <div>
            <p className="mb-2 text-xs text-muted-foreground">업로드가 완료됐습니다. 재전사를 실행할까요?</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => handleRetranscribeChoice(false)}
                className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted"
              >
                아니오
              </button>
              <button
                type="button"
                onClick={() => handleRetranscribeChoice(true)}
                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                예, 재전사
              </button>
            </div>
          </div>
        )}

        {phase === 'retranscribing' && <p className="text-xs text-muted-foreground">재전사 요청 중...</p>}

        {phase === 'error' && (
          <div>
            <p className="mb-2 text-xs text-destructive">{error}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={runMergeAndUpload}
                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                재시도
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const totalSize = orderedFiles.reduce((sum, f) => sum + f.size, 0)

  return (
    <Dialog onClose={handleCancel} closeOnBackdrop={false} closeOnEsc={false}>
      <h2 className="mb-4 text-lg font-semibold">기존 녹음 뒤에 연결</h2>

      {orderedFiles.length > 1 ? (
        <div className="mb-4">
          <p className="mb-2 text-xs text-muted-foreground">
            위에서부터 순서대로 하나의 오디오로 병합됩니다 (파일 사이 3초 무음 삽입) · 총 {orderedFiles.length}개 ·{' '}
            {formatSize(totalSize)}
          </p>
          <AudioFileOrderList files={orderedFiles} onReorder={setOrderedFiles} onRemove={handleRemove} />
        </div>
      ) : orderedFiles.length === 1 ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {orderedFiles[0].name} ({formatSize(orderedFiles[0].size)})
        </p>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">추가할 오디오 파일이 없습니다.</p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          취소
        </button>
        <button
          type="button"
          disabled={orderedFiles.length === 0}
          onClick={runMergeAndUpload}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          병합 시작
        </button>
      </div>
    </Dialog>
  )
}
