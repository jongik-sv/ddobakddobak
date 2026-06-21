require "rails_helper"

RSpec.describe ScheduleRolloverJob, type: :job do
  let(:user)    { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:rule)    { '{"freq":"weekly","days":[1],"time":"10:00","tz":"Asia/Seoul"}' }

  def recurring_missed
    create(:meeting, project: project, creator: user, status: "pending",
           recurrence_rule: rule, scheduled_start_time: 90.seconds.ago)
  end

  describe "#perform" do
    it "놓친 반복 시리즈에 대해 미래 successor 를 정확히 1개 생성한다" do
      source = recurring_missed
      expect {
        described_class.new.perform
      }.to change { Meeting.where(previous_meeting_id: source.id).count }.by(1)

      successor = Meeting.find_by(previous_meeting_id: source.id)
      expect(successor.status).to eq("pending")
      expect(successor.scheduled_start_time).to be > Time.current
    end

    it "두 번 실행해도 중복 생성하지 않는다(멱등)" do
      source = recurring_missed
      described_class.new.perform
      expect {
        described_class.new.perform
      }.not_to change { Meeting.where(previous_meeting_id: source.id).count }
    end

    it "놓친 원본은 pending 으로 남긴다(놓친 예약 목록에 계속 노출)" do
      source = recurring_missed
      described_class.new.perform
      expect(source.reload.status).to eq("pending")
      expect(source.schedule_dismissed_at).to be_nil
    end

    it "비반복 놓친 예약은 건드리지 않는다" do
      plain = create(:meeting, project: project, creator: user, status: "pending",
                     recurrence_rule: nil, scheduled_start_time: 90.seconds.ago)
      expect {
        described_class.new.perform
      }.not_to change { Meeting.where(previous_meeting_id: plain.id).count }
    end

    it "트리거 유예 안(아직 안 놓침)인 반복 예약은 건드리지 않는다" do
      in_grace = create(:meeting, project: project, creator: user, status: "pending",
                        recurrence_rule: rule, scheduled_start_time: 10.seconds.ago)
      expect {
        described_class.new.perform
      }.not_to change { Meeting.where(previous_meeting_id: in_grace.id).count }
    end
  end
end
