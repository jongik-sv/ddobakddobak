import { useState, useEffect, useRef, useCallback } from 'react'
import { getApiBaseUrl, getMode } from '../config'
import { apiClient, getAuthHeaders } from '../api/client'
import { downloadBlob } from '../lib/download'

export interface AudioPlayerResult {
  isReady: boolean
  isPlaying: boolean
  hasAudio: boolean
  audioLoaded: boolean
  currentTimeMs: number
  durationMs: number
  playbackRate: number
  play: () => void
  pause: () => void
  seekTo: (ms: number) => void
  setPlaybackRate: (rate: number) => void
  download: (filename?: string) => Promise<void>
}

export function useAudioPlayer(meetingId: number): AudioPlayerResult {
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasAudio, setHasAudio] = useState(false)
  const [audioLoaded, setAudioLoaded] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [playbackRate, setPlaybackRateState] = useState(1)

  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let cancelled = false
    let blobUrl: string | null = null
    const audioUrl = `${getApiBaseUrl()}/meetings/${meetingId}/audio`

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
          if (cancelled || !res.ok) return null
          return res.blob()
        })
        .then((blob) => {
          if (cancelled || !blob) return
          blobUrl = URL.createObjectURL(blob)
          audio.src = blobUrl
        })
        .catch(() => {})
    } else {
      audio.src = audioUrl
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
      setCurrentTimeMs(0)
      setDurationMs(0)
    }
  }, [meetingId])

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
  }, [])

  const setPlaybackRate = useCallback((rate: number) => {
    const audio = audioRef.current
    if (audio) audio.playbackRate = rate
    setPlaybackRateState(rate)
  }, [])

  const download = useCallback(async (filename?: string) => {
    const response = await apiClient.get(`meetings/${meetingId}/audio`)
    const disposition = response.headers.get('content-disposition') ?? ''
    const match = disposition.match(/filename="?(.+?)"?$/)
    const serverFilename = match?.[1] ?? `meeting-${meetingId}.webm`
    const blob = await response.blob()
    await downloadBlob(blob, filename ?? serverFilename)
  }, [meetingId])

  return { isReady, isPlaying, hasAudio, audioLoaded, currentTimeMs, durationMs, playbackRate, play, pause, seekTo, setPlaybackRate, download }
}
