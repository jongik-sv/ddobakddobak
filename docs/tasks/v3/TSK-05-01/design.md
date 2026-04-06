# TSK-05-01: 검색 결과 회의별 그룹핑 - 설계

## 구현 방향
- 백엔드 변경 없이, 프론트엔드에서 `SearchResult[]` 배열을 `meeting_id` 기준으로 그룹핑하여 렌더링
- 기존 SearchPage에서 flat list로 렌더링하던 결과를 `MeetingResultGroup` 컴포넌트 단위로 변경
- 각 그룹은 회의 헤더(제목 + 날짜 + 매칭 건수)와 하위 snippet 카드 목록으로 구성
- 기본 펼침 상태, `ChevronDown`/`ChevronUp` 아이콘으로 접기/펼치기 토글
- 회의 헤더의 제목 영역 클릭 시 해당 회의 페이지(`/meetings/:id`)로 이동
- 기존 `TypeBadge`, `HighlightSnippet` 서브 컴포넌트를 그대로 재사용
- 기존 필터, 페이지네이션 로직은 변경 없이 유지 (그룹핑은 페이지 단위 결과에 대해 적용)

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/pages/SearchPage.tsx` | 그룹핑 로직 추가, 결과 렌더링을 `MeetingResultGroup`으로 교체 | 수정 |
| `frontend/src/pages/SearchPage.test.tsx` | 그룹핑 렌더링, 접기/펼치기 토글, 매칭 건수 표시 테스트 추가 | 수정 |

## 주요 구조

### 그룹핑 유틸 함수 (`groupByMeeting`)

SearchPage 파일 내부에 정의. 별도 파일 분리 불필요 (단일 사용처).

```ts
interface MeetingGroup {
  meeting_id: number
  meeting_title: string
  created_at: string          // 그룹 내 가장 최신 created_at
  transcriptCount: number
  summaryCount: number
  results: SearchResult[]
}

function groupByMeeting(results: SearchResult[]): MeetingGroup[] {
  const map = new Map<number, MeetingGroup>()
  for (const r of results) {
    let group = map.get(r.meeting_id)
    if (!group) {
      group = {
        meeting_id: r.meeting_id,
        meeting_title: r.meeting_title,
        created_at: r.created_at,
        transcriptCount: 0,
        summaryCount: 0,
        results: [],
      }
      map.set(r.meeting_id, group)
    }
    if (r.type === 'transcript') group.transcriptCount++
    else group.summaryCount++
    if (r.created_at > group.created_at) group.created_at = r.created_at
    group.results.push(r)
  }
  return Array.from(map.values())
}
```

- `Map`으로 출현 순서 보존 (백엔드가 이미 시간순 정렬하여 반환)
- 그룹 내 `results` 배열은 원본 순서 유지

### `MeetingResultGroup` 컴포넌트

SearchPage 파일 내부에 정의. Props:

```ts
interface MeetingResultGroupProps {
  group: MeetingGroup
  onNavigate: (meetingId: number) => void
}
```

**렌더링 구조:**

```
<div className="border rounded-lg bg-card overflow-hidden">
  {/* 그룹 헤더 */}
  <div className="flex items-center gap-2 px-4 py-3 bg-muted/30">
    {/* 접기/펼치기 토글 버튼 */}
    <button onClick={toggleExpand}>
      <ChevronDown /> 또는 <ChevronUp />
    </button>

    {/* 회의 제목 (클릭 시 회의 페이지 이동) */}
    <button onClick={() => onNavigate(group.meeting_id)}>
      <span className="font-medium">{group.meeting_title}</span>
    </button>

    {/* 날짜 */}
    <span className="text-xs text-muted-foreground">
      {formatted date}
    </span>

    {/* 매칭 건수 배지 */}
    <div className="ml-auto flex gap-1.5">
      {group.summaryCount > 0 && <span>요약 {N}건</span>}
      {group.transcriptCount > 0 && <span>전사 {N}건</span>}
    </div>
  </div>

  {/* 하위 snippet 카드 목록 (expanded 상태일 때만) */}
  {expanded && (
    <div className="divide-y divide-border">
      {group.results.map(result => (
        <div className="px-4 py-3">
          <TypeBadge type={result.type} />
          {result.speaker && <span>{result.speaker}</span>}
          <HighlightSnippet html={result.snippet} />
        </div>
      ))}
    </div>
  )}
</div>
```

**상태 관리:**
- `const [expanded, setExpanded] = useState(true)` -- 기본 펼침
- 토글 버튼 클릭 시 `setExpanded(prev => !prev)`

**접근성:**
- 토글 버튼에 `aria-expanded={expanded}`, `aria-label="접기"/"펼치기"` 설정
- 하위 카드 영역에 `role="region"` 설정

### SearchPage 수정 사항

1. **import 추가**: `ChevronDown`, `ChevronUp` (lucide-react)
2. **그룹핑 적용**: 결과 렌더링 부분에서 `results.map(...)` 대신 `groupByMeeting(results).map(group => <MeetingResultGroup .../>)` 사용
3. **총 건수 표시**: 기존 `총 {total}건의 결과` 문구는 그대로 유지 (서버 total 기준)

**변경 전 (line 178~201):**
```tsx
<div className="space-y-2">
  {results.map((result, idx) => (
    <button key={...} onClick={...}>
      {/* flat card */}
    </button>
  ))}
</div>
```

**변경 후:**
```tsx
<div className="space-y-3">
  {groupByMeeting(results).map(group => (
    <MeetingResultGroup
      key={group.meeting_id}
      group={group}
      onNavigate={(id) => navigate(`/meetings/${id}`)}
    />
  ))}
</div>
```

## 데이터 흐름

```
searchMeetings API 호출
  --> SearchResponse { results: SearchResult[], total, page, per_page }
  --> setResults(res.results)  -- 기존 state 그대로
  --> 렌더링 시 groupByMeeting(results) 호출
  --> MeetingGroup[] 배열 생성 (meeting_id 기준 그룹핑)
  --> MeetingResultGroup 컴포넌트 N개 렌더링
  --> 각 그룹 내 expanded state로 접기/펼치기 제어
```

- 그룹핑은 렌더링 시점에 매번 수행 (`results` state가 바뀔 때만 재계산)
- `useMemo`로 감싸서 불필요한 재계산 방지: `const groups = useMemo(() => groupByMeeting(results), [results])`

## 테스트 계획

### SearchPage.test.tsx 수정/추가 케이스

1. **동일 회의 결과가 그룹으로 묶여 표시됨** -- meeting_id 동일한 2건 반환 시 회의 제목이 1번만 헤더로 나타나는지 확인
2. **그룹 헤더에 매칭 건수 표시** -- `요약 1건`, `전사 2건` 텍스트 존재 확인
3. **접기/펼치기 토글 동작** -- 토글 버튼 클릭 시 하위 snippet 카드 숨김/표시 확인
4. **회의 헤더 클릭 시 네비게이션** -- 그룹 헤더의 제목 클릭 시 `navigate('/meetings/:id')` 호출 확인
5. **서로 다른 회의 결과는 별도 그룹** -- meeting_id가 다른 결과는 각각 독립 그룹으로 표시

### 기존 테스트 호환

- 기존 `검색 결과를 표시한다` 테스트: meeting_id가 서로 다르므로 각각 그룹 헤더로 표시됨. 회의 제목, TypeBadge 등은 여전히 DOM에 존재하므로 기존 assertion 호환 가능. 단, DOM 구조 변경으로 인해 selector 조정이 필요할 수 있음
- 기존 `결과 클릭 시 회의 페이지로 이동` 테스트: 회의 헤더 제목 클릭으로 변경되므로 assertion 유지 가능

## 선행 조건
- 없음 (depends: - 이며, 기존 SearchPage와 search API만 사용)
