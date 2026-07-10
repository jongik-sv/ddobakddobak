# log

[2026-07-04 00:00] [INIT] task 생성. _shared/routing.md 부재 확인(존재하지 않음) → worker 라우팅 생략, 내부 서브에이전트(Workflow)로 진행
[2026-07-04 00:00] [SCOUT] 규모 실측: backend rb 145f/12,208L (ctrl 47, model 27, job 21, svc 44, mig 75), frontend ts/tsx 434f/51,329L, sidecar/app py 54f/7,696L, src-tauri/src rs 21f/4,138L, speakrs-cli 103L
[2026-07-04 00:00] [USER] 추가 지시 3건: ①조사 실행 ②재작성 타당성 검토 포함 ③목표=서버 개념 없는 개인용 회의 관리 앱
[2026-07-04 00:10] [WORKER] Workflow wf_181899f2-42c 기동 (내부 서브에이전트 19: 인벤토리4 + 웹리서치6 + 옵션평가6 + 적대검증3)
[2026-07-04 00:30] [WORKER] Workflow wf_181899f2-42c 완료: 19/19 에이전트, 에러 0, 도구호출 298, 소요 15.3분
[2026-07-04 00:40] [VERIFICATION] ①output=보고서 1건, artifacts/재작성-검토-보고서.md 존재 확인 ✓ ②constraints(코드 변경 없음, read-only 분석) 충족 ✓ ③적대검증 3인 전원 recommendation_holds=true(보정: F공수 10~14개월, risk 3, STT회귀 스파이크 필요, FGS는 절반 기완성) ④fact-check 9건 전건 확인·반박 0
[2026-07-04 00:40] [DECISION] 최종 권고=A/F 통합(Tauri 단일앱 목적지, strangler 점진 이관), B~E 기각, 선행 게이트 M0 2~4주(수요검증·앱전환내성·STT품질·동결자기검증). status=done
[2026-07-04 01:00] [CORRECTION] 사용자 지적으로 docs/stt-batch-engine-experiments-2026-06.md(6/13 실측) 반영: 배치 STT는 whisper.cpp gguf f16이 이미 품질·안정 1위(657seg·스킵0·환각0) → whisper-rs 배치 이식=무손실, M0-3 스파이크 범위를 '실시간 라이브만'으로 축소(리스크4 중→하). 보고서 §6 M0-3·§7 리스크표 수정
[2026-07-04 02:00] [WORKER] Workflow wf_7e3f5c46-0cd 완료(선행사례 조사 4에이전트, 에러0): transcribe.cpp(Handy팀, Qwen3-ASR GGUF 인프로세스+Rust 스트리밍 바인딩 MIT)·sherpa-onnx 공식 Rust 크레이트 1.13.3(Qwen3 0.6B int8 공식)·fluidaudio-rs(CoreML ANE+LS-EEND) 발견
[2026-07-04 02:05] [VERIFICATION] 보고서 §9 신설(후보 서열표+Handy 아키텍처+계획수정 3항), §6 M0-3 재정의(대안모델 검증→동일모델 런타임 3종 비교, 스파이크당 1~3일). 파일 존재·정합 확인
[2026-07-04 02:30] [HANDOFF] 사용자 결정: 새 repo ~/project/ddobak-solo에서 시작(원본=서버/클라 제품 존속). 준비 완료: git init + CLAUDE.md(절대규칙3·확정결정·보존할 방어코드) + README + docs/{재작성-검토-보고서(사본), 마이그레이션-플랜(Phase0~6 체크리스트), phase0-stt-스파이크(후보3+측정표)} + docs/reference/{stt-batch-engine-experiments, diarization-research} + .gitignore. 커밋은 안 함(명시 요청 없음)
