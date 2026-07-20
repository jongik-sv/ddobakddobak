/**
 * D'Flow 전송 다이얼로그(SendToDflowDialog)의 자동 판정/제목 조립/연결 분기 로직.
 * 서버 규칙(스펙 §1.3·§1.4, backend/app/models/meeting.rb의 dflow_root_folder_name·
 * dflow_sub_folder_name·dflow_auto_title)을 프런트에서 그대로 재현해 전송 전 미리보기를 만든다.
 * 실제 판정은 서버가 최종 수행하며, 여기서는 미리보기 + 실패 시 수동 선택지 노출용이다.
 */

export interface FolderPathEntry {
  id: number
  name: string
}

const DFLOW_TITLE_MAX_LENGTH = 200

/** §1.3: 폴더 체인의 최상위 폴더명 (root). 폴더 없으면 undefined. */
export function dflowRootFolderName(folderPath: FolderPathEntry[] | undefined): string | undefined {
  return folderPath?.[0]?.name
}

/** §1.3: 최상위 바로 아래 폴더명. 3단계 이상이면 그 아래는 무시. 없으면 undefined. */
export function dflowSubFolderName(folderPath: FolderPathEntry[] | undefined): string | undefined {
  return folderPath && folderPath.length >= 2 ? folderPath[1].name : undefined
}

/**
 * §1.3: root 폴더명을 D'Flow meta.teams와 대조해 자동 판정된 team을 반환한다.
 * 불일치/폴더 없음이면 null(호출부가 select 노출).
 */
export function detectDflowTeam(folderPath: FolderPathEntry[] | undefined, teams: string[]): string | null {
  const root = dflowRootFolderName(folderPath)
  if (!root) return null
  return teams.includes(root) ? root : null
}

/**
 * §1.4: 전송 제목 자동 조립 "<하위폴더명>-<원제목>" (하위 없으면 원제목).
 * 200자 초과 시 원제목 쪽을 잘라 맞춘다(하위폴더명 접두는 보존).
 */
export function buildDflowTitle(folderPath: FolderPathEntry[] | undefined, title: string): string {
  const stripped = title.trim()
  const sub = dflowSubFolderName(folderPath)
  if (!sub) return stripped.slice(0, DFLOW_TITLE_MAX_LENGTH)

  const prefix = `${sub}-`
  const maxTitleLen = Math.max(0, DFLOW_TITLE_MAX_LENGTH - prefix.length)
  return prefix + stripped.slice(0, maxTitleLen)
}

/** UUID v4/v7 표기 형식(하이픈 포함 36자) 검증 — 계약 §4.3의 public_uid 형식. */
export const DFLOW_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidDflowUuid(value: string): boolean {
  return DFLOW_UUID_REGEX.test(value.trim())
}

const DDOBAK_EXTERNAL_ID_PREFIX = 'ddobak:'

export type DflowLinkAction =
  | { type: 'link'; publicUid: string }
  | { type: 'claim' }

/**
 * 계약 §10.2 A/B 분기: [D'Flow에서 찾기] 목록에서 항목 선택 시 연결 방식 결정.
 * external_id가 "ddobak:" 프리픽스면 그 uuid로 역주입(A/link). 그 외(null 포함, 다른 프리픽스 포함)는
 * 이 회의의 claim 대상으로 본다(B) — 프리픽스가 없거나 형식이 다른 값은 우리 서버가 발급한 것이
 * 아니므로 파싱을 시도하지 않고 claim으로 폴백해 서버 쪽 충돌 판정(409)에 맡긴다.
 */
export function resolveDflowLinkAction(externalId: string | null): DflowLinkAction {
  if (externalId && externalId.startsWith(DDOBAK_EXTERNAL_ID_PREFIX)) {
    return { type: 'link', publicUid: externalId.slice(DDOBAK_EXTERNAL_ID_PREFIX.length) }
  }
  return { type: 'claim' }
}
