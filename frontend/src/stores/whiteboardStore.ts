import { create } from 'zustand'
import { downloadBlob } from '../lib/download'
import { WHITEBOARD_FAILURE_MESSAGES, renderBoardHtml, validateBoard } from '../lib/whiteboard'
import type { WhiteboardBoard, WhiteboardMaterial } from '../lib/whiteboard'
import {
  WhiteboardNoSummaryError,
  WhiteboardServerDisabledError,
  getWhiteboard,
  postWhiteboard,
} from '../api/whiteboard'
import { createAuthenticatedConsumer } from '../lib/actionCableAuth'
import { useAuthStore } from './authStore'
import type { Subscription } from '@rails/actioncable'
import { WhiteboardRunFailure, generateBoardLocal } from '../lib/whiteboard/runner'

export type WhiteboardStatus = 'idle' | 'running' | 'done' | 'error'

export interface WhiteboardEntry {
  status: WhiteboardStatus
  board: WhiteboardBoard | null
  filename: string
  error: string | null
  /** 생성에 쓴 재료의 지문 — 회의록이 바뀌었는지(stale) 판정한다. */
  digest: string
  /** 저장(downloadBlob) 실패 문구. */
  saveError: string | null
  /** 어느 경로로 만들었는지. 서버 경로는 stale 을 서버가 판정한다. */
  source: 'local' | 'server'
  /** 서버 경로: 저장본 digest 가 현재 회의록과 다른지(GET stale). */
  serverStale: boolean
}

export interface WhiteboardNotice {
  meetingId: number
  kind: 'done' | 'error'
  message: string
}

export interface WhiteboardCableEvent {
  type?: string
  meeting_id?: number
  digest?: string
  error_kind?: string
  message?: string
}

/** 서버 경로 실패 문구 — 설계 §7 + §11.5(auth). 서버 PC 기준이라 "이 PC" 문구는 쓰지 않는다. */
export const SERVER_AUTH_MESSAGE = '서버 PC의 Claude Code 로그인이 필요합니다. 관리자에게 알려 주세요.'
export const SERVER_NOT_FOUND_MESSAGE = '서버 PC에서 Claude Code를 찾을 수 없습니다. 관리자에게 알려 주세요.'

export function serverFailureMessage(kind?: string | null, detail?: string | null): string {
  switch (kind) {
    case 'auth':
      return SERVER_AUTH_MESSAGE
    case 'rate_limit':
      return WHITEBOARD_FAILURE_MESSAGES.rate_limit
    case 'format':
      return WHITEBOARD_FAILURE_MESSAGES.format
    case 'timeout':
      return WHITEBOARD_FAILURE_MESSAGES.timeout
    case 'not_found':
      return SERVER_NOT_FOUND_MESSAGE
    default: {
      const d = (detail ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (d.startsWith('화이트보드를 만들지 못했습니다')) return d
      return `화이트보드를 만들지 못했습니다: ${d || '알 수 없는 오류'}`
    }
  }
}

const IDLE: WhiteboardEntry = { status: 'idle', board: null, filename: '', error: null, digest: '', saveError: null, source: 'local', serverStale: false }

interface WhiteboardState {
  entries: Record<number, WhiteboardEntry>
  /** 회의별 내보내기 패널이 열려 있는지 — 닫힌 채 끝나면 전역 토스트로 알린다. */
  panelOpen: Record<number, boolean>
  notice: WhiteboardNotice | null
  setPanelOpen: (meetingId: number, open: boolean) => void
  /** 이미 실행 중이면 새로 실행하지 않는다. */
  startLocal: (meetingId: number, material: WhiteboardMaterial, filename: string) => Promise<void>
  /**
   * 서버의 Claude Code 로 만든다. 'disabled' 면 서버 모드가 꺼진 것(403) — 호출 측이 copy 로 폴백한다.
   * 같은 digest 의 저장본이 있으면 서버가 200 으로 즉시 돌려준다.
   */
  startServer: (meetingId: number, material: WhiteboardMaterial, filename: string) => Promise<'ok' | 'disabled'>
  /** GET 으로 서버 상태를 복원·갱신한다(패널 열 때, 채널 연결·이벤트 때). none 이면 아무것도 바꾸지 않는다. */
  refreshServer: (meetingId: number, filename?: string) => Promise<void>
  /** 회의 채널 수신부가 넘겨 주는 whiteboard_ready / whiteboard_failed 처리. 그 밖 type 은 무시. */
  onCableEvent: (ev: WhiteboardCableEvent) => void
  save: (meetingId: number) => Promise<void>
  reset: (meetingId: number) => void
  dismissNotice: () => void
  /** 모든 채널 구독·폴링 타이머를 정리하고 상태를 비운다(로그아웃 시). */
  disposeAll: () => void
}

/** 재료(제목·일시·회의록 본문)의 지문. 요약이 다시 만들어지면 달라진다. */
export function materialDigest(m: WhiteboardMaterial): string {
  return JSON.stringify([m.title, m.datetime, m.markdown])
}

export const SAVE_FAILED_MESSAGE = '화이트보드를 저장하지 못했습니다. 다시 시도해 주세요.'

export function selectEntry(s: { entries: Record<number, WhiteboardEntry> }, meetingId: number): WhiteboardEntry {
  return s.entries[meetingId] ?? IDLE
}

// 회의별 채널 구독(서버 생성 중에만). 회의 상세 화면에는 TranscriptionChannel 핸들러가 없으므로 직접 구독한다.
const watchers = new Map<number, { sub: Subscription; consumer: { disconnect: () => void } }>()

function unwatch(id: number) {
  const w = watchers.get(id)
  if (!w) return
  watchers.delete(id)
  try {
    w.sub.unsubscribe()
    w.consumer.disconnect()
  } catch {
    // 이미 끊김
  }
}

/** 서버 running 동안의 GET 폴링(채널 보조) — 15초 간격, 최대 10분. */
export const POLL_INTERVAL_MS = 15_000
export const POLL_MAX_MS = 10 * 60 * 1000
const pollers = new Map<number, ReturnType<typeof setInterval>>()
// 채널 구독이 거부된 회의 — 다시 구독하지 않고 폴링만으로 진행한다.
const rejectedChannels = new Set<number>()

function stopPoll(id: number) {
  const t = pollers.get(id)
  if (t === undefined) return
  clearInterval(t)
  pollers.delete(id)
}

function stopAll(id: number) {
  unwatch(id)
  stopPoll(id)
  rejectedChannels.delete(id)
}

export const useWhiteboardStore = create<WhiteboardState>((set, get) => {
  const patch = (id: number, e: Partial<WhiteboardEntry>) =>
    set((s) => ({ entries: { ...s.entries, [id]: { ...selectEntry(s, id), ...e } } }))

  const notifyIfClosed = (id: number, kind: 'done' | 'error', message: string) => {
    if (!get().panelOpen[id]) set({ notice: { meetingId: id, kind, message } })
  }

  const startPoll = (id: number) => {
    if (pollers.has(id)) return
    let elapsed = 0
    const timer = setInterval(() => {
      elapsed += POLL_INTERVAL_MS
      const cur = selectEntry(get(), id)
      if (cur.status !== 'running' || cur.source !== 'server' || elapsed > POLL_MAX_MS) {
        stopPoll(id)
        return
      }
      void get().refreshServer(id)
    }, POLL_INTERVAL_MS)
    pollers.set(id, timer)
  }

  const finishDone = (id: number, rawBoard: unknown, digest?: string, stale = false) => {
    stopAll(id)
    let board: WhiteboardBoard
    try {
      board = validateBoard(rawBoard)
    } catch {
      finishError(id, WHITEBOARD_FAILURE_MESSAGES.format, digest, stale)
      return
    }
    const wasRunning = selectEntry(get(), id).status === 'running'
    patch(id, { status: 'done', board, error: null, source: 'server', serverStale: stale, ...(digest ? { digest } : {}) })
    if (wasRunning) notifyIfClosed(id, 'done', '화이트보드를 만들었습니다.')
  }

  const finishError = (id: number, message: string, digest?: string, stale = false) => {
    stopAll(id)
    const wasRunning = selectEntry(get(), id).status === 'running'
    patch(id, { status: 'error', board: null, error: message, source: 'server', serverStale: stale, ...(digest ? { digest } : {}) })
    if (wasRunning) notifyIfClosed(id, 'error', message)
  }

  const watch = (id: number) => {
    startPoll(id)
    if (rejectedChannels.has(id) || watchers.has(id)) return
    try {
      const consumer = createAuthenticatedConsumer()
      const sub = consumer.subscriptions.create(
        { channel: 'TranscriptionChannel', meeting_id: id },
        {
          // 구독이 붙기 전에 끝난 경우를 놓치지 않도록 연결 시점에 한 번 조회한다.
          connected() {
            void get().refreshServer(id)
          },
          received(data: WhiteboardCableEvent) {
            get().onCableEvent({ ...data, meeting_id: data.meeting_id ?? id })
          },
          // 협업자 등 구독이 거부되면 채널을 닫고 폴링만으로 진행한다.
          rejected() {
            rejectedChannels.add(id)
            unwatch(id)
          },
        },
      )
      watchers.set(id, { sub, consumer })
    } catch {
      // 채널을 못 열면 패널 재오픈 시 GET 으로 복원한다.
    }
  }

  return {
    entries: {},
    panelOpen: {},
    notice: null,
    setPanelOpen: (id, open) => set((s) => ({ panelOpen: { ...s.panelOpen, [id]: open } })),
    startLocal: async (id, material, filename) => {
      if (selectEntry(get(), id).status === 'running') return
      patch(id, { status: 'running', board: null, filename, error: null, digest: materialDigest(material), saveError: null, source: 'local', serverStale: false })
      try {
        const board = await generateBoardLocal(material)
        patch(id, { status: 'done', board })
        if (!get().panelOpen[id]) {
          set({ notice: { meetingId: id, kind: 'done', message: '화이트보드를 만들었습니다.' } })
        }
      } catch (e) {
        const message = e instanceof WhiteboardRunFailure ? e.failure.message : '화이트보드를 만들지 못했습니다.'
        patch(id, { status: 'error', error: message })
        if (!get().panelOpen[id]) {
          set({ notice: { meetingId: id, kind: 'error', message } })
        }
      }
    },
    startServer: async (id, material, filename) => {
      if (selectEntry(get(), id).status === 'running') return 'ok'
      patch(id, {
        status: 'running', board: null, filename, error: null, digest: materialDigest(material),
        saveError: null, source: 'server', serverStale: false,
      })
      try {
        const res = await postWhiteboard(id)
        if (res.status === 'done') {
          finishDone(id, res.board, res.digest)
        } else {
          watch(id)
        }
        return 'ok'
      } catch (e) {
        if (e instanceof WhiteboardServerDisabledError) {
          patch(id, { status: 'idle', error: null })
          return 'disabled'
        }
        const message =
          e instanceof WhiteboardNoSummaryError
            ? 'AI 회의록이 있어야 만들 수 있습니다.'
            : '화이트보드를 만들지 못했습니다. 다시 시도해 주세요.'
        finishError(id, message)
        return 'ok'
      }
    },
    refreshServer: async (id, filename) => {
      const cur = selectEntry(get(), id)
      // 이 PC에서 만든(local) 결과나 진행 중 작업은 서버 상태로 덮어쓰지 않는다.
      if (cur.status !== 'idle' && cur.source !== 'server') return
      let res
      try {
        res = await getWhiteboard(id)
      } catch {
        return
      }
      // 조회 중에 상태가 바뀌었으면(예: 사용자가 새로 시작) 오래된 응답을 버린다.
      const now = selectEntry(get(), id)
      if (now.status !== cur.status || now.source !== cur.source) return
      if (res.status === 'none') return
      if (res.status === 'running') {
        patch(id, {
          status: 'running', source: 'server', digest: res.digest ?? '', serverStale: false,
          ...(filename ? { filename } : {}), error: null, board: null,
        })
        watch(id)
      } else if (res.status === 'done') {
        if (filename) patch(id, { filename })
        finishDone(id, res.board, res.digest, res.stale)
      } else {
        if (filename) patch(id, { filename })
        finishError(id, serverFailureMessage(res.error_kind, res.error_message), res.digest, res.stale)
      }
    },
    onCableEvent: (ev) => {
      const id = ev.meeting_id
      if (typeof id !== 'number') return
      if (ev.type !== 'whiteboard_ready' && ev.type !== 'whiteboard_failed') return
      const entry = selectEntry(get(), id)
      // 내가 서버로 만들고 있는 회의의 이벤트만 처리한다(다른 사용자가 만든 것은 무시).
      if (entry.status !== 'running' || entry.source !== 'server') return
      if (ev.type === 'whiteboard_ready') {
        void get().refreshServer(id)
      } else {
        finishError(id, serverFailureMessage(ev.error_kind, ev.message))
      }
    },
    save: async (id) => {
      const entry = selectEntry(get(), id)
      if (!entry.board) return
      patch(id, { saveError: null })
      try {
        const html = renderBoardHtml(entry.board)
        await downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), entry.filename)
      } catch {
        patch(id, { saveError: SAVE_FAILED_MESSAGE })
        // 패널·토스트 어느 쪽에서 눌렀든 사용자에게 보이도록 토스트도 띄운다.
        set({ notice: { meetingId: id, kind: 'error', message: SAVE_FAILED_MESSAGE } })
      }
    },
    reset: (id) => {
      stopAll(id)
      set((s) => ({ entries: { ...s.entries, [id]: IDLE } }))
    },
    dismissNotice: () => set({ notice: null }),
    disposeAll: () => {
      for (const id of [...watchers.keys()]) unwatch(id)
      for (const id of [...pollers.keys()]) stopPoll(id)
      rejectedChannels.clear()
      set({ entries: {}, panelOpen: {}, notice: null })
    },
  }
})

// 로그아웃(인증 해제) 시 구독·타이머·이전 사용자의 결과를 정리한다.
useAuthStore.subscribe((state, prev) => {
  if (prev.isAuthenticated && !state.isAuthenticated) useWhiteboardStore.getState().disposeAll()
})
