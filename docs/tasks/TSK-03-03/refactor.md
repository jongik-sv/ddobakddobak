# TSK-03-03: 리팩토링 내역

## 변경 사항
| 파일 | 변경 내용 |
|---|---|
| SpeakerLabel.tsx | SPEAKER_N 끝 숫자 파싱으로 색상 인덱스 결정 |
| LiveTranscript.tsx | partial/finals 변경 시 useEffect로 자동 스크롤 |
| test/setup.ts | scrollIntoView jsdom 전역 stub 추가 |

## 테스트 확인
- 결과: PASS (96/96)
