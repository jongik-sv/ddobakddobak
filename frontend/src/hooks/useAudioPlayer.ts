import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE_URL } from '../config'
import { apiClient } from '../api/client'
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
    const audioUrl = `${API_BASE_URL}/meetings/${meetingId}/audio`

    const audio = new Audio()
    audioRef.current = audio
    audio.preload = 'metadata'

    audio.addEventListener('loadedmetadata', () => {
      if (cancelled) return
      setHasAudio(true)
      setDurationMs(audio.duration * 1000)
      setIsReady(true)
    })

    audio.addEventListener('canplay', () => {
      if (!cancelled) setAudioLoaded(true)
    })

    audio.addEventListener('play', () => { if (!cancelled) setIsPlaying(true) })
    audio.addEventListener('pause', () => { if (!cancelled) setIsPlaying(false) })
    audio.addEventListener('ended', () => { if (!cancelled) setIsPlaying(false) })
    audio.addEventListener('timeupdate', () => {
      if (!cancelled) setCurrentTimeMs(audio.currentTime * 1000)
    })
    audio.addEventListener('error', () => {
      if (!cancelled) setIsReady(true)
    })

    audio.src = audioUrl

    return () => {
      cancelled = true
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
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
