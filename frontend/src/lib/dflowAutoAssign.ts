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
 * 불일치/폴더 없음이면 null — 이는 **실패가 아니라 team 선택이 필요하다는 신호**다
 * (자유 루트 전송 자체는 막지 않는다 — 호출부가 select를 노출해 사용자가 고른 값을
 * team_override로 실어 보내면 그대로 성공한다. ddobak-W3 확정: 워크리스트 §11.3⑤).
 */
export function detectDflowTeam(folderPath: FolderPathEntry[] | undefined, teams: string[]): string | null {
  const root = dflowRootFolderName(folderPath)
  if (!root) return null
  return teams.includes(root) ? root : null
}

/** §2-C: D'Flow가 깊이 5 초과 편철 경로를 조용히 절단하는 한도(400 아님) — 사전 경고 전용, 차단 금지. */
export const DFLOW_MAX_FOLDER_DEPTH = 5

/**
 * "루트가 이번 전송에 실제로 쓰일 team인가"의 단일 소스(single source of truth).
 * 단순히 root가 meta.teams 어딘가에 있는지가 아니라 **이번 전송에서 실제로 쓰일 team**과 root
 * 이름의 일치로 판정한다 — 정본(decisions-final-2026-07-27.md §2-C)이 "경고는 teamOverride
 * 확정 이후 재평가"라 못박은 이유가 이것이다: root 이름이 meta.teams에 있는 team이어도, 그
 * team이 이번 전송에서 무효화돼(예: team_required 재시도) 사용자가 **다른** team을 골랐다면
 * D'Flow는 root를 팀 루트로 보지 않고 team 폴더를 한 단 더 끼워 넣는다.
 *
 * dflowEffectiveFolderDepth(깊이 경고, W4)와 dflowFolderPreviewPath(편철 경로 미리보기, W7)가
 * 반드시 이 함수 하나를 공유해야 한다 — 사본을 두면 경고와 미리보기가 서로 다른 말을 하게 된다.
 */
export function dflowRootIsResolvedTeamRoot(
  folderPath: FolderPathEntry[] | undefined,
  resolvedTeam: string | null
): boolean {
  const root = dflowRootFolderName(folderPath)
  return !!resolvedTeam && root === resolvedTeam
}

/**
 * §2-C 계산식(decisions-final-2026-07-27.md §2-C — D'Flow 코드와 일치 확인됨):
 *   folder_path.length + (루트가 팀코드면 0, 아니면 1)
 * resolvedTeam은 호출부가 자동 판정(detectDflowTeam) 또는 select 확정값 중 이번에 실제로
 * 보낼 값을 넘긴다 — 미확정이면 null(보수적으로 +1, 즉 아직 정해지지 않은 동안은 경고 쪽으로
 * 기운다). "루트가 팀코드인가" 판정은 dflowRootIsResolvedTeamRoot 하나를 공유한다(위 설명).
 */
export function dflowEffectiveFolderDepth(
  folderPath: FolderPathEntry[] | undefined,
  resolvedTeam: string | null
): number {
  const names = folderPath ?? []
  return names.length + (dflowRootIsResolvedTeamRoot(folderPath, resolvedTeam) ? 0 : 1)
}

/**
 * W7: 다이얼로그 미리보기용 편철 경로 세그먼트("MES / 품질 / 주간정례"로 조인해 표시).
 * root가 이번 전송에 실제로 쓸 team이 아니면(dflowRootIsResolvedTeamRoot === false) team이
 * 맨 앞에 한 칸 끼어든 모습을 그대로 보여준다(정규화 ② 한 칸 내림 — "MES / 신규TF / 킥오프").
 * resolvedTeam이 미확정(null)이면 team을 붙이지 않는다 — 아직 어디로 갈지 판정할 수 없어서다.
 *
 * ⚠️ 이것은 "절단 전" 경로다. 깊이 5 초과분은 D'Flow가 무통보로 절단해 다른 경로에 안착한다
 * (정본 §2-C, 절단 유지 확정) — 최종 저장 위치를 대신하지 않는다. 최종 확인은 W8의 응답 에코
 * (`folder_path_status`)의 몫이며, 여기서는 흉내내지 않는다.
 */
export function dflowFolderPreviewPath(
  folderPath: FolderPathEntry[] | undefined,
  resolvedTeam: string | null
): string[] {
  const names = (folderPath ?? []).map((entry) => entry.name)
  if (dflowRootIsResolvedTeamRoot(folderPath, resolvedTeam)) return names
  return resolvedTeam ? [resolvedTeam, ...names] : names
}

/**
 * 위 실효 깊이가 D'Flow 절단 한도(5)를 넘는지 — **차단용이 아니라 사전 경고 노출 여부 판정용**이다.
 * 절단은 D'Flow 쪽 동작(정본 §2-C 확정)이고 또박또박은 경고만 띄운다.
 */
export function dflowFolderDepthExceedsWarningLimit(
  folderPath: FolderPathEntry[] | undefined,
  resolvedTeam: string | null
): boolean {
  return dflowEffectiveFolderDepth(folderPath, resolvedTeam) > DFLOW_MAX_FOLDER_DEPTH
}

/**
 * §1.4: 전송 제목 자동 조립. 원제목 그대로(200자 캡) — folder_path로 실제 폴더에 편철되므로
 * 하위폴더명 접두를 붙이면 이중 라벨이 된다(워크리스트 §4 W6). 접두 버전은
 * buildDflowLegacyPrefixedTitle 로 분리 보존.
 */
export function buildDflowTitle(title: string): string {
  return title.trim().slice(0, DFLOW_TITLE_MAX_LENGTH)
}

/**
 * (레거시) §1.4 원래 규칙: "<하위폴더명>-<원제목>" (하위 없으면 원제목).
 * 200자 초과 시 원제목 쪽을 잘라 맞춘다(하위폴더명 접두는 보존).
 * buildDflowTitle 에서 접두를 걷어낸 뒤에도 보존한다 — 자동 링크 매칭(워크리스트 §7.7 C2)이
 * 기존 연동의 접두 있는 D'Flow 제목을 재현·비교해야 할 수 있어서다.
 */
export function buildDflowLegacyPrefixedTitle(folderPath: FolderPathEntry[] | undefined, title: string): string {
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
