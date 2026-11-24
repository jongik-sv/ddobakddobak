---
title: "자주 묻는 질문"
description: "설치·실행 방식·계정·녹음·회의록·공유에 대해 사용자가 자주 묻는 질문과 답을 모았습니다."
sidebar:
  order: 3
---

궁금한 항목을 눌러 펼쳐 보세요. 증상이 있는 문제는 [문제 해결](../troubleshooting/)에서 찾는 것이 더 빠릅니다.

## 시작하기

<details>
<summary>또박또박은 무엇을 해 주나요?</summary>

회의 음성을 실시간으로 받아쓰고, 말한 사람을 자동으로 구분하고, AI가 회의록으로 정리합니다. 이미 녹음한 오디오 파일을 올려 회의록을 만들 수도 있습니다. 자세한 내용은 [또박또박 소개](../../start/overview/)를 보세요.
</details>

<details>
<summary>로컬 실행과 서버 연결 중 무엇을 골라야 하나요?</summary>

혼자 쓰고, 회의 내용을 내 컴퓨터 밖으로 보내고 싶지 않다면 **로컬 실행**이 알맞습니다. 팀원과 같은 회의록을 함께 보고, 웹 브라우저나 휴대폰에서도 접속하려면 **서버 연결**을 고르세요. 이미 팀의 회의 서버가 있다면 보통 서버 연결입니다. 비교는 [첫 실행](../../start/first-run/)에 표로 정리했습니다.
</details>

<details>
<summary>어떤 기기에서 쓸 수 있나요?</summary>

macOS와 Windows 데스크톱 앱, Android 앱, 웹 브라우저에서 쓸 수 있습니다. 웹 브라우저와 휴대폰은 항상 서버에 접속하는 방식이고, 로컬 실행은 데스크톱 앱에서만 고를 수 있습니다. → [설치](../../start/install/)
</details>

<details>
<summary>회원가입은 어디서 하나요?</summary>

로그인 화면에는 회원가입 버튼이 없습니다. 서버 관리자가 만들어 준 계정으로 로그인하거나, 프로젝트 관리자가 보낸 초대 링크에서 「가입하고 합류하기」로 가입합니다. → [로그인과 계정 만들기](../../start/login/)
</details>

<details>
<summary>비밀번호를 잊었습니다.</summary>

스스로 초기화하는 기능은 없습니다. 서버 관리자에게 초기화를 요청하면 임시 비밀번호를 받을 수 있고, 로그인한 뒤 「설정」 → 「개인설정」의 「비밀번호 변경」에서 새 비밀번호로 바꾸세요.
</details>

<details>
<summary>첫 화면에 나오는 「내 회의」는 무엇인가요?</summary>

나만 쓰는 개인 프로젝트입니다. 팀 프로젝트가 없어도 바로 회의를 만들 수 있습니다. → [프로젝트 선택](../../start/project-select/)
</details>

<details>
<summary>프로젝트 선택 화면이 다음부터는 안 나옵니다.</summary>

한 번 고른 프로젝트는 기억해서 바로 그 프로젝트의 회의 목록을 엽니다. 다른 프로젝트로 옮기려면 사이드바 위쪽의 「프로젝트 전환」을 사용하세요. → [프로젝트 관리](../../projects/projects/)
</details>

## 녹음과 전사

<details>
<summary>어떤 언어를 인식하나요?</summary>

한국어, English, 日本語, 中文, Español, Français, Deutsch를 선택할 수 있습니다. 여러 언어가 섞이는 회의는 설정에서 오디오 분할 길이를 짧게 하면 언어 감지가 더 정확해질 수 있습니다. → [음성·인식](../../settings/voice/)
</details>

<details>
<summary>화상회의 상대방의 목소리도 기록할 수 있나요?</summary>

데스크톱 앱의 시스템 오디오 캡처를 쓰면 컴퓨터에서 나오는 소리를 함께 기록할 수 있습니다. → [시스템 오디오 캡처](../../recording/system-audio/)
</details>

<details>
<summary>인터넷이 없어도 쓸 수 있나요?</summary>

로컬 실행은 내 컴퓨터 안에서 처리하므로 음성 인식에 인터넷이 필요하지 않습니다. 단, AI 회의록을 만드는 LLM을 외부 서비스로 지정했다면 그 서비스에 접속할 수 있어야 합니다. Android 앱은 서버 없이 기기 안에서 녹음하고 전사하는 오프라인 시작을 지원합니다. → [오프라인 녹음](../../recording/offline/)
</details>

<details>
<summary>이미 녹음해 둔 파일로 회의록을 만들 수 있나요?</summary>

가능합니다. 오디오 파일을 올리면 전사와 회의록을 만들고, 여러 파일을 순서대로 이어 붙여 한 회의로 만들 수도 있습니다. 앱 어디서든 오디오 파일을 끌어다 놓으면 업로드가 시작됩니다. → [오디오 파일 업로드](../../recording/upload/)
</details>

<details>
<summary>녹음 중에 앱을 닫아도 되나요?</summary>

데스크톱 앱에서 창을 닫으면 「또박또박을 어떻게 할까요?」 창이 나옵니다. 녹음 중이라면 먼저 회의를 종료하는 것이 안전합니다. 웹 브라우저는 탭을 닫으면 녹음이 끊길 수 있으니 닫지 마세요. 중요한 회의는 데스크톱 앱을 권장합니다.
</details>

<details>
<summary>녹음 중에 중요한 부분을 표시할 수 있나요?</summary>

북마크를 추가하면 그 시점이 기록됩니다. 단축키는 `Ctrl` + `B`(macOS는 `Cmd` + `B`)입니다. 메모도 남길 수 있습니다. → [라이브 녹음](../../recording/live/), [키보드 단축키](../shortcuts/)
</details>

## 회의록

<details>
<summary>AI 회의록은 언제 만들어지나요?</summary>

녹음 중에는 설정한 간격마다 회의록이 갱신되고, 회의를 종료하면 최종본이 만들어집니다. 간격은 설정에서 고를 수 있으며 「안함」을 고르면 자동 갱신하지 않습니다. → [AI 회의록](../../minutes/ai-summary/), [회의록 설정](../../settings/meeting/)
</details>

<details>
<summary>회의록을 직접 고칠 수 있나요?</summary>

회의록 본문은 직접 편집할 수 있습니다. 전사의 오타도 문장 단위로 고칠 수 있습니다. 회의를 「잠금」(읽기 전용)으로 바꿔 두면 실수로 고치는 일을 막을 수 있습니다. → [AI 회의록](../../minutes/ai-summary/), [전사 편집](../../minutes/transcript/)
</details>

<details>
<summary>회의 유형이 무엇인가요?</summary>

일반 회의, 팀 회의처럼 회의 성격에 맞춰 회의록의 구성(핵심 요약, 논의 사항, 결정사항 등)을 정하는 선택지입니다. 회의를 만들 때 고릅니다. → [새 회의 만들기](../../meetings/new-meeting/)
</details>

<details>
<summary>화자 이름은 어떻게 바꾸나요?</summary>

회의 상세 화면에서 화자 이름을 누르고 새 이름을 입력한 뒤 `Enter`를 누릅니다. → [화자 정리](../../minutes/speakers/)
</details>

<details>
<summary>지난 회의에서 나온 내용을 어떻게 찾나요?</summary>

사이드바의 전역 검색에서 키워드로 찾거나, AI 챗에 질문하면 근거가 된 회의 위치와 함께 답합니다. → [전역 검색](../../ai/search/), [회의 AI 챗](../../ai/chat/)
</details>

<details>
<summary>지난 회의와 이어지는 회의는 어떻게 관리하나요?</summary>

회의를 서로 연결해 두면 이전 회의 요약을 참고해 회의록을 만들 수 있습니다. → [연결 회의](../../minutes/linked-meetings/)
</details>

## 공유와 내보내기

<details>
<summary>팀원이 회의 중에 실시간으로 볼 수 있나요?</summary>

한 기기에서 녹음하는 동안 같은 회의를 다른 기기에서 열면 읽기 전용 뷰어로 진행 중인 전사와 회의록을 볼 수 있습니다. 공유 코드를 입력하는 기능은 없습니다. → [다른 기기에서 실시간으로 보기](../../share/live-share/)
</details>

<details>
<summary>누가 회의를 고칠 수 있나요?</summary>

회의 소유자와 관리자는 모든 작업을 할 수 있고, 협업자로 지정된 사람은 부여된 권한만큼 편집할 수 있습니다. 그 밖의 사람은 읽기만 가능합니다. → [회의 협업자 권한](../../share/collaborators/)
</details>

<details>
<summary>회의록을 어떤 형식으로 저장할 수 있나요?</summary>

마크다운, PDF, DOCX로 내려받을 수 있고, AI에 그대로 붙여 넣을 수 있는 프롬프트와 화이트보드 형식도 지원합니다. 요약을 모아 zip으로 내보내는 기능도 있습니다. → [회의록 내보내기](../../share/export/)
</details>

<details>
<summary>회의 데이터를 다른 서버나 컴퓨터로 옮길 수 있나요?</summary>

회의와 폴더를 아카이브 파일로 내보내고 다른 곳에서 가져올 수 있습니다. 로컬 실행에서 서버 연결로 옮길 때도 사용합니다. → [아카이브 내보내기·가져오기](../../share/archive/)
</details>

<details>
<summary>외부 프로그램이나 AI 도구에서 회의 내용을 조회할 수 있나요?</summary>

회의 API와 API 토큰을 발급하면 가능합니다. 토큰마다 권한 범위를 좁힐 수 있습니다. → [회의 API](../../settings/meeting-api/)
</details>

## 삭제와 복구

<details>
<summary>실수로 회의를 삭제했습니다.</summary>

삭제한 회의는 먼저 휴지통으로 이동하므로 휴지통에서 복구할 수 있습니다. 휴지통에서 영구 삭제하면 되돌릴 수 없습니다. → [휴지통](../../trash/trash/)
</details>

<details>
<summary>회의록을 다시 만들면 직접 고친 내용이 사라지나요?</summary>

회의록을 다시 만들면 직접 편집한 내용이 새 결과로 바뀔 수 있습니다. 다시 만들기 전에 내용을 따로 보관해 두고, 안내 문구를 꼭 읽어 보세요. → [AI 회의록](../../minutes/ai-summary/)
</details>

## 설정

<details>
<summary>설정을 바꾸고 싶은데 메뉴가 없습니다.</summary>

휴대폰(Android)에서는 설정 일부가 제한됩니다. LLM·음성 인식 같은 서버 전체 설정은 관리자만 바꿀 수 있습니다. 내 계정에만 적용되는 항목은 「개인설정」 탭에 있습니다. → [개인설정](../../settings/personal/)
</details>

<details>
<summary>매뉴얼은 어떻게 여나요?</summary>

앱에서 `F1`을 누르거나 사이드바의 「매뉴얼」 버튼을 누르면 현재 화면에 맞는 페이지가 열립니다. → [키보드 단축키](../shortcuts/)
</details>

원하는 답이 없다면 [문제 해결](../troubleshooting/)을 확인하거나 서버 관리자에게 문의하세요.
