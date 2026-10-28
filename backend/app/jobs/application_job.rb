class ApplicationJob < ActiveJob::Base
  # 잡 워커는 puma 에서 fork 된 별도 프로세스라 설정 저장 시의 ENV 갱신이 전달되지 않는다.
  # settings.yaml 이 바뀌었으면 잡 시작 전에 ENV 를 재동기화한다(예외는 내부에서 삼킴).
  before_perform { AppSettings.refresh_env_if_changed! }

  # Automatically retry jobs that encountered a deadlock
  # retry_on ActiveRecord::Deadlocked

  # Most jobs are safe to ignore if the underlying records are no longer available
  # discard_on ActiveJob::DeserializationError
end
