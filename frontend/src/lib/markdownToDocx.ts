import {
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  TableLayoutType,
  BorderStyle,
  WidthType,
  ShadingType,
  ImageRun,
} from 'docx'

/**
 * Mermaid 코드를 SVG → PNG(ArrayBuffer)로 변환한다.
 * 실패 시 null을 반환한다.
 */
async function renderMermaidToImage(
  code: string,
  idx: number,
): Promise<{ buffer: ArrayBuffer; width: number; height: number } | null> {
  try {
    const mermaid = (await import('mermaid')).default
    const html2canvas = (await import('html2canvas')).default

    mermaid.initialize({ startOnLoad: false, theme: 'default' })

    const id = `docx-mmd-${idx}-${Date.now()}`
    console.log('[DOCX-MERMAID] rendering idx=', idx)
    const { svg } = await mermaid.render(id, code.trim())

    // SVG를 숨겨진 DOM 컨테이너에 삽입 (충분한 폭 확보)
    const container = document.createElement('div')
    container.style.position = 'fixed'
    container.style.left = '0'
    container.style.top = '0'
    container.style.width = '800px'
    container.style.zIndex = '-9999'
    container.style.background = 'white'
    container.style.padding = '16px'
    container.innerHTML = svg
    // SVG를 컨테이너 폭에 맞게 확장
    const svgEl = container.querySelector('svg')
    if (svgEl) {
      svgEl.style.width = '100%'
      svgEl.style.height = 'auto'
    }
    document.body.appendChild(container)

    // html2canvas로 DOM 요소를 직접 캡처 (Image 요소 우회)
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff' })
    document.body.removeChild(container)

    // 잔여 DOM 요소 정리
    document.querySelectorAll(`[id^="d${id}"]`).forEach((el) => el.remove())

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    )
    const buffer = await blob.arrayBuffer()

    const natW = canvas.width / 2
    const natH = canvas.height / 2
    const maxWidth = 600
    const ratio = Math.min(maxWidth / natW, 1)

    console.log('[DOCX-MERMAID] captured, size=', natW, 'x', natH)
    return { buffer, width: Math.round(natW * ratio), height: Math.round(natH * ratio) }
  } catch (err) {
    console.error('[DOCX-MERMAID] render failed:', err)
    return null
  }
}

/**
 * Markdown 텍스트를 docx Paragraph/Table 배열로 변환한다.
 * Mermaid 블록은 SVG → PNG 이미지로 렌더링한다.
 */
export async function markdownToDocxParagraphs(markdown: string): Promise<(Paragraph | Table)[]> {
  const lines = markdown.split('\n')
  const paragraphs: (Paragraph | Table)[] = []

  let inCodeBlock = false
  let isMermaidBlock = false
  let codeBlockLang = ''
  let codeLines: string[] = []
  let i = 0
  let mermaidIdx = 0

  while (i < lines.length) {
    const line = lines[i]!

    // ── 코드 블록 경계 ──
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        const langMatch = line.match(/^```(\w*)/)
        codeBlockLang = langMatch?.[1] ?? ''
        isMermaidBlock = codeBlockLang.toLowerCase() === 'mermaid'
        codeLines = []
        i++
        continue
      }

      // 코드 블록 종료
      inCodeBlock = false
      const code = codeLines.join('\n')

      if (isMermaidBlock) {
        const img = await renderMermaidToImage(code, mermaidIdx++)
        if (img) {
          paragraphs.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  data: img.buffer,
                  transformation: { width: img.width, height: img.height },
                  type: 'png',
                }),
              ],
            }),
          )
        } else {
          // 렌더링 실패 시 코드 블록으로 fallback
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: '[Mermaid] ',
                  bold: true,
                  color: '888888',
                  font: 'Courier New',
                  size: 18,
                }),
              ],
            }),
          )
          for (const codeLine of codeLines) {
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({ text: codeLine, font: 'Courier New', size: 18 }),
                ],
              }),
            )
          }
        }
      } else {
        // 일반 코드 블록 — 언어 라벨 + 코드
        if (codeBlockLang) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: codeBlockLang,
                  font: 'Courier New',
                  size: 16,
                  color: '999999',
                  italics: true,
                }),
              ],
            }),
          )
        }
        for (const codeLine of codeLines) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: codeLine || ' ',
                  font: 'Courier New',
                  size: 18, // 9pt
                }),
              ],
              shading: { fill: 'F5F5F5', type: ShadingType.CLEAR, color: 'auto' },
            }),
          )
        }
      }
      isMermaidBlock = false
      codeBlockLang = ''
      codeLines = []
      i++
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      i++
      continue
    }

    // ── 빈 줄 → 건너뛰기 ──
    if (line.trim() === '') {
      i++
      continue
    }

    // ── 구분선 ──
    if (/^---+$/.test(line.trim())) {
      paragraphs.push(new Paragraph({ text: '' }))
      i++
      continue
    }

    // ── 헤딩 ──
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
      }
      paragraphs.push(
        new Paragraph({
          heading: headingMap[level],
          children: parseInlineFormatting(headingMatch[2]),
        }),
      )
      i++
      continue
    }

    // ── 마크다운 테이블 ──
    if (line.trimStart().startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i]!.trimStart().startsWith('|')) {
        tableLines.push(lines[i]!)
        i++
      }

      // 2줄 미만이면 일반 텍스트로 fallback
      if (tableLines.length < 2) {
        for (const tl of tableLines) {
          paragraphs.push(new Paragraph({ children: parseInlineFormatting(tl) }))
        }
        continue
      }

      // separator row 찾기
      let separatorIdx = -1
      for (let s = 0; s < tableLines.length; s++) {
        if (/^\|[\s:]*-{3,}[\s:]*(\|[\s:]*-{3,}[\s:]*)*\|?\s*$/.test(tableLines[s]!.trim())) {
          separatorIdx = s
          break
        }
      }

      const parseCells = (rowLine: string): string[] =>
        rowLine
          .split('|')
          .map((c) => c.trim())
          .filter(
            (_, idx, arr) =>
              !(idx === 0 && arr[0] === '') && !(idx === arr.length - 1 && arr[arr.length - 1] === ''),
          )

      let headerCells: string[] | null = null
      let dataLines: string[]

      if (separatorIdx >= 0) {
        if (separatorIdx > 0) {
          headerCells = parseCells(tableLines[separatorIdx - 1]!)
        }
        dataLines = tableLines.filter(
          (_, idx) => idx !== separatorIdx && (headerCells ? idx !== separatorIdx - 1 : true),
        )
      } else {
        dataLines = tableLines
      }

      const colCount = headerCells
        ? headerCells.length
        : dataLines.length > 0
          ? parseCells(dataLines[0]!).length
          : 0

      if (colCount === 0) {
        for (const tl of tableLines) {
          paragraphs.push(new Paragraph({ children: parseInlineFormatting(tl) }))
        }
        continue
      }

      const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }
      const tableBorders = {
        top: borderStyle,
        bottom: borderStyle,
        left: borderStyle,
        right: borderStyle,
        insideHorizontal: borderStyle,
        insideVertical: borderStyle,
      }

      // A4 콘텐츠 폭 ≈ 9072 DXA (약 160mm)를 균등 분배
      const totalWidthDxa = 9072
      const cellWidthDxa = Math.floor(totalWidthDxa / colCount)
      console.log('[DOCX-TABLE] colCount=', colCount, 'cellWidthDxa=', cellWidthDxa, 'layout=FIXED')
      const makeCell = (text: string, isHeader: boolean): TableCell =>
        new TableCell({
          width: { size: cellWidthDxa, type: WidthType.DXA },
          children: [new Paragraph({ children: parseInlineFormatting(text) })],
          ...(isHeader
            ? { shading: { fill: 'F0F0F0', type: ShadingType.CLEAR, color: 'auto' } }
            : {}),
        })

      const normalizeRow = (cells: string[]): string[] => {
        if (cells.length >= colCount) return cells.slice(0, colCount)
        return [...cells, ...Array(colCount - cells.length).fill('')]
      }

      const rows: TableRow[] = []

      if (headerCells) {
        rows.push(
          new TableRow({
            tableHeader: true,
            children: normalizeRow(headerCells).map((cell) => makeCell(cell, true)),
          }),
        )
      }

      for (const dataLine of dataLines) {
        const cells = normalizeRow(parseCells(dataLine))
        rows.push(new TableRow({ children: cells.map((cell) => makeCell(cell, false)) }))
      }

      if (rows.length > 0) {
        paragraphs.push(
          new Table({
            rows,
            width: { size: totalWidthDxa, type: WidthType.DXA },
            columnWidths: Array(colCount).fill(cellWidthDxa),
            layout: TableLayoutType.FIXED,
            borders: tableBorders,
          }),
        )
      }
      continue
    }

    // ── 체크박스 리스트 ──
    const checkboxMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)$/)
    if (checkboxMatch) {
      const checked = checkboxMatch[1].toLowerCase() === 'x'
      const prefix = checked ? '\u2611 ' : '\u2610 '
      paragraphs.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: prefix }), ...parseInlineFormatting(checkboxMatch[2])],
        }),
      )
      i++
      continue
    }

    // ── 불릿 리스트 ──
    const bulletMatch = line.match(/^-\s+(.+)$/)
    if (bulletMatch) {
      paragraphs.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInlineFormatting(bulletMatch[1]),
        }),
      )
      i++
      continue
    }

    // ── 인용문 ──
    const quoteMatch = line.match(/^>\s*(.+)$/)
    if (quoteMatch) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          indent: { left: 720 }, // 0.5 inch
          children: [
            new TextRun({
              text: quoteMatch[1],
              italics: true,
            }),
          ],
        }),
      )
      i++
      continue
    }

    // ── 일반 텍스트 ──
    paragraphs.push(
      new Paragraph({
        children: parseInlineFormatting(line),
      }),
    )
    i++
  }

  return paragraphs
}

/**
 * 인라인 **bold**, ~~strikethrough~~ 서식을 파싱하여 TextRun 배열로 변환한다.
 */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = []
  // bold(**...**) 와 strikethrough(~~...~~) 모두 처리
  const regex = /\*\*(.+?)\*\*|~~(.+?)~~/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index) }))
    }
    if (match[1] !== undefined) {
      // bold
      runs.push(new TextRun({ text: match[1], bold: true }))
    } else if (match[2] !== undefined) {
      // strikethrough
      runs.push(new TextRun({ text: match[2], strike: true }))
    }
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex) }))
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text }))
  }

  return runs
}
