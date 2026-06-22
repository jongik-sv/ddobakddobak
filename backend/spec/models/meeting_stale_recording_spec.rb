require "rails_helper"

RSpec.describe Meeting, "stale recording reaper" do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }

  def rec(heartbeat_at:, status: "recording")
    create(:meeting, project: project, creator: user, status: status,
                     started_at: 10.minutes.ago, recorder_heartbeat_at: heartbeat_at)
  end

  before { RecordingLock.reset! }

  describe "#stale_recording?" do
    it "fresh heartbeat(<90s) → false (활성 보호)" do
      expect(rec(heartbeat_at: 5.seconds.ago).stale_recording?).to be false
    end

    it "방금 시작(heartbeat=now) → false (시작직후 침묵 보호)" do
      expect(rec(heartbeat_at: Time.current).stale_recording?).to be false
    end

    it "heartbeat 90s+ 과거 → true" do
      expect(rec(heartbeat_at: 3.minutes.ago).stale_recording?).to be true
    end

    it "heartbeat nil(레거시/크래시) → true" do
      expect(rec(heartbeat_at: nil).stale_recording?).to be true
    end

    it "completed → false (recording 아님)" do
      expect(rec(heartbeat_at: nil, status: "completed").stale_recording?).to be false
    end
  end

  describe "#heal_stale_recording!" do
    it "stale → completed + ended_at + paused_at nil" do
      m = rec(heartbeat_at: nil)
      m.update_column(:paused_at, 5.minutes.ago)
      m.heal_stale_recording!
      m.reload
      expect(m.status).to eq("completed")
      expect(m.ended_at).to be_present
      expect(m.paused_at).to be_nil
    end

    it "heartbeat 있는 stale → ended_at = 마지막 heartbeat 시각(치유시각 아님)" do
      last_presence = 3.minutes.ago
      m = rec(heartbeat_at: last_presence)
      m.heal_stale_recording!
      m.reload
      expect(m.status).to eq("completed")
      # 종료시각은 치유 호출 시각(Time.current)이 아니라 마지막 presence(하트비트)여야 한다.
      expect(m.ended_at).to be_within(1.second).of(last_presence)
    end

    it "활성(fresh) → no-op" do
      m = rec(heartbeat_at: 1.second.ago)
      expect { m.heal_stale_recording! }.not_to change { m.reload.status }
    end

    it "전사 있으면 finalize/summary enqueue" do
      m = rec(heartbeat_at: nil)
      create(:transcript, meeting: m)
      expect(MeetingFinalizerJob).to receive(:perform_later).with(m.id)
      expect(MeetingSummarizationJob).to receive(:perform_later).with(m.id, type: "final")
      m.heal_stale_recording!
    end

    it "전사 없으면 job 미enqueue" do
      m = rec(heartbeat_at: nil)
      expect(MeetingFinalizerJob).not_to receive(:perform_later)
      m.heal_stale_recording!
    end

    it "두 인스턴스 동시 heal → finalize/summary 각각 1회만 enqueue(원자 가드)" do
      # 동시성 재현: 두 인스턴스를 모두 recording 상태로 로드한 뒤 각각 heal 호출.
      # 한 인스턴스가 먼저 DB 를 completed 로 전이하면, 다른 인스턴스는 자기 메모리상
      # status 가 여전히 recording 이라 중복 enqueue 를 시도한다 → update_all 변경행수
      # 가드가 0행이면 early return 해 중복을 막아야 한다.
      m = rec(heartbeat_at: nil)
      create(:transcript, meeting: m)
      m1 = Meeting.find(m.id)
      m2 = Meeting.find(m.id)

      expect(MeetingFinalizerJob).to receive(:perform_later).with(m.id).once
      expect(MeetingSummarizationJob).to receive(:perform_later).with(m.id, type: "final").once

      m1.heal_stale_recording!
      m2.heal_stale_recording!
    end
  end
end
