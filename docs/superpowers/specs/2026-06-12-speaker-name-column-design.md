# Transcript speaker_name 컬럼 — 화자 이름 표시·검색 설계

**날짜**: 2026-06-12 · **브랜치**: feat/speaker-diarization (diarization v2 위에 증분)

## 목표

화자 rename("화자 1" → "앨리스") 시 이름이 트랜스크립트 배지·검색·내보내기에 보이게 한다. **ID와 이름을 분리**해 같은 이름을 두 화자에 붙여도 가역(분리 가능)하게 유지한다.

## 데이터 모델

```
Transcript.speaker_label : string, not null  — 화자 ID ("화자 1"). 불변. 기존 컬럼.
Transcript.speaker_name  : string, nullable  — 표시 이름 ("앨리스"). 신규 컬럼. null = 이름 없음 → label로 표시.
```

이름의 원천(source of truth)은 기존대로 sidecar SpeakerDB(`meeting_<id>.json`의 names 맵). `speaker_name` 컬럼은 그 비정규화 사본 — 검색·직렬화·내보내기용.

## 쓰기 경로

1. **rename** (`Api::V1::SpeakersController#update`): sidecar PUT 성공 후
   `meeting.transcripts.where(speaker_label: id).update_all(speaker_name: name)`
2. **reset** (`#destroy_all`): sidecar DELETE 성공 후
   `meeting.transcripts.update_all(speaker_name: nil)`
3. **STT 재생성** (`FileTranscriptionJob#store_transcripts`): 트랜스크립트 생성 직후 sidecar `GET /speakers`로 names 맵 조회, `name != id`인 항목만 라벨별 `update_all(speaker_name:)` — 재인식해도 기존 이름 유지 (SpeakerDB names가 "화자 N" 키로 보존되는 기존 동작 활용)
4. **실시간** (`TranscriptionJob`): speaker_name 미설정(null) — 변경 없음

## 읽기 경로

- **직렬화**: `transcript_serializable.rb` + `meeting_serializable.rb`에 `speaker_name` 추가
- **프론트 표시**: `Transcript` 타입·`transcriptStore` finals·`transcriptMapper`에 speaker_name 추가. 배지 렌더는 `speaker_name ?? speaker_label` (TranscriptPanel 직접 렌더 + SpeakerLabel 경유 모두). rename 성공 시 SpeakerPanel이 transcriptStore의 해당 라벨 finals를 in-place 갱신 → 즉시 리렌더
- **검색**: `search_service.rb` 화자 필터를 `(t.speaker_label = ? OR t.speaker_name = ?)`로 확장. 검색 결과의 speaker 필드는 표시 이름(`speaker_name || speaker_label`) 반환
- **내보내기**: `markdown_exporter.rb` → `t.speaker_name.presence || t.speaker_label`

## 명시적 Out of Scope

- **AI 요약 프롬프트 통합** (`llm_service.rb#format_transcripts`): 해당 파일에 다른 작업의 미커밋 변경 존재 — 그 작업 머지 후 한 줄 수정으로 후속 처리
- **FTS 본문 인덱스에 speaker_name 추가**: FTS 가상 테이블 재구축 필요 — 이름 검색은 화자 필터로 충분, 본문 free-text에서 이름 hit은 v1 제외
- **BlockNote 에디터 블록**: 삽입 시점 라벨 스냅샷 — 변경 없음
- 회의 간 화자 동일성

## 함정 (구현 시 주의)

- **마이그레이션**: 파일 추가만으로 러닝 dev Rails가 전 요청 500 (PendingMigrationError) — 마이그레이션 생성 즉시 `rails db:migrate` 실행
- **SQLite LIKE**: 화자 필터는 exact match(`= ?`)라 ESCAPE 불필요. LIKE로 바꾸지 말 것 (바꾸면 ESCAPE '\' 필수)
- **권한**: rename/reset은 mutating — SpeakersController 기존 가드(meeting 접근 제어) 확인·유지
- **이름 == 라벨**: sidecar names 맵에서 `name == id`는 "이름 미설정" 의미 — speaker_name에 복사하지 않음(null 유지)

## 테스트

- 마이그레이션 후 모델 스펙(컬럼 존재, validates 영향 없음)
- SpeakersController request spec: rename → transcripts.speaker_name 갱신, reset → nil
- FileTranscriptionJob: 재생성 후 names 재적용
- search_service: 이름으로 화자 필터 hit
- 프론트: 배지 name fallback 렌더, rename 후 스토어 갱신 리렌더
