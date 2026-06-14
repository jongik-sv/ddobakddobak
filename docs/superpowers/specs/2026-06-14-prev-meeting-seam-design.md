# 이전 회의 이음매 개선 — 하나의 회의로 병합 (2026-06-14)

repo `ddobakddobak`, 브랜치 `feat/prev-meeting-reference`.

## 문제

연결 회의(이전 회의 참고)의 회의록이 `## 📋 이전 회의 이어받음` H2 대제목으로 끊겨
두 회의를 꿰맨 듯 보임. 사용자 요구: **회의 2개가 등록됐어도 "하나의 회의"로 합치고,
논의사항 중간에 절취선 하나만으로 이전/현재 시점 구분.**

## 결정 (모드별 동작)

| 모드 | 동작 | 절취선 |
|------|------|--------|
| 재구조화(`summary_restructure=true`, 기본) | 이전+현재 완전 병합(주제별 통합) | 없음 |
| 증분(`summary_restructure=false`) | **이전+현재 병합**하되 논의사항만 시점 구분 | **논의사항 중간 1개** |

### 증분(연결) 목표 구조
```
# 회의 제목
## 핵심 요약            ← 이전+현재 통합(하나)
## 논의 사항
   [이전 회의 논의]
   **✂ ─ ─ ─ ─ ─ 이전 회의 / 현재 회의 ─ ─ ─ ─ ─**   ← 절취선은 여기만
   [현재 회의 논의]
## 결정사항            ← 이전+현재 통합(하나, 절취선 없음)
## Action Items        ← 이전+현재 통합(하나, 절취선 없음)
```

절취선 상수: `PREVIOUS_MEETING_CUT_LINE = "**✂ ─ ─ ─ ─ ─ 이전 회의 / 현재 회의 ─ ─ ─ ─ ─**"`.

## 변경

1. **시드** `meeting.rb#seed_summary_from_previous!`: 모드 무관 **이전 회의록 base만** 깐다(절취선 없음).
   절취선은 시드가 아니라 LLM이 논의사항 안에 넣는다.
2. **연결+증분 = refine 병합 + 논의 절취선 지시**:
   - `llm_prompts.rb`: `seeded_merge_instruction`(메서드) — "한 회의로 통합. 핵심요약·결정사항·Action Items는
     이전+현재 합쳐 각각 하나로. 논의사항은 이전 논의 → 절취선(상수) → 현재 논의 순서. 절취선은 논의 안에 단 1회."
   - `llm_service.rb#refine_notes`: `seeded_merge:` 파라미터 추가 → true면 위 지시 append.
   - `meeting_summarization_job.rb`: 라우팅 변경 —
     `refine` 사용 = `summary_restructure? || previous_meeting_id.present?`
     `seeded_merge` = `previous_meeting_id.present? && !summary_restructure?`
     `chronological`(시간순, 주제재구성 금지) = `!summary_restructure? && previous_meeting_id.blank?`(비연결 증분 백지폴백만)
3. **연결+재구조화**: refine(seeded_merge:false) → 완전 병합, 절취선 없음.
4. **비연결 증분**: append-only(현행 유지).
5. **재생성 누락 버그**: 별도 fix 불필요 — 연결+증분이 이제 refine(전체 자막)을 타므로
   `remaining=0` 시드-only 경로를 안 거침. 비연결 증분 재생성은 `latest_notes.blank?` 폴백으로 정상.

## 테스트 (TDD)

- `meeting_previous_meeting_spec`: 시드 = base만(절취선 없음), 모드 무관.
- `llm_service` spec: `refine_notes(seeded_merge:true)` → 시스템에 절취선 상수 + 통합 지시 주입. 기본 false → 미주입.
- `meeting_summarization_job_previous_spec`: 연결+증분=refine(seeded_merge:true) / 연결+재구조화=refine(seeded_merge:false) /
  비연결+증분=append.

## 프론트 / 기존 데이터

- 프론트 변경 없음(순수 마크다운 렌더).
- 회의 #109는 옛/중간 상태 요약 보유 → 재생성해야 새 구조 적용(자동 소급 없음).

## 리스크

- 절취선 위치·섹션 통합은 LLM이 프롬프트 지시로 수행 → 모델이 안 지키면 프롬프트 튜닝 필요.
