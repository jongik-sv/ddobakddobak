import { useEffect, useRef, useCallback } from 'react'
import type { Consumer, Subscription } from '@rails/actioncable'
import { createTranscriptionChannel, sendAudioChunk, sendHeartbeat as performHeartbeat } from '../channels/transcription'
import { useAppSettingsStore } from '../stores/appSettingsStore'
import { DIARIZATION } from '../config'
import { createAuthenticatedConsumer } from '../lib/actionCableAuth'
import type { ChunkMeta } from './useAudioRecorder'

export interface UseTranscriptionResult {
  sendChunk: (pcm: Int16Array, meta?: ChunkMeta) => void
  sendSystemChunk: (pcm: Int16Array, meta?: ChunkMeta) => void
  /** 녹음 클라 생존 하트비트 1회 전송. 호출 책임은 useLiveRecording(활성 녹음 게이트). */
  sendHeartbeat: () => void
}

/** appSettingsStore 상태에서 diarization 설정 객체를 생성한다 (실시간 /transcribe 청크 전용). */
function buildDiarizationConfig(state: ReturnType<typeof useAppSettingsStore.getState>): Record<string, unknown> {
  return {
    ...DIARIZATION,
    ...state.diarizationOverrides,
    // 실시간 청크 화자분리는 품질 문제(청크 단위 DER 20~50%, gpu_lock으로 STT 지연)로 항상 비활성.
    // 화자 분리 토글은 배치(파일 업로드/STT 재생성) 경로에만 적용된다 — Rails가 settings.yaml에서 읽음.
    // plan: docs/superpowers/plans/2026-06-12-speaker-diarization-v2.md
    enable: false,
  }
}

export function useTranscription(meetingId: number): UseTranscriptionResult {
  const consumerRef = useRef<Consumer | null>(null)
  const subscriptionRef = useRef<Subscription | null>(null)

  // 설정을 ref에 캐시하여 매 청크마다 새 객체 생성 방지
  // 회의 언어(mode/languages)는 서버가 회의 생성자 설정에서 결정하므로 전송하지 않는다.
  const diarizationConfigRef = useRef<Record<string, unknown>>({})

  // 초기값 설정 + subscribe를 하나의 effect로 통합
  useEffect(() => {
    const state = useAppSettingsStore.getState()
    diarizationConfigRef.current = buildDiarizationConfig(state)

    return useAppSettingsStore.subscribe((s) => {
      diarizationConfigRef.current = buildDiarizationConfig(s)
    })
  }, [])

  useEffect(() => {
    const consumer = createAuthenticatedConsumer()
    consumerRef.current = consumer

    const subscription = createTranscriptionChannel(meetingId, consumer)
    subscriptionRef.current = subscription

    return () => {
      subscription.unsubscribe()
      consumer.disconnect()
      consumerRef.current = null
      subscriptionRef.current = null
    }
  }, [meetingId])

  const send = useCallback((source: 'mic' | 'system', pcm: Int16Array, meta?: ChunkMeta) => {
    if (subscriptionRef.current) {
      sendAudioChunk(subscriptionRef.current, pcm, meta, diarizationConfigRef.current, source)
    }
  }, [])

  const sendChunk = useCallback((pcm: Int16Array, meta?: ChunkMeta) => send('mic', pcm, meta), [send])
  const sendSystemChunk = useCallback((pcm: Int16Array, meta?: ChunkMeta) => send('system', pcm, meta), [send])

  // 하트비트는 useLiveRecording이 "이 클라가 활성 녹음 중"일 때만 구동한다.
  // (마운트 시 자동 발사 금지 — 시청자/2번째 탭이 owner 롤로 keep-alive 를 보내면
  //  stale-recording 자동종결이 무력화된다.)
  const sendHeartbeat = useCallback(() => {
    if (subscriptionRef.current) performHeartbeat(subscriptionRef.current)
  }, [])

  return { sendChunk, sendSystemChunk, sendHeartbeat }
}
