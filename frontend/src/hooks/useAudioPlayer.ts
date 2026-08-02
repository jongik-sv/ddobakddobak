import { useState, useEffect, useRef, useCallback } from 'react'
import { getApiBaseUrl, getMode } from '../config'
import { apiClient, getAuthHeaders } from '../api/client'
import { filenameFromDisposition } from '../api/projectTransfers'
import { downloadBlob } from '../lib/download'

export interface AudioPlayerResult {
  isReady: boolean
  isPlaying: boolean
  hasAudio: boolean
  audioLoaded: boolean
  srcReady: boolean
  currentTimeMs: number
  durationMs: number
  playbackRate: number
  play: () => void
  pause: () => void
  seekTo: (ms: number) => void
  setPlaybackRate: (rate: number) => void
  download: (filename?: string) => Promise<void>
}

/**
 * @param audioVersion 서버 오디오 파일이 교체될 때마다 증가하는 토큰(transcriptStore.audioRevision).
 *   절단(transcripts#redact)은 같은 경로의 파일 내용을 바꾸므로, 이 값이 URL과 effect deps에
 *   들어가지 않으면 캐시된 blob(=절단 전 기밀 오디오)이 계속 재생된다. 길이는 우연히 같을 수
 *   있으므로 durationMs 가 아니라 별도 카운터를 쓴다.
 */
export function useAudioPlayer(meetingId: number, audioVersion = 0): AudioPlayerResult {
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasAudio, setHasAudio] = useState(false)
  const [audioLoaded, setAudioLoaded] = useState(false)
  const [srcReady, setSrcReady] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [playbackRate, setPlaybackRateState] = useState(1)

  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let cancelled = false
    let blobUrl: string | null = null
    const audioUrl = audioVersion > 0
      ? `${getApiBaseUrl()}/meetings/${meetingId}/audio?v=${audioVersion}`
      : `${getApiBaseUrl()}/meetings/${meetingId}/audio`

    // Audio 엘리먼트를 동기적으로 생성 (cleanup에서 확실히 접근 가능)
    const audio = new Audio()
    audioRef.current = audio
    audio.preload = 'metadata'

    audio.addEventListener('loadedmetadata', () => {
      if (cancelled) return
      setHasAudio(true)
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDurationMs(audio.duration * 1000)
      }
      setIsReady(true)
    })

    audio.addEventListener('durationchange', () => {
      if (!cancelled && Number.isFinite(audio.duration) && audio.duration > 0) {
        setDurationMs(audio.duration * 1000)
      }
    })

    audio.addEventListener('canplay', () => { if (!cancelled) setAudioLoaded(true) })
    audio.addEventListener('play', () => { if (!cancelled) setIsPlaying(true) })
    audio.addEventListener('pause', () => { if (!cancelled) setIsPlaying(false) })
    audio.addEventListener('ended', () => { if (!cancelled) setIsPlaying(false) })
    audio.addEventListener('timeupdate', () => {
      if (!cancelled) setCurrentTimeMs(audio.currentTime * 1000)
    })
    // 일시정지 상태의 프로그래매틱 seek는 timeupdate가 안 떠서 시간 표시가 갱신되지 않는다.
    // seeked로 실제 위치를 반영(브라우저가 clamp한 값까지 보정).
    audio.addEventListener('seeked', () => {
      if (!cancelled) setCurrentTimeMs(audio.currentTime * 1000)
    })
    audio.addEventListener('error', () => {
      if (!cancelled) setIsReady(true)
    })

    // peaks API에서 duration을 먼저 확보 (moov atom이 파일 끝에 있어 메타데이터 로드 실패하는 경우 대비)
    apiClient.get(`meetings/${meetingId}/peaks`)
      .json<{ duration: number }>()
      .then((res) => {
        if (cancelled || !res.duration) return
        setDurationMs(res.duration * 1000)
        setHasAudio(true)
        setIsReady(true)
      })
      .catch(() => {})

    // 서버 모드: fetch로 blob을 가져와 objectURL 생성 (Authorization 헤더 필요)
    // 로컬 모드: 기존 방식 유지 (직접 URL 설정)
    if (getMode() === 'server') {
      fetch(audioUrl, { headers: getAuthHeaders() })
        .then((res) => {
          if (cancelled) return null
          // 오디오 없음(404 등) → src를 설정하지 않으면 audio가 error 이벤트도 안 쏴서
          // 로딩 스피너가 영영 안 사라진다. 여기서 직접 로딩을 종료시킨다.
          if (!res.ok) {
            setIsReady(true)
            return null
          }
          return res.blob()
        })
        .then((blob) => {
          if (cancelled || !blob) return
          // 빈 파일(0바이트)도 재생 불가 → 로딩 종료
          if (blob.size === 0) {
            setIsReady(true)
            return
          }
          blobUrl = URL.createObjectURL(blob)
          audio.src = blobUrl
          setSrcReady(true)
        })
        .catch(() => {
          if (!cancelled) setIsReady(true)
        })
    } else {
      audio.src = audioUrl
      setSrcReady(true)
    }

    return () => {
      cancelled = true
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      audioRef.current = null
      setIsReady(false)
      setIsPlaying(false)
      setHasAudio(false)
      setAudioLoaded(false)
      setSrcReady(false)
      setCurrentTimeMs(0)
      setDurationMs(0)
    }
  }, [meetingId, audioVersion])

  const play = useCallback(() => {
    audioRef.current?.play()
  }, [])

  const pause = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  const seekTo = useCallback((ms: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = ms / 1000
    // 낙관적 갱신: 일시정지 중 seek는 미디어 이벤트가 늦거나 안 떠서
    // 시간 표시·트랜스크립트 하이라이트가 0:00에 멈춘다. 목표 위치를 즉시 반영.
    setCurrentTimeMs(ms)
  }, [])

  const setPlaybackRate = useCallback((rate: number) => {
    const audio = audioRef.current
    if (audio) audio.playbackRate = rate
    setPlaybackRateState(rate)
  }, [])

  const download = useCallback(async (filename?: string) => {
    const response = await apiClient.get(`meetings/${meetingId}/audio`)
    const disposition = response.headers.get('content-disposition')
    const serverFilename = filenameFromDisposition(disposition) ?? `meeting-${meetingId}.webm`
    const blob = await response.blob()
    await downloadBlob(blob, filename ?? serverFilename)
  }, [meetingId])

  return { isReady, isPlaying, hasAudio, audioLoaded, srcReady, currentTimeMs, durationMs, playbackRate, play, pause, seekTo, setPlaybackRate, download }
}
