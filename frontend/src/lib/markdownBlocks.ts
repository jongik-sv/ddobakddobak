/**
 * 마크다운 파서 공통 블록 유틸리티.
 *
 * pdfExporter.ts(markdownToHtml)와 markdownToDocx.ts(markdownToDocxParagraphs)가
 * 각자 재구현하던 마크다운 테이블 파싱 로직 중, 완전히 동일했던 부분만 추출한다.
 * 두 파일의 헤딩 레벨 범위(1~6 vs 1~3), 리스트/인용문 처리 방식은 서로 다르게
 * 발전해 있어 통합 시 동작이 갈릴 위험이 있으므로 블록 분류 전체를 공유하지 않고,
 * 테이블 구분선 판별과 셀 파싱만 공유한다.
 */

/**
 * 마크다운 테이블의 구분선(separator) 행인지 판별한다.
 * 예: `|---|---|`, `|:---|:---:|---:|`
 */
export function isTableSeparatorRow(row: string): boolean {
  return /^\|[\s:]*-{3,}[\s:]*(\|[\s:]*-{3,}[\s:]*)*\|?\s*$/.test(row.trim())
}

/**
 * 마크다운 테이블 행을 셀 문자열 배열로 분리한다.
 * 각 셀은 trim되며, 행 양끝의 `|` 경계로 생긴 빈 셀은 제거한다.
 * (예: `| a | b |` → `['a', 'b']`)
 */
export function parseTableCells(rowLine: string): string[] {
  return rowLine
    .split('|')
    .map((c) => c.trim())
    .filter((_, idx, arr) => !(idx === 0 && arr[0] === '') && !(idx === arr.length - 1 && arr[arr.length - 1] === ''))
}
