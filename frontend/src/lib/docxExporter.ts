import type { MeetingExportData } from '../api/meetings'

/**
 * MeetingExportData를 DOCX Blob으로 변환한다.
 * docx 패키지는 코드 스플리팅을 위해 동적 임포트한다.
 */
export async function generateDocx(data: MeetingExportData): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table } = await import('docx')
  const { markdownToDocxParagraphs } = await import('./markdownToDocx')

  const { meeting, summary, action_items = [], transcripts = [] } = data

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []

  // ── 1. 제목 ──
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: meeting.title })],
    }),
  )

  // ── 2. 메타 정보 ──
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: '날짜: ', bold: true }),
        new TextRun({ text: meeting.date }),
      ],
    }),
  )
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: '시간: ', bold: true }),
        new TextRun({ text: `${meeting.start_time} ~ ${meeting.end_time}` }),
      ],
    }),
  )
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: '상태: ', bold: true }),
        new TextRun({ text: meeting.status }),
      ],
    }),
  )
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: '작성자: ', bold: true }),
        new TextRun({ text: meeting.creator_name }),
      ],
    }),
  )

  // ── 3. 구분선 ──
  children.push(new Paragraph({ text: '' }))

  // ── 4. 요약 ──
  if (summary) {
    if (summary.type === 'notes_markdown' && summary.notes_markdown) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: 'AI 회의록' })],
        }),
      )
      children.push(...(await markdownToDocxParagraphs(summary.notes_markdown)))
    } else if (summary.type === 'json_fields') {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: 'AI 요약' })],
        }),
      )

      // 핵심 사항
      if (summary.key_points?.length) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun({ text: '핵심 사항' })],
          }),
        )
        for (const point of summary.key_points) {
          children.push(
            new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: point })],
            }),
          )
        }
      }

      // 결정 사항
      if (summary.decisions?.length) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun({ text: '결정 사항' })],
          }),
        )
        for (const decision of summary.decisions) {
          children.push(
            new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: decision })],
            }),
          )
        }
      }

      // 논의 내용
      if (summary.discussion_details?.length) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun({ text: '논의 내용' })],
          }),
        )
        for (const detail of summary.discussion_details) {
          children.push(
            new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: detail })],
            }),
          )
        }
      }
    }
  }

  // ── 5. 메모 ──
  if (data.memo) {
    children.push(new Paragraph({ text: '' }))
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: '메모' })],
      }),
    )
    for (const line of data.memo.split('\n')) {
      if (line.trim() === '') {
        children.push(new Paragraph({ text: '' }))
      } else {
        children.push(new Paragraph({ children: [new TextRun({ text: line })] }))
      }
    }
  }

  // ── 6. Action Items ──
  if (action_items.length > 0) {
    children.push(new Paragraph({ text: '' }))
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: 'Action Items' })],
      }),
    )
    for (const item of action_items) {
      const checked = item.status === 'completed'
      const prefix = checked ? '\u2611 ' : '\u2610 '
      const parts: InstanceType<typeof TextRun>[] = [
        new TextRun({ text: `${prefix}${item.content}` }),
      ]
      if (item.assignee_name) {
        parts.push(new TextRun({ text: ` (@${item.assignee_name})`, italics: true }))
      }
      if (item.due_date) {
        parts.push(new TextRun({ text: ` [${item.due_date}]`, color: '888888' }))
      }
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parts,
        }),
      )
    }
  }

  // ── 7. 원본 텍스트 ──
  if (transcripts.length > 0) {
    children.push(new Paragraph({ text: '' }))
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: '원본 텍스트' })],
      }),
    )
    for (const t of transcripts) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: t.speaker_label, bold: true }),
            new TextRun({ text: ` (${t.timestamp})  `, color: '888888' }),
            new TextRun({ text: t.content }),
          ],
        }),
      )
    }
  }

  // ── Document 생성 & 패킹 ──
  const doc = new Document({
    sections: [{ children }],
  })

  return Packer.toBlob(doc)
}
