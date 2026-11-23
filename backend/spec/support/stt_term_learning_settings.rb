# 실 settings.yaml 을 읽지 않도록 학습 설정을 기본값으로 고정한다.
# 설정 읽기/저장 자체를 검증하는 spec 은 `stt_settings_io: true` 메타데이터로 건너뛴다.
RSpec.configure do |config|
  config.before do |example|
    next if example.metadata[:stt_settings_io]
    allow(AppSettings).to receive(:stt_term_learning).and_return(AppSettings::STT_TERM_LEARNING_DEFAULTS.dup)
  end
end
