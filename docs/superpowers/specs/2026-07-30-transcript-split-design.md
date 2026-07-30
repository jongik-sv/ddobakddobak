# 전사 세그먼트 분할(split)

- 날짜: 2026-07-30
- 상태: 설계 승인됨 (사용자가 접근안 A 선택)
- 브랜치: `feature/transcript-split`
- 후속 스펙: 구간 절단(기밀 구간 삭제) — 별도 진행. 이 문서 부록에 확정된 결정만 기록.

## 목표

전사 한 행에 여러 화자의 발언이 섞여 있을 때, 사람이 지정한 지점에서 두 행으로 쪼개고
각 조각에 화자를 지정한다.

## 배경

두 가지 이유로 지금 필요하다.

1. **후속 "구간 절단" 기능의 전제조건.** 절단은 "완전히 포함된 전사 행 + 오디오 구간"으로
   환원하면 단순해지는데, 구간에 부분만 겹치는 행은 먼저 split으로 경계를 맞춰야 한다.
2. **기존 `destroy_batch`에 버그 2개**가 있고 신규 코드가 같은 컨트롤러에 들어가므로
   같은 PR에서 고친다 (아래 "동봉 수정").

## 범위 결정 (확정)

- **2분할만.** 3인 이상 섞인 행은 두 번 호출한다. N분할 일반화는 검증·UI 복잡도가 눈에 띄게
  올라가는데 빈도가 불확실하므로 하지 않는다.
- **분할 지점은 사람이 직접 지정.** 오디오 ms와 텍스트 문자 인덱스를 **독립된 두 입력**으로 받는다.
  자동 추정은 하지 않는다 — STT가 단어 단위 타임스탬프를 주지 않으므로
  (`transcription_job.rb:58-68`, `file_transcription_job.rb:165` 모두 세그먼트 단위 `started_at_ms`/
  `ended_at_ms`만 반환) 추정하면 문자 비율 선형 보간이 되어 신뢰할 수 없다.
- **두 입력 사이의 정합성은 검사하지 않는다.** 사람이 정한 값을 신뢰한다.
- API의 `split_index`는 임의 문자 인덱스를 받는다. **UI만 단어 경계로 제한한다**(프론트 절 참조) —
  서버에 단어 경계 규칙을 넣으면 한국어 토큰화 정의를 서버·클라이언트 두 곳에서 맞춰야 한다.
- 조각별로 화자를 다르게 지정할 수 있다 (원래 목적).
- 텍스트 내용 자체는 수정하지 않는다. 분할점에서 자르기만 한다 (수정은 기존 `update_content` 담당).

## 백엔드 — API

```
POST /api/v1/meetings/:meeting_id/transcripts/:id/split
{
  "split_ms": 123456,
  "split_index": 42,
  "expected_content": "…원문 전체…",
  "first":  { "speaker_label": "SPEAKER_00", "speaker_name": "김철수" },
  "second": { "speaker_label": "SPEAKER_01", "speaker_name": null },
  "client_id": "…"
}
→ 200 { "updated": <transcript_json>, "inserted": <transcript_json> }
```

### `expected_content`가 필수인 이유

`split_index`는 **클라이언트가 들고 있던 텍스트**에 대한 문자 위치다. 다이얼로그가 열려 있는
동안 다른 클라이언트(또는 같은 사용자의 다른 탭)가 `update_content`를 호출할 수 있고,
`update_content`에는 버전·etag가 없다(`transcripts_controller.rb:92-94`가 그냥
`transcript.update!(content:)`). 그러면 서버는 **이미 사라진 텍스트를 기준으로 계산된 인덱스**로
엉뚱한 지점을 자르고, `0 < i < length`만 만족하면 검증도 통과해 **200을 반환한다.**

즉 이 기능의 실패 모드가 조용한 전사 훼손이 된다. 같은 PR에서 고치는 `destroy_batch` 버그보다
나쁘다. 그래서 요청에 원문 전체를 실어 보내고 서버가 현재 `content`와 정확히 일치하지 않으면
409로 거부한다. `content`는 5000자 제한이 있어(`transcripts_controller.rb:87`) 전문 전송 비용이
문제되지 않으므로 다이제스트 대신 원문을 그대로 비교한다.

`split_ms`는 범위 검증이 있어 같은 위험이 없다.

`first`/`second` 키 자체가 생략되면 원행의 `speaker_label`/`speaker_name`을 그대로 승계한다
(시간·텍스트만 쪼개고 화자는 그대로 두는 용법). 키를 주면서 `speaker_name: null`을 명시하면
이름을 지우는 뜻이다 — 즉 "생략 = 승계", "null 명시 = 비움"으로 구분한다.

조각 텍스트는 각각 `strip` 한 값을 저장한다. 분할점 앞뒤 공백이 그대로 남으면 표시가 지저분하고,
아래 blank 검증과 저장값이 어긋난다.

### 검증

| 항목 | 규칙 | 실패 시 |
|---|---|---|
| `split_ms` | `started_at_ms < split_ms < ended_at_ms` (양 경계 배제) | 422 `split_ms out of range` |
| `split_index` | `0 < split_index < content.length` | 422 `split_index out of range` |
| 양쪽 조각 | `strip` 후 둘 다 non-blank | 422 `split produces blank content` |
| `expected_content` | 현재 `content`와 정확히 일치 | 409 + 한글 메시지 (위 참조) |
| `speaker_label` | 지정 시 non-blank (`Transcript`가 `validates :speaker_label, presence: true`) | 422 |
| 진행 상태 | `status` ∈ `recording`·`transcribing` 이거나 `summarizing == true` 면 금지 | 409 + 한글 메시지 |
| 잠금 | 기존 `reject_if_locked!` | 403 (기존 동작) |
| 권한 | `authorize_meeting_control!` | 기존 동작 |

`meetings.status`는 `pending`·`recording`·`transcribing`·`completed` 네 값이고
(`schema.rb:292` check constraint), 요약 진행은 별도 boolean 컬럼 `summarizing`이다
(`meeting.rb:592-605`). 셋 다 막는 이유가 각각 다르다.

- `recording` — `bulk_create` 멱등키와 재번호가 충돌 (아래 참조)
- `transcribing` — 파일 전사가 행을 계속 만드는 중이라 `sequence_number`가 유동적
- `summarizing == true` — 요약 잡이 `applied_to_minutes: false` 행을 읽는 중이라
  (`meeting_summarization_job.rb:150-153`) 그 사이 행을 쪼개면 append 대상이 어긋난다

에러 메시지는 `reject_if_locked!`(`meeting_write_guard.rb:13`)와 같이 한글 문장으로 맞춘다.

경계를 배제하는 이유: `split_ms == started_at_ms`면 조각1이 0길이가 되고,
`split_index == 0`이면 조각1 내용이 비어 `validates :content, presence: true`에 걸린다.

권한 등급을 `authorize_meeting_control!`로 두는 이유: split은 기밀 삭제가 아니라 전사 편집이고,
같은 성격의 `update_content`가 이미 이 등급을 쓴다(`transcripts_controller.rb:10`). 등급을 올리면
협업자가 자기가 고칠 수 있는 텍스트를 쪼갤 수는 없는 비대칭이 생긴다.

**녹음 중 금지가 특히 중요하다.** `bulk_create`는 `(meeting_id, sequence_number)`를 멱등키로
쓴다(`transcripts_controller.rb:33-35`). split이 뒤 행들의 `sequence_number`를 재번호하면
온디바이스 STT의 재전송이 엉뚱한 행을 갱신한다.

### 트랜잭션 순서

```ruby
ActiveRecord::Base.transaction do
  # 1. 뒤 행 재번호 (아래 주의사항 참조)
  #      Transcript.where(meeting_id: m.id).where("sequence_number > ?", orig.sequence_number)
  #        .reorder(nil).update_all("sequence_number = sequence_number + 1")
  # 2. 원행을 조각1로 update!  → after_save :fts_upsert 가 인덱스를 갱신
  # 3. 조각2를 create!         → after_save :fts_upsert
end
# 4. meeting.reconcile_embeddings!   (트랜잭션 밖 — 잡 큐잉)
# 5. meeting.update!(last_user_edit_at: Time.current)
# 6. ActionCable broadcast
```

**원행을 destroy 하고 2행을 새로 만들지 않는다.** 원행을 조각1로 `update!` 하고 조각2만
`create!` 하면 기계장치가 확실히 줄어든다 — 조각1에 대한 FTS delete/insert 왕복이 없고,
임베딩 행이 새로 생기지 않고, SQLite rowid 재사용을 걱정할 일이 없고, 프론트 스토어가 기존
항목을 그 id로 계속 들고 있으면 되므로 "1개 제거 + 2개 삽입" 스플라이스가 필요 없다.
브로드캐스트도 `{updated, inserted}`로 단순해진다.

`update_all`에 `.reorder(nil)`을 붙이는 이유: `Transcript`에 `default_scope { order(:sequence_number) }`가
있어서 관계에 ORDER BY가 붙은 상태로 `update_all`이 나간다. SQLite는 `UPDATE ... ORDER BY`를
컴파일 플래그 없이는 지원하지 않는다. Rails가 어댑터별로 걸러줄 수도 있지만 확인에 의존하지 않고
`reorder(nil)`로 확실히 떼는 쪽을 택한다. `Transcript.where(meeting_id:)`로 시작하는 것도
`@meeting.transcripts` 관계에 딸린 스코프를 피하기 위함이다.

`(meeting_id, sequence_number)`에 unique 제약이 없으므로(`schema.rb:407` — 일반 index)
재번호 중 중간 충돌은 없다.

### 승계·갱신 필드

| 필드 | 조각1 (원행 `update!`) | 조각2 (신규 `create!`) | 안 하면 |
|---|---|---|---|
| `content` | `content[0...split_index]` | `content[split_index..]` | — |
| `started_at_ms` | 원값 유지 | `split_ms` | 마커 해석이 깨진다(아래 참조) |
| `ended_at_ms` | `split_ms` | 원값 유지 | — |
| `sequence_number` | 원값 유지 | 원값 + 1 | `default_scope order(:sequence_number)`에서 순서가 뒤섞인다 |
| `speaker_label`/`speaker_name` | 요청값 또는 원값 승계 | 동일 | — |
| `audio_source` | 승계 | 승계 | mic/system 구분이 깨진다 |
| `applied_to_minutes` | **원값 그대로 복사** | **원값 그대로 복사** | `false`로 새로 만들면 realtime 요약이 그 구간을 **다시 append** 한다 (`meeting_summarization_job.rb:150-153`, `:187-196`) |

조각1이 원래 `started_at_ms`를 유지하는 것이 마커 안전성의 근거다. 요약·챗의 인용 마커는
`⟦t:<ms>|s:<화자>⟧` 형태로 전사의 `started_at_ms`를 가리키고, 프론트는 `speakerAtMs`
(`citationMarkers.ts:57-70`)로 **ms에서 현재 화자를 다시 해석**한다. 마커 안의 화자 문자열은
표시에 쓰이지 않으므로 조각에 다른 화자를 지정해도 무해하다.

### 브로드캐스트

`update_content`는 내용만 바뀌므로 `transcript_updated`로 충분하지만, split은 행이 하나 늘고
기존 행의 ms 경계도 바뀌므로 새 이벤트가 필요하다.

```ruby
ActionCable.server.broadcast(@meeting.transcription_stream, {
  type: "transcript_split",
  updated: transcript_json(first),
  inserted: transcript_json(second),
  client_id: params[:client_id]
})
```

클라이언트는 `updated.id` 항목을 제자리에서 갱신하고 그 **바로 뒤에** `inserted`를 끼운다.
뒤 행들의 `sequence_number`가 바뀐 것은 클라이언트 표시 순서에 영향이 없으므로 전송하지 않는다
(프론트는 API가 준 배열 순서를 유지한다).

## 동봉 수정 — 기존 `destroy_batch` 버그 2개

`transcripts_controller.rb:20-26`.

1. **`delete_all`이 FTS에 평문을 남긴다.** `transcripts_fts` 유지는 DB 트리거가 아니라
   Rails 콜백(`fts_indexable.rb:6-7` `after_destroy :fts_delete`)이고 `delete_all`은 콜백을
   건너뛴다. 검색 결과로 새지는 않는다 — `search_service.rb:62`와
   `folder_chat_context.rb:69`가 `JOIN transcripts t ON t.id = transcripts_fts.source_id`라
   orphan은 걸러진다. 그러나 **삭제한 발언의 평문이 SQLite 파일 안에 그대로 남는다.**
   후속 기밀 삭제 기능에서는 이게 곧 결함이 된다. `destroy_all`로 바꾼다.
2. **`last_user_edit_at`을 갱신하지 않는다.** 전사를 지워도 D'Flow 재전송 판정
   (`meeting.rb:478-481` `dflow_needs_resync?`)에 잡히지 않는다. 갱신을 추가한다.

## 프론트엔드

### 진입점

`TranscriptPanel.tsx`의 세그먼트 행에 "분할" 액션을 둔다. 기존
`EditableTranscriptText`(더블클릭 → contentEditable, Enter 저장)와 **모드를 섞지 않는다** —
Enter 키 의미가 충돌한다.

### 분할 모달 (`SplitTranscriptDialog`)

입력이 두 개 독립값이고 프리뷰가 필요하므로 인라인이 아니라 모달로 만든다.

- **텍스트 분할점 — 단어 경계 단위.** 원문을 단어 토큰으로 쪼개 각 경계에 클릭·탭 가능한
  삽입점을 렌더하고, 선택된 경계의 문자 인덱스를 `split_index`로 보낸다.

  캐럿(`<textarea readOnly>`의 `selectionStart` 또는 contentEditable Range)을 쓰지 않는 이유:
  readOnly textarea가 터치 환경에서 캐럿을 놓아주지 않는 경우가 있어 모바일·Tauri Android
  WebView 동작이 플랫폼에 의존하게 된다. 단어 경계 방식은 그냥 버튼 클릭이라 플랫폼 의존이
  없고, 화자가 바뀌는 지점은 사실상 항상 단어·문장 경계이므로 글자 단위 정밀도를 잃어도
  손실이 없다. 데스크톱에서도 캐럿 놓기보다 클릭이 쉽다.
- **오디오 위치**: "현재 재생 위치 사용" 버튼(플레이어의 현재 ms 채택) + `mm:ss.mmm` 직접 입력.
  범위는 `(started_at_ms, ended_at_ms)` 개방구간으로 클램프.
- **화자 2개**: `getSpeakers(meetingId)`(`api/speakers.ts:8`)로 기존 화자 목록을 드롭다운에,
  새 화자 직접 입력도 허용. 기본값은 양쪽 다 원행 화자.
- **프리뷰**: 두 조각의 텍스트와 각 ms 범위를 나란히 표시. 저장 전에 눈으로 확인 가능해야 한다.
- 서버 검증 규칙을 클라이언트에서도 미리 걸어 저장 버튼을 비활성화한다.

### 스토어

`transcriptStore`에 split 반영 액션을 추가한다 (`updateFinal` 옆): 기존 항목을 `updated`로
갱신하고 그 뒤에 `inserted`를 끼운다. 낙관적 갱신은 하지 않는다 — 조각2의 id는 서버가
만들므로 응답을 받고 반영한다. 저장 중 스피너로 처리.

409(`expected_content` 불일치)를 받으면 "다른 곳에서 이 발언이 수정되었습니다. 다시 시도하세요"로
안내하고 다이얼로그를 최신 내용으로 리셋한다.

## 테스트

**백엔드 (RSpec)**

- request spec: 정상 분할 — 행 2개, 텍스트·ms 경계, 승계 필드 전부(특히 `applied_to_minutes`)
- request spec: 검증 4종 각각 422 (`split_ms` 경계값 2개 포함), 잠금 403, 권한
- request spec: 진행 상태 가드 3종 각각 409 (`recording`, `transcribing`, `summarizing: true`)
- request spec: 뒤 행 `sequence_number`가 +1 되고 전체 순서가 유지됨
- request spec: `last_user_edit_at` 갱신 확인
- request spec: `expected_content` 불일치 시 409, 그리고 **행이 전혀 변경되지 않았음**
- **FTS 정합성**: 분할 후 `transcripts_fts`에 원행 텍스트가 없고 조각 2개가 있음.
  `delete_all`로 되돌리면 실패해야 한다(반증 확인).
- **`applied_to_minutes` 반증**: `applied_to_minutes: true` 행을 분할해 양쪽이 `true`임을
  단언하고, 이를 `false`로 되돌리면 요약 잡이 그 내용을 `notes_markdown`에 **다시 append**
  하는지 확인한다. 이 필드가 조용히 텍스트를 재주입하는 유일한 경로이고, 후속 기밀 삭제
  스펙이 이게 일어나지 않는다는 것에 의존한다.
- `destroy_batch` 회귀: `destroy_all` 전환 후 FTS에서 사라짐 + `last_user_edit_at` 갱신
- 임베딩: `reconcile_embeddings!` 호출됨

**프론트 (vitest)**

- `SplitTranscriptDialog`: 단어 경계 클릭 → 해당 문자 인덱스가 `split_index`로 전송,
  재생 위치 채택, 범위 밖 ms 거부, 양 끝 경계 선택 시 저장 비활성화, 프리뷰 내용,
  `expected_content`가 원문 그대로 실려 감
- `transcriptStore`: split 반영이 기존 항목을 갱신하고 바로 뒤에 새 항목을 끼움
- ActionCable `transcript_split` 수신 처리
- 409 응답 시 안내 + 다이얼로그 리셋

## 하지 않는 것 (YAGNI)

- N분할 일반화
- ms 자동 추정 / word-level 타임스탬프 도입
- 역연산(인접 두 행 병합)
- 되돌리기(undo)
- 오디오 편집 — 후속 스펙
- 분할 중 텍스트 내용 수정 (기존 `update_content` 사용)

---

## 구현 후 확정된 사항 (2026-07-30, 브랜치 `feature/transcript-split`)

설계 당시 못 본 함정과, 구현하며 스펙보다 좁히거나 넓힌 부분.

### 스펙에 없었던 함정

- **JS UTF-16 vs Ruby 코드포인트 불일치.** `split_index`를 프론트가 계산하는데 JS 문자열
  오프셋은 UTF-16 코드유닛이고 Ruby `String#[]`·`#length`는 코드포인트다. BMP 밖 문자
  (이모지 등)가 앞에 있으면 서버가 다른 위치를 자른다. `SplitTranscriptDialog`에
  `utf16ToCodepointIndex()`를 두어 전송 전에 변환한다. 반증 테스트 필수 — 순수 BMP(한글)
  문자열로만 테스트하면 변환이 no-op이라 회귀를 못 잡는다.
- **원격 split이 조각2를 소실시켜 보인다.** `TranscriptPanel`은 `transcripts` prop으로
  렌더하고 store는 content override만 제공한다. 원격 split 수신 시 store가 기존 행을 조각1로
  줄이지만 삽입된 조각2는 prop 배열에 없어 렌더되지 않는다 → 다른 사용자 화면에서 조각2
  텍스트가 사라져 보인다. `transcriptStore.remoteSplitRevision` + `markRemoteSplit()`
  (채널 경로에서만 증가)과 `MeetingPage`의 재조회 이펙트로 해결. 로컬 split은
  `handleTranscriptSplit`이 직접 반영하므로 카운터를 건드리지 않아 중복 재조회가 없다.
  `resetTranscriptStore()` 이펙트가 같은 커밋에서 먼저 실행되며 카운터를 0으로 되돌리므로,
  비교는 반드시 `useTranscriptStore.getState()`의 현재값으로 해야 한다 — 이펙트 클로저의
  reactive 값을 쓰면 마운트마다 스퓨리어스 재조회가 나간다(실측 확인: 1회 기대 → 3회).
- **로컬 split 후 트레일링 `sequence_number` 드리프트.** 서버는 뒤 행 전체를 `+1` 재번호하는데
  응답 `{updated, inserted}`엔 그 정보가 없다. `handleTranscriptSplit`·`applySplit`에서 서버
  동작을 미러링한다(`updated.sequence_number`보다 큰 행만 +1; `inserted`는 이미 orig+1이므로
  미러링 뒤에 splice해야 이중 증가하지 않는다). 데이터 손상 경로는 없다 — 이어녹음 시드
  `baseSeq`는 로컬 IndexedDB에서 나온다(`useLocalRecording.ts:183-184`).
- **`MeetingPage`·`meetingDetailTabs` prop 스레딩이 필요하다.** `TranscriptPanel`의 표시 배열을
  실제로 소유한 건 페이지다. store만 갱신해서는 분할된 새 행이 화면에 나타나지 않는다.
- **파라미터 타입 방어.** `split_ms`/`split_index`가 Hash·Array면 `to_i`가 없어
  `NoMethodError` → unhandled 500(`application_controller`에 `StandardError` 캐치 없음).
  `scalar_param?`(String 또는 Numeric)로 `.to_i` 앞에서 걸러 422로 만든다. `nil`도 함께 걸린다.
  액션 전체를 `rescue`로 감싸면 진짜 버그를 삼키므로 하지 않았다.

### 스펙보다 좁힌·넓힌 부분

- **`speaker_label` "지정 시 non-blank"**: 명시적으로 지정한 값이 blank인 경우만 사전 422.
  키를 생략해 승계한 결과가 blank인 잔여 케이스(`bulk_create`가 온디바이스 미상 화자를
  `speaker_label: ""`로 `save!(validate: false)` 저장할 수 있다)는 모델 검증에 맡기고
  `ActiveRecord::RecordInvalid`를 422로 변환한다. 트랜잭션이 롤백되어 부분 반영은 없다.
  `bulk_create`의 `validate: false` 우회를 사용자 대면 엔드포인트로 확장하지는 않았다.
- **`first`/`second` 승계는 필드 단위**: 객체를 주면서 일부 키만 넣으면 그 키만 오버라이드하고
  나머지는 승계. 객체 자체가 없을 때만 전부 승계.
- **`destroy_batch`의 `last_user_edit_at`은 실제 삭제가 있을 때만** 갱신한다. 존재하지 않는
  id만 보낸 요청까지 갱신하면 아무것도 안 바뀌었는데 D'Flow가 재전송 대상으로 오판한다.
  `apply_glossary_entry`(`meetings_controller.rb:661-664`)와 같은 원칙.
- **409 재조회 실패 시 저장 영구 비활성화**: `getTranscripts`가 실패를 삼켜 `[]`를 반환하므로
  "재조회 실패"와 "행 부재"가 프론트에서 구분되지 않는다. 어느 쪽이든 옛 `expected_content`로
  재저장하면 반드시 또 409이므로, 안내 후 저장을 막아 무한 루프에 갇히지 않게 한다.
- **분할 진입 버튼은 hover 전용이 아니다.** 캐럿 대신 단어 경계 버튼을 쓴 이유가 터치 대응인데
  진입점이 hover 전용이면 모바일에서 누를 수 없다.

### 알려진 한계 (수용)

- 재조회 `getTranscripts(meetingId).then(...)`에 취소·에러 처리가 없다. 같은 파일의 기존 초기
  로드 이펙트와 동일한 패턴이므로 회귀가 아니고, 하나만 방어적으로 바꾸면 불일치가 생겨
  그대로 두었다.
- `remoteSplitRevisionSeenRef.current === null` 분기는 실제로 도달하지 않는다(reset 이펙트가
  항상 먼저 실행). 이펙트 선언 순서 변경·커스텀 훅 추출 리팩토링 대비 방어 가드로만 남겼다.

### 검증 실측

- 백엔드 전체 스위트: **2158 examples, 0 failures** (20분 29초). 착수 전 main 2127 + 신규 31,
  `transcripts_spec.rb`의 `it` 개수 증가분(16 → 47)과 정확히 일치.
- 백엔드 rubocop: no offenses.
- 프론트 `npx tsc -p tsconfig.app.json`: 에러 0.
- 프론트 전체 `npx vitest run`: **213 files / 1904 tests 통과**. uncaught exception은
  `AiChatPanel.test.tsx`·`MeetingLivePage.test.tsx` 사전 존재분뿐(둘 다 미터치).
- 적대 검토 2회(작성자 아닌 별도 에이전트). 백엔드 major 1건(위 타입 방어), 프론트 minor 5건
  전부 처리. 반증 실증: 코드포인트 변환 제거 시 2개 실패, 트레일링 미러링 제거 시 1개 실패,
  `getState()` 대신 클로저 값 사용 시 재조회 1회→3회 — 각각 확인 후 복원.

---

## 부록 — 후속 "구간 절단" 스펙에서 이미 확정된 결정

별도 스펙으로 진행하지만 이 대화에서 확정된 것을 잃지 않기 위해 기록한다.

- **방식은 절단**(묵음 마스킹 아님). 구간 N개를 모아 한 번에 잘라낸다.
- **전사는 ms를 당긴다.** 구간이 여러 개면 각 행 앞에 잘린 총량이 누적 delta가 되므로
  행별 계산이 필요하다.
- **회의록(요약)은 마커를 고치는 대신 행을 지우고 재요약을 유도한다.** realtime 요약은
  append형이라(`meeting_summarization_job.rb:150-153`) 전사를 지워도 `notes_markdown`에서
  텍스트가 사라지지 않는다.
- **`meetings.brief_summary`는 명시적으로 nil 처리해야 한다.** `meeting.rb:615`가
  `update_column(..., text) if text.present?`라 재생성 결과가 빈 값이면 옛 발췌가 남는다.
  그리고 이 컬럼은 LIKE 검색 대상이다(`meeting.rb:151`).
- **`action_items`/`decisions`의 `ai_generated: true` 행도 재생성 대상.** 전사에서 LLM이
  추출한다(`meeting_finalizer_service.rb:28-41`). 기존 재생성 경로가 있다(`meetings_controller.rb:565-566`).
- **오디오 경계는 이웃 행과의 gap 중간점으로 클램프.** 전사 행의 ms를 그대로 쓰면 인접
  발언을 깎는다 — 오디오 overlap 500ms로 구간이 겹치도록 만들어져 있다
  (`citationMarkers.ts:46-48` 주석).
- **챗 히스토리는 지우지 않는다 (사용자 결정).** 결과로 두 가지를 한계로 수용한다.
  - 기밀 완전 삭제가 아니다. `chat_messages.content`에 어시스턴트가 풀어 쓴 내용이 남는다.
    노출 범위는 사용자별 사유 데이터라(`for_user`, `scoped_chat_messages_controller.rb:9`)
    이미 전사를 볼 수 있던 사람으로 한정된다.
  - 챗 마커 보정이 필요하다. `speakerAtMs`에 nearest 폴백이 있어
    (`citationMarkers.ts:71-78`) 어긋난 마커가 에러 없이 **조용히 엉뚱한 발언으로 시크**한다.
    절단 구간 이후 마커는 누적 delta만큼 shift, 절단 구간 **내부**를 가리키는 마커는 제거.
    회의 스코프 + 그 회의를 `⟦m:<id>/t:<ms>⟧`(`FOLDER_CITATION_RE`)로 인용한 폴더·프로젝트
    스코프까지 대상.
- **D'Flow는 사용자가 직접 처리 (사용자 결정).** 이미 전송된 회의록은 우리 DB를 지워도
  D'Flow에 남는다. 삭제 확인 다이얼로그에 경고 + 링크를 띄운다. Tauri에서 `window.confirm`은
  non-blocking이라 취소해도 실행되므로 `confirmDialog` 헬퍼를 써야 한다.
- **오디오 재인코딩 손실을 수용한다.** 절단은 `-c copy`가 안 되고, 원본 mp3가 64kbps
  (`audio_upload_job.rb` `MP3_BITRATE`)이며 원본 webm은 이미 삭제된다(`cleanup_original`).
  원본 보존은 기밀 목적과 정면으로 배치되므로 한 세대 손실을 받아들인다.
- **파괴적 절단이므로 필터 인프라가 불필요하다.** `redacted_ranges` 테이블도, STT 재실행·화자
  재분리·검색·내보내기 경로의 구간 필터도 필요 없다 — 원음과 전사 행이 실제로 없기 때문이다.
  (UI에 "이 구간 삭제됨"을 표시하거나 감사 로그를 남기려면 그건 별개 이유로 필요.)
- **미확인 항목**: `solid_queue_jobs.arguments`에 전사 텍스트가 실려 남는지. `SttChunkStorage`를
  만든 이력을 보면 조심한 흔적이 있으나 확인하지 않았다.
- **데스크톱 로컬 잔존**: `src-tauri/src/audio/mod.rs:139`의 `recordings/<meetingId>.wav`는
  업로드 성공 후 삭제되지만(`:182-184`), 업로드 실패·미완료 회의는 클라이언트에 원음이 남는다.
  서버 삭제가 미치지 못하는 범위로 명시한다.
- **Whisper 환각**: 잘라내는 방식이므로 무관하나, 묵음 마스킹을 택했다면 재전사 시 묵음에서
  환각 텍스트가 나올 수 있다는 리스크가 있었다.
