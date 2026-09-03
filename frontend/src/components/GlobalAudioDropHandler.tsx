import { useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { MeetingFileDropOverlay } from './meeting/MeetingFileDropOverlay'
import { UploadAudioModal, isAcceptedAudioFile } from './meeting/UploadAudioModal'
import { LocalToast } from './ui/LocalToast'
import { useLocalToast } from '../hooks/useLocalToast'
import type { Meeting } from '../api/meetings'
import { usePromptTemplateStore } from '../stores/promptTemplateStore'
import { useProjectStore } from '../stores/projectStore'
import { useToastStore } from '../stores/toastStore'

/**
 * GatedApp 전역 오디오 드래그앤드롭 핸들러.
 *
 * 회의 목록(/meetings)과 회의 상세 이하 전체(/meetings/:id, /meetings/:id/live,
 * /meetings/:id/viewer 등)는 각자 자체 드롭 처리를 갖고 있다(MeetingsPage는 자체 오버레이로
 * 업로드 모달을 열고, MeetingPage는 첨부 triage로 처리) — 이 라우트들에서는 전역 오버레이를
 * 비활성화해 이중 처리를 막는다. `/meetings/:id/*` 와일드카드로 회의 상세 하위 라우트 전체를
 * 한 번에 배제한다(요구사항 3).
 *
 * 프로젝트가 선택되지 않은 상태(로그인 직후 랜딩 등)에서는 업로드할 프로젝트 루트가 없으므로
 * 비활성화한다. 업로드 모달이 열려 있는 동안도 비활성화 — 모달 내부 드롭존이 이어서 처리한다.
 */
export function GlobalAudioDropHandler() {
  const navigate = useNavigate()
  const isMeetingList = useMatch('/meetings')
  const isMeetingDetailOrSub = useMatch('/meetings/:id/*')
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const meetingTypeList = usePromptTemplateStore((s) => s.meetingTypeList)
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null)
  const { message: toastMessage, show: showToast } = useLocalToast()

  const disabled =
    Boolean(isMeetingList) || Boolean(isMeetingDetailOrSub) || currentProjectId == null || pendingFiles !== null

  const handleFilesDropped = (files: File[]) => {
    const audioFiles = files.filter(isAcceptedAudioFile)
    if (audioFiles.length === 0) {
      const notice = '오디오 파일만 업로드할 수 있습니다.'
      // useToastStore(전역 상태)는 기존 관례상 함께 기록하되, 실제로 눈에 보이는 안내는
      // 아래 LocalToast가 담당한다 — toastStore.message는 MeetingLivePage에서만 렌더되어
      // 이 핸들러가 활성인 라우트(챗·설정·프로젝트 목록 등)에서는 화면에 표시되지 않는다.
      useToastStore.getState().showStatus(notice)
      showToast(notice)
      return
    }
    setPendingFiles(audioFiles)
  }

  return (
    <>
      <MeetingFileDropOverlay disabled={disabled} onFilesDropped={handleFilesDropped} />
      {pendingFiles && (
        <UploadAudioModal
          folderId={null}
          meetingTypeList={meetingTypeList}
          initialFiles={pendingFiles}
          onClose={() => setPendingFiles(null)}
          onCreated={(meeting: Meeting) => {
            setPendingFiles(null)
            navigate(`/meetings/${meeting.id}`)
          }}
        />
      )}
      <LocalToast message={toastMessage} />
    </>
  )
}
