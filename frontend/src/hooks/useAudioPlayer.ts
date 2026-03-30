import { useState, useEffect, useRef, useCallback } from 'react'
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
  const blobUrlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const response = await apiClient.get(`meetings/${meetingId}/audio`)

        if (!response.ok || cancelled) {
          if (!cancelled) setIsReady(true)
          return
        }

        const blob = await response.blob()
        if (cancelled) return

        const blobUrl = URL.createObjectURL(blob)
        blobUrlRef.current = blobUrl

        const audio = new Audio(blobUrl)
        audioRef.current = audio

        audio.addEventListener('loadedmetadata', () => {
          if (cancelled) return
          setHasAudio(true)
          setAudioLoaded(true)
          setDurationMs(audio.duration * 1000)
          setIsReady(true)
        })

        audio.addEventListener('play', () => { if (!cancelled) setIsPlaying(true) })
        audio.addEventListener('pause', () => { if (!cancelled) setIsPlaying(false) })
        audio.addEventListener('ended', () => { if (!cancelled) setIsPlaying(false) })
        audio.addEventListener('timeupdate', () => {
          if (!cancelled) setCurrentTimeMs(audio.currentTime * 1000)
        })
      } catch {
        if (!cancelled) setIsReady(true)
      }
    }

    init()

    return () => {
      cancelled = true
      const audio = audioRef.current
      if (audio) {
        audio.pause()
        audio.src = ''
        audioRef.current = null
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
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
    const url = blobUrlRef.current
    if (!url) return
    const res = await fetch(url)
    const blob = await res.blob()
    await downloadBlob(blob, filename ?? `meeting-${meetingId}.webm`)
  }, [meetingId])

  return { isReady, isPlaying, hasAudio, audioLoaded, currentTimeMs, durationMs, playbackRate, play, pause, seekTo, setPlaybackRate, download }
}
