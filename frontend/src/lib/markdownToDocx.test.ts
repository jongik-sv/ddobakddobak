import { describe, it, expect, vi } from 'vitest'
import { markdownToDocxParagraphs } from './markdownToDocx'

// characterization tests — WP-F6 리팩토링 전 markdownToDocxParagraphs의 현재 출력 구조를 고정한다.
// 목적: lib/markdownBlocks.ts 추출(테이블 separator/셀 파싱 공유화) 후에도 이 구조가 동일해야 한다.
// docx의 Paragraph/Table/TextRun은 내부적으로 JSON 직렬화 가능한 트리(rootKey/root)를 갖고 있어
// JSON.stringify로 구조를 고정할 수 있다.

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg><rect width="10" height="10"/></svg>' }),
  },
}))

vi.mock('html2canvas', () => ({
  default: vi.fn().mockResolvedValue({
    width: 200,
    height: 100,
    toBlob: (cb: (b: Blob) => void) => cb(new Blob(['fake-png-bytes'], { type: 'image/png' })),
  }),
}))

function serialize(nodes: unknown): string {
  return JSON.stringify(nodes, (_key, value) => (typeof value === 'function' ? undefined : value), 2)
}

describe('markdownToDocxParagraphs (characterization)', () => {
  it('헤딩(1~3단계)을 변환한다 — 4단계 이상은 일반 텍스트로 처리된다', async () => {
    const md = '# 제목1\n## 제목2\n### 제목3\n#### 제목4(헤딩미지원)'
    const result = await markdownToDocxParagraphs(md)
    expect(result).toHaveLength(4)
    expect(serialize(result)).toMatchSnapshot()
  })

  it('불릿(-)·체크박스 리스트를 변환한다', async () => {
    const md = '- 항목1\n- 항목2\n- [x] 완료\n- [ ] 미완료'
    const result = await markdownToDocxParagraphs(md)
    expect(serialize(result)).toMatchSnapshot()
  })

  it('정렬 콜론이 포함된 테이블(헤더+구분선)을 변환한다', async () => {
    const md = '| 이름 | 값 | 비고 |\n|:---|:---:|---:|\n| 홍길동 | 10 | 좋음 |\n| 김철수 | 20 | |'
    const result = await markdownToDocxParagraphs(md)
    expect(result).toHaveLength(1)
    expect(serialize(result)).toMatchSnapshot()
  })

  it('구분선 없는 테이블은 헤더 없이 전부 데이터 row로 처리한다', async () => {
    const md = '| a | b |\n| c | d |'
    const result = await markdownToDocxParagraphs(md)
    expect(serialize(result)).toMatchSnapshot()
  })

  it('열 개수가 부족한 row는 빈 셀로 채운다(normalizeRow)', async () => {
    const md = '| a | b | c |\n|---|---|---|\n| 1 | 2 |'
    const result = await markdownToDocxParagraphs(md)
    expect(serialize(result)).toMatchSnapshot()
  })

  it('일반 코드 블록(언어 라벨 포함)을 변환한다', async () => {
    const md = '```ts\nconst a = 1\nconsole.log(a)\n```'
    const result = await markdownToDocxParagraphs(md)
    expect(serialize(result)).toMatchSnapshot()
  })

  it('mermaid 코드 블록을 이미지(ImageRun)로 변환한다', async () => {
    const md = '```mermaid\ngraph TD\n  A --> B\n```'
    const result = await markdownToDocxParagraphs(md)
    expect(result).toHaveLength(1)
    expect(serialize(result)).toMatchSnapshot()
  })

  it('인용문(단일 라인)을 변환한다', async () => {
    const md = '> 참고: 다음 회의는 **다음주 월요일**입니다.'
    const result = await markdownToDocxParagraphs(md)
    expect(serialize(result)).toMatchSnapshot()
  })

  it('구분선(---)을 빈 Paragraph로 변환한다', async () => {
    const md = '---'
    const result = await markdownToDocxParagraphs(md)
    expect(serialize(result)).toMatchSnapshot()
  })

  it('인라인 서식(bold/strikethrough)을 TextRun으로 분리한다', async () => {
    const md = '일반 **굵게** 일반 ~~취소선~~ 끝'
    const result = await markdownToDocxParagraphs(md)
    expect(serialize(result)).toMatchSnapshot()
  })

  it('종합 픽스처(헤딩/리스트/체크박스/테이블/코드+mermaid/blockquote/한글)', async () => {
    const md = [
      '# 회의록',
      '',
      '## 참석자',
      '- 홍길동',
      '- 김철수',
      '',
      '### 액션 아이템',
      '- [x] 설계 문서 작성',
      '- [ ] 리뷰 요청',
      '',
      '## 결정 사항',
      '| 항목 | 담당자 |',
      '|:---|---:|',
      '| API 설계 | 홍길동 |',
      '',
      '## 아키텍처',
      '```mermaid',
      'graph TD; A-->B',
      '```',
      '',
      '> 참고: 다음 회의는 **다음주 월요일**입니다.',
      '',
      '자세한 내용은 일반 텍스트입니다.',
    ].join('\n')
    const result = await markdownToDocxParagraphs(md)
    expect(serialize(result)).toMatchSnapshot()
  })
})
