require "rails_helper"

# 파일 전사 대기열 위치(#transcription_queue_position) 검증.
# file_transcription 큐는 스레드 1개 직렬 — 앞선 잡이 오래 걸리면 뒤 회의는 진행률이
# 0%로 고정돼 보여 "고장"으로 오인된다(실사고). SolidQueue::Job 쿼리 결과를 스텁해
# 실제 큐 DB(테스트 환경엔 solid_queue_jobs 테이블이 없음) 없이 로직만 검증한다.
RSpec.describe Meeting, "#transcription_queue_position" do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user, status: "transcribing") }

  # SolidQueue::Job 을 흉내내는 최소 더블. class_name/arguments/claimed? 만 있으면 된다.
  def fake_job(id:, class_name:, meeting_id:, claimed: false)
    double("SolidQueue::Job", id: id, class_name: class_name,
           arguments: { "job_class" => class_name, "arguments" => [meeting_id] },
           claimed?: claimed)
  end

  describe "transcribing 이 아니면" do
    it "쿼리 없이 nil" do
      m = create(:meeting, project: project, creator: user, status: "completed")
      expect(Meeting).not_to receive(:unfinished_transcription_queue_jobs)
      expect(m.transcription_queue_position).to be_nil
    end
  end

  describe "transcribing 인데" do
    it "앞선 미완료 잡이 2개면 2를 반환" do
      jobs = [
        fake_job(id: 1, class_name: "FileTranscriptionJob", meeting_id: 9991),
        fake_job(id: 2, class_name: "ReDiarizeJob", meeting_id: 9992),
        fake_job(id: 3, class_name: "FileTranscriptionJob", meeting_id: meeting.id)
      ]
      allow(Meeting).to receive(:unfinished_transcription_queue_jobs).and_return(jobs)

      expect(meeting.transcription_queue_position).to eq(2)
    end

    it "자기 잡이 claimed(실행 중)면 nil(프론트가 진행률 표시로 전환)" do
      jobs = [ fake_job(id: 1, class_name: "FileTranscriptionJob", meeting_id: meeting.id, claimed: true) ]
      allow(Meeting).to receive(:unfinished_transcription_queue_jobs).and_return(jobs)

      expect(meeting.transcription_queue_position).to be_nil
    end

    it "자기 잡을 찾지 못하면 nil (enqueue 실패·상태 stale 등)" do
      jobs = [ fake_job(id: 1, class_name: "FileTranscriptionJob", meeting_id: 9999) ]
      allow(Meeting).to receive(:unfinished_transcription_queue_jobs).and_return(jobs)

      expect(meeting.transcription_queue_position).to be_nil
    end

    it "ReDiarizeJob도 같은 큐 앞자리로 카운트된다" do
      jobs = [
        fake_job(id: 1, class_name: "ReDiarizeJob", meeting_id: 8888),
        fake_job(id: 2, class_name: "FileTranscriptionJob", meeting_id: meeting.id)
      ]
      allow(Meeting).to receive(:unfinished_transcription_queue_jobs).and_return(jobs)

      expect(meeting.transcription_queue_position).to eq(1)
    end

    it "큐 DB 자체가 없으면(dev/test :async 어댑터) StatementInvalid를 흡수해 nil" do
      # unfinished_transcription_queue_jobs 를 스텁하지 않아 실제 SolidQueue::Job 쿼리가
      # 나가고, 테스트 환경엔 solid_queue_jobs 테이블이 없어 StatementInvalid가 발생한다.
      expect(meeting.transcription_queue_position).to be_nil
    end
  end
end
