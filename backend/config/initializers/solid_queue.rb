# solid_queue_jobs.arguments(TEXT) 비대 방지 조치의 일부(레버①).
# finished 잡 보관 기본값(1일)을 1시간으로 단축한다 — 오디오 청크가 파일 경로 참조로
# 바뀌어도, base64가 인라인으로 남아 있던 예전 finished 잡이 하루씩 큐 DB에 눌러앉는
# 것을 막기 위함.
#
# 순서 검증: SolidQueue::Engine의 "solid_queue.config" initializer(엔진 자체 initializer)는
# config.solid_queue(OrderedOptions)에 담긴 값만 SolidQueue.*= 로 반영한다. 이 값은 보통
# config/environments/<env>.rb 에서 채워진다(예: 이 리포의 config.solid_queue.connects_to).
# config/initializers/*.rb 는 Rails::Application::Finisher#load_config_initializers 에서
# 실행되며, 이는 모든 Railtie/Engine initializer(엔진의 "solid_queue.config" 포함) 이후에
# 실행된다. 따라서 아래 직접 대입은 엔진 initializer보다 나중에 실행되어 덮어써지지 않는다.
SolidQueue.clear_finished_jobs_after = 1.hour
