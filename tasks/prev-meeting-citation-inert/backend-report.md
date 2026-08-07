# Task 1 (Backend) 리포트: 연결 회의 시드 마커 m: 각인 + citation_meetings 맵

## 변경 파일 목록 (내가 만든 변경만 — 아래 "동시 작업 관찰" 참고)

- `backend/app/services/llm_prompts/citation_markers.rb`
  - `stamp_source_meeting(text, meeting_id)` 추가: bare `⟦t:..⟧` → `⟦m:<id>/t:..⟧` 각인. 이미 `m:`인 마커는 `CITATION_RE`가 매치하지 않아 그대로 보존(연쇄 연결 원출처 유지).
  - `referenced_meeting_ids(text)` 추가: `FOLDER_CITATION_RE`로 `m:` 마커의 회의id 전부 스캔(중복 제거, 정수 배열).
  - 헤더 주석의 마커 스트립 4곳 대조표를 m: 대응 완료 상태로 갱신.
- `backend/app/models/meeting.rb`
  - `seed_summary_from_previous!`: 복사 직전 `CitationMarkers.stamp_source_meeting(base, previous_meeting_id)` 적용.
- `backend/app/services/llm_prompts/citation_prompts.rb`
  - `CITATION_MARKER_INSTRUCTION`의 "[최우선] 보존" 지시에 `⟦m:..⟧`도 명시.
- `backend/app/models/summary.rb` (`fts_value_for`), `backend/app/services/markdown_exporter.rb` (`render_summary`), `backend/app/services/meeting_chat_context.rb` (`summary_text`)
  - 마커 스트립 정규식에 `(?:m:\d+\/)?` optional prefix 추가 — 기존 콜론/구분자 지원 범위는 그대로 두고 m: 케이스만 확장(파일 헤더 주석이 통일은 별도 후속이라 명시했던 기존 결정 존중).
- `backend/app/controllers/concerns/meeting_serializable.rb`
  - `meeting_json`의 `full` 블록에 `json[:citation_meetings] = citation_meetings_map(meeting)` 추가.
  - `citation_meetings_map(meeting)` private 메서드 추가: `active_summary.notes_markdown` → `referenced_meeting_ids` → `Meeting.accessible_by(current_user).where(id: ids).pluck(:id, :title).to_h`. 삭제/접근불가 회의는 `accessible_by` 스코프가 자연히 제외.
- 신규 spec: `backend/spec/requests/api/v1/meetings_citation_meetings_spec.rb`
- 확장 spec: `spec/services/llm_prompts/citation_markers_spec.rb`, `spec/models/meeting_previous_meeting_spec.rb`, `spec/models/summary_spec.rb`, `spec/services/meeting_chat_context_spec.rb`, `spec/services/markdown_exporter_spec.rb`

## 스트립 경로 grep 전수 목록 (항목 3)

`grep -rn "⟦" app/ --include="*.rb"` 기준, 마커를 지우거나 치환하는 코드 전부:

| 위치 | 역할 | m: 처리 |
|---|---|---|
| `app/models/summary.rb:14` (`fts_value_for`) | FTS 인덱싱 시 마커 제거 | 확장함 |
| `app/models/meeting.rb:623` (`extract_brief_summary`) | `brief_summary` 추출 시 마커 제거 | 이미 처리됨 — `/⟦[^⟧]*⟧/` 와일드카드라 원래부터 두 포맷 다 지움. 변경 없음 |
| `app/services/markdown_exporter.rb:43` (`render_summary`, D'Flow 전송이 이 클래스를 재사용) | 내보내기 마크다운 렌더 | 확장함 |
| `app/services/meeting_chat_context.rb:50` (`summary_text`) | 챗 컨텍스트 조립 | 확장함 |
| `app/controllers/api/v1/transcripts_controller.rb:801-827` (`rewrite_meeting_markers`/`rewrite_folder_markers`, redact 시 챗 마커 시프트) | 이미 `CITATION_RE`/`FOLDER_CITATION_RE` 둘 다 각각 전담 처리 | 원래부터 처리됨. 변경 없음 |
| `app/services/summary_zip_exporter.rb` | ZIP 내보내기 | `MarkdownExporter`를 그대로 호출 — 간접 커버 |
| `app/services/dflow_upload_service.rb` | D'Flow 전송 | 본문은 `MarkdownExporter.new(@meeting, include_transcript: false).call`로 만들어짐(62행) — 간접 커버. `current_notes_markdown`은 blank 체크에만 사용되고 전송 본문 자체는 아님 |
| `app/services/meeting_export_serializer.rb` | PDF/DOCX용 구조화 데이터 | 마커를 스트립하지 않고 원문 그대로 프론트에 전달(기존부터 그랬음, 이번 스코프 아님 — 프론트가 렌더 시 처리하는 경로로 추정, frontend/ 미확인·미수정) |

## Spec 실행

```
cd backend && bundle exec rspec \
  spec/services/llm_prompts/citation_markers_spec.rb spec/models/meeting_previous_meeting_spec.rb \
  spec/requests/api/v1/meetings_citation_meetings_spec.rb spec/models/summary_spec.rb \
  spec/services/meeting_chat_context_spec.rb spec/services/markdown_exporter_spec.rb
# → 70 examples, 0 failures
```

```
cd backend && bundle exec rspec \
  spec/models/meeting_summary_spec.rb spec/models/meeting_spec.rb spec/models/meeting_previous_meeting_spec.rb spec/models/summary_spec.rb \
  spec/services/dflow_auto_link_service_spec.rb spec/services/dflow_client_spec.rb spec/services/dflow_folder_migration_service_spec.rb spec/services/dflow_upload_service_spec.rb \
  spec/services/meeting_chat_context_spec.rb spec/services/meeting_exporter_spec.rb spec/services/meeting_finalizer_service_spec.rb spec/services/meeting_glossary_applier_spec.rb spec/services/meeting_importer_spec.rb spec/services/summary_zip_exporter_spec.rb \
  spec/services/llm_prompts/citation_markers_spec.rb \
  spec/requests/api/v1/meeting_dflow_spec.rb spec/requests/api/v1/meetings_previous_meeting_spec.rb spec/requests/api/v1/meetings_citation_meetings_spec.rb spec/requests/api/v1/meetings_export_spec.rb spec/requests/api/v1/summary_zip_export_spec.rb spec/requests/api/v1/meetings_spec.rb \
  spec/requests/api/v1/transcripts_spec.rb spec/requests/api/v1/meetings_audio_spec.rb \
  spec/jobs/meeting_chat_job_spec.rb spec/jobs/meeting_summarization_job_agenda_spec.rb spec/jobs/meeting_summarization_job_previous_spec.rb spec/jobs/meeting_summarization_job_spec.rb spec/jobs/summarization_job_spec.rb
# → 738 examples, 0 failures
```

전체 스위트(`bundle exec rspec`, 인자 없음, 1차):
```
Finished in 11 minutes 49 seconds
2401 examples, 0 failures
```
⚠️ 이 1차 실행은 아래 "Fix round 1" 착수 **전** 백그라운드로 띄운 프로세스라, Ruby가 부팅 시점에
로드한 코드 기준이다 — `meeting_serializable.rb`의 협업자 인가 보강과 그 신규 spec 3건은 이 실행에
반영되지 않았다(파일은 수정했지만 이미 뜬 프로세스는 재로드하지 않음). Fix 반영분은 아래 "Fix round 1"
절의 커버링 spec 55건 별도 실행(fresh process)으로 이미 green 확인했고, 정확성을 위해 전체 스위트를
Fix 반영 후 코드로 재실행한 결과를 "전체 스위트 2차"에 별도 기록한다.

## 설계와 다르게 한 결정 + 사유

1. **각인 구현을 `text.gsub(CITATION_RE) { |m| m.sub("⟦t:", "⟦m:#{id}/t:") }` 로 구현** (캡처 그룹을 재조합해 문자열을 새로 짓지 않음). 원본 마커의 구분자(`|` vs `/`)·시간 표기(ms vs mm:ss)를 그대로 보존하면서 `⟦m:<id>/` 접두만 삽입하는 것이 가장 손실 없는 방법이라 판단.
2. **스트립 3곳(summary.rb/markdown_exporter.rb/meeting_chat_context.rb)에 `(?:m:\d+\/)?` optional prefix만 추가**, 4개 사이트 정규식 전체 통일은 하지 않음. `citation_markers.rb` 파일 헤더에 이미 "통일은 별도 후속" 이라는 기존 설계 결정이 문서화돼 있어 그 결정을 존중 — brief의 "m: 포맷도 처리하도록 확장"만 정확히 수행하고 콜론 지원 등 기존 불일치는 손대지 않았다.
3. **`citation_meetings` 맵의 접근성 필터에 기존 `Meeting.accessible_by(current_user)` 스코프를 재사용**. 별도 권한 로직을 새로 만들지 않고 `update_owner`/`accessible_previous_meeting_id`와 동일한 기준을 그대로 적용 — 삭제(`kept` 스코프에 없음)와 비접근 회의를 자연히 함께 걸러낸다.
4. **`meeting_export_serializer.rb`(PDF/DOCX 내보내기)는 손대지 않음**. `notes_markdown`을 스트립 없이 그대로 프론트로 넘기는 기존 동작이라 이번 스코프의 "마커 스트립 경로"에 해당하지 않는다고 판단했고, frontend/ 수정 금지 제약도 있어 그 쪽 렌더 처리 여부는 확인하지 않았다 — 우려사항에 기재.

## 우려사항

1. **`meeting_export_serializer.rb`(PDF/DOCX 내보내기 JSON)는 notes_markdown을 마커 그대로 프론트에 전달한다.** 프론트가 이 마커를 렌더링 시 제거하지 않으면 PDF/DOCX 산출물에 `⟦m:.../t:.../s:...⟧` 텍스트가 그대로 노출될 수 있다(이번 시드 각인으로 `m:` 마커가 생기면서 발생 가능성이 t: 단독일 때보다 커짐 — 연결 회의를 쓰면 거의 항상 발생). frontend 확인은 스코프 밖이라 미검증.
2. **동시 작업 관찰**: 작업 중 같은 워킹트리(`feature/prev-meeting-citation-inert`, worktree 미분리)에서 별도 세션이 `citation_markers.rb`/`citation_prompts.rb`/`llm_service.rb`/`spec/services/llm_service_spec.rb`/`spec/services/llm_prompts_relocation_spec.rb`에 동시 수정을 가하는 것을 확인했다(인용 마커 "정규화"(`CitationMarkers.normalize`) 기능 추가로 보임, `lib/tasks/citation_markers.rake` 신규 포함). frontend/ 쪽도 다른 세션이 `useMeeting.ts`/`useViewerData.ts`/`transcriptStore.ts`/`types.ts`를 동시 수정 중이었다. 내 Edit 호출은 모두 성공했고 `git diff`로 확인한 결과 내 변경분과 그쪽 변경분이 겹치지 않고 공존하고 있으나, **워크트리 미분리 상태에서의 동시 편집은 근본적으로 레이스 컨디션**이다 — 최종 커밋 전 전체 diff를 한 번 더 사람이 검토할 것을 권한다.
3. **기존 데이터 미소급은 의도대로 미구현** — 이미 시드된 옛 `t:` 마커는 이번 변경으로 자동 전환되지 않는다(brief 제약대로). 참고로 동시 작업 중이던 다른 세션이 `lib/tasks/citation_markers.rake`(`normalize_summaries`)를 추가했는데, 이 rake task는 내 `m:` 각인과는 목적이 다른(LLM 출력 변형 교정) 별도 기능이라 이번 소급 미구현과는 무관하다.
4. **`⟦m:<id>/t:..⟧` 각인은 `previous_meeting`이 삭제되거나 접근이 바뀌어도 시드 시점 스냅샷 그대로 고정된다** — `citation_meetings` 맵은 매 조회 시 최신 접근성을 재평가하므로, 시드 이후 원본 회의가 삭제되면 마커는 남아있지만 맵에서는 빠져 프론트가 "이전 회의" 폴백으로 표시한다(brief 의도와 일치, 명시적으로 확인차 기록).

## Fix round 1 (리뷰 반영): citation_meetings_map 협업자 인가 보강

**Finding**: `citation_meetings_map`이 `Meeting.accessible_by(current_user)`만 써서 idea 44 협업자
분기(직접 지정·폴더 상속, `meeting_lookup.rb:20-28` `authorize_meeting_read!`)가 빠짐 — 폴더 상속
협업자가 `shared:false` 이전 회의를 연결한 경우 실제로는 열람 가능한데도 맵에서 제외되어 프론트가
"이전 회의" 폴백으로 잘못 표시.

**수정**: `backend/app/controllers/concerns/meeting_serializable.rb`의 `citation_meetings_map`을
2단계로 변경.
1. 기존대로 `Meeting.accessible_by(current_user).where(id: ids)` 로 배치 조회(admin/소유자/
   프로젝트멤버+shared 커버, 대부분의 id가 여기서 해석됨).
2. `accessible_by`로 못 걸러진 `remaining_ids`만 — 즉 이미 배치 필터로 축소된 나머지만 —
   `MeetingLookup#meeting_collaborator?` (동일 컨트롤러에 `include MeetingLookup`으로 이미
   mix-in돼 있어 직접 호출 가능)를 그대로 재사용해 개별 판정. 새 권한 로직을 발명하지 않고
   `authorize_meeting_read!`가 쓰는 것과 동일한 헬퍼로 인가 기준을 단일화했다.

**쿼리 폭발 관련 결정**: `meeting_collaborator?` 내부에서 `Folder#collaborator?` → `ancestor_records`가
폴더 깊이만큼 쿼리를 낸다. 완전 배치화(전 폴더 1회 로드 + in-memory 조상 체인, `Folder.visible_folder_ids`
패턴)도 검토했으나, 2단계 필터링 후 `remaining_ids`가 이미 `accessible_by`로 걸러진 잔여(한 문서 안
citation id 개수는 보통 한 자릿수, 그중 소유·같은 프로젝트+shared가 아닌 것만 남음 — 실무상 0건인
경우가 대부분)라 개별 조회의 실질 비용이 낮다고 판단해 기존 헬퍼 재사용을 우선했다. `Meeting.kept.where`
로 `remaining_ids` 전체를 1쿼리로 먼저 로드해 존재하지 않는(삭제된) id는 여기서 자연 제외된다.

**신규 spec** (`spec/requests/api/v1/meetings_citation_meetings_spec.rb`):
- "폴더 상속 협업자면 shared:false 이전 회의도 맵에 제목을 포함한다" (2단계 조상 폴더 협업자 케이스, finding이 지목한 정확한 시나리오)
- "직접 지정 협업자(MeetingCollaborator)면 shared:false 이전 회의도 맵에 제목을 포함한다"
- "협업자도 아니고 접근 불가한 shared:false 회의는 계속 제외된다(회귀)"

**커버링 spec 재실행**:
```
cd backend && bundle exec rspec \
  spec/requests/api/v1/meetings_citation_meetings_spec.rb \
  spec/requests/api/v1/meetings_previous_meeting_spec.rb \
  spec/requests/api/v1/meeting_collaborators_spec.rb \
  spec/models/meeting_editable_spec.rb \
  spec/models/folder_collaborator_spec.rb
# → 55 examples, 0 failures
```

**전체 스위트 2차** (Fix 반영 후 코드로 fresh 프로세스 재실행):
```
Finished in 11 minutes 10 seconds
2372 examples, 1 failure
```
실패 1건: `spec/services/llm_prompts_relocation_spec.rb[1:1:9]`
`CITATION_MARKER_INSTRUCTION bytesize drift: 1025 != 1013`.

**원인**: 이 spec은 `LlmPrompts` 상수들의 바이트/SHA256 동일성을 고정 baseline과 대조하는
golden-file 가드(`behavior-change-0` 분할 리팩토링용)다. 내가 이번 작업 항목 2에서
`CITATION_MARKER_INSTRUCTION`에 "⟦t:..⟧·⟦m:..⟧ 마커 보존" 한 줄을 추가했으므로(브리프 필수 항목),
값이 1013→1025바이트로 바뀌는 건 **의도된 변경**이고 baseline이 갱신됐어야 했다. 동시 작업 중이던
다른 세션이 한때 이 파일에 자신들의 "정규화" 관련 지시 줄을 더 얹고 baseline도 그에 맞춰 갱신했었으나,
그 세션이 이후 자기 줄을 되돌리며 baseline도 원본(1013)으로 리셋해버려 — 그 시점에 여전히 남아있는
내 변경분과 baseline이 어긋났다(`git diff`로 재확인: `citation_prompts.rb`엔 현재 내 한 줄 diff만
있고 다른 세션의 흔적은 없음 — 그쪽은 안정화된 상태).

**Fix**: `spec/services/llm_prompts_relocation_spec.rb`의 `CITATION_MARKER_INSTRUCTION` baseline
엔트리를 현재 실제 값 기준으로 갱신 — `bin/rails runner`로 `Digest::SHA256.hexdigest`·`bytesize` 재계산
(`dd076cb9...`, `1025`). 헤더 주석에도 REFINE_NOTES_SYSTEM_PROMPT 등과 동일한 패턴으로 변경 사유 한 줄 추가.
새 권한/검증 로직 발명이 아니라 golden-file을 현재 상태에 맞춰 재동기화한 것 — 이 spec의 존재 목적
자체가 "의도된 변경 시 baseline을 갱신하라"이므로 이번 수정은 그 규칙을 정확히 따른 것.

**재검증**:
```
cd backend && bundle exec rspec spec/services/llm_prompts_relocation_spec.rb
# → 20 examples, 0 failures
cd backend && bundle exec rspec \
  spec/services/llm_prompts_relocation_spec.rb spec/services/llm_prompts/citation_markers_spec.rb \
  spec/requests/api/v1/meetings_citation_meetings_spec.rb spec/requests/api/v1/meetings_previous_meeting_spec.rb \
  spec/models/meeting_previous_meeting_spec.rb
# → 73 examples, 0 failures
```

**전체 스위트 3차** (baseline fix 반영 후 fresh 프로세스 재실행, 결과는 완료 후 append):
