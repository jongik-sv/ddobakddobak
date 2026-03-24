import { useEffect, useRef, useCallback } from 'react'
import { createConsumer } from '@rails/actioncable'
import type { Consumer, Subscription } from '@rails/actioncable'
import { createTranscriptionChannel, sendAudioChunk } from '../channels/transcription'
import { useAuthStore } from '../stores/authStore'
import { useAppSettingsStore } from '../stores/appSettingsStore'
import { DIARIZATION } from '../config'
import { WS_URL } from '../config'
import type { ChunkMeta } from './useAudioRecorder'

export interface UseTranscriptionResult {
  sendChunk: (pcm: Int16Array, meta?: ChunkMeta) => void
}

export function useTranscription(meetingId: number): UseTranscriptionResult {
  const token = useAuthStore((s) => s.token)
  const consumerRef = useRef<Consumer | null>(null)
  const subscriptionRef = useRef<Subscription | null>(null)

  // 설정을 ref에 캐시하여 매 청크마다 새 객체 생성 방지
  const diarizationConfigRef = useRef<Record<string, unknown>>({})
  const languagesRef = useRef<string[]>([])

  useEffect(() => {
    return useAppSettingsStore.subscribe((state) => {
      diarizationConfigRef.current = {
        ...DIARIZATION,
        ...state.diarizationOverrides,
        enable: state.diarizationEnabled,
      }
      languagesRef.current = state.selectedLanguages
    })
  }, [])

  // 초기값 설정
  useEffect(() => {
    const state = useAppSettingsStore.getState()
    diarizationConfigRef.current = {
      ...DIARIZATION,
      ...state.diarizationOverrides,
      enable: state.diarizationEnabled,
    }
    languagesRef.current = state.selectedLanguages
  }, [])

  useEffect(() => {
    const url = token ? `${WS_URL}?token=${token}` : WS_URL
    const consumer = createConsumer(url)
    consumerRef.current = consumer

    const subscription = createTranscriptionChannel(meetingId, consumer)
    subscriptionRef.current = subscription

    return () => {
      subscription.unsubscribe()
      consumer.disconnect()
      consumerRef.current = null
      subscriptionRef.current = null
    }
  }, [meetingId, token])

  const sendChunk = useCallback((pcm: Int16Array, meta?: ChunkMeta) => {
    if (subscriptionRef.current) {
      sendAudioChunk(subscriptionRef.current, pcm, meta, diarizationConfigRef.current, languagesRef.current)
    }
  }, [])

  return { sendChunk }
}
