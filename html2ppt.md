# 프롬프트

내 HTML → PPTX 변환 코드를 직접 개선해줘.


목표:

- HTML → PNG/screenshot 삽입 방식은 절대 사용하지 말 것
- PowerPoint에서 수정 가능한 PPTX 객체로 생성할 것
- 텍스트, 도형, 이미지, 표, 차트가 각각 편집 가능해야 함
- Playwright를 활용해 실제 브라우저 렌더링 기준의 좌표/스타일을 추출할 것

핵심 수정 방향:

1. Playwright로 HTML을 로드한 뒤 DOM 요소별 "getBoundingClientRect()" 값을 추출해줘.
2. "window.getComputedStyle()"로 실제 적용된 CSS 값을 추출해줘.
3. 추출한 "boundingBox + computedStyle" 데이터를 기준으로 PPTX 객체를 생성하도록 수정해줘.
4. px → inch 변환은 "inch = px / 96" 기준으로 통일해줘.
5. flex/grid/absolute 레이아웃은 직접 해석하지 말고, Playwright 렌더링 결과의 최종 좌표를 기준으로 PPT에 배치해줘.
6. z-index와 DOM depth를 계산해 PPT 객체 삽입 순서에 반영해줘.
7. 텍스트는 이미지화하지 말고 PowerPoint textbox로 생성해줘.
8. background, border, border-radius, opacity는 PPT shape 속성으로 변환해줘.
9. img 태그는 PPT image 객체로 삽입하되 "object-fit", "object-position", crop 처리를 반영해줘.
10. SVG는 가능한 경우 벡터로 유지하고, 복잡한 경우에도 편집 가능성을 최대한 유지해줘.
11. table은 PPT table 객체로 변환해줘.
12. chart/canvas는 가능하면 원본 데이터 기반 PPT chart 객체로 재구성해줘.
13. 지원하지 못하는 CSS는 fallback 처리하고, 반드시 리포트로 남겨줘.
14. 생성된 PPTX 객체의 위치, 크기, 타입, 스타일 매핑 결과를 디버그 로그로 남겨줘.

Playwright 구현 요구사항:

- "page.setViewportSize()"로 PPT 슬라이드 비율과 동일한 렌더링 환경을 구성해줘.
- 웹폰트 로딩이 끝난 뒤 변환되도록 "document.fonts.ready"를 기다려줘.
- 이미지 로딩 완료 후 변환되도록 모든 "img.complete" 상태를 확인해줘.
- DOM 요소별로 다음 정보를 JSON으로 추출해줘:
  - tagName
  - textContent
  - boundingBox
  - computedStyle
  - zIndex
  - opacity
  - transform
  - background
  - border
  - borderRadius
  - fontFamily
  - fontSize
  - fontWeight
  - lineHeight
  - color
  - textAlign
  - display
  - position
  - overflow
  - objectFit
  - objectPosition
  - src / href
  - children depth
- 숨김 요소, 크기 0인 요소, display:none, visibility:hidden 요소는 제외해줘.
- 추출된 JSON을 기반으로 PPTX 생성 로직을 분리해줘.

작업 방식:

- 먼저 현재 코드에서 HTML/CSS → PPTX 변환 품질을 떨어뜨리는 문제를 찾아줘.
- 그다음 Playwright 기반 추출 레이어를 추가하거나 기존 추출 로직을 교체해줘.
- PPTX 생성 로직은 추출된 JSON을 입력으로 받는 구조로 리팩토링해줘.
- 전체 코드를 무리하게 다시 작성하지 말고, 필요한 함수/모듈 중심으로 패치해줘.
- 기존 API와 입력/출력 형식은 최대한 유지해줘.
- 수정한 코드에는 핵심 이유를 주석으로 남겨줘.
- 수정 후 테스트 방법도 함께 제시해줘.

최종 결과:

- 개선된 코드
- Playwright 기반 DOM/style 추출 코드
- PPTX 객체 생성 코드
- CSS → PPTX 매핑 테이블
- fallback 처리 목록
- 디버그/검증 로그 예시
- 테스트 방법을 순서대로 제공해줘.

# design.md 
https://github.com/voltagent/awesome-design-md
https://getdesign.md/claude/design-md
