/**
 * useLocalAudioPlayer — 오프라인(로컬) 회의 오디오 재생 훅.
 *
 * useAudioPlayer(서버 URL 하드코딩)의 오프라인 대응판. 서버 fetch 대신 localStore의
 * audio/<seq>.wav 세그먼트들을 mergeLocalAudio로 1벌 WAV로 병합 → Blob objectURL로 재생한다.
 *
 * 반환은 **AudioPlayerResult와 동일한 형태**라 기존 AudioPlayer/MiniAudioPlayer를 그대로
 * 재사용할 수 있고, 추가로 오프라인 전용 segmentOffsetsMs / seekToSegment(i)를 노출한다.
 * (seek는 started_at_ms 직접 사용 대신 병합 시 누적된 무음컷-보정 오프셋을 쓴다.)
 *
 * jsdom/일부 WebView는 blob src에서 loadedmetadata를 안 쏘므로, hasAudio/isReady/durationMs는
 * mergeLocalAudio 결과로 **직접 시드**하고 play/pause/timeupdate만 <audio> 이벤트로 미러한다.
 *
 * download는 lib/download의 downloadBlob 재사용(기본 `${title}.wav`). 병합은 첫 마운트시 lazy.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { AudioPlayerResult } from './useAudioPlayer'
import { mergeLocalAudio } from '../stt/localStore'
import { downloadBlob } from '../lib/download'

export interface LocalAudioPlayerResult extends AudioPlayerResult {
  /** 병합 세그먼트별 시작 오프셋(ms). finals 인덱스와 1:1 정렬. */
  segmentOffsetsMs: number[]
  /** finals 인덱스 i 세그먼트 시작 지점으로 시크(started_at_ms 드리프트 회피). */
  seekToSegment: (index: number) => void
}

/**
 * @param reloadKey 값이 바뀌면 오디오/오프셋을 재병합(재전사 후 새 segmentOffsetsMs 반영용).
 */
export function useLocalAudioPlayer(localId: string, title: string, reloadKey = 0): LocalAudioPlayerResult {
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasAudio, setHasAudio] = useState(false)
  const [audioLoaded, setAudioLoaded] = useState(false)
  const [srcReady, setSrcReady] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [playbackRate, setPlaybackRateState] = useState(1)
  const [segmentOffsetsMs, setSegmentOffsetsMs] = useState<number[]>([])

  const audioRef = useRef<HTMLAudioElement | null>(null)
  // download가 병합을 한 번 더 안 하도록 bytes를 보관.
  const bytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  // seekToSegment 콜백이 최신 오프셋을 stale closure 없이 읽도록 ref 미러.
  const offsetsRef = useRef<number[]>([])

  useEffect(() => {
    let cancelled = false
    let blobUrl: string | null = null

    const audio = new Audio()
    audioRef.current = audio
    audio.preload = 'metadata'

    // play/pause/timeupdate만 미러(서버 훅과 동일 리스너). 메타데이터/duration은 직접 시드.
    audio.addEventListener('canplay', () => { if (!cancelled) setAudioLoaded(true) })
    audio.addEventListener('play', () => { if (!cancelled) setIsPlaying(true) })
    audio.addEventListener('pause', () => { if (!cancelled) setIsPlaying(false) })
    audio.addEventListener('ended', () => { if (!cancelled) setIsPlaying(false) })
    audio.addEventListener('timeupdate', () => {
      if (!cancelled) setCurrentTimeMs(audio.currentTime * 1000)
    })
    audio.addEventListener('loadedmetadata', () => {
      // 실제 WebView에서 발화되면 좀 더 정확한 duration으로 갱신(있을 때만).
      if (!cancelled && Number.isFinite(audio.duration) && audio.duration > 0) {
        setDurationMs(audio.duration * 1000)
      }
    })

    // 병합은 lazy(마운트 1회).
    mergeLocalAudio(localId)
      .then((merged) => {
        if (cancelled) return
        if (!merged) {
          // 오디오 없음 → 로딩 종료(스피너 영구 표시 방지).
          setIsReady(true)
          return
        }
        bytesRef.current = merged.bytes
        offsetsRef.current = merged.segmentOffsetsMs
        setSegmentOffsetsMs(merged.segmentOffsetsMs)
        setDurationMs(merged.durationMs)
        setHasAudio(true)
        setIsReady(true)
        blobUrl = URL.createObjectURL(new Blob([merged.bytes], { type: 'audio/wav' }))
        audio.src = blobUrl
        setSrcReady(true)
      })
      .catch(() => {
        if (!cancelled) setIsReady(true)
      })

    return () => {
      cancelled = true
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      audioRef.current = null
      bytesRef.current = null
      offsetsRef.current = []
      setIsReady(false)
      setIsPlaying(false)
      setHasAudio(false)
      setAudioLoaded(false)
      setSrcReady(false)
      setCurrentTimeMs(0)
      setDurationMs(0)
      setSegmentOffsetsMs([])
    }
  }, [localId, reloadKey])

  const play = useCallback(() => { audioRef.current?.play() }, [])
  const pause = useCallback(() => { audioRef.current?.pause() }, [])

  const seekTo = useCallback((ms: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = ms / 1000
  }, [])

  const seekToSegment = useCallback((index: number) => {
    const audio = audioRef.current
    if (!audio) return
    const ms = offsetsRef.current[index]
    if (ms != null) audio.currentTime = ms / 1000
  }, [])

  const setPlaybackRate = useCallback((rate: number) => {
    const audio = audioRef.current
    if (audio) audio.playbackRate = rate
    setPlaybackRateState(rate)
  }, [])

  const download = useCallback(async (filename?: string) => {
    const bytes = bytesRef.current
    if (!bytes) return
    const blob = new Blob([bytes], { type: 'audio/wav' })
    await downloadBlob(blob, filename ?? `${title}.wav`)
  }, [title])

  return {
    isReady,
    isPlaying,
    hasAudio,
    audioLoaded,
    srcReady,
    currentTimeMs,
    durationMs,
    playbackRate,
    play,
    pause,
    seekTo,
    setPlaybackRate,
    download,
    segmentOffsetsMs,
    seekToSegment,
  }
}
