import { useEffect, useRef, useCallback } from 'react'
import type { Consumer, Subscription } from '@rails/actioncable'
import { createTranscriptionChannel, sendAudioChunk } from '../channels/transcription'
import { useAppSettingsStore } from '../stores/appSettingsStore'
import { DIARIZATION } from '../config'
import { createAuthenticatedConsumer } from '../lib/actionCableAuth'
import type { ChunkMeta } from './useAudioRecorder'

export interface UseTranscriptionResult {
  sendChunk: (pcm: Int16Array, meta?: ChunkMeta) => void
  sendSystemChunk: (pcm: Int16Array, meta?: ChunkMeta) => void
}

/** appSettingsStore 상태에서 diarization 설정 객체를 생성한다. */
function buildDiarizationConfig(state: ReturnType<typeof useAppSettingsStore.getState>): Record<string, unknown> {
  return {
    ...DIARIZATION,
    ...state.diarizationOverrides,
    enable: state.diarizationEnabled,
  }
}

export function useTranscription(meetingId: number): UseTranscriptionResult {
  const consumerRef = useRef<Consumer | null>(null)
  const subscriptionRef = useRef<Subscription | null>(null)

  // 설정을 ref에 캐시하여 매 청크마다 새 객체 생성 방지
  const diarizationConfigRef = useRef<Record<string, unknown>>({})
  const languagesRef = useRef<string[]>([])

  // 초기값 설정 + subscribe를 하나의 effect로 통합
  useEffect(() => {
    const state = useAppSettingsStore.getState()
    diarizationConfigRef.current = buildDiarizationConfig(state)
    languagesRef.current = state.selectedLanguages

    return useAppSettingsStore.subscribe((s) => {
      diarizationConfigRef.current = buildDiarizationConfig(s)
      languagesRef.current = s.selectedLanguages
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
      sendAudioChunk(subscriptionRef.current, pcm, meta, diarizationConfigRef.current, languagesRef.current, source)
    }
  }, [])

  const sendChunk = useCallback((pcm: Int16Array, meta?: ChunkMeta) => send('mic', pcm, meta), [send])
  const sendSystemChunk = useCallback((pcm: Int16Array, meta?: ChunkMeta) => send('system', pcm, meta), [send])

  return { sendChunk, sendSystemChunk }
}
