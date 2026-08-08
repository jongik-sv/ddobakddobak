import { useEffect, useRef } from 'react'
import type { SetURLSearchParams } from 'react-router-dom'

/**
 * URL 쿼리스트링 파라미터를 1회만 소비하는 공용 패턴 — 전역 검색에서 넘어온 ?q=,
 * 챗 인용 클릭으로 넘어온 ?t=<ms> 등, "진입 시 자동 적용 후 URL에서 제거"하는
 * 케이스가 반복돼 추출했다. 적용 후 파라미터를 제거(replace)해 새로고침/뒤로가기
 * 시 재발동을 막는다.
 *
 * @param parse   raw 쿼리 문자열을 원하는 타입으로 변환. 값이 없거나 유효하지 않으면
 *                undefined를 반환 — 이후 값이 바뀌길(ready 조건 등) 기다리며 재시도한다.
 * @param ready   parse가 유효값을 반환해도 아직 적용할 준비가 안 됐으면(예: 오디오 로딩 전) false.
 * @param onApply parse된 값을 실제로 적용하는 콜백. 호출 직후 파라미터가 URL에서 제거된다.
 */
export function useConsumeSearchParamOnce<T>(
  searchParams: URLSearchParams,
  setSearchParams: SetURLSearchParams,
  paramName: string,
  parse: (raw: string) => T | undefined,
  ready: boolean,
  onApply: (value: T) => void
) {
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current) return
    const raw = searchParams.get(paramName)
    if (raw === null) return
    const value = parse(raw)
    if (value === undefined) return
    if (!ready) return
    applied.current = true
    onApply(value)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete(paramName)
        return next
      },
      { replace: true }
    )
  }, [searchParams, setSearchParams, paramName, parse, ready, onApply])
}
