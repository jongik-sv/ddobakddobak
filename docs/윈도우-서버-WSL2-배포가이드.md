# 또박또박 윈도우 서버 배포 가이드 (WSL2)

원격지에 있는 Windows 서버(NVIDIA GPU 탑재)에 또박또박 백엔드 전체(Rails + STT sidecar)를 설치·운영하기 위한 가이드입니다. 모든 작업은 맥(개발 컴퓨터)에서 SSH로 원격 수행하며, RDP는 비상용으로만 사용합니다.

> 이 문서는 **Windows 서버 특화 단계**(WSL2 설치, 자동 시작, 포트 노출)를 다룹니다.
> Rails·sidecar 설치 자체는 기존 [`배포가이드.md`](../배포가이드.md)의 §2.3(웹 서버), §2.2(STT 서버, Linux) 섹션을 WSL2 안에서 그대로 따릅니다.

---

## 전체 구성

```
[맥 (개발 컴퓨터)]  ──SSH──▶  [Windows 서버 (원격)]
  조종석 역할만                      │
  코드는 git push/pull              ├─ Windows 호스트: OpenSSH, NVIDIA 드라이버, RDP(비상용)
                                    └─ WSL2 Ubuntu (실제 일하는 곳)
                                         ├─ Rails 백엔드 + 프론트 빌드
                                         ├─ sidecar (STT/화자분리/임베딩, CUDA)
                                         ├─ git clone된 또박또박 소스
                                         └─ tmux + Claude Code (서버에서의 개발)
```

**설계 원칙**

- Windows는 "WSL2를 담는 껍데기"로만 사용하고, 서버 소프트웨어는 전부 WSL2 Ubuntu 안에서 실행한다.
  - 기존 배포가이드의 Linux 섹션이 거의 그대로 적용된다.
  - Rails를 네이티브 Windows에서 돌리는 문제(gem 네이티브 확장, Puma cluster 모드 불가, 커뮤니티 지원 부재)를 전부 피한다.
  - PyTorch CUDA는 WSL2에서 공식 지원된다 (NVIDIA 공식).
- STT는 코드 수정 불필요: sidecar STT 팩토리(`sidecar/app/stt/factory.py`)가 `stt: auto` 설정에서 CUDA를 감지해 `qwen3_asr_transformers`(CJK 정확도 우수)를 자동 선택한다. MLX 엔진은 Apple Silicon 전용이며 비-Apple 환경에서 자동 대체된다.

**왜 네이티브 Windows가 아닌가**

| 컴포넌트 | 네이티브 Windows | WSL2 |
|---|---|---|
| Rails + Puma | 취약. gem 컴파일 문제, Puma cluster(fork) 불가, 지원 부재 | 표준 Linux 경로 |
| 배포 스크립트 (bash) | 전면 재작성 필요 | 그대로 재사용 |
| STT (CUDA) | 동작 | 동작 (동급) |
| 임베딩 (KURE, PyTorch) | 동작 | 동작 (동급) |
| claude CLI / Caddy / SQLite | 동작 | 동작 (동급) |

Python·CUDA는 어느 쪽이든 되지만, Rails가 네이티브 Windows에서 약한 고리이므로 WSL2로 결정한다.

---

## 0단계: 사전 확인 (맥에서 SSH 접속)

```bash
ssh <윈도유저>@<서버IP>
```

접속하면 PowerShell 또는 cmd 프롬프트가 뜬다 (`C:\Users\...>`). 세 가지를 확인한다.

### ① Windows 버전 — WSL2 가능 여부

```powershell
systeminfo | findstr /B /C:"OS Name" /C:"OS Version"
```

- **Windows Server 2022 이상, Windows 10/11** → WSL2 가능, 진행.
- **Windows Server 2019** → WSL1만 지원되어 이 가이드 적용 불가. 전략 재검토 필요.

### ② GPU와 드라이버

```powershell
nvidia-smi
```

- 표가 나오면 드라이버 설치됨.
- `not recognized`이면 드라이버 설치 필요:
  ```powershell
  winget install Nvidia.GeForceDrivers   # GeForce 계열
  # 데이터센터 GPU(Tesla/A-시리즈 등)는 NVIDIA 사이트에서 해당 드라이버 설치
  ```
  SSH에서 설치가 막히면 이때만 RDP를 사용한다.
- **WSL 안에는 드라이버·CUDA 툴킷을 설치하지 않는다.** Windows 호스트 드라이버만 있으면 WSL이 자동으로 GPU를 넘겨받고, PyTorch pip wheel이 CUDA 런타임을 포함한다.

### ③ sshd 자동 시작 — 재부팅 후 접속 유지 (중요)

```powershell
Get-Service sshd | Select-Object Status, StartType
# StartType이 Automatic이 아니면:
Set-Service sshd -StartupType Automatic
```

원격 서버라 재부팅 후 SSH가 안 살아나면 손쓸 방법이 RDP뿐이 된다. 재부팅 전에 반드시 확인한다.

---

## 1단계: WSL2 + Ubuntu 설치

같은 SSH 세션에서:

```powershell
wsl --install -d Ubuntu
```

WSL 기능 활성화 + Ubuntu 다운로드까지 수행한다. 끝나면 재부팅:

```powershell
shutdown /r /t 0
```

SSH가 끊긴다. 1~2분 후 다시 `ssh <윈도유저>@<서버IP>`로 재접속한다.

재접속 후 Ubuntu 초기 설정:

```powershell
wsl
```

첫 실행 시 Ubuntu 유저명/비밀번호를 묻는다. SSH 터미널에서 그대로 입력하면 된다. 완료되면 프롬프트가 `유저명@서버명:~$`로 바뀐다 — 이제 Ubuntu 안이다.

검증:

```bash
exit                    # PowerShell로 나가서
wsl -l -v               # VERSION 열이 2인지 확인 (1이면 CUDA 불가)
wsl                     # 다시 Ubuntu로

nvidia-smi              # Windows와 같은 표가 나오면 GPU 패스스루 성공
```

---

## 2단계: 맥에서 한 번에 Ubuntu로 접속되게 설정

매번 "ssh → PowerShell → `wsl` 입력"을 반복하지 않도록, 맥의 `~/.ssh/config`에 추가한다:

```
Host ddobak-win
    HostName <서버IP>
    User <윈도유저>
    RequestTTY yes
    RemoteCommand wsl.exe
```

원리: SSH 접속 직후 PowerShell 대신 `wsl.exe`를 실행하므로 바로 Ubuntu 셸에 떨어진다. WSL 안에 별도 sshd를 설치하거나 portproxy를 구성할 필요가 없다.

```bash
ssh ddobak-win                # → 즉시 Ubuntu 프롬프트
ssh <윈도유저>@<서버IP>        # RemoteCommand 우회 → Windows PowerShell (포트 설정 등에 사용)
```

### 비밀번호 없이 접속 (선택)

맥 공개키를 Windows에 등록한다. Windows OpenSSH는 계정 종류에 따라 경로가 다르다:

- **관리자 그룹 계정**: `C:\ProgramData\ssh\administrators_authorized_keys`
- **일반 계정**: `C:\Users\<유저>\.ssh\authorized_keys`

---

## 3단계: WSL 자동 시작 설정 (중요)

WSL은 기본적으로 부팅 시 자동으로 뜨지 않는다. 서버가 정전·Windows 업데이트로 재부팅되면 또박또박도 죽은 채로 남는다. 두 가지를 설정한다.

### ① systemd 활성화 (WSL Ubuntu 안에서)

서비스 자동 기동의 토대. 배포가이드의 systemd 유닛(§2.2 6단계, §2.3 8단계)을 쓰기 위해 필수.

```bash
sudo tee /etc/wsl.conf <<'EOF'
[boot]
systemd=true
EOF
```

적용은 Windows 쪽에서 `wsl --shutdown` 후 재진입.

### ② 부팅 시 WSL 기동 (Windows 관리자 PowerShell)

```powershell
schtasks /create /tn "WSL-AutoStart" /tr "wsl.exe -d Ubuntu --exec /bin/true" /sc onstart /ru SYSTEM /rl HIGHEST /f
```

재부팅 → 작업 스케줄러가 WSL을 깨움 → systemd가 등록된 서비스(Rails, sidecar)를 자동으로 올림.

> **참고**: WSL은 유휴 상태가 길어지면 VM을 내리는 경우가 있다. systemd 서비스가 떠 있으면 보통 내려가지 않으므로 기본값으로 시작하고, 문제가 생기면 Windows 쪽 `%USERPROFILE%\.wslconfig`의 `[wsl2]` 섹션에서 `vmIdleTimeout`을 조정한다.

---

## 4단계: 소스 받고 기존 배포가이드 따라가기

WSL Ubuntu 안에서 진행한다. **반드시 WSL 홈 디렉토리(ext4)에 clone한다** — `/mnt/c/...`는 파일 IO가 몇 배 느리다.

```bash
cd ~
git clone <또박또박 repo URL> ddobakddobak
cd ddobakddobak
```

여기부터는 [`배포가이드.md`](../배포가이드.md)를 순서대로 따른다:

1. **§2.3 웹 서버 설치**: rbenv + Ruby → backend bundle → frontend 빌드 → `SERVER_MODE=true`로 실행 → nginx HTTPS → systemd 등록. Ubuntu 기준 문서라 WSL2에서 그대로 유효하다.
   - ⚠️ `SERVER_MODE=true` 누락 시 모든 요청이 desktop@local 유저로 처리되어 JWT 인증이 무력화된다 (§2.3 8단계 참고).
2. **§2.2 STT 서버 설치 (Linux)**: uv → sidecar 의존성 → `settings.yaml`(`stt: auto`) → 실행 → systemd 등록.
   - `auto`가 CUDA를 감지해 `qwen3_asr_transformers`를 자동 선택한다. STT 코드 수정 불필요.

### 단일 박스 구성에 따른 차이

기존 가이드는 "웹 서버 ↔ STT 서버"가 분리된 구성을 전제하지만, 이 배포는 한 박스에 둘 다 올린다:

- sidecar 주소는 `localhost:13324`로 설정 (다른 서버 IP 아님)
- 가이드의 "웹 서버에서만 STT 포트 접근 허용" 방화벽 단계는 생략

### 설치 후 검증

```bash
# GPU로 STT 엔진이 선택됐는지 sidecar 로그 확인
# "[STT] 자동 감지 엔진: qwen3_asr_transformers" 가 보여야 함

# health 체크
curl http://localhost:13324/health     # sidecar
curl http://localhost:13323/up         # backend
```

- 화자분리·임베딩(KURE)의 CUDA 실동작은 실제 회의 1건으로 검증한다.

---

## 5단계: 외부 접속용 포트 노출

WSL2는 기본 NAT 뒤에 있어 LAN에서 서버 IP로 접속해도 WSL 안까지 들어오지 않는다. 팀원이 실제 접속하는 시점에 아래 중 하나를 적용한다.

### 방법 A — mirrored 네트워킹 (Windows 11 22H2+ / Server 2025, 권장)

Windows 쪽 `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```

`wsl --shutdown` 후 재기동. WSL이 서버의 LAN IP를 그대로 쓰므로 portproxy가 불필요하다. 방화벽 인바운드 규칙만 연다:

```powershell
New-NetFirewallRule -DisplayName "ddobak-https" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
```

### 방법 B — portproxy (구버전 Windows)

관리자 PowerShell:

```powershell
$wslIp = (wsl hostname -I).Trim().Split(" ")[0]
netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 connectport=443 connectaddress=$wslIp
New-NetFirewallRule -DisplayName "ddobak-https" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
```

⚠️ **WSL IP는 재부팅마다 바뀐다.** 위 portproxy 갱신을 스크립트(.ps1)로 저장하고 3단계의 시작 작업(WSL-AutoStart) 뒤에 이어 실행되도록 작업 스케줄러에 등록해야 한다. 이 번거로움이 방법 A를 권장하는 이유다.

### 맥·서버가 서로 다른 네트워크(외부망)인 경우

Tailscale을 Windows 호스트에 설치하면 포트포워딩·공인 IP 고민이 사라진다. 같은 LAN/VPN이면 불필요.

---

## 6단계: 일상 워크플로우 (세팅 완료 후)

```bash
# 맥에서
ssh ddobak-win           # → Ubuntu
tmux new -s dev          # 이미 있으면: tmux attach -t dev
claude                   # 서버 안에서 Claude Code로 수정·개발
```

- SSH가 끊겨도 tmux 세션은 유지된다. 재접속 후 `tmux attach -t dev`.
- **코드 흐름은 git 경유**: 맥 작업 → `git push` → 서버 `git pull`. 서버 작업 → 반대로. 파일을 손으로 옮기지 않는다.
- 파일을 많이 편집할 때는 맥 VS Code + Remote-SSH 확장으로 `ddobak-win` 접속 — WSL 내부 파일을 로컬처럼 편집.
- RDP는 GUI가 꼭 필요한 예외 상황(드라이버 설치 등)에만 사용.

---

## 순서 요약

| 단계 | 어디서 | 내용 | 소요 |
|---|---|---|---|
| 0 | 맥→SSH | Windows 버전·GPU·sshd 자동시작 확인 | 5분 |
| 1 | SSH | `wsl --install` + 재부팅 + Ubuntu 유저 생성 + `nvidia-smi` 확인 | 15분 |
| 2 | 맥 | `~/.ssh/config`에 `ddobak-win` 등록 | 2분 |
| 3 | SSH | systemd 켜기 + WSL 자동시작 작업 등록 | 5분 |
| 4 | WSL | clone + 배포가이드 §2.3, §2.2 진행 | 1~2시간 |
| 5 | SSH | (팀원 접속 시점에) mirrored 또는 portproxy로 포트 노출 | 10분 |
| 6 | 맥 | ssh + tmux + claude로 일상 개발 | — |

---

## 체크리스트

### 설치 전

- [ ] Windows Server 2022+ 또는 Windows 10/11 확인 (2019는 불가)
- [ ] `nvidia-smi` 동작 (Windows 호스트)
- [ ] `sshd` StartupType = Automatic

### 설치 후

- [ ] `wsl -l -v` → VERSION 2
- [ ] WSL 안 `nvidia-smi` 동작 (GPU 패스스루)
- [ ] `/etc/wsl.conf`에 `systemd=true`
- [ ] 작업 스케줄러 `WSL-AutoStart` 등록
- [ ] sidecar 로그에 `자동 감지 엔진: qwen3_asr_transformers`
- [ ] backend `SERVER_MODE=true` 확인
- [ ] **서버 재부팅 1회 실시** → SSH 재접속 → Rails·sidecar 자동 기동 확인 (가장 중요한 통합 검증)
- [ ] 실제 회의 1건으로 STT·화자분리·임베딩 동작 확인

---

## 문제 해결

| 증상 | 원인/조치 |
|---|---|
| 재부팅 후 SSH 접속 불가 | sshd StartupType 미설정. RDP로 접속해 `Set-Service sshd -StartupType Automatic` |
| WSL 안에서 `nvidia-smi` 실패 | Windows 호스트 드라이버가 구버전. 호스트 드라이버만 업데이트 (WSL 안에 설치 금지) |
| `wsl -l -v`가 VERSION 1 | `wsl --set-version Ubuntu 2` |
| 재부팅 후 서비스 안 뜸 | ①`WSL-AutoStart` 작업 미등록 ②`systemd=true` 누락 ③systemd 유닛 `enable` 안 함 — 순서대로 확인 |
| LAN에서 접속 안 됨 | NAT 문제. 5단계(mirrored/portproxy) 적용 여부, 방화벽 인바운드 규칙 확인 |
| portproxy가 재부팅 후 죽음 | WSL IP 변경 때문. 갱신 스크립트를 시작 작업에 등록 (또는 방법 A로 전환) |
| JWT 인증 무시되고 아무나 접속 | `SERVER_MODE=true` 누락. 배포가이드 §2.3 8단계 참고 |
| 빌드/IO가 비정상적으로 느림 | 소스가 `/mnt/c/` 아래에 있음. WSL 홈(ext4)으로 이동 |
