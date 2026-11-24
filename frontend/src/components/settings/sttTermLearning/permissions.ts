import { getMode } from '../../../config'
import { useAuthStore } from '../../../stores/authStore'
import { useProjectStore } from '../../../stores/projectStore'

/** 전역 레벨을 바꿀 수 있는가 — 시스템 관리자(또는 로컬 모드)만. 프로젝트 관리자는 전역을 읽기만 한다. */
export function useCanWriteGlobal(): boolean {
  const role = useAuthStore((s) => s.user?.role)
  return role === 'admin' || getMode() === 'local'
}

/** 관리자인 팀 프로젝트가 1개 이상인가 — 프로젝트 목록(role 포함)에서 파생.
 *  개인(personal) 프로젝트는 가입 시 본인이 admin 으로 자동 생성되므로 제외한다(서버 AdminScope 도 제외). */
export function useManagesAnyProject(): boolean {
  return useProjectStore((s) => s.projects.some((p) => p.role === 'admin' && !p.personal))
}
