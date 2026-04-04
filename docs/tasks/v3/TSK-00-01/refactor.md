# TSK-00-01: 리팩토링 내역

## 변경 사항

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/index.css` | 중복된 `@layer base` 블록 2개를 1개로 통합 |
| `frontend/src/index.css` | `overscroll-behavior: none`을 `body`에서 `html, body`로 확장 (design.md 사양 일치) |
| `frontend/src/index.css` | `.drag-ghost`의 하드코딩 색상(`white`, `rgba`)을 CSS 변수(`--background`, `--foreground`)로 교체 |

## 테스트 확인
- 결과: PASS
- 56 test files, 449 tests 전부 통과
