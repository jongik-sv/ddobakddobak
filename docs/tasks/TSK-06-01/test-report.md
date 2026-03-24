# TSK-06-01: 테스트 결과

## 결과: PASS

## 실행 요약

| 구분 | 통과 | 실패 | 합계 |
|------|------|------|------|
| meetings_spec.rb | 38 | 0 | 38 |
| 전체 (bundle exec rspec) | 201 | 0 | 201 |

## 재시도 이력
- 첫 실행에 통과

## 비고
- 시스템 기본 Ruby(2.6) + Bundler(1.17.2)로는 Gemfile.lock의 BUNDLED WITH 4.0.8 요구사항과 충돌하여 실행 불가
- Homebrew Ruby 4.0.2 + Bundler 4.0.8(`/opt/homebrew/opt/ruby/bin/bundle`)로 실행
- `Status code :unprocessable_entity is deprecated` 경고가 다수 출력되었으나 테스트 통과에는 영향 없음
- 전체 테스트 중 1개 pending(`spec/models/user_spec.rb` — 미구현 예제, 정상)
