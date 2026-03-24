# TSK-05-03 테스트 리포트

## 테스트 실행 결과
- 실행 일시: 2026-03-25
- 총 테스트: 108개
- 통과: 108개
- 실패: 0개

## 테스트 상세

### AiSummaryPanel 테스트
- [x] summary가 null일 때 준비 중 메시지 표시
- [x] key_points 렌더링 확인
- [x] decisions 렌더링 확인
- [x] is_final=true일 때 최종 요약 배지 표시
- [x] action_items 렌더링 확인 (있을 경우)
- [x] key_points와 decisions 모두 빈 배열일 때 빈 상태 메시지 표시

### 기타 통과한 테스트

#### HomePage
- [x] 홈 페이지가 렌더링됨
- [x] 로그인 링크가 존재함

#### AudioRecorder
- [x] 비녹음 상태에서 "녹음 시작" 버튼 표시
- [x] 녹음 중 상태에서 "녹음 중지" 버튼 표시
- [x] 녹음 중 상태에서 녹음 표시등("녹음 중") 표시
- [x] 비녹음 상태에서 녹음 표시등 미표시
- [x] "녹음 시작" 클릭 시 start() 호출
- [x] "녹음 중지" 클릭 시 stop() 호출
- [x] 에러 발생 시 에러 메시지 표시

#### TeamPage
- [x] 팀 관리 페이지가 렌더링됨
- [x] 팀 목록이 표시됨
- [x] 팀 생성 폼이 존재함
- [x] 팀 생성 성공 시 목록에 추가됨
- [x] 팀 선택 시 팀원 목록이 표시됨
- [x] admin 역할일 때 초대 폼이 표시됨
- [x] member 역할일 때 초대 폼이 표시되지 않음
- [x] admin 역할일 때 제거 버튼이 표시됨
- [x] member 역할일 때 제거 버튼이 표시되지 않음
- [x] 팀원 초대 성공 시 목록에 추가됨
- [x] 팀원 제거 성공 시 목록에서 제거됨

#### MeetingLivePage
- [x] "회의 시작" 버튼 렌더
- [x] "회의 종료" 버튼은 회의 시작 전 비활성화
- [x] 3영역 레이아웃 표시 (자막, 요약, 메모)
- [x] "회의 시작" 클릭 시 startMeeting API 호출
- [x] 회의 시작 후 녹음 표시등 표시
- [x] "회의 종료" 클릭 시 stopMeeting API 호출

#### Sidebar
- [x] 대시보드 링크가 렌더링됨
- [x] 팀 목록 링크가 렌더링됨
- [x] 대시보드 링크 href가 /dashboard임
- [x] 팀 목록 링크 href가 /teams임
- [x] md 이하에서 숨김 클래스를 가짐

#### AppLayout
- [x] children이 렌더링됨
- [x] 사이드바가 렌더링됨
- [x] 헤더가 렌더링됨
- [x] 사용자 이름이 헤더에 표시됨

#### Header
- [x] 사용자 이름이 표시됨
- [x] 로그아웃 버튼이 렌더링됨
- [x] 로그아웃 버튼 클릭 시 logout()이 호출됨
- [x] user가 null일 때 크래시 없이 렌더링됨

#### LoginPage
- [x] 로그인 페이지가 렌더링됨
- [x] 이메일 입력 필드가 존재함
- [x] 비밀번호 입력 필드가 존재함
- [x] 로그인 성공 시 /dashboard로 이동
- [x] 로그인 실패 시 에러 메시지 표시
- [x] 회원가입 페이지 링크가 존재함

#### SignupPage
- [x] 회원가입 페이지가 렌더링됨
- [x] 이름, 이메일, 비밀번호 입력 필드가 존재함
- [x] 회원가입 성공 시 /dashboard로 이동
- [x] 회원가입 실패 시 에러 메시지 표시
- [x] 로그인 페이지 링크가 존재함

#### useAudioRecorder
- [x] 초기 상태: isRecording=false, error=null
- [x] start() 호출 시 마이크 권한 요청
- [x] start() 성공 후 isRecording=true
- [x] start() 후 AudioContext가 16kHz로 생성됨
- [x] start() 후 AudioWorklet 모듈 등록
- [x] stop() 후 isRecording=false
- [x] worklet 메시지 수신 시 onChunk 콜백 호출
- [x] stop() 시 onStop(Blob) 콜백 호출
- [x] getUserMedia 실패 시 error 설정, isRecording=false 유지
- [x] stop() 시 스트림 트랙 중지

#### SpeakerLabel
- [x] 화자 레이블 텍스트 렌더
- [x] 다른 화자 레이블 렌더
- [x] role="status" 접근성 속성 포함
- [x] SPEAKER_00은 첫 번째 색상 반환
- [x] SPEAKER_01은 두 번째 색상 반환 (SPEAKER_00과 다름)
- [x] 알 수 없는 화자는 기본 색상 반환

#### PrivateRoute
- [x] 미인증 시 /login으로 리다이렉트
- [x] 인증 시 protected content 렌더링

#### LiveTranscript
- [x] 빈 상태에서 빈 컨테이너 렌더
- [x] final 발화 텍스트 표시
- [x] 여러 final 발화 모두 표시
- [x] partial 텍스트 표시
- [x] partial 텍스트에 data-testid="partial" 속성
- [x] final 텍스트는 partial 스타일 없음
- [x] 화자 레이블이 final 발화와 함께 표시

#### App 라우팅
- [x] / 경로에서 HomePage가 렌더링됨
- [x] /login 경로에서 LoginPage가 렌더링됨

#### useTranscription
- [x] 마운트 시 TranscriptionChannel 구독
- [x] 언마운트 시 구독 해제
- [x] sendChunk 호출 시 perform으로 오디오 전송
- [x] partial 이벤트 수신 시 스토어 업데이트
- [x] final 이벤트 수신 시 스토어 업데이트
- [x] speaker_change 이벤트 수신 시 currentSpeaker 업데이트
- [x] summary_update 이벤트 수신 시 summary 업데이트
- [x] meetingId 변경 시 재구독

#### auth API
- [x] sign_in 엔드포인트로 POST 요청
- [x] token과 user를 반환
- [x] sign_up 엔드포인트로 POST 요청
- [x] token과 user를 반환

#### transcriptStore
- [x] 초기 상태 확인
- [x] setPartial: partial 텍스트 업데이트
- [x] addFinal: finals 배열에 추가
- [x] addFinal 후 partial 초기화
- [x] setSpeaker: currentSpeaker 업데이트
- [x] setSummary: summary 업데이트
- [x] reset: 전체 상태 초기화
- [x] 여러 final 발화 순서 유지

#### authStore
- [x] 초기 상태: user는 null이고 isAuthenticated는 false
- [x] setUser 호출 시 user가 설정되고 isAuthenticated가 true
- [x] setToken 호출 시 token이 설정됨
- [x] login 호출 시 token, user, isAuthenticated 설정됨
- [x] logout 호출 시 상태가 초기화됨

## 실패 이력
- 없음 (첫 실행에서 전체 통과)
