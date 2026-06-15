# 안건 자료 추출 파이프라인 (2차) 설계

작성일: 2026-06-15
전제: 1차(안건 `.md`/`.txt` 업로드 → 압축 → 회의록 주입)는 구현 완료. 본 문서는 그 위에 **비-텍스트 안건 첨부(pdf/docx/pptx/xlsx/이미지)의 추출**을 얹는 2차.

## 1. 결정 사항 (확정)

| 항목 | 결정 |
|--|--|
| 추출 범위 | 전부 — pdf, docx, pptx, xlsx, 독립 이미지(png/jpg/…) |
| 저장 방식 | **폴더 + 파일** — 원본 첨부 옆 `<file_path>.extracted/` 폴더에 추출 md 기록 (MeetingAttachment row 아님 → 첨부 목록에 안 보임, category CHECK/인덱스 누수 회피) |
| 독립 이미지 | **Vision OCR만** (chart→mermaid 복원은 폐기 — 환각) |
| 임베디드 이미지 | **무시** — 문서 내부에 그림으로 박힌 이미지는 텍스트화 안 함 |
| 네이티브 차트 | **데이터표 추출 포함** — ppt/xls 차트 *객체*는 python-pptx/openpyxl로 카테고리+값을 읽어 md 표로. (차트 "모양"은 미복원, 데이터만) |
| 추출 엔진 | **D — Claude CLI + 코드실행** (`claude -p --allowedTools Read Bash Write`). CLI 샌드박스의 python-pptx/openpyxl/python-docx/pdfplumber로 **결정적** 추출. 배포에 새 시스템 의존성 0 (요약·명함 OCR과 동일 CLI 표준화). |

### 추출 결과가 갈리는 경계 (명시)
- 네이티브 차트 객체 → 데이터표 살림, 모양 안 살림
- SmartArt/도형 순서도 → 도형 텍스트(라벨)만, 화살표·흐름 구조 소실
- **office/pdf 문서 *내부*에 그림으로 박힌 차트·순서도 → 유일한 미싱**(임베디드 OCR 무시 결정). 독립 이미지 파일로 업로드하면 OCR로 읽힘.

## 2. 아키텍처

```
업로드(비-md agenda 파일)
  → 컨트롤러 훅 → AgendaExtractionJob(attachment_id)
      → AgendaExtractionService(attachment): claude CLI 1회
          content_type별 지시 → python 라이브러리로 추출(이미지만 Vision)
          → 원본 옆 <file_path>.extracted/ 에 md 기록
      → 완료 후 AgendaReferenceJob(meeting_id) 체이닝
  → AgendaReferenceJob (1차 확장): 업로드 .md/.txt + 모든 agenda 첨부의 .extracted/*.md
      합산 → compress_agenda <8000자 → meetings.agenda_reference
  → 회의록 요약 주입 (1차 그대로, 무변경)
```

핵심: **추출(원본별 raw md) 과 압축(회의 단위 합산 <8000) 분리.** 압축·주입·1회플래그는 1차 자산 재사용.

## 3. 컴포넌트

### 3.1 AgendaExtractionService (신규)
- `CardExtractionService` 패턴 복제 (claude CLI shell-out, `ensure_cli!`, timeout, `--permission-mode bypassPermissions`).
- 입력: 비-텍스트 `MeetingAttachment`. 출력: 기록한 md 경로 배열.
- `--allowedTools Read Bash Write` (Bash=python 실행, Write=md 기록).
- content_type별 지시 분기 + 출력 파일명 규칙 (`<name>` = 원본 `original_filename` 의 basename, 확장자 포함 — 디스크 저장명 `<meeting>_<hex>_` 접두는 제외):
  - pptx → `<name>.pptx.md` (텍스트 + 네이티브 차트 데이터표; 임베디드 이미지 무시)
  - xlsx → 시트별 `<name>.xlsx.sheet1.md`, `sheet2.md` …
  - docx → `<name>.docx.md`
  - pdf → `<name>.pdf.md` (CLI Read 가능)
  - image(png/jpg/gif/webp) → `<name>.<ext>.md` (Vision OCR — 코드 아님)
- 시스템 프롬프트 골자: "주어진 경로 파일을 **눈으로 읽지 말고 지정 python 라이브러리로 추출**하라(이미지 제외). 텍스트·표·네이티브 차트 데이터를 markdown으로. 임베디드 이미지는 무시. 출력 md를 `<extraction_dir>/` 에 지정 파일명으로 Write 하라."
- 텍스트(md/txt) 원본은 이 서비스 안 탐 — 1차 직행.

### 3.2 AgendaExtractionJob (신규)
- `perform(attachment_id)`: 첨부 조회(비-텍스트 agenda file 가드) → 서비스 호출 → 폴더 기록.
- 완료/실패 무관하게 마지막에 `AgendaReferenceJob.perform_later(meeting_id)` 체이닝(부분 반영).
- broadcast `agenda_extraction_done`(선택).
- 에러: rescue + 로그 (1차 무음손실 차단 패턴). 추출 실패한 파일은 폴더 비고 RefJob이 나머지로 진행.

### 3.3 AgendaReferenceJob (확장)
- `collect_agenda_text` 변경: 기존 업로드 `.md`/`.txt` 원본 + **모든 `category='agenda', kind='file'` 첨부의 `<file_path>.extracted/*.md`** 를 position 순 합산.
- 이후 로직(compress_agenda<8000, applied_at 리셋) 1차 그대로.

### 3.4 MeetingAttachment (확장)
- `extraction_dir` → `"#{file_path}.extracted"` (file_path 있을 때만).
- `remove_file_from_disk` 콜백이 원본 파일 + `extraction_dir`(`FileUtils.rm_rf`) 동시 삭제 → 원본 삭제 시 추출물 cascade.

### 3.5 컨트롤러 훅 (변경, `meeting_attachments_controller.rb`)
- agenda 파일 **생성**:
  - 텍스트(text/markdown·text/plain) → `AgendaReferenceJob`(1차 직행)
  - 비텍스트 → `AgendaExtractionJob`(추출 후 RefJob 체이닝)
- agenda **삭제 / 카테고리 변경** → `AgendaReferenceJob`(폴더는 모델 콜백이 정리; 삭제 시 추출 불필요).
- 헬퍼: 기존 `recompute_agenda_reference!` 곁에 분기 추가.

## 4. 폴더 레이아웃
```
storage/attachments/<meeting>_<hex>_deck.pptx
storage/attachments/<meeting>_<hex>_deck.pptx.extracted/
    deck.pptx.md
storage/attachments/<meeting>_<hex>_book.xlsx
storage/attachments/<meeting>_<hex>_book.xlsx.extracted/
    book.xlsx.sheet1.md
    book.xlsx.sheet2.md
```
임베디드 이미지 미저장이므로 폴더엔 md만.

## 5. 에러 처리 / 비용
- 추출 CLI 실패 → 서비스 로그+raise, Job rescue → RefJob 계속(부분 반영). 1차 D8 무음손실 차단과 동형.
- 비용: 업로드당 추출 CLI 1회/파일 + 압축 CLI 1회. 전부 업로드 시점 async 1회성 → 라이브 요약 비용 무영향.
- 멱등: 재업로드/재추출 시 `extraction_dir` 덮어쓰기. RefJob은 멱등(전체 재계산).

## 6. 테스트 (TDD)
- `AgendaExtractionService`: content_type별 CLI 지시·파일명 분기, xlsx 다중시트, 폴더 기록 (call_cli stub).
- `AgendaExtractionJob`: 서비스 stub → 폴더 기록 + RefJob enqueue, 실패 시에도 RefJob enqueue.
- `MeetingAttachment`: `extraction_dir`, 원본 삭제 시 폴더 `rm_rf` cascade.
- `AgendaReferenceJob`(확장): `.extracted/*.md` 도 합산 수집.
- 컨트롤러: 비텍스트 agenda→ExtractionJob, 텍스트 agenda→RefJob.

## 7. 리스크 / 1단계 스파이크
- **유일 핵심 리스크**: 배포 claude CLI 샌드박스가 **Bash+python+라이브러리 실행을 보장**하는지. python-pptx/openpyxl/python-docx/pdfplumber가 CLI 런타임에 없으면 추출 실패.
- **구현 1단계 = 스파이크**: 서버(배포 환경)에서 `claude -p --allowedTools Read Bash Write` 로 샘플 pptx → md 실증. 라이브러리 미존재 시 `pip install`(venv) 또는 폴백(A: 우리가 libs 설치) 전환 판단.
- 스파이크 통과 후에만 본 구현(서비스→잡→확장→컨트롤러) 진행.

## 8. 스코프 밖 (비목표)
- 임베디드 이미지 OCR, 차트 모양 복원, 순서도 흐름(mermaid) 복원.
- reference 카테고리(1차와 동일하게 agenda만).
- 프론트 변경(category='안건' 이미 지원, 추출물은 숨김).
