export type WhiteboardRoute = 'local' | 'copy' | 'server'
export type WhiteboardWebMode = 'copy' | 'server_claude'

export interface WhiteboardRouteInput {
  isTauri: boolean
  /** detect_claude 결과. 없거나 실패면 null */
  localClaude: string | null | undefined
  /** 설정 조회 결과. 실패 시 null/undefined → copy */
  webMode: WhiteboardWebMode | null | undefined
  serverClaudeAvailable: boolean | null | undefined
  /** 기본 true. false 면 server 분기를 copy 로 처리(비상 차단용) */
  serverEnabled?: boolean
}

export function resolveWhiteboardRoute(input: WhiteboardRouteInput): WhiteboardRoute {
  if (input.isTauri && input.localClaude) return 'local'
  if (input.webMode === 'server_claude' && input.serverClaudeAvailable === true && input.serverEnabled !== false) {
    return 'server'
  }
  return 'copy'
}
