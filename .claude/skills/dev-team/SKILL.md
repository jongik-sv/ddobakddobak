---
name: dev-team
description: "WP(Work Package) 단위로 하위 Task들을 병렬 분배하여 개발. 사용법: /dev-team WP-04 또는 /dev-team WP-04 WP-05 또는 /dev-team (자동 선정) 또는 /dev-team WP-04 --team-size 5"
---

# /dev-team - WP 단위 팀 병렬 개발

인자: `$ARGUMENTS` (WP-ID + 옵션)
- WP-ID: 1개 이상 (공백 구분). 생략 시 자동 선정
- `--team-size N`: 개발팀원 수 (기본값: 3)

## 0. 설정 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `TEAM_SIZE` | 3 | 개발팀원 수 (스폰·할당 상한) |

> `--team-size N` 옵션으로 변경 가능. 아래 문서에서 `{TEAM_SIZE}`로 참조.

## 전제조건 확인
- git repo 초기화 여부 확인 (`git status`). 안 되어 있으면 사용자에게 안내 후 중단.
- `tmux list-windows -F '#{window_name}'`로 기존 창 확인. 동일 이름 창이 있으면 사용자에게 확인 후 정리.

## 실행 절차

### 1. WP 선정 및 Task 수집

#### 인자 파싱
- `$ARGUMENTS`에서 WP-ID 목록과 `--team-size N` 옵션을 추출한다
- WP-ID가 없으면 자동 선정 로직 실행

#### 인자가 있는 경우
- 각 WP-ID에 대해 `docs/wbs.md`에서 `## {WP-ID}:` 섹션을 찾는다

#### 인자가 없는 경우 (자동 선정)
1. `docs/wbs.md`에서 `progress: 100%`가 아닌 모든 WP를 수집
2. 각 WP의 하위 Task 중 status가 `[ ]`이고, depends가 모두 충족된(`[xx]` 또는 해당 WP 외부에서 이미 완료) Task가 1개 이상 있는 WP를 **실행 가능 WP**로 판정
3. 실행 가능 WP를 **모두 선택**하여 병렬 실행
4. 선택된 WP 목록을 사용자에게 보여주고 확인 후 진행

#### Task 수집
- 선택된 각 WP 하위의 모든 `### TSK-XX-XX:` Task 블록을 수집한다
- 각 Task에서 추출: TSK-ID, domain, status, depends

### 2. 의존성 분석 및 실행 계획

각 WP 내부에서 Task의 **실행 레벨**을 산출한다:

```
Level 0: depends가 모두 완료이거나, 선택된 WP 외부 Task에만 의존 (즉시 시작 가능)
Level 1: WP 내 Level 0 Task에 의존
Level 2: WP 내 Level 1 Task에 의존
...
```

**같은 Level의 Task는 domain에 관계없이 병렬 실행한다.**
다른 WP의 Task에 의존하는 경우, 시그널 파일로 완료를 감지한다 (cross-WP 동기화 참조).

### 3. 아키텍처

```
팀리더 (현재 세션)
 ├─ [tmux window: WP-04]
 │   ├─ [pane 0] WP 리더 (claude) ──→ 시그널 파일로 팀리더에게 보고
 │   ├─ [pane 1] 개발팀원1 (claude) ──→ 시그널 파일로 완료 보고 ──→ /clear 후 재활용
 │   ├─ [pane 2] 개발팀원2 (claude) ──→ 시그널 파일로 완료 보고 ──→ /clear 후 재활용
 │   └─ [pane 3] 개발팀원3 (claude) ──→ 시그널 파일로 완료 보고 ──→ /clear 후 재활용
 │
 └─ [tmux window: WP-05]
     ├─ [pane 0] WP 리더 (claude)
     ├─ [pane 1] 개발팀원1 (claude)
     ├─ [pane 2] 개발팀원2 (claude)
     └─ [pane 3] 개발팀원3 (claude)
```

| 계층 | 단위 | 역할 | 실행 방식 |
|------|------|------|-----------|
| Window | WP | WP 리더 (pane 0): Task 스케줄링, 팀원 관리 | tmux window + worktree |
| Pane | 팀원 | 고정 {TEAM_SIZE}명, Task를 순차 수행 | tmux pane (claude 프로세스, 재활용) |
| Agent | Phase | 개발 단계 실행 | 팀원 내부 서브에이전트 |

### 4. 팀 spawn

**tmux 환경 감지**:
```bash
[ -n "$TMUX" ] && command -v tmux > /dev/null
```

#### (A) tmux 환경 — WP 리더를 tmux 창으로 spawn ← **권장**

현재 세션이 **팀리더** 역할을 한다. 모든 WP의 worktree와 창을 **동시에** 생성한다.

각 WP마다:

1. worktree 생성:
```bash
git worktree add .claude/worktrees/{WP-ID} -b dev/{WP-ID}
```
기존 worktree/브랜치가 있으면 정리 후 재생성.

2. 시그널 디렉토리 생성:
```bash
mkdir -p .claude/worktrees/.signals
```

3. WP 리더 프롬프트를 파일로 저장하고, 래퍼 스크립트로 **WP 리더** spawn (pane 0):
```bash
# 프롬프트 파일 저장 (따옴표 이스케이프 문제 방지)
cat > .claude/worktrees/{WP-ID}-prompt.txt << 'PROMPT_EOF'
{WP 리더 프롬프트}
PROMPT_EOF

# 래퍼 스크립트 생성
cat > .claude/worktrees/{WP-ID}-run.sh << 'SCRIPT_EOF'
#!/bin/bash
cd "$(dirname "$0")/{WP-ID}"
exec claude --dangerously-skip-permissions "$(<../"{WP-ID}-prompt.txt")"
SCRIPT_EOF
chmod +x .claude/worktrees/{WP-ID}-run.sh

# tmux 창으로 실행
tmux new-window -n "{WP-ID}" .claude/worktrees/{WP-ID}-run.sh
```
- claude 종료 시 창이 자동으로 닫힌다
- WP 리더가 pane 0에서 실행되며, 팀원 pane 생성은 리더가 담당

4. **모든 WP 완료 대기 및 감지**:
팀리더는 Bash 도구의 `run_in_background` 옵션으로 모니터링 스크립트를 실행한다:
```bash
TEAM_WINDOWS=("WP-04" "WP-05")  # spawn한 WP 창 이름들
while true; do
  ALL_DONE=true
  for w in "${TEAM_WINDOWS[@]}"; do
    if tmux list-windows -F '#{window_name}' | grep -q "^${w}$"; then
      ALL_DONE=false
      break
    fi
  done
  if $ALL_DONE; then
    echo "ALL_TEAM_MEMBERS_DONE"
    break
  fi
  sleep 30
done
```
- 모니터링 완료 통보를 받으면 팀리더가 자동으로 5단계를 실행한다

#### (B) tmux 외 환경 — Agent 도구로 백그라운드 실행

각 WP마다 Agent 도구로 서브에이전트를 **병렬** 실행:

**공통 설정**:
- **isolation**: "worktree"
- **mode**: "auto"
- **run_in_background**: true

모든 에이전트 완료 통보 후 5단계로 진행한다.

---

### 보고 체계

```
팀원 ──시그널 파일──→ WP 리더 ──시그널 파일──→ 팀리더
```

| 방향 | 방법 | 용도 |
|------|------|------|
| WP 리더 → 팀원 (할당) | **tmux send-keys** | Task 프롬프트를 pane에 전송 |
| 팀원 → WP 리더 (보고) | **시그널 파일** | `../.signals/{TSK-ID}.done` 생성 |
| WP 리더 → 팀원 (초기화) | **tmux send-keys** | `/clear` 전송 (컨텍스트 리셋) |
| WP 리더 → 팀리더 (보고) | **시그널 파일** | WP 완료 보고 |

### cross-WP 동기화

다른 WP의 Task에 의존하는 경우, 시그널 파일로 동기화한다.

**팀원이 Task 완료 시** (SendMessage 보고 외에 추가로):
```bash
touch ../.signals/{TSK-ID}.done
```

**WP 리더가 cross-WP 의존 Task를 할당하기 전**:
```bash
while [ ! -f ../.signals/{의존-TSK-ID}.done ]; do sleep 10; done
```

예: TSK-04-05가 TSK-05-02에 의존 → WP-04 리더가 `../.signals/TSK-05-02.done` 파일을 확인 후 TSK-04-05 할당.

---

### WP 리더 프롬프트

```
너는 {WP-ID} WP 리더이다.

⚠️ 중요: 팀원은 반드시 tmux pane으로만 생성하라. Agent 도구로 팀원을 생성하지 마라.
⚠️ 중요: 가장 먼저 아래 "초기화" 섹션의 bash 명령어를 실행하여 tmux pane을 생성하라.

개발팀원 {TEAM_SIZE}명을 tmux pane으로 스폰하고, Task를 1건씩 할당하여 개발을 관리하라.
**리더는 직접 개발하지 않는다. 모든 Task는 팀원에게 위임한다.**
**리더는 시그널 파일 폴링으로 완료를 감지한다.**
**팀원 = tmux pane 내의 별도 claude 프로세스. Agent 도구 사용 금지.**

## 담당 Task 목록
[WP 내 모든 Task 블록 — TSK-ID, domain, depends, 요구사항, 기술 스펙 포함]

## 실행 계획
[팀리더가 산출한 레벨별 실행 계획]

## WP 리더 역할

### 초기화 — 팀원 pane 생성 (최초 1회)

1. {TEAM_SIZE}개의 tmux pane을 생성하고 각 pane에서 claude를 실행한다:
   ```bash
   # 팀원 pane 생성 (현재 window 내에서 분할)
   for i in $(seq 1 {TEAM_SIZE}); do
     tmux split-window -t {WP-ID} -h \
       "cd $(pwd) && claude --dangerously-skip-permissions"
   done
   # 레이아웃 정리
   tmux select-layout -t {WP-ID} tiled
   ```

2. 각 pane ID를 기록한다:
   ```bash
   # pane 목록 조회 (pane 0은 리더 자신)
   tmux list-panes -t {WP-ID} -F '#{pane_index}:#{pane_id}'
   ```
   - pane 0: WP 리더 (자신)
   - pane 1~{TEAM_SIZE}: 개발팀원1~{TEAM_SIZE}

3. Level 0 Task부터 최대 {TEAM_SIZE}명에게 각 **1건씩** tmux send-keys로 할당

### 업무 할당 (tmux send-keys)

**할당 방법**: tmux send-keys로 팀원 pane에 프롬프트를 전송한다.

```bash
tmux send-keys -t {paneId} '{할당 프롬프트}' Enter
```

**할당 프롬프트 템플릿** (작은따옴표 이스케이프 주의):
```
아래 Task를 개발하라. 각 단계를 서브에이전트(Agent 도구)로 실행하라.
완료 후 시그널 파일을 생성하고, 다음 지시가 올 때까지 대기하라.
추가 Task를 스스로 시작하지 마라.

## 담당 Task
{단일 Task 블록 — TSK-ID, domain, depends, 요구사항, 기술 스펙 포함}

## 수행 절차 — 각 단계를 서브에이전트로 실행

1. **설계 (서브에이전트)**:
   Agent 도구로 실행 (mode: "auto")
   - /dev-design 스킬의 절차를 따른다
   - docs/PRD.md, docs/TRD.md를 참조하여 구현 설계
   - docs/tasks/{TSK-ID}/design.md 생성 (.claude/skills/dev-design/template.md 양식)
   - docs/wbs.md에서 status를 [dd]로 변경

2. **TDD 구현 (서브에이전트)**:
   Agent 도구로 실행 (mode: "auto")
   - /dev-build 스킬의 절차를 따른다
   - design.md를 참조하여 테스트 먼저 작성 → 구현 → 테스트 통과 확인
   - domain별 테스트: backend=RSpec, frontend=Vitest, sidecar=pytest
   - docs/wbs.md에서 status를 [im]로 변경

3. **테스트 (서브에이전트)**:
   Agent 도구로 실행 (mode: "auto")
   - /dev-test 스킬의 절차를 따른다
   - 전체 테스트 실행, 실패 시 수정 (최대 3회)
   - docs/tasks/{TSK-ID}/test-report.md 생성 (.claude/skills/dev-test/template.md 양식)

4. **리팩토링 (서브에이전트)**:
   Agent 도구로 실행 (mode: "auto")
   - /dev-refactor 스킬의 절차를 따른다
   - 코드 품질 개선 → 테스트 재실행
   - docs/tasks/{TSK-ID}/refactor.md 생성 (.claude/skills/dev-refactor/template.md 양식)
   - docs/wbs.md에서 status를 [xx]로 변경

## 완료 처리
1. git add + git commit 하라
2. 시그널 파일 생성:
   Bash 도구로 실행: echo '테스트: {통과수}/{전체수}\n커밋: {해시}\n특이사항: {내용}' > ../.signals/{TSK-ID}.done
3. 다음 지시가 올 때까지 대기
```

### 반복 사이클 (시그널 파일 감지)

리더는 Task 할당 후 시그널 파일로 완료를 감지한다:

```bash
# 할당한 TSK-ID의 시그널 파일을 대기
while [ ! -f ../.signals/{TSK-ID}.done ]; do sleep 10; done
cat ../.signals/{TSK-ID}.done
```

시그널 파일 감지 후 아래 순서를 **정확히** 따른다:

1. **보고 확인**: 시그널 파일 내용에서 테스트 결과, 커밋 해시 확인
2. **컨텍스트 초기화** (tmux send-keys로 /clear):
   ```bash
   tmux send-keys -t {paneId} '/clear' Enter
   ```
   - 10초 대기 후 확인 프롬프트 응답:
   ```bash
   sleep 10 && tmux send-keys -t {paneId} Enter
   ```
   - {paneId}: 팀원의 tmux pane ID
3. **다음 Task 할당**: 현재 레벨에서 미할당 Task가 있으면 tmux send-keys로 1건 할당
   - cross-WP 의존이 있는 Task는 시그널 파일 확인 후 할당
   - 현재 레벨의 모든 Task 완료 시 다음 레벨로 진행
4. **모든 Task 완료 시**: 최종 정리로 이동

**⚠️ 필수 규칙**:
- **1건씩 할당**: 복수 할당 시 통제 불가
- **tmux send-keys 중복 전송 금지**: 시그널 파일 감지 전 재전송하지 않는다
- **시그널 파일 감지 전 /clear 금지**: 진행 중인 작업이 중단된다
- **올바른 흐름**: 1건 할당 → 시그널 파일 대기 → /clear → 다음 1건 할당
- **시그널 파일 대기는 Bash `run_in_background`로 실행**: 리더 블로킹 방지

### 최종 정리

모든 Task의 시그널 파일을 확인한 후:
1. 모든 변경사항이 커밋되었는지 확인 (`git status`)
2. 미커밋 변경이 있으면 추가 커밋
3. 팀리더에게 완료 보고 (시그널 파일):
```bash
cat > ../.signals/{WP-ID}.done << 'EOF'
[{WP-ID} 완료]
- 완료 Task: {완료된 TSK-ID 목록}
- 테스트: {통과 수}/{전체 수}
- 커밋: {최신 커밋 해시}
- 특이사항: {있으면 기록, 없으면 "없음"}
EOF
```
4. 프로세스 종료 (tmux 창 자동 닫힘 → 팀리더가 감지)

## 규칙
- 같은 worktree에서 여러 팀원이 작업하므로 파일 충돌에 주의
- 공유 파일 (routes.rb, schema.rb, wbs.md 등) 수정은 리더가 직접 하거나, 한 팀원에게만 배정
- 모든 테스트가 통과해야 다음 레벨로 진행
- 신규 팀원 pane 생성 금지 — 병렬 처리 필요 시 팀원 내부에서 서브에이전트 사용
```

### 5. 결과 통합 (팀리더)

#### (A) 개별 WP 조기 머지 — WP 완료 즉시 실행

다른 WP가 아직 실행 중이더라도, 완료된 WP는 즉시 머지할 수 있다.
`../.signals/{WP-ID}.done` 시그널 파일이 생성되면 (또는 사용자가 요청하면) 해당 WP를 머지한다:

1. 해당 WP의 tmux 창(window) 종료:
```bash
# 모든 pane의 claude 종료
for i in $(tmux list-panes -t {WP-ID} -F '#{pane_index}'); do
  tmux send-keys -t {WP-ID}.$i '/exit' Enter 2>/dev/null
done
sleep 3
tmux kill-window -t {WP-ID} 2>/dev/null
```

2. main에 미커밋 변경이 있으면 먼저 커밋
3. 머지 실행:
```bash
git merge --no-ff dev/{WP-ID} -m "Merge dev/{WP-ID}: {WP 제목} ({TSK-ID 목록})"
```
4. 충돌 발생 시: 수동 해결 후 `git add` + `git commit --no-edit`
5. worktree + 브랜치 정리:
```bash
git worktree remove --force .claude/worktrees/{WP-ID}
git branch -d dev/{WP-ID}
```
6. `docs/wbs.md`에서 해당 WP의 `- progress:` 값 업데이트

#### (B) 전체 완료 머지 — 모든 WP 완료 후 실행

모니터링에서 `ALL_TEAM_MEMBERS_DONE`을 수신하면 (또는 사용자가 요청 시) 팀리더가 아직 머지되지 않은 WP들을 순차 머지한다:

1. 각 worktree 브랜치의 변경사항을 확인 (`git log main..dev/{WP-ID} --oneline`)
2. main 브랜치에 순차적으로 머지 (`git merge --no-ff dev/{WP-ID}`)
   - 머지 순서: 의존성 하위 WP부터 (예: WP-05 → WP-04, TSK-04-05가 TSK-05-02에 의존하므로)
3. 머지 후 충돌 여부 확인
   - 충돌 발생 시: 사용자에게 보고하고 수동 해결 요청 후 대기
   - 충돌 없으면: 다음 브랜치 머지 진행
4. 모든 머지 완료 후 정리:
   - 시그널 디렉토리 정리: `rm -rf .claude/worktrees/.signals`
   - 남은 worktree 정리: `git worktree remove --force .claude/worktrees/{WP-ID} && git branch -d dev/{WP-ID}`
5. `docs/wbs.md`에서 각 WP의 `- progress:` 값을 업데이트
6. 전체 결과 요약 보고:
   - WP별 완료 Task 수
   - 성공/실패 현황
   - 머지 결과
