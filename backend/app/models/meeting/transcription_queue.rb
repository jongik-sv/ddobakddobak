# 파일 전사(file_transcription) 대기열 위치 조회.
module Meeting::TranscriptionQueue
  extend ActiveSupport::Concern

  # 파일 전사 대기열 위치. file_transcription 큐는 스레드 1개 직렬이라, 앞선 회의가 오래 걸리면
  # (예: 70분 파일) 뒤에 업로드된 회의는 진행률이 계속 0%로 보여 "고장"으로 오인된다(실사고).
  # transcribing인데 자기 잡이 아직 대기(미claim) 상태면 앞선 미완료 잡 수(N)를 반환 —
  # 프론트는 이걸로 "앞에 N건 대기 중"을 보여주다가, 잡이 claim(실행 시작)되면 nil로 전환해
  # 기존 진행률 표시(ActionCable broadcast)로 자연스럽게 넘어간다.
  # SolidQueue::Job은 :queue DB 별도 커넥션(config/environments/production.rb connects_to)이라
  # primary DB 커넥션풀에 영향 없음. dev/test(:async 어댑터)는 큐 테이블 자체가 없어
  # StatementInvalid가 나므로 nil로 폴백(기존 "잡 못 찾으면 null" 동작과 동일 취급).
  TRANSCRIPTION_QUEUE_NAME = "file_transcription".freeze
  TRANSCRIPTION_QUEUE_JOB_CLASSES = %w[FileTranscriptionJob ReDiarizeJob].freeze

  def transcription_stream
    "meeting_#{id}_transcription"
  end

  # jobs: 미리 조회해둔 스냅샷(옵션) — meeting_serializable#transcription_queue_jobs_snapshot 가
  # 요청(컨트롤러 인스턴스) 단위로 1회 조회한 배열을 넘겨 목록 직렬화의 회의별 재조회(N+1)를
  # 피한다. 생략하면(단건 조회 등) 기존처럼 그 자리에서 조회한다.
  def transcription_queue_position(jobs = nil)
    return nil unless transcribing?

    jobs ||= self.class.unfinished_transcription_queue_jobs
    own_index = jobs.find_index do |job|
      TRANSCRIPTION_QUEUE_JOB_CLASSES.include?(job.class_name) &&
        self.class.transcription_queue_job_meeting_id(job) == id
    end
    return nil unless own_index

    return nil if jobs[own_index].claimed? # 실행 중 — 진행률 표시로 전환

    own_index
  rescue ActiveRecord::StatementInvalid
    nil
  end

  class_methods do
    # queue_name=file_transcription, 미완료(finished_at nil) 잡을 id 순(=enqueue 순)으로 스냅샷.
    # ReDiarizeJob도 같은 큐를 공유하므로 자연히 포함된다(다른 회의의 재분리도 대기열을 밀어야 정확).
    # failed_execution 이 붙은 잡은 제외 — SolidQueue는 실패해도 finished_at을 채우지 않으므로
    # (gem 소스 SolidQueue::Job::Executable#finished! 은 성공 경로에서만 호출) 워커 강제종료(배포
    # 재시작·OOM 시 프로세스 prune 의 fail_all_claimed_executions_with)로 죽은 잡이 제외 없이는
    # 영구 대기 카운트에 잡혀 뒤 회의들의 대기 수를 과대표시하고, 자기 잡이 failed면 영원히
    # "대기 중"으로 멈춘다.
    def unfinished_transcription_queue_jobs
      # claimed_execution 을 함께 preload — meeting_serializable#transcription_queue_jobs_snapshot 가
      # 요청당 1회 이 스냅샷을 재사용하는 목록 직렬화 경로에서, 회의마다 호출되는 jobs[i].claimed?
      # (has_one 존재 체크)가 추가 쿼리 없이 미리 로드된 값을 쓰게 한다.
      SolidQueue::Job.where(queue_name: TRANSCRIPTION_QUEUE_NAME, finished_at: nil)
                     .where.missing(:failed_execution)
                     .includes(:claimed_execution)
                     .order(:id).to_a
    end

    # SolidQueue::Job#arguments = ActiveJob 직렬화 해시(예: {"job_class"=>"FileTranscriptionJob",
    # "arguments"=>[meeting_id], ...}). meeting_id(Integer)는 ActiveJob 허용 원시타입이라 그대로 보존.
    def transcription_queue_job_meeting_id(job)
      args = job.arguments
      return nil unless args.is_a?(Hash)
      Array(args["arguments"]).first
    end
  end
end
