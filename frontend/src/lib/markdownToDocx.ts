import {
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
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
    mermaid.initialize({ startOnLoad: false, theme: 'default' })

    const id = `docx-mmd-${idx}-${Date.now()}`
    const { svg } = await mermaid.render(id, code.trim())

    // 잔여 DOM 요소 정리
    document.querySelectorAll(`[id^="ddocx-mmd-"]`).forEach((el) => el.remove())

    // SVG → Canvas → PNG
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = reject
      img.src = url
    })

    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth * scale
    canvas.height = img.naturalHeight * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    )
    const buffer = await blob.arrayBuffer()

    // DOCX에 삽입할 크기 (EMU 기준으로 적절한 폭, 최대 600px)
    const maxWidth = 600
    const ratio = Math.min(maxWidth / img.naturalWidth, 1)
    const width = Math.round(img.naturalWidth * ratio)
    const height = Math.round(img.naturalHeight * ratio)

    return { buffer, width, height }
  } catch {
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

      const makeCell = (text: string, isHeader: boolean): TableCell =>
        new TableCell({
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
            width: { size: 100, type: WidthType.PERCENTAGE },
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
