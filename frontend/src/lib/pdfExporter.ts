import type { MeetingExportData } from '../api/meetings'

// ── Public API ──────────────────────────────────

/**
 * MeetingExportData를 PDF Blob으로 변환한다.
 * html2pdf.js를 사용하여 HTML → PDF 변환을 수행한다.
 */
export async function generatePdf(data: MeetingExportData): Promise<Blob> {
  const html = renderExportHtml(data)
  const html2pdf = (await import('html2pdf.js')).default

  // wrapper: 사용자에게 안보이도록 숨김 (opacity: 0)
  // container: 실제 콘텐츠 (opacity 없음) → html2pdf가 이것만 복제
  const wrapper = document.createElement('div')
  wrapper.style.position = 'fixed'
  wrapper.style.left = '0'
  wrapper.style.top = '0'
  wrapper.style.zIndex = '-9999'
  wrapper.style.opacity = '0'
  wrapper.style.pointerEvents = 'none'

  const container = document.createElement('div')
  container.innerHTML = html
  container.style.width = '210mm'

  wrapper.appendChild(container)
  document.body.appendChild(wrapper)

  // Mermaid 블록을 SVG로 렌더링
  await renderMermaidBlocks(container)

  try {
    const blob: Blob = await html2pdf()
      .set({
        margin: [15, 15, 15, 15],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(container)
      .outputPdf('blob')
    return blob
  } finally {
    document.body.removeChild(wrapper)
  }
}

/**
 * 회의 ID와 날짜로 PDF 파일명을 생성한다.
 * 형식: meeting-{id}-{YYYY-MM-DD}.pdf
 */
export function buildPdfFilename(meetingId: number, date?: string | Date): string {
  const d = date ? new Date(date) : new Date()
  const dateStr = d.toISOString().slice(0, 10)
  return `meeting-${meetingId}-${dateStr}.pdf`
}

// ── Mermaid SVG 렌더링 ─────────────────────────

async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const blocks = container.querySelectorAll<HTMLElement>('.mermaid-render')
  if (blocks.length === 0) return

  try {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false, theme: 'default' })

    for (let idx = 0; idx < blocks.length; idx++) {
      const el = blocks[idx]!
      const code = el.getAttribute('data-code') ?? ''
      if (!code.trim()) continue

      try {
        const id = `pdf-mmd-${idx}-${Date.now()}`
        const { svg } = await mermaid.render(id, code.trim())
        el.innerHTML = svg
        el.classList.remove('mermaid-render')
        // SVG가 페이지 폭을 넘지 않도록 제한
        const svgEl = el.querySelector('svg')
        if (svgEl) {
          svgEl.style.maxWidth = '100%'
          svgEl.style.height = 'auto'
        }
      } catch {
        // 렌더링 실패 시 코드 블록으로 fallback
        el.innerHTML = `<pre style="background:#f5f5f5;padding:8px;border-radius:4px;font-size:9pt;white-space:pre-wrap;word-break:break-word;"><code>${esc(code)}</code></pre>`
        el.classList.remove('mermaid-render')
      }
    }
    // mermaid.render가 body에 남기는 잔여 요소 정리
    document.querySelectorAll('[id^="dpdf-mmd-"]').forEach((el) => el.remove())
  } catch {
    // mermaid 로드 실패 시 모든 블록을 플레이스홀더로 대체
    blocks.forEach((el) => {
      el.textContent = '[Mermaid 다이어그램 렌더링 실패]'
    })
  }
}

// ── HTML Renderer ───────────────────────────────

const FONT_STACK =
  "-apple-system, 'Apple SD Gothic Neo', 'Pretendard', 'Noto Sans KR', 'Malgun Gothic', sans-serif"

const BASE_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: ${FONT_STACK};
    font-size: 11pt;
    line-height: 1.6;
    color: #222;
    margin: 0;
    padding: 0;
  }
  h1 { font-size: 18pt; font-weight: bold; margin: 0 0 8px 0; }
  h2 { font-size: 14pt; font-weight: bold; margin: 20px 0 8px 0; }
  h3 { font-size: 12pt; font-weight: bold; margin: 16px 0 6px 0; }
  h4, h5, h6 { font-size: 11pt; font-weight: bold; margin: 12px 0 4px 0; }
  hr { border: none; border-top: 1px solid #ccc; margin: 16px 0; }
  ul, ol { padding-left: 24px; margin: 4px 0; }
  li { margin-bottom: 4px; }
  p { margin: 6px 0; }
  strong { font-weight: bold; }
  em { font-style: italic; }
  code {
    background: #f5f5f5;
    padding: 1px 4px;
    border-radius: 3px;
    font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
    font-size: 10pt;
  }
  pre {
    background: #f5f5f5;
    padding: 10px 12px;
    border-radius: 4px;
    border: 1px solid #e0e0e0;
    font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
    font-size: 9pt;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
    word-break: break-all;
    overflow: hidden;
    margin: 8px 0;
    max-width: 100%;
  }
  pre code {
    background: none;
    padding: 0;
    font-size: inherit;
  }
  blockquote {
    border-left: 3px solid #ddd;
    padding-left: 12px;
    font-style: italic;
    color: #666;
    margin: 8px 0;
  }
  .metadata-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
    font-size: 10pt;
  }
  .metadata-table td {
    padding: 4px 8px;
    vertical-align: top;
  }
  .metadata-table td:first-child {
    font-weight: bold;
    color: #555;
    width: 80px;
    white-space: nowrap;
  }
  .action-list {
    list-style: none;
    padding-left: 0;
  }
  .action-list li {
    margin-bottom: 6px;
  }
  .action-meta {
    font-size: 9pt;
    color: #888;
    margin-left: 4px;
  }
  .transcript-entry {
    margin-bottom: 12px;
  }
  .transcript-speaker {
    font-weight: bold;
  }
  .transcript-time {
    color: #888;
    font-size: 9pt;
    margin-left: 6px;
  }
  .transcript-content {
    margin-top: 2px;
  }
  .mermaid-render {
    text-align: center;
    margin: 12px 0;
    overflow: hidden;
  }
  .mermaid-render svg {
    max-width: 100%;
    height: auto;
  }
  .md-table-wrapper {
    width: 100%;
    overflow: hidden;
    margin: 8px 0;
  }
  .md-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10pt;
    table-layout: fixed;
  }
  .md-table th, .md-table td {
    border: 1px solid #ccc;
    padding: 6px 10px;
    text-align: left;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .md-table th {
    background: #f0f0f0;
    font-weight: bold;
  }
  .code-lang {
    display: block;
    font-size: 8pt;
    color: #999;
    margin-bottom: 4px;
    font-family: ${FONT_STACK};
  }
`

function renderExportHtml(data: MeetingExportData): string {
  const parts: string[] = []

  // Title
  parts.push(`<h1>${esc(data.meeting.title)}</h1>`)

  // Metadata
  parts.push(renderMetadata(data.meeting))
  parts.push('<hr>')

  // Summary
  if (data.summary) {
    parts.push(renderSummary(data.summary))
  }

  // Memo
  if (data.memo) {
    parts.push(`<h2>메모</h2>\n<p>${esc(data.memo).replace(/\n/g, '<br>')}</p>`)
  }

  // Action Items
  if (data.action_items?.length > 0) {
    parts.push(renderActionItems(data.action_items))
  }

  // Transcripts
  if (data.transcripts?.length > 0) {
    parts.push(renderTranscripts(data.transcripts))
  }

  return `<div style="font-family: ${FONT_STACK}; font-size: 11pt; line-height: 1.6; color: #222;">
<style>${BASE_STYLES}</style>
${parts.join('\n')}
</div>`
}

// ── Section Renderers ───────────────────────────

function renderMetadata(meeting: MeetingExportData['meeting']): string {
  const statusMap: Record<string, string> = {
    pending: '대기 중',
    recording: '녹음 중',
    transcribing: '변환 중',
    completed: '완료',
  }
  const status = statusMap[meeting.status] ?? meeting.status

  return `<table class="metadata-table">
  <tr><td>날짜</td><td>${esc(meeting.date)}</td></tr>
  <tr><td>시간</td><td>${esc(meeting.start_time)} ~ ${esc(meeting.end_time)}</td></tr>
  <tr><td>상태</td><td>${esc(status)}</td></tr>
  <tr><td>작성자</td><td>${esc(meeting.creator_name)}</td></tr>
</table>`
}

function renderSummary(summary: MeetingExportData['summary']): string {
  if (!summary) return ''

  if (summary.type === 'notes_markdown' && summary.notes_markdown) {
    return `<h2>회의록</h2>\n${markdownToHtml(summary.notes_markdown)}`
  }

  // json_fields
  const sections: string[] = []
  sections.push('<h2>회의 요약</h2>')

  if (summary.key_points && summary.key_points.length > 0) {
    sections.push('<h3>핵심 포인트</h3>')
    sections.push(renderBulletList(summary.key_points))
  }

  if (summary.decisions && summary.decisions.length > 0) {
    sections.push('<h3>결정 사항</h3>')
    sections.push(renderBulletList(summary.decisions))
  }

  if (summary.discussion_details && summary.discussion_details.length > 0) {
    sections.push('<h3>논의 내용</h3>')
    sections.push(renderBulletList(summary.discussion_details))
  }

  return sections.join('\n')
}

function renderBulletList(items: string[]): string {
  const lis = items.map((item) => `  <li>${esc(item)}</li>`).join('\n')
  return `<ul>\n${lis}\n</ul>`
}

function renderActionItems(items: MeetingExportData['action_items']): string {
  const lis = items
    .map((item) => {
      const checked = item.status === 'completed'
      const prefix = checked ? '☑' : '☐'
      const meta: string[] = []
      if (item.assignee_name) meta.push(item.assignee_name)
      if (item.due_date) meta.push(`기한: ${item.due_date}`)
      const metaStr = meta.length > 0 ? ` <span class="action-meta">(${esc(meta.join(' / '))})</span>` : ''
      return `  <li>${prefix} ${esc(item.content)}${metaStr}</li>`
    })
    .join('\n')

  return `<h2>실행 항목</h2>\n<ul class="action-list">\n${lis}\n</ul>`
}

function renderTranscripts(transcripts: MeetingExportData['transcripts']): string {
  const entries = transcripts
    .map(
      (t) =>
        `<div class="transcript-entry">` +
        `<span class="transcript-speaker">${esc(t.speaker_label)}</span>` +
        `<span class="transcript-time">${esc(t.timestamp)}</span>` +
        `<div class="transcript-content">${esc(t.content)}</div>` +
        `</div>`,
    )
    .join('\n')

  return `<h2>전사 기록</h2>\n${entries}`
}

// ── Markdown → HTML 변환기 ──────────────────────

/**
 * Markdown → HTML 변환기.
 * 지원: 헤딩, 볼드, 이탤릭, 인라인 코드, 코드 블록(언어 표시),
 *        Mermaid SVG 렌더링, 테이블, 불릿/번호 리스트, 체크박스,
 *        인용, 수평선, 링크, 이미지, 취소선
 */
function markdownToHtml(md: string): string {
  const lines = md.split('\n')
  const output: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // Fenced code block (``` or ~~~)
    const fenceMatch = line.match(/^(`{3,}|~{3,})(\w*)/)
    if (fenceMatch) {
      const fence = fenceMatch[1]!
      const lang = fenceMatch[2] ?? ''
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith(fence)) {
        codeLines.push(lines[i]!)
        i++
      }
      i++ // skip closing fence

      const code = codeLines.join('\n')

      if (lang.toLowerCase() === 'mermaid') {
        // data-code 속성에 Mermaid 코드를 저장 → generatePdf에서 SVG로 변환
        output.push(`<div class="mermaid-render" data-code="${escAttr(code)}"></div>`)
      } else {
        const langLabel = lang ? `<span class="code-lang">${esc(lang)}</span>` : ''
        output.push(`<pre>${langLabel}<code>${esc(code)}</code></pre>`)
      }
      continue
    }

    // Blank line
    if (line.trim() === '') {
      i++
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      output.push('<hr>')
      i++
      continue
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/)
    if (headingMatch) {
      const level = headingMatch[1]!.length
      output.push(`<h${level}>${inlineMarkdown(headingMatch[2]!)}</h${level}>`)
      i++
      continue
    }

    // Blockquote
    if (line.startsWith('> ') || line === '>') {
      const quoteLines: string[] = []
      while (i < lines.length && (lines[i]!.startsWith('> ') || lines[i] === '>')) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ''))
        i++
      }
      output.push(`<blockquote>${inlineMarkdown(quoteLines.join('<br>'))}</blockquote>`)
      continue
    }

    // Checkbox list item
    const checkMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)/)
    if (checkMatch) {
      const listItems: string[] = []
      while (i < lines.length) {
        const cm = lines[i]!.match(/^[-*]\s+\[([ xX])\]\s+(.*)/)
        if (!cm) break
        const checked = cm[1] !== ' '
        const prefix = checked ? '☑' : '☐'
        listItems.push(`  <li>${prefix} ${inlineMarkdown(cm[2]!)}</li>`)
        i++
      }
      output.push(`<ul class="action-list">\n${listItems.join('\n')}\n</ul>`)
      continue
    }

    // Unordered list
    if (/^[-*+]\s+/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i]!)) {
        listItems.push(`  <li>${inlineMarkdown(lines[i]!.replace(/^[-*+]\s+/, ''))}</li>`)
        i++
      }
      output.push(`<ul>\n${listItems.join('\n')}\n</ul>`)
      continue
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        listItems.push(`  <li>${inlineMarkdown(lines[i]!.replace(/^\d+\.\s+/, ''))}</li>`)
        i++
      }
      output.push(`<ol>\n${listItems.join('\n')}\n</ol>`)
      continue
    }

    // Markdown table
    if (line.trimStart().startsWith('|')) {
      const tableRows: string[][] = []
      let hasHeader = false

      while (i < lines.length && lines[i]!.trimStart().startsWith('|')) {
        const row = lines[i]!.trim()
        // separator row (|---|---|)
        if (/^\|[\s:]*-{3,}[\s:]*(\|[\s:]*-{3,}[\s:]*)*\|?\s*$/.test(row)) {
          hasHeader = tableRows.length > 0
          i++
          continue
        }
        const cells = row
          .split('|')
          .map((c) => c.trim())
          .filter((_, idx, arr) => !(idx === 0 && arr[0] === '') && !(idx === arr.length - 1 && arr[arr.length - 1] === ''))
        tableRows.push(cells)
        i++
      }

      if (tableRows.length > 0) {
        const headerRow = hasHeader ? tableRows[0]! : null
        const bodyRows = hasHeader ? tableRows.slice(1) : tableRows
        let html = '<div class="md-table-wrapper"><table class="md-table">'
        if (headerRow) {
          html += '<thead><tr>'
          for (const cell of headerRow) {
            html += `<th>${inlineMarkdown(cell)}</th>`
          }
          html += '</tr></thead>'
        }
        html += '<tbody>'
        for (const row of bodyRows) {
          html += '<tr>'
          for (const cell of row) {
            html += `<td>${inlineMarkdown(cell)}</td>`
          }
          html += '</tr>'
        }
        html += '</tbody></table></div>'
        output.push(html)
      }
      continue
    }

    // Normal paragraph
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.match(/^(#{1,6}\s|[-*+]\s|>\s|\d+\.\s|```|~~~|---|___|\*\*\*|\|)/)
    ) {
      paraLines.push(lines[i]!)
      i++
    }
    if (paraLines.length > 0) {
      output.push(`<p>${inlineMarkdown(paraLines.join('<br>'))}</p>`)
    }
  }

  return output.join('\n')
}

/**
 * 인라인 Markdown 요소를 HTML로 변환한다.
 * 지원: inline code, bold+italic, bold, italic, strikethrough, image, link
 */
function inlineMarkdown(text: string): string {
  let result = esc(text)

  // Inline code (`` ` ``) — 가장 먼저 처리하여 내부 서식 변환 방지
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Bold + Italic (***text*** or ___text___)
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  result = result.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')

  // Bold (**text** or __text__)
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>')

  // Italic (*text* or _text_)
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>')
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>')

  // Strikethrough (~~text~~)
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>')

  // Images (![alt](url))
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">')

  // Links ([text](url))
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Restore <br> that was escaped
  result = result.replace(/&lt;br&gt;/g, '<br>')

  return result
}

// ── Utilities ───────────────────────────────────

/** HTML 특수문자를 이스케이프한다. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** HTML 속성값을 이스케이프한다. (data-* 속성용) */
function escAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '&#10;')
}
