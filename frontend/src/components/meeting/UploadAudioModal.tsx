import { useState } from 'react'
import { uploadAudioFile, updateMeeting } from '../../api/meetings'
import type { Meeting, SummaryVerbosity } from '../../api/meetings'
import { useProjectStore } from '../../stores/projectStore'
import { IS_TAURI, IS_MOBILE } from '../../config'
import { errorToMessage } from '../../lib/errors'
import { Dialog } from '../ui/Dialog'
import { MeetingTypeSelector } from './MeetingListUI'
import { VERBOSITY_OPTIONS } from './SummaryOptionsControl'

const ACCEPTED_AUDIO_TYPES = '.mp3,.wav,.m4a,.webm,.ogg,.flac,.aac,.mp4'

interface UploadAudioModalProps {
  folderId: number | null
  meetingTypeList: { value: string; label: string }[]
  onClose: () => void
  onCreated: (meeting: Meeting) => void
}

export function UploadAudioModal({ folderId, meetingTypeList, onClose, onCreated }: UploadAudioModalProps) {
  const [title, setTitle] = useState('')
  const [meetingType, setMeetingType] = useState('general')
  // '' = 직전 회의 설정 승계 (파라미터 미전송 → 서버가 결정)
  const [verbosity, setVerbosity] = useState<SummaryVerbosity | ''>('')
  const [restructure, setRestructure] = useState<'' | 'true' | 'false'>('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const handleFile = (f: File) => {
    setFile(f)
    if (!title.trim()) {
      const name = f.name.replace(/\.[^.]+$/, '')
      setTitle(name)
    }
  }

  const handleTauriFileSelect = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'webm', 'ogg', 'flac', 'aac', 'mp4'] }],
    })
    if (!selected || typeof selected !== 'string') return
    const filePath = selected
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(filePath)
    const name = filePath.split('/').pop() ?? 'audio'
    const ext = name.split('.').pop()?.toLowerCase() ?? 'webm'
    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
      webm: 'audio/webm', ogg: 'audio/ogg', flac: 'audio/flac',
      aac: 'audio/aac', mp4: 'audio/mp4',
    }
    const blob = new Blob([bytes], { type: mimeMap[ext] ?? 'audio/webm' })
    const nativeFile = new File([blob], name, { type: blob.type })
    handleFile(nativeFile)
  }

  const handleDropZoneClick = () => {
    // 데스크탑 Tauri만 네이티브 picker 사용. 모바일(Tauri 안드로이드 포함)은
    // 웹뷰 file input 사용 — content:// URI readFile 위험 회피, 시스템 선택기 신뢰.
    if (IS_TAURI && !IS_MOBILE) {
      handleTauriFileSelect()
    } else {
      document.getElementById('audio-file-input')?.click()
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !title.trim()) return
    setLoading(true)
    setError('')
    try {
      const meeting = await uploadAudioFile({
        title: title.trim(),
        meeting_type: meetingType,
        audio: file,
        project_id: useProjectStore.getState().currentProjectId,
        ...(verbosity ? { summary_verbosity: verbosity } : {}),
        ...(restructure ? { summary_restructure: restructure === 'true' } : {}),
      })
      // 폴더가 있으면 이동
      if (folderId) {
        await updateMeeting(meeting.id, { folder_id: folderId })
        meeting.folder_id = folderId
      }
      onCreated(meeting)
      onClose()
    } catch (err: unknown) {
      setError(await errorToMessage(err, '업로드에 실패했습니다.'))
    } finally {
      setLoading(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <Dialog onClose={onClose} backdropClassName="bg-black/10 backdrop-blur-sm" closeOnBackdrop={false} closeOnEsc={false}>
      <h2 className="text-lg font-semibold mb-4">오디오 파일로 회의록 작성</h2>

      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 파일 드롭존 */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          }`}
          onClick={handleDropZoneClick}
        >
          <input
            id="audio-file-input"
            type="file"
            accept={ACCEPTED_AUDIO_TYPES}
            onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
            className="hidden"
          />
          {file ? (
            <div className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              <div className="text-left">
                <p className="text-sm font-medium text-gray-900 truncate max-w-[250px]">{file.name}</p>
                <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFile(null) }}
                className="ml-2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <div>
              <svg className="w-8 h-8 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-gray-600">오디오 파일을 드래그하거나 클릭하여 선택</p>
              <p className="text-xs text-gray-400 mt-1">MP3, WAV, M4A, WebM, OGG, FLAC</p>
            </div>
          )}
        </div>

        {/* 제목 */}
        <div>
          <label className="block text-sm font-medium mb-1">회의 제목</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="회의 제목을 입력하세요"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* 회의 유형 */}
        <div>
          <label className="block text-sm font-medium mb-2">회의 유형</label>
          <MeetingTypeSelector
            meetingTypeList={meetingTypeList}
            selected={meetingType}
            onSelect={setMeetingType}
          />
        </div>

        {/* 회의록 압축율 */}
        <div>
          <label htmlFor="upload-verbosity" className="block text-sm font-medium mb-1">회의록 압축율</label>
          <select
            id="upload-verbosity"
            value={verbosity}
            onChange={(e) => setVerbosity(e.target.value as SummaryVerbosity | '')}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="">직전 회의 설정 따름 (기본)</option>
            {VERBOSITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>
            ))}
          </select>
        </div>

        {/* 재구조화 여부 */}
        <div>
          <label htmlFor="upload-restructure" className="block text-sm font-medium mb-1">회의록 구성 방식</label>
          <select
            id="upload-restructure"
            value={restructure}
            onChange={(e) => setRestructure(e.target.value as '' | 'true' | 'false')}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="">직전 회의 설정 따름 (기본)</option>
            <option value="true">주제별 재구성 — 전체를 주제별로 재정리</option>
            <option value="false">시간 흐름 — 회의 진행 순서대로 요약</option>
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={loading || !file || !title.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? '업로드 중...' : '업로드 및 변환'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
