# TSK-04-01: 터치 타겟 및 호버 미디어 쿼리 적용 - 설계

## 구현 방향

4가지 축으로 나누어 기존 코드를 소규모 수정한다:

1. **터치 타겟 확보** -- 모든 인터랙티브 요소(button, link, checkbox, switch)에 최소 44x44px 터치 영역을 보장한다. 시각적 크기를 바꾸지 않고 `min-h-[44px] min-w-[44px]` 또는 패딩 확대로 터치 영역만 넓힌다.
2. **인접 버튼 간격** -- 가까이 붙어있는 버튼 그룹에 `gap-2` (8px) 이상을 보장한다.
3. **호버 효과 분기** -- `@media (hover: hover)` 미디어 쿼리를 index.css에 정의하고, 터치 전용 기기에서 hover 스타일이 고착되지 않도록 한다.
4. **텍스트 선택 보장** -- 전사/요약 텍스트 영역에 `select-text` 클래스를 명시하여 iOS에서도 텍스트 복사가 가능하도록 한다.

핵심 원칙: **데스크톱 UI는 시각적으로 변경하지 않는다.** 터치 타겟은 패딩이나 min-height/min-width로만 확보하고, 호버 효과는 `@media (hover: hover)` 안에서만 동작하므로 데스크톱 경험은 그대로 유지된다.

---

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/index.css` | `@media (hover: hover)` 유틸리티, 터치 타겟 전역 기본값 추가 | 수정 |
| `frontend/src/components/ui/Switch.tsx` | 스위치 터치 영역 44px 확보 | 수정 |
| `frontend/src/components/ui/Tooltip.tsx` | hover → `@media (hover: hover)` 분기 | 수정 |
| `frontend/src/components/layout/AppLayout.tsx` | 사이드바 토글 버튼 터치 타겟 확보 | 수정 |
| `frontend/src/components/layout/Sidebar.tsx` | NavLink/버튼 터치 타겟 44px, hover 분기 | 수정 |
| `frontend/src/components/meeting/AudioPlayer.tsx` | 재생 버튼·배속·다운로드 터치 타겟, 프로그레스 바 thumb hover 분기 | 수정 |
| `frontend/src/components/meeting/AudioRecorder.tsx` | 녹음 버튼 min-h-[44px] 보장 | 수정 |
| `frontend/src/components/meeting/ExportButton.tsx` | 트리거 버튼·형식 선택·체크박스 터치 타겟 | 수정 |
| `frontend/src/components/meeting/ShareButton.tsx` | 버튼 터치 타겟, 인접 아이콘 버튼 간격 | 수정 |
| `frontend/src/components/meeting/ShareLinkButton.tsx` | 버튼 터치 타겟 | 수정 |
| `frontend/src/components/meeting/TranscriptPanel.tsx` | 텍스트 `select-text` 보장, 항목 터치 타겟, hover 분기 | 수정 |
| `frontend/src/components/meeting/AiSummaryPanel.tsx` | 저장 버튼 터치 타겟 | 수정 |
| `frontend/src/components/meeting/SpeakerPanel.tsx` | 화자 편집/초기화 버튼 터치 타겟, hover 분기 | 수정 |
| `frontend/src/components/meeting/RecordTabPanel.tsx` | 탭 버튼 min-h-[44px] | 수정 |
| `frontend/src/components/meeting/AttachmentCard.tsx` | 카드 hover 분기, 버튼 터치 타겟 | 수정 |
| `frontend/src/components/meeting/ViewerHeader.tsx` | 버튼 터치 타겟 | 수정 |
| `frontend/src/components/meeting/ParticipantList.tsx` | 버튼 hover 분기, 터치 타겟 | 수정 |
| `frontend/src/components/folder/FolderTree.tsx` | 폴더 항목 터치 타겟, group-hover 분기, 컨텍스트 메뉴 항목 44px | 수정 |
| `frontend/src/components/folder/FolderBreadcrumb.tsx` | 버튼 터치 타겟 | 수정 |
| `frontend/src/components/settings/SettingsModal.tsx` | 닫기 버튼·탭 버튼 터치 타겟 | 수정 |
| `frontend/src/components/settings/SettingsContent.tsx` | 슬라이더 thumb 터치 타겟, 호버 분기 | 수정 |
| `frontend/src/components/settings/UserManagementPanel.tsx` | 버튼 터치 타겟, hover 분기 | 수정 |
| `frontend/src/components/decision/DecisionList.tsx` | 항목 hover 분기, 버튼 터치 타겟 | 수정 |
| `frontend/src/components/decision/DecisionForm.tsx` | 입력 필드·버튼 터치 타겟 | 수정 |
| `frontend/src/components/action-item/ActionItemList.tsx` | 체크박스·hover 분기, 버튼 터치 타겟 | 수정 |
| `frontend/src/components/action-item/ActionItemForm.tsx` | 입력 필드·버튼 터치 타겟 | 수정 |
| `frontend/src/components/meeting/EditMeetingDialog.tsx` | 모달 내 입력·버튼 터치 타겟 | 수정 |
| `frontend/src/components/meeting/AddFileDialog.tsx` | 모달 내 버튼 터치 타겟, hover 분기 | 수정 |
| `frontend/src/components/meeting/AddLinkDialog.tsx` | 모달 내 입력·버튼 터치 타겟 | 수정 |
| `frontend/src/components/PromptTemplateManager.tsx` | 버튼 터치 타겟, hover 분기 | 수정 |
| `frontend/src/pages/MeetingPage.tsx` | 헤더 아이콘 버튼 터치 타겟, 전사 텍스트 select-text, hover 분기 | 수정 |
| `frontend/src/pages/MeetingLivePage.tsx` | 녹음 컨트롤 버튼 터치 타겟, 인접 버튼 간격, hover 분기 | 수정 |
| `frontend/src/pages/MeetingsPage.tsx` | 카드 hover 분기, 툴바 버튼 터치 타겟, 삭제/편집 hover 분기 | 수정 |
| `frontend/src/pages/DashboardPage.tsx` | 통계 카드·최근 회의 카드 hover 분기 | 수정 |
| `frontend/src/pages/SearchPage.tsx` | 검색 버튼·필터 버튼·결과 카드 터치 타겟, 페이지네이션 hover 분기 | 수정 |

---

## 주요 구조

### 1. CSS 유틸리티 (`index.css`)

```css
/* ── 호버 분기 유틸리티 ── */
/* 터치 전용 기기에서는 hover 스타일이 고착되지 않도록,
   hover 가능한 디바이스에서만 hover 효과를 적용한다 */

@media (hover: hover) {
  /* 범용 hover-bg 유틸리티 */
  .can-hover\:hover\:bg-gray-50:hover  { background-color: rgb(249 250 251); }
  .can-hover\:hover\:bg-gray-100:hover { background-color: rgb(243 244 246); }
  .can-hover\:hover\:bg-gray-200:hover { background-color: rgb(229 231 235); }
  .can-hover\:hover\:bg-muted\/50:hover { background-color: hsl(var(--muted) / 0.5); }
  .can-hover\:hover\:bg-accent:hover {
    background-color: hsl(var(--accent));
    color: hsl(var(--accent-foreground));
  }

  /* group-hover 유틸리티 — 폴더 트리, 카드 등에서 사용 */
  .group:hover .can-hover\:group-hover\:opacity-100 { opacity: 1; }
  .group:hover .can-hover\:group-hover\:block { display: block; }
  .group:hover .can-hover\:group-hover\:hidden { display: none; }
}

/* ── 전역 터치 타겟 기본값 ── */
/* 터치 기기에서 인터랙티브 요소의 최소 터치 영역을 보장한다.
   데스크톱에서는 min-height를 강제하지 않는다. */
@media (hover: none) {
  button, [role="switch"], [role="checkbox"],
  a[href], input[type="checkbox"], input[type="radio"],
  select {
    min-height: 44px;
    min-width: 44px;
  }

  /* 인접 버튼 최소 간격 보장 (flex/grid 컨테이너 내) */
  .touch-gap > * + * {
    margin-left: 8px;
  }
}

/* ── 텍스트 선택 보장 ── */
/* iOS Safari에서 텍스트 선택이 차단되는 것을 방지 */
.select-text {
  -webkit-user-select: text;
  user-select: text;
}
```

그러나 Tailwind v4의 `@utility` 디렉티브를 활용하면 더 간결하게 작성할 수 있다. **실제 구현에서는 아래 전략을 사용한다:**

#### 전략 A (권장): Tailwind 기본 `hover:` → 하이브리드 접근

Tailwind의 `hover:` 유틸리티는 기본적으로 모든 기기에서 `hover` pseudo-class를 적용한다. 이를 `@media (hover: hover)` 안에서만 동작하도록 index.css에 전역 래퍼를 추가한다.

```css
/* index.css에 추가 — Tailwind hover를 hover 가능 기기에서만 적용 */
@media (hover: none) {
  /* hover-none 기기에서는 모든 :hover 스타일을 비활성화 */
  *:hover {
    /* 개별 프로퍼티 리셋은 불필요 —
       hover:none 기기에서 :hover가 고착되지 않도록
       브라우저가 처리하지만, 일부 iOS에서 tap 후 고착되는 경우 방지 */
  }
}
```

**최종 채택 전략:** index.css 전역 래퍼 대신, `hover:` 사용이 문제되는 **특정 컴포넌트**에서만 `@media (hover: hover)`를 CSS-in-class로 적용한다. 구체적으로:

- **카드 hover 배경** (DashboardPage, MeetingsPage, SearchPage): 터치 시 배경색이 고착되는 문제 → `hover:bg-muted/50`를 CSS class로 교체
- **group-hover로 보이기/숨기기** (FolderTree, MeetingPage 북마크 삭제): 터치 기기에서 접근 불가 → 항상 표시하되 데스크톱에서만 hover 숨김
- **AudioPlayer 프로그레스 바 thumb**: `group-hover:opacity-100` → 터치에서는 항상 표시
- **Tooltip**: `group-hover` → 터치에서는 `title` attribute로 폴백

### 2. 터치 타겟 확보 패턴

3가지 패턴을 상황에 따라 사용한다:

#### 패턴 A: 직접 min-height/min-width 추가 (독립 버튼)

```tsx
// Before
<button className="p-1.5 rounded-md ...">
  <ArrowLeft className="w-5 h-5" />
</button>

// After — 터치 영역 44px 확보 (패딩 증가로)
<button className="p-2.5 rounded-md ...">
  <ArrowLeft className="w-5 h-5" />
</button>
```

#### 패턴 B: min-h/min-w 유틸리티 (텍스트 버튼)

```tsx
// Before
<button className="px-3 py-1.5 text-sm ...">STT 재생성</button>

// After — 높이만 보장 (이미 가로가 충분)
<button className="px-3 py-2 text-sm min-h-[44px] ...">STT 재생성</button>
```

#### 패턴 C: 패딩 영역 확장 (아이콘 전용 버튼)

```tsx
// Before — p-0.5 (총 크기 약 18px)
<button className="p-0.5 rounded hover:bg-green-100">
  <Copy className="w-3.5 h-3.5" />
</button>

// After — 터치 영역 44px 확보
<button className="p-2.5 -m-2 rounded hover:bg-green-100">
  <Copy className="w-3.5 h-3.5" />
</button>
```

음의 마진 (`-m-2`)으로 시각적 공간을 차지하지 않으면서 터치 영역만 넓힌다.

### 3. 호버 분기: `@media (hover: hover)` 적용

#### 3-A. group-hover로 요소 보이기/숨기기

터치 기기에서 hover로 숨겨진 요소에 접근할 수 없는 문제를 해결한다.

```tsx
// Before — FolderTree 삭제 버튼
<button className="opacity-0 group-hover:opacity-100 ...">
  <Trash2 className="w-3 h-3" />
</button>

// After — 터치 기기에서는 항상 표시
<button className="opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 ...">
  <Trash2 className="w-3 h-3" />
</button>
```

Tailwind v4에서 임의 미디어 쿼리 variant가 길어지므로, **index.css에 커스텀 variant를 정의**한다:

```css
/* index.css — hover 가능 기기 전용 유틸리티 */
@utility hover-hide {
  @media (hover: hover) {
    opacity: 0;
  }
}
@utility hover-show-on-group-hover {
  @media (hover: hover) {
    .group:hover & {
      opacity: 1;
    }
  }
}
```

```tsx
// After — 간결한 유틸리티 사용
<button className="hover-hide hover-show-on-group-hover transition-opacity ...">
  <Trash2 className="w-3 h-3" />
</button>
```

#### 3-B. 카드/리스트 항목 hover 배경색

```tsx
// Before — DashboardPage 통계 카드
<div className="... cursor-pointer hover:bg-muted/50 transition-colors">

// After — CSS 변수를 활용한 hover 분기
<div className="... cursor-pointer hover:[@media(hover:hover)]:bg-muted/50 active:bg-muted/50 transition-colors">
```

**실용적 대안:** `hover:bg-muted/50`는 대부분의 모바일 브라우저에서 잘 동작한다 (터치 해제 시 hover가 풀림). 따라서 **카드 hover는 기존 코드를 유지**하되, `active:` 상태를 추가하여 터치 피드백을 보강하는 것으로 충분하다.

#### 3-C. Tooltip 호버

```tsx
// Before
<span className="... opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible ...">

// After — hover 가능 기기에서만 tooltip 표시, 터치에서는 title attr 폴백
// Tooltip.tsx의 tooltip span에 추가 클래스 적용
```

### 4. 텍스트 선택 보장

```tsx
// TranscriptPanel.tsx — 전사 텍스트
<span className="text-sm text-gray-800 select-text">{transcript.content}</span>

// AiSummaryPanel.tsx — BlockNoteView 래퍼
<div className="flex-1 overflow-y-auto select-text">
  <BlockNoteView ... />
</div>
```

---

## 파일별 상세 변경

### `frontend/src/index.css`

추가 내용:

```css
/* ── v3 터치 최적화 유틸리티 ── */

/* hover 가능 기기에서만 요소를 숨기고, group hover 시 표시 */
@utility hover-hide {
  @media (hover: hover) {
    opacity: 0;
  }
}

/* group hover 시 opacity 복원 (hover 기기 전용) */
@utility hover-show-parent {
  @media (hover: hover) {
    .group:hover & {
      opacity: 1;
    }
  }
}

/* group hover 시 display: none (hover 기기 전용) */
@utility hover-hide-parent {
  @media (hover: hover) {
    .group:hover & {
      display: none;
    }
  }
}

/* group hover 시 display: block (hover 기기 전용) */
@utility hover-show-block-parent {
  @media (hover: hover) {
    .group:hover & {
      display: block;
    }
  }
}

/* Tooltip — hover 기기에서만 표시 */
@utility hover-tooltip {
  @media (hover: hover) {
    .group\/tooltip:hover & {
      opacity: 1;
      visibility: visible;
    }
  }
  @media (hover: none) {
    display: none;
  }
}

/* 터치 기기에서 텍스트 선택 보장 */
.select-text {
  -webkit-user-select: text !important;
  user-select: text !important;
}
```

### `frontend/src/components/ui/Switch.tsx`

- 스위치 버튼: `h-5 w-9` → 유지하되, 외부 `<label>` 래퍼에 `min-h-[44px]` 추가
- 전체 label 영역을 터치 타겟으로 사용

```
Before: <label className="inline-flex items-center gap-2 select-none ...">
After:  <label className="inline-flex items-center gap-2 select-none min-h-[44px] ...">
```

### `frontend/src/components/ui/Tooltip.tsx`

- `group-hover/tooltip:opacity-100 group-hover/tooltip:visible` → `hover-tooltip` 유틸리티로 교체
- 터치 기기에서 tooltip은 숨기고 `title` attribute는 유지 (브라우저 네이티브 long-press tooltip)

```
Before: className="... opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible ..."
After:  className="... opacity-0 invisible hover-tooltip ..."
```

### `frontend/src/components/layout/AppLayout.tsx`

- 사이드바 토글 버튼: `p-1.5` → `p-2.5` (44px 터치 타겟)
- `hover:bg-accent` → 유지 (단독 버튼이라 고착 문제 없음)

### `frontend/src/components/layout/Sidebar.tsx`

- NavLink `py-2` → `py-2.5` (높이 40px → 44px)
- 설정 버튼 동일 처리
- 닫기 버튼 `p-1.5` → `p-2.5`

### `frontend/src/components/meeting/AudioPlayer.tsx`

- 재생/정지 버튼: `w-8 h-8` → `w-11 h-11` (44px)
- 배속 버튼: `px-2 py-0.5` → `px-3 py-1.5 min-h-[44px]`
- 다운로드 버튼: `p-1.5` → `p-2.5`
- 프로그레스 바 thumb: `opacity-0 group-hover:opacity-100` → `opacity-100` (항상 표시) 또는 `hover-hide hover-show-parent`
- 프로그레스 바 높이: `h-1.5` → `h-2` + 터치 영역 `py-4` (클릭/터치 영역 확대)

### `frontend/src/components/meeting/ExportButton.tsx`

- 트리거 버튼: `px-3 py-1.5` → `px-3 py-2 min-h-[44px]`
- 형식 선택 버튼: `px-2 py-1.5` → `min-h-[44px]`
- 체크박스 라벨: `mb-2` → `min-h-[44px] flex items-center`
- 취소/다운로드 버튼: `px-3 py-1.5` → `px-3 py-2 min-h-[44px]`

### `frontend/src/components/meeting/ShareButton.tsx`

- 공유 버튼: `px-3 py-1.5` → `px-3 py-2 min-h-[44px]`
- 복사/중지 아이콘 버튼: `p-0.5` → `p-2` (터치 영역 확대)
- 아이콘 간 간격 보장: 이미 `gap-1.5` → `gap-2` (8px)

### `frontend/src/components/meeting/ShareLinkButton.tsx`

- 버튼: `px-3 py-1.5` → `px-3 py-2 min-h-[44px]`

### `frontend/src/components/meeting/TranscriptPanel.tsx`

- 각 전사 항목: `p-2` → `p-3 min-h-[44px]`
- 전사 텍스트: `select-text` 추가
- `hover:bg-gray-100` → 유지 (카드 호버는 문제 없음), `active:bg-gray-100` 추가

### `frontend/src/components/meeting/SpeakerPanel.tsx`

- 초기화 버튼: `text-xs text-red-400` → `text-xs text-red-400 min-h-[44px] flex items-center`
- 화자 이름 편집 버튼: 행 전체를 `min-h-[44px]` 확보
- `hover:text-blue-600` → 유지 (텍스트 색상 hover는 문제 없음)

### `frontend/src/components/meeting/RecordTabPanel.tsx`

- 탭 버튼: `px-3 py-2` → `px-3 py-2 min-h-[44px]`

### `frontend/src/components/folder/FolderTree.tsx`

- 폴더 항목: `px-2 py-1` → `px-2 py-2 min-h-[44px]`
- 더보기 버튼 (`MoreHorizontal`): `p-0.5` → `p-2`
- `group-hover:block` / `group-hover:hidden` → `hover-show-block-parent` / `hover-hide-parent` 유틸리티
- 컨텍스트 메뉴 항목: `px-3 py-1.5` → `px-3 py-2.5 min-h-[44px]`

### `frontend/src/components/settings/SettingsModal.tsx`

- 닫기 버튼: `p-1.5` → `p-2.5`
- 탭 버튼: `px-4 py-2.5` → `px-4 py-3 min-h-[44px]`

### `frontend/src/pages/MeetingPage.tsx`

- 뒤로가기 버튼: `p-1.5` → `p-2.5`
- 첨부/메모/북마크 토글 아이콘 버튼: `p-1.5` → `p-2.5`
- 편집(Pencil) 아이콘 버튼: `p-1` → `p-2.5`
- STT 재생성/회의록 재생성/회의 재개 버튼: `px-3 py-1.5` → `px-3 py-2 min-h-[44px]`
- 삭제 버튼: `px-2 py-1` → `px-3 py-2 min-h-[44px]`
- 북마크 리스트 항목: `px-3 py-1.5` → `px-3 py-2.5 min-h-[44px]`
- 북마크 삭제 버튼: `opacity-0 group-hover:opacity-100` → `hover-hide hover-show-parent`
- 오타 수정 삭제 버튼: `w-6 h-6` → `min-w-[44px] min-h-[44px]`
- 확인/취소 다이얼로그 버튼: `px-3 py-1.5` → `px-4 py-2.5 min-h-[44px]`
- 전사 텍스트에 `select-text` 보장 (TranscriptPanel에서 처리)

### `frontend/src/pages/MeetingLivePage.tsx`

- 녹음 컨트롤 버튼(시작/일시정지/종료): `px-3 py-1.5` → `px-3 py-2 min-h-[44px]`
- 뒤로가기·설정·북마크 등 아이콘 버튼: `p-1.5` → `p-2.5`
- 인접 버튼 그룹: `gap-2`(8px) 이상 확인, 부족하면 `gap-2`로 조정
- 오타 수정 삭제 버튼: `w-6 h-6` → `min-w-[44px] min-h-[44px]`
- 패널 리사이즈 핸들: `hover:bg-blue-400` → `[@media(hover:hover)]:hover:bg-blue-400` 또는 유지 (큰 문제 없음)

### `frontend/src/pages/MeetingsPage.tsx`

- 카드 `hover:bg-muted/50` → 유지 + `active:bg-muted/50` 추가 (터치 피드백)
- 삭제/편집 아이콘 (`group-hover` 패턴): `hover-hide hover-show-parent` 유틸리티
- 정렬/뷰 전환 아이콘 버튼: 터치 타겟 44px 확보
- 새 회의/파일 업로드 버튼: 이미 `px-4 py-2`로 44px 근접 → `min-h-[44px]` 추가
- 페이지네이션 버튼: `p-1.5` → `p-2.5`

### `frontend/src/pages/DashboardPage.tsx`

- 통계 카드: `hover:bg-muted/50` → 유지 + `active:bg-muted/50` 추가
- 최근 회의 카드: 동일 처리
- "전체 보기" 링크: 터치 타겟 `min-h-[44px] inline-flex items-center` 추가
- "첫 회의 시작하기" 버튼: 이미 `px-4 py-2`로 충분

### `frontend/src/pages/SearchPage.tsx`

- 검색 버튼: `px-4 py-2` → 유지 (이미 44px 근접), `min-h-[44px]` 추가
- 필터 토글 버튼: `p-2` → `p-2.5 min-h-[44px] min-w-[44px]`
- 검색 결과 카드: `hover:bg-accent/50` → 유지 + `active:bg-accent/50` 추가
- 페이지네이션 버튼: `p-1.5` → `p-2.5 min-h-[44px] min-w-[44px]`

---

## 데이터 흐름

이 태스크는 UI-only 변경이므로 데이터 흐름 변경 없음. API, 상태 관리, 라우팅에 대한 변경 없음.

---

## 구현 순서

| 순서 | 작업 | 범위 |
|------|------|------|
| 1 | `index.css` 유틸리티 추가 | hover-hide, hover-show-parent, hover-tooltip, select-text |
| 2 | 공통 UI 컴포넌트 수정 | Switch, Tooltip |
| 3 | 레이아웃 컴포넌트 수정 | AppLayout, Sidebar |
| 4 | 회의 관련 컴포넌트 수정 | AudioPlayer, ExportButton, ShareButton, ShareLinkButton, TranscriptPanel, AiSummaryPanel, SpeakerPanel, RecordTabPanel, AttachmentCard, ViewerHeader, ParticipantList |
| 5 | 폴더/설정 컴포넌트 수정 | FolderTree, FolderBreadcrumb, SettingsModal, SettingsContent, UserManagementPanel |
| 6 | Action Item / Decision 컴포넌트 수정 | ActionItemList, ActionItemForm, DecisionList, DecisionForm |
| 7 | 주요 페이지 수정 | MeetingPage, MeetingLivePage, MeetingsPage, DashboardPage, SearchPage |
| 8 | 기타 컴포넌트 수정 | EditMeetingDialog, AddFileDialog, AddLinkDialog, PromptTemplateManager |

---

## 검증 기준

| 항목 | 기준 |
|------|------|
| 터치 타겟 | Chrome DevTools 모바일 뷰포트에서 모든 버튼/링크의 렌더링 크기 >= 44x44px |
| 인접 버튼 간격 | 인접 인터랙티브 요소 사이 최소 8px |
| 호버 분기 | Chrome DevTools에서 `pointer: coarse` 에뮬레이션 시 hover 스타일 미적용 |
| 텍스트 선택 | 모바일 뷰포트에서 전사/요약 텍스트 길게 눌러 선택 가능 |
| 데스크톱 회귀 | 1280x800 뷰포트에서 모든 페이지 기존과 시각적으로 동일 |

## 선행 조건

- TSK-01-03 (AppLayout 반응형 재구성) -- `h-dvh`, CSS 유틸리티가 이미 index.css에 추가되어야 hover 유틸리티를 같은 파일에 추가할 수 있음
- TSK-00-01 (viewport meta 및 CSS 유틸리티 추가) -- `@media (hover: hover)` 호버 분기 유틸리티가 TSK-00-01에서 기본 골격이 추가되며, 이 태스크에서 실제 컴포넌트에 적용
