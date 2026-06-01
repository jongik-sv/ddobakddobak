/**
 * sttModeResolver - 활성 STT 모드 결정 (순수 함수, I/O 없음)
 *
 * 온디바이스(로컬) STT 로컬모드 통합의 일부.
 * 서버 STT와 로컬(Android 온디바이스) STT 중 어느 쪽을 사용할지
 * 사용자 수동 선택 + 서버 도달성 + 로컬 가용성 조합으로 결정한다.
 *
 * 진리표:
 *   manual='local'  & localCapable      -> 'local'
 *   manual='local'  & !localCapable     -> 'server' (불가 시 폴백)
 *   manual='server'                     -> 'server' (무조건)
 *   manual='auto'   & !reachable & cap. -> 'local'  (오프라인 폴백)
 *   manual='auto'   & 그 외             -> 'server'
 *
 * 부수효과 없음: probeUrl(serverReachable) 호출 및 localCapable 판정
 * (Android && 모델 present && lang∈Cohere8 && single speaker)은
 * 호출 측(외부)에서 계산해 입력으로 전달한다.
 */

/** 사용자가 수동으로 고를 수 있는 STT 모드. 'auto'는 자동 결정. */
export type SttManualMode = 'server' | 'local' | 'auto'

/** 최종적으로 실행되는 STT 모드(자동 결정의 결과). */
export type SttActiveMode = 'server' | 'local'

/**
 * 모드 결정의 사유. 상태바 표시 및 디버깅용.
 * - 'manual'          : 사용자가 명시한 모드를 그대로 사용
 * - 'auto-offline'    : auto 모드에서 서버 미도달 → 로컬 폴백
 * - 'auto-online'     : auto 모드에서 서버 도달 가능 → 서버 사용
 * - 'local-incapable' : local 요청했으나 로컬 불가 → 서버 폴백
 */
export type SttModeReason =
  | 'manual'
  | 'auto-offline'
  | 'auto-online'
  | 'local-incapable'

export interface SttModeResolverInput {
  /** 사용자가 선택한 모드. */
  manualMode: SttManualMode
  /** probeUrl 결과(호출은 외부). 서버에 도달 가능한가. */
  serverReachable: boolean
  /** 로컬 STT 실행 가능 여부: Android && 모델 present && lang∈Cohere8 && single speaker. */
  localCapable: boolean
}

export interface SttModeResolution {
  /** 실제 실행할 모드. */
  mode: SttActiveMode
  /** 그 모드가 선택된 사유(표시/로깅용). */
  reason: SttModeReason
}

/**
 * 활성 STT 모드와 사유를 함께 결정한다.
 * 순수 함수: 동일 입력 → 동일 출력, 부수효과 없음.
 */
export function resolveSttModeWithReason(
  input: SttModeResolverInput,
): SttModeResolution {
  const { manualMode, serverReachable, localCapable } = input

  switch (manualMode) {
    case 'local':
      return localCapable
        ? { mode: 'local', reason: 'manual' }
        : { mode: 'server', reason: 'local-incapable' }

    case 'server':
      return { mode: 'server', reason: 'manual' }

    case 'auto':
      // 서버 미도달 + 로컬 가용 → 로컬 폴백. 그 외에는 서버.
      if (!serverReachable && localCapable) {
        return { mode: 'local', reason: 'auto-offline' }
      }
      return { mode: 'server', reason: 'auto-online' }
  }
}

/**
 * 활성 STT 모드만 반환하는 간편 함수.
 * 사유가 필요하면 {@link resolveSttModeWithReason}를 사용한다.
 */
export function resolveSttMode(input: SttModeResolverInput): SttActiveMode {
  return resolveSttModeWithReason(input).mode
}
