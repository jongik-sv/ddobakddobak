import { useState, useEffect, useRef, useCallback } from 'react'
import type { RefObject } from 'react'
import { apiClient } from '../api/client'
import { downloadBlob } from '../lib/download'

export interface AudioPlayerResult {
  isReady: boolean
  isPlaying: boolean
  hasAudio: boolean
  currentTimeMs: number
  durationMs: number
  play: () => void
  pause: () => void
  seekTo: (ms: number) => void
  download: (filename?: string) => Promise<void>
}

export function useAudioPlayer(
  meetingId: number,
  waveformRef: RefObject<HTMLDivElement | null>
): AudioPlayerResult {
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasAudio, setHasAudio] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)

  const wavesurferRef = useRef<import('wavesurfer.js').default | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!waveformRef.current) return

    let cancelled = false

    async function init() {
      const WaveSurfer = (await import('wavesurfer.js')).default

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

        if (!waveformRef.current || cancelled) return

        const ws = WaveSurfer.create({
          container: waveformRef.current,
          waveColor: '#6366f1',
          progressColor: '#4f46e5',
          url: blobUrl,
        })

        ws.on('ready', () => {
          if (!cancelled) {
            setHasAudio(true)
            setDurationMs(ws.getDuration() * 1000)
            setIsReady(true)
          }
        })

        ws.on('play', () => {
          if (!cancelled) setIsPlaying(true)
        })

        ws.on('pause', () => {
          if (!cancelled) setIsPlaying(false)
        })

        ws.on('finish', () => {
          if (!cancelled) setIsPlaying(false)
        })

        ws.on('timeupdate', (currentTime: number) => {
          if (!cancelled) setCurrentTimeMs(currentTime * 1000)
        })

        wavesurferRef.current = ws
      } catch {
        // audio may not be available for this meeting — mark as ready so UI isn't stuck
        if (!cancelled) setIsReady(true)
      }
    }

    init()

    return () => {
      cancelled = true
      wavesurferRef.current?.destroy()
      wavesurferRef.current = null
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
      setIsReady(false)
      setIsPlaying(false)
      setHasAudio(false)
      setCurrentTimeMs(0)
      setDurationMs(0)
    }
  }, [meetingId, waveformRef])

  const play = useCallback(() => {
    wavesurferRef.current?.play()
  }, [])

  const pause = useCallback(() => {
    wavesurferRef.current?.pause()
  }, [])

  const seekTo = useCallback((ms: number) => {
    const ws = wavesurferRef.current
    if (!ws) return
    const duration = ws.getDuration()
    if (duration > 0) {
      ws.seekTo(ms / (duration * 1000))
    } else {
      ws.seekTo(0)
    }
  }, [])

  const download = useCallback(async (filename?: string) => {
    const url = blobUrlRef.current
    if (!url) return
    const res = await fetch(url)
    const blob = await res.blob()
    await downloadBlob(blob, filename ?? `meeting-${meetingId}.webm`)
  }, [meetingId])

  return { isReady, isPlaying, hasAudio, currentTimeMs, durationMs, play, pause, seekTo, download }
}
