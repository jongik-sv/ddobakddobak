import { IS_TAURI } from '../../config'
import {
  WHITEBOARD_SYSTEM_PROMPT,
  buildRetrySuffix,
  buildWhiteboardUserContent,
  classifyWhiteboardFailure,
  classifyWhiteboardOutput,
  parseBoardResponse,
  WhiteboardValidationError,
} from './index'
import type { WhiteboardBoard, WhiteboardFailure, WhiteboardMaterial } from './index'

/** 이 PC의 claude 실행 파일 경로. 비Tauri·커맨드 없음(Android 등)·실패면 null. */
export async function detectLocalClaude(): Promise<string | null> {
  if (!IS_TAURI) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const path = await invoke<string | null>('detect_claude')
    return path || null
  } catch {
    return null
  }
}

async function runClaude(userContent: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('run_claude_whiteboard', {
    systemPrompt: WHITEBOARD_SYSTEM_PROMPT,
    userContent,
    timeoutSecs: 180,
  })
}

export class WhiteboardRunFailure extends Error {
  failure: WhiteboardFailure
  constructor(failure: WhiteboardFailure) {
    super(failure.message)
    this.name = 'WhiteboardRunFailure'
    this.failure = failure
  }
}

/**
 * 이 PC의 Claude Code로 보드 JSON을 만든다. 스키마 위반이면 오류 문구를 붙여 1회 재요청한다.
 * 실패하면 WhiteboardRunFailure(분류된 문구 포함)를 던진다.
 */
export async function generateBoardLocal(material: WhiteboardMaterial): Promise<WhiteboardBoard> {
  const base = buildWhiteboardUserContent(material)
  try {
    const first = await runClaude(base)
    try {
      return parseBoardResponse(first)
    } catch (e) {
      if (!(e instanceof WhiteboardValidationError)) throw e
      // 로그인 필요·한도 문구가 정상 종료 stdout 으로 온 경우는 재요청해도 소용없다.
      const early = classifyWhiteboardOutput(first)
      if (early) throw new WhiteboardRunFailure(early)
      const second = await runClaude(base + buildRetrySuffix(e.message))
      try {
        return parseBoardResponse(second)
      } catch (e2) {
        const late = e2 instanceof WhiteboardValidationError ? classifyWhiteboardOutput(second) : null
        if (late) throw new WhiteboardRunFailure(late)
        throw e2
      }
    }
  } catch (e) {
    if (e instanceof WhiteboardRunFailure) throw e
    throw new WhiteboardRunFailure(classifyWhiteboardFailure(e))
  }
}
