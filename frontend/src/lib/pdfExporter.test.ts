import { describe, it, expect } from 'vitest'
import { markdownToHtml } from './pdfExporter'

// characterization tests — WP-F6 리팩토링 전 markdownToHtml의 현재 출력을 고정한다.
// 목적: lib/markdownBlocks.ts 추출 후에도 이 출력이 바이트 단위로 동일해야 한다.

describe('markdownToHtml (characterization)', () => {
  it('헤딩(1~6단계)을 h1~h6로 변환한다', () => {
    const md = '# 제목1\n## 제목2\n### 제목3\n#### 제목4\n##### 제목5\n###### 제목6'
    expect(markdownToHtml(md)).toMatchInlineSnapshot(`
      "<h1>제목1</h1>
      <h2>제목2</h2>
      <h3>제목3</h3>
      <h4>제목4</h4>
      <h5>제목5</h5>
      <h6>제목6</h6>"
    `)
  })

  it('불릿(-,*,+)·순번 리스트를 변환한다', () => {
    const md = '- 항목1\n- 항목2\n\n* 별표항목\n+ 플러스항목\n\n1. 첫번째\n2. 두번째'
    expect(markdownToHtml(md)).toMatchInlineSnapshot(`
      "<ul>
        <li>항목1</li>
        <li>항목2</li>
      </ul>
      <ul>
        <li>별표항목</li>
        <li>플러스항목</li>
      </ul>
      <ol>
        <li>첫번째</li>
        <li>두번째</li>
      </ol>"
    `)
  })

  it('체크박스 리스트를 ☑/☐ 로 변환한다', () => {
    const md = '- [x] 완료 항목\n- [ ] 미완료 항목\n- [X] 대문자 체크'
    expect(markdownToHtml(md)).toMatchInlineSnapshot(`
      "<ul class="action-list">
        <li>☑ 완료 항목</li>
        <li>☐ 미완료 항목</li>
        <li>☑ 대문자 체크</li>
      </ul>"
    `)
  })

  it('정렬 콜론이 포함된 테이블을 변환한다', () => {
    const md = '| 이름 | 값 | 비고 |\n|:---|:---:|---:|\n| 홍길동 | 10 | 좋음 |\n| 김철수 | 20 | |'
    expect(markdownToHtml(md)).toMatchInlineSnapshot(`
      "<div class="md-table-wrapper"><table class="md-table"><thead><tr><th>이름</th><th>값</th><th>비고</th></tr></thead><tbody><tr><td>홍길동</td><td>10</td><td>좋음</td></tr><tr><td>김철수</td><td>20</td><td></td></tr></tbody></table></div>"
    `)
  })

  it('헤더 없는 테이블(구분선 없음)은 전부 body row로 처리한다', () => {
    const md = '| a | b |\n| c | d |'
    expect(markdownToHtml(md)).toMatchInlineSnapshot(`
      "<div class="md-table-wrapper"><table class="md-table"><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table></div>"
    `)
  })

  it('fenced code block(언어 표시 포함)을 변환한다', () => {
    const md = '```ts\nconst a = 1\nconsole.log(a)\n```'
    expect(markdownToHtml(md)).toMatchInlineSnapshot(`
      "<pre><span class="code-lang">ts</span><code>const a = 1
      console.log(a)</code></pre>"
    `)
  })

  it('mermaid fenced block을 data-code 속성의 div로 변환한다', () => {
    const md = '```mermaid\ngraph TD\n  A --> B\n```'
    expect(markdownToHtml(md)).toMatchInlineSnapshot(
      `"<div class="mermaid-render" data-code="graph TD&#10;  A --&gt; B"></div>"`,
    )
  })

  it('blockquote(멀티라인)를 <br>로 연결한 <blockquote>로 변환한다', () => {
    const md = '> 첫줄\n> 둘째줄\n>'
    expect(markdownToHtml(md)).toMatchInlineSnapshot(
      `"<blockquote>첫줄<br>둘째줄<br></blockquote>"`,
    )
  })

  it('수평선(---, ***, ___)을 <hr>로 변환한다', () => {
    const md = '---\n\n***\n\n___'
    expect(markdownToHtml(md)).toMatchInlineSnapshot(`
      "<hr>
      <hr>
      <hr>"
    `)
  })

  it('인라인 서식(bold/italic/strike/code/link/image)을 변환한다', () => {
    const md =
      '**굵게** *기울임* ***굵고기울임*** ~~취소선~~ `코드` [링크](https://example.com) ![대체텍스트](https://example.com/img.png)'
    expect(markdownToHtml(md)).toMatchInlineSnapshot(
      `"<p><strong>굵게</strong> <em>기울임</em> <strong><em>굵고기울임</em></strong> <del>취소선</del> <code>코드</code> <a href="https://example.com">링크</a> <img src="https://example.com/img.png" alt="대체텍스트" style="max-width:100%"></p>"`,
    )
  })

  it('한글 단락은 개행을 <br>로 유지하며 <p>로 감싼다', () => {
    const md = '안녕하세요.\n오늘 회의록입니다.\n\n다음 문단입니다.'
    expect(markdownToHtml(md)).toMatchInlineSnapshot(`
      "<p>안녕하세요.<br>오늘 회의록입니다.</p>
      <p>다음 문단입니다.</p>"
    `)
  })

  it('종합 픽스처(헤딩/리스트/체크박스/테이블/코드+mermaid/blockquote/인라인/한글)', () => {
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
      '자세한 내용은 `README.md`를 참고하세요.',
    ].join('\n')
    expect(markdownToHtml(md)).toMatchSnapshot()
  })
})
