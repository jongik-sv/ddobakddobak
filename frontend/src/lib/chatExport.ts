/**
 * AI 챗 답변 내보내기 — 인용 마커를 제거한 순수 마크다운으로 변환·저장한다.
 * (idea.md 33: "md 파일 저장도 되면 좋겠다. 물론 마커는 빼고 파일로 저장해야된다.")
 */
import { FOLDER_CITATION_RE, stripCitationMarkers } from './citationMarkers'
import { downloadText } from './download'

// <br>/<br/>/<br />, 대소문자 무관, 인라인(문장 중간) 포함.
const BR_TAG_RE = /<br\s*\/?\s*>/gi

// 펜스 시작/끝 라인 판정(```  또는 ~~~, 3개 이상, 앞 공백 허용). GFM처럼 완전히
// 엄밀하진 않지만(중첩·들여쓰기 규칙 등은 다루지 않음) 이 용도엔 충분.
const FENCE_RE = /^\s*(`{3,}|~{3,})/

/**
 * 펜스 코드블록(``` / ~~~ 라인 경계) 내부와 인라인 코드(백틱 스팬) 내부의 `<br>` 리터럴은
 * 보존하고, 그 외 위치의 `<br>`만 개행으로 치환한다.
 * 렌더러(ChatMarkdown.tsx의 rehypeChatBr)는 마크다운 파서가 code/pre로 파싱한 내용은
 * raw 노드로 넘기지 않으므로 코드 내부 `<br>`를 건드리지 않는다 — 저장 시에도 동일하게
 * 보존해야 렌더/저장이 어긋나지 않는다.
 * 라인 단위로 펜스 상태를 추적하고, 펜스 밖에서는 백틱 런(run) 길이를 매칭해 인라인
 * 코드 스팬을 판정한다(상세는 replaceBrOutsideInlineCode 참고) — 중첩 펜스, 이스케이프된
 * 백틱 등 예외 케이스는 다루지 않는다.
 */
function replaceBrOutsideCode(text: string): string {
  let inFence = false
  let fenceChar = ''
  const lines = text.split('\n').map((line) => {
    const fenceMatch = FENCE_RE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (!inFence) {
        inFence = true
        fenceChar = marker
      } else if (marker === fenceChar) {
        inFence = false
        fenceChar = ''
      }
      // 펜스 여는/닫는 라인 자체는 치환 대상에서 제외(언어 지정자 등만 있음).
      return line
    }
    if (inFence) return line
    return replaceBrOutsideInlineCode(line)
  })
  return lines.join('\n')
}

// 백틱 연속(run) 매칭용.
const BACKTICK_RUN_RE = /`+/g

/**
 * 라인에서 인라인 코드 스팬(백틱 런) 밖의 `<br>`만 개행으로 치환한다.
 * CommonMark 코드 스팬 규칙처럼 같은 길이의 백틱 런끼리만 스팬을 여닫는 것으로 취급한다
 * (예: `` ` `` 안에 단일 백틱이 섞여 있어도 다음에 오는 같은 길이(2개)의 런이 닫는다).
 * 왼쪽부터 순서대로 매칭하며, 열렸지만 닫히지 않은 런은 코드 스팬이 아닌 것으로
 * 간주해 그 뒤도 일반 텍스트로 취급한다(관대한 처리).
 */
function replaceBrOutsideInlineCode(line: string): string {
  const runs: Array<{ start: number; end: number; length: number }> = []
  let match: RegExpExecArray | null
  BACKTICK_RUN_RE.lastIndex = 0
  while ((match = BACKTICK_RUN_RE.exec(line)) !== null) {
    runs.push({ start: match.index, end: match.index + match[0].length, length: match[0].length })
  }

  const codeRanges: Array<[number, number]> = []
  let i = 0
  while (i < runs.length) {
    let closeIdx = -1
    for (let j = i + 1; j < runs.length; j++) {
      if (runs[j].length === runs[i].length) {
        closeIdx = j
        break
      }
    }
    if (closeIdx === -1) {
      // 매칭되는 닫는 런이 없음 — 코드 스팬이 아닌 리터럴 백틱으로 취급.
      i += 1
      continue
    }
    codeRanges.push([runs[i].start, runs[closeIdx].end])
    i = closeIdx + 1
  }

  if (codeRanges.length === 0) {
    return line.replace(BR_TAG_RE, '\n')
  }

  let result = ''
  let cursor = 0
  for (const [start, end] of codeRanges) {
    result += line.slice(cursor, start).replace(BR_TAG_RE, '\n')
    result += line.slice(start, end)
    cursor = end
  }
  result += line.slice(cursor).replace(BR_TAG_RE, '\n')
  return result
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 챗 답변 원문(인용 마커 포함)을 저장용 순수 마크다운으로 변환한다.
 * - 인용 마커(인라인 ⟦t:.../s:...⟧ + 크로스미팅 ⟦m:.../t:.../s:...⟧) 전부 제거.
 *   FOLDER_CITATION_RE를 먼저 제거해야 CITATION_RE 오매칭을 피한다(ChatMarkdown의
 *   markersToSeekLinks와 동일한 순서 규칙).
 * - <br> 계열 리터럴을 실제 개행으로 치환 (단, 코드블록·인라인 코드 내부는 보존 — 렌더러와 동일 규칙).
 * - 그 외 마크다운 문법(코드블록, 표, mermaid 펜스 등)은 원본 그대로 보존.
 * - 끝은 개행 1개로 정리.
 */
export function chatAnswerToMarkdown(content: string): string {
  const withoutFolderMarkers = content.replace(new RegExp(FOLDER_CITATION_RE.source, 'g'), '')
  // stripCitationMarkers가 인라인 마커 제거 + 그로 인해 생긴 줄끝(개행 직전/문자열 끝) 잉여
  // 공백 정리를 함께 처리한다. 폴더 마커 제거로 생긴 잉여 공백도 이 시점에 같이 정리된다.
  const withoutMarkers = stripCitationMarkers(withoutFolderMarkers)
  const withNewlines = replaceBrOutsideCode(withoutMarkers)
  return withNewlines.replace(/\s+$/, '') + '\n'
}

/** 로컬 시각 기준 `ai-answer-YYYYMMDD-HHmmss.md` 파일명. */
function buildFilename(now: Date): string {
  const y = now.getFullYear()
  const mo = pad2(now.getMonth() + 1)
  const d = pad2(now.getDate())
  const h = pad2(now.getHours())
  const mi = pad2(now.getMinutes())
  const s = pad2(now.getSeconds())
  return `ai-answer-${y}${mo}${d}-${h}${mi}${s}.md`
}

/** 챗 답변을 마커 제거된 .md 파일로 다운로드한다(브라우저 anchor / Tauri 저장 다이얼로그 자동 분기). */
export async function downloadChatAnswer(content: string): Promise<void> {
  const markdown = chatAnswerToMarkdown(content)
  const filename = buildFilename(new Date())
  await downloadText(markdown, filename, 'text/markdown;charset=utf-8')
}
