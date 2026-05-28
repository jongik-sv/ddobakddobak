# 서버 설정 화면 — 저장된 서버 + 스캔 피드백 개선

- 날짜: 2026-05-28
- 대상 컴포넌트: `frontend/src/components/auth/ServerSetup.tsx`
- 신규 모듈: `frontend/src/lib/savedServers.ts`

## 배경 / 문제

서버 연결 설정 화면(Tauri 데스크톱·모바일 공용)에서 사용자가 다음 불편을 보고했다.

1. **스캔 버튼 무반응 체감** — "같은 Wi-Fi에서 서버 찾기" 버튼을 눌러도 눌린 느낌·진행 표시가 약해 동작 여부를 알기 어렵다. (스캔은 `/24` 대역 TCP 프로브로 2~5초 소요되므로 진행 표시가 특히 중요.)
2. **최근 서버에 포트번호가 그대로 노출** — URL 전체(`http://192.168.0.10:13323`)가 보여 지저분하다. 포트는 빼고 텍스트로만 표기 희망.
3. **마지막 서버 1개만 유효** — 여러 장소(사무실/집 등)를 옮겨 다니면 직전 접속만 남아 이전 이력 재접속이 어렵다.
4. **이력 편집 불가** — 이름/위치 같은 부가 정보를 붙이거나 항목을 삭제할 수 없다.

## 현재 구조

- localStorage 키 `recent_servers` = `string[]` (URL 문자열), 최대 5개, dedup.
- `pushRecentServer(url)`가 `handleComplete` 시 맨 앞에 추가.
- 렌더: 단순 URL 버튼 목록. `pickServer(url)` → URL 채우고 헬스체크.

## 결정 사항 (사용자 확정)

- 목록 성격: **저장된 서버(관리형)** — 접속 성공 시 자동 추가, 이름/위치 편집·삭제로 사용자가 직접 관리. 최근접속순 정렬, 캡 10.
- 포트 표시: **기본포트(13323) 숨김**, 그 외 포트만 `· 포트 NNNN` 텍스트.
- 편집 UX: **행 인라인 펼치기** (이름·위치 input + 저장/취소). 화면 전환·모달 없음.
- 삭제: **확인창 없이 즉시 삭제** (재접속 시 자동 재등록되므로 저비용).
- 위치 표시: 2줄 subline에 `host[· 포트 N][· 위치]`로 합쳐 표기.

## 설계

### 1. 데이터 모델 + 마이그레이션

```ts
interface SavedServer {
  url: string             // 정규화된 origin, 예: http://192.168.0.10:13323
  name?: string           // 사용자 지정 이름
  location?: string       // 사용자 지정 위치 메모
  lastConnectedAt: number // epoch ms — 정렬 키
}
```

- localStorage 키는 `recent_servers` **유지**. 로더가 두 형태를 모두 수용:
  - 항목이 `string` (구버전) → `{ url, lastConnectedAt: 0 }`로 변환.
  - 항목이 객체 → 그대로 사용 (url 필수, 나머지 옵셔널).
- 별도 마이그레이션 키 불필요. 구버전 사용자는 첫 로드 시 자동 변환되고, 다음 저장 시 새 형태로 기록된다.
- 캡 5 → **10** (`MAX_RECENT`).
- 정렬: `lastConnectedAt` 내림차순. 동률이면 기존 순서 유지.

### 2. 로직 모듈 분리 — `frontend/src/lib/savedServers.ts`

컴포넌트에서 localStorage 로직을 추출해 단위 테스트 가능하게 하고 `ServerSetup`을 축소한다.

```ts
export interface SavedServer { url: string; name?: string; location?: string; lastConnectedAt: number }

export function loadSavedServers(): SavedServer[]          // 로드 + 마이그레이션 + 정렬
export function upsertOnConnect(url: string): SavedServer[] // 접속 성공 기록. url 매칭 시 name/location 보존, lastConnectedAt만 갱신. 캡 10. 저장 후 목록 반환
export function updateSavedServer(url: string, patch: { name?: string; location?: string }): SavedServer[]
export function removeSavedServer(url: string): SavedServer[]
```

- 모든 쓰기 함수는 저장 후 최신 목록을 반환 → 컴포넌트가 setState에 그대로 사용.
- `try/catch`로 localStorage 파싱 실패 시 빈 배열 폴백 (기존 패턴 유지).

### 3. 표시 헬퍼

```ts
const DEFAULT_PORT = '13323'
function displayHost(url): string   // "192.168.0.10" (호스트만)
function displayPort(url): string|null // 기본포트면 null, 아니면 "8080"
```

- 행 렌더:
  - 1줄: `name || displayHost(url)`
  - 2줄(subline, muted): `[displayHost(url) (name 있을 때만), 포트 N (비기본일 때), location].filter(Boolean).join(' · ')`
    - name 없으면 1줄이 곧 host이므로 subline에서 host 생략 → subline = `[포트 N?, location?].join(' · ')` (비면 미표시).
    - name 있으면 subline = `host[· 포트 N][· 위치]`.

### 4. UI 변경 (`ServerSetup.tsx`)

- 섹션 제목 `최근 서버` → **`저장된 서버`**.
- 각 행: 본문 영역(클릭=`pickServer`, 연결 확인) + 우측 아이콘 ✎(편집)/✕(삭제). 아이콘은 `stopPropagation`으로 행 연결과 분리.
- **편집 모드**: `editingUrl` 상태. ✎ 클릭 시 해당 행이 인라인 펼쳐져 이름·위치 `<input>` + [저장][취소]. 저장 → `updateSavedServer` → 목록 갱신 + 펼침 닫기. 취소 → 펼침만 닫기.
- **삭제**: ✕ 클릭 → `removeSavedServer` 즉시 반영.
- 스캔/저장된 서버 행 모두 동일 스타일 패턴 유지 (선택 시 파란 테두리/링, 인라인 상태 아이콘 `renderRowStatus`).

### 5. 스캔 버튼 피드백 강화

- press 효과 강화: `active:scale-95 active:bg-slate-200` + `transition-transform`. (현재 `active:scale-[0.99]`는 거의 안 보임.)
- 스캔 중 표시 유지(스피너 + "서버 검색 중...") + 버튼 하단 보조 힌트: "같은 네트워크를 살펴보는 중… 수 초 걸려요". 스캔 완료/0건 시 기존 안내 문구 유지.

## 영향 범위 / 비목표

- 변경 파일: `ServerSetup.tsx`, 신규 `lib/savedServers.ts`, 테스트.
- Rust `scan_lan_servers` 변경 없음.
- 헬스체크/`normalizeUrl`/모드 선택 로직 변경 없음.
- 비목표: 서버 import/export, 클라우드 동기화, 즐겨찾기 별도 섹션.

## 테스트

- ⚠️ **선결 이슈**: 현재 `ServerSetup.test.tsx` 다수 실패 — placeholder가 코드(`192.168.0.10 또는 http://example.com:13323`)와 불일치(테스트는 `https://api.example.com` 기대). 컴포넌트를 손대므로 이 불일치를 정상화한다.
- 신규 단위 테스트 `lib/__tests__/savedServers.test.ts`:
  - 구버전 `string[]` 로드 → 마이그레이션.
  - `upsertOnConnect`: 신규 추가 / 기존 url의 name·location 보존 / lastConnectedAt 갱신 / 캡 10 / 최근순 정렬.
  - `updateSavedServer`, `removeSavedServer`.
- 컴포넌트 테스트 추가:
  - 저장된 서버 행 렌더 (이름/호스트/포트 표시 규칙, 기본포트 숨김).
  - ✎ → 인라인 input 노출 → 저장 시 표시 갱신.
  - ✕ → 행 제거.
- 검증: `npx vitest run` 전체 그린.

## 미해결 / 추후

- 없음.
