import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getMeeting,
  getSummary,
  updateMeeting,
  deleteMeeting as deleteMeetingApi,
} from '../api/meetings'
import type { Meeting, SummaryResponse, UpdateMeetingParams } from '../api/meetings'
import { useTranscriptStore } from '../stores/transcriptStore'

// 모듈 레벨 캐시 — 페이지 전환 시 이전 데이터 즉시 표시
const meetingCache = new Map<number, { meeting: Meeting; summary: SummaryResponse | null }>()

interface UseMeetingReturn {
  meeting: Meeting | null
  summary: SummaryResponse | null
  teamMembers: { id: number; name: string }[]
  isLoading: boolean
  error: string | null
  updateTitle: (title: string) => Promise<void>
  updateMeetingInfo: (data: UpdateMeetingParams) => Promise<void>
  deleteMeeting: () => Promise<void>
  refetch: () => void
}

export function useMeeting(meetingId: number): UseMeetingReturn {
  const navigate = useNavigate()
  const cached = meetingCache.get(meetingId)
  const [meeting, setMeeting] = useState<Meeting | null>(cached?.meeting ?? null)
  const [summary, setSummary] = useState<SummaryResponse | null>(cached?.summary ?? null)
  const [isLoading, setIsLoading] = useState(!cached)
  const [error, setError] = useState<string | null>(null)

  const [fetchKey, setFetchKey] = useState(0)
  const refetch = useCallback(() => setFetchKey((k) => k + 1), [])

  useEffect(() => {
    // Stale-response 가드. refetch()(fetchKey 증가)가 이전 요청이 끝나기 전에 다시 불리면
    // (예: updateMeetingInfo → refetch() 직후 기밀 구간 절단 → applyLocalRedaction이
    // refetchMeeting() 재호출) 먼저 나간 요청(A)과 나중에 나간 요청(B)이 둘 다 인플라이트로
    // 남는다. 가드 없이는 나중에 나간 B가 먼저 응답해 화면을 정상화해도, 뒤늦게 응답한
    // 스테일 A가 setMeeting/setSummary로 그 결과를 덮어쓴다 — 절단으로 파기된 회의록이
    // 화면에 되살아나는 경로였다(CRITICAL, 4차 감사).
    //
    // React는 deps([meetingId, fetchKey]) 변경 시 새 effect를 실행하기 **전에** 이전 effect의
    // cleanup을 실행한다. 그래서 B용 effect가 마운트되는 순간(= 두 번째 fetchKey 변경이
    // 커밋되는 순간, 네트워크 완료를 기다리지 않는다) A의 cancelled가 이미 true로 바뀐다 —
    // A/B의 실제 응답 도착 순서와 무관하게, "더 나중에 시작된 요청"만 화면에 반영된다.
    let cancelled = false

    if (!meetingCache.has(meetingId)) setIsLoading(true)
    setError(null)

    Promise.all([getMeeting(meetingId), getSummary(meetingId)])
      .then(([meetingData, summaryData]) => {
        if (cancelled) return
        setMeeting(meetingData)
        setSummary(summaryData)
        // 이전 회의 인용 마커 배지용 회의명 맵 — AiSummaryPanel이 store에서 직접 읽는다.
        useTranscriptStore.getState().setCitationMeetings(meetingData.citation_meetings ?? {})
        meetingCache.set(meetingId, { meeting: meetingData, summary: summaryData })
      })
      .catch((err: Error) => {
        // 스테일 실패가 이미 반영된 최신 성공 상태를 에러 화면으로 덮으면 안 된다.
        if (cancelled) return
        setError(err.message)
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [meetingId, fetchKey])

  async function updateTitle(title: string) {
    const updated = await updateMeeting(meetingId, { title })
    setMeeting((prev) => (prev ? { ...prev, ...updated } : updated))
  }

  async function updateMeetingInfo(data: UpdateMeetingParams) {
    const updated = await updateMeeting(meetingId, data)
    // 즉시 merge(경로 등 full 전용 필드 보존) 후, full GET 으로 previous_meeting 등 갱신.
    setMeeting((prev) => (prev ? { ...prev, ...updated } : updated))
    refetch()
  }

  async function deleteMeeting() {
    await deleteMeetingApi(meetingId)
    navigate('/dashboard')
  }

  const teamMembers: { id: number; name: string }[] = []

  return {
    meeting,
    summary,
    teamMembers,
    isLoading,
    error,
    updateTitle,
    updateMeetingInfo,
    deleteMeeting,
    refetch,
  }
}
