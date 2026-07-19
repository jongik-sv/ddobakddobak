import { describe, it, expect, vi, beforeEach } from 'vitest'

// lib/download의 텍스트 저장 스파이 (localExport.test.ts와 동일 패턴).
const downloadText = vi.fn().mockResolvedValue(undefined)
vi.mock('./download', () => ({
  downloadText: (...a: unknown[]) => downloadText(...a),
}))

import { chatAnswerToMarkdown, downloadChatAnswer } from './chatExport'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('chatAnswerToMarkdown', () => {
  it('(a) 인라인 인용 마커를 제거한다', () => {
    const md = chatAnswerToMarkdown('예산은 5천만원으로 결정됐습니다. ⟦t:125000|s:화자 1⟧')
    expect(md).toBe('예산은 5천만원으로 결정됐습니다.\n')
    expect(md).not.toContain('⟦')
  })

  it('(b) 크로스미팅(폴더) 인용 마커를 제거한다', () => {
    const md = chatAnswerToMarkdown('지난 회의에서 합의됨. ⟦m:142/t:125000/s:화자 1⟧')
    expect(md).toBe('지난 회의에서 합의됨.\n')
    expect(md).not.toContain('⟦')
    expect(md).not.toContain('m:142')
  })

  it('(b-2) 인라인 마커와 크로스미팅 마커가 섞여 있어도 모두 제거한다', () => {
    const md = chatAnswerToMarkdown(
      '첫 결정 ⟦t:1000|s:화자 1⟧ 그리고 지난 회의 결정 ⟦m:5/t:2000/s:화자 2⟧ 끝.',
    )
    expect(md).not.toContain('⟦')
    expect(md).toBe('첫 결정  그리고 지난 회의 결정  끝.\n')
  })

  it('(c) <br> 변형들을 개행으로 치환한다 (대소문자·공백·self-close 무관)', () => {
    const md = chatAnswerToMarkdown('첫줄<br>둘째줄<br/>셋째줄<br />넷째줄<BR>다섯째줄')
    expect(md).toBe('첫줄\n둘째줄\n셋째줄\n넷째줄\n다섯째줄\n')
  })

  it('(c-2) 인라인(문장 중간)의 <br>도 개행으로 치환한다', () => {
    const md = chatAnswerToMarkdown('앞부분 <br> 뒷부분')
    expect(md).toBe('앞부분 \n 뒷부분\n')
  })

  it('(d) 코드블록·표·mermaid 펜스 등 일반 마크다운 문법은 원본 보존', () => {
    const content = [
      '# 제목',
      '',
      '```mermaid',
      'graph TD; A-->B;',
      '```',
      '',
      '| 항목 | 값 |',
      '| --- | --- |',
      '| a | 1 |',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
      '- 목록1',
      '- 목록2',
    ].join('\n')
    const md = chatAnswerToMarkdown(content)
    expect(md).toContain('```mermaid')
    expect(md).toContain('graph TD; A-->B;')
    expect(md).toContain('| 항목 | 값 |')
    expect(md).toContain('```js')
    expect(md).toContain('const x = 1')
    expect(md).toContain('- 목록1')
    expect(md).toContain('# 제목')
  })

  it('(e) 마커 제거로 생긴 줄 끝 잉여 공백을 정리한다', () => {
    const md = chatAnswerToMarkdown('첫 줄 ⟦t:1000|s:화자 1⟧   \n둘째 줄')
    expect(md).toBe('첫 줄\n둘째 줄\n')
  })

  it('끝에 개행을 정확히 1개로 정리한다 (여러 개 → 1개, 없음 → 1개 추가)', () => {
    expect(chatAnswerToMarkdown('내용\n\n\n')).toBe('내용\n')
    expect(chatAnswerToMarkdown('내용')).toBe('내용\n')
  })

  it('(f) 코드블록(펜스) 안의 <br>는 개행으로 치환하지 않고 보존한다', () => {
    const content = ['설명 <br> 계속', '```', '한줄<br>둘째줄', '```', '이어지는 <br> 텍스트'].join(
      '\n',
    )
    const md = chatAnswerToMarkdown(content)
    expect(md).toBe('설명 \n 계속\n```\n한줄<br>둘째줄\n```\n이어지는 \n 텍스트\n')
  })

  it('(g) 인라인 코드(백틱) 안의 <br>는 개행으로 치환하지 않고 보존한다', () => {
    const md = chatAnswerToMarkdown('설명: `code<br>here` 그리고 <br> 일반 텍스트')
    expect(md).toBe('설명: `code<br>here` 그리고 \n 일반 텍스트\n')
  })

  it('(g-2) 이중 백틱 코드 스팬 안의 <br>는 개행으로 치환하지 않고 보존한다', () => {
    const md = chatAnswerToMarkdown('앞 `` code<br>here `` 뒤')
    expect(md).toBe('앞 `` code<br>here `` 뒤\n')
  })

  it('(g-3) 이중 백틱 스팬 안에 단일 백틱이 섞여 있어도 <br>는 보존된다', () => {
    const md = chatAnswerToMarkdown('앞 `` a ` b<br>c `` 뒤')
    expect(md).toBe('앞 `` a ` b<br>c `` 뒤\n')
  })

  it('(g-4) 이중 백틱 스팬 밖의 <br>은 치환되고 스팬 안은 보존되는 혼합 케이스', () => {
    const md = chatAnswerToMarkdown('앞 <br> `` code<br>here `` 뒤 <br> 끝')
    expect(md).toBe('앞 \n `` code<br>here `` 뒤 \n 끝\n')
  })

  it('(h) 코드블록·인라인 코드 밖의 <br>만 개행으로 치환되는 혼합 케이스', () => {
    const content = [
      '첫 문단 <br> 둘째줄',
      '```js',
      'const s = "a<br>b"',
      '```',
      '인라인 `x<br>y` 코드 후 <br> 일반',
    ].join('\n')
    const md = chatAnswerToMarkdown(content)
    expect(md).toBe(
      [
        '첫 문단 ',
        ' 둘째줄',
        '```js',
        'const s = "a<br>b"',
        '```',
        '인라인 `x<br>y` 코드 후 ',
        ' 일반',
        '',
      ].join('\n'),
    )
  })
})

describe('downloadChatAnswer', () => {
  it('마커가 제거된 마크다운을 text/markdown Blob으로 downloadText 호출한다', async () => {
    await downloadChatAnswer('결정: 5천만원 ⟦t:1000|s:화자 1⟧')
    expect(downloadText).toHaveBeenCalledTimes(1)
    const [content, filename, mime] = downloadText.mock.calls[0]
    expect(content).toBe('결정: 5천만원\n')
    expect(filename).toMatch(/^ai-answer-\d{8}-\d{6}\.md$/)
    expect(mime).toBe('text/markdown;charset=utf-8')
  })
})
