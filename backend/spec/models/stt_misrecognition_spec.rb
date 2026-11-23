require "rails_helper"

RSpec.describe SttMisrecognition do
  let(:project) { create(:project) }
  let(:m1) { create(:meeting, project: project) }
  let(:m2) { create(:meeting, project: project) }

  def rec(status, meeting: m1, wrong: "우판", correct: "후판")
    described_class.record!(project_id: project.id, wrong: wrong, correct: correct, status: status, meeting: meeting)
  end

  describe ".record!" do
    it "없으면 생성: key 정규화, hit 1, first/last meeting, last_seen_at" do
      r = freeze_time { rec("confirmed", wrong: " MES ", correct: "엠이에스") }
      expect(r).to be_persisted
      expect(r).to have_attributes(wrong: "MES", correct: "엠이에스", wrong_key: "mes", correct_key: "엠이에스",
                                   status: "confirmed", hit_count: 1, first_meeting_id: m1.id, last_meeting_id: m1.id)
      expect(r.last_seen_at).to be_present
    end

    it "같은 key 쌍은 upsert: hit_count 증가, last 갱신, first 유지" do
      first = rec("undecided")
      travel 1.minute
      again = rec("undecided", meeting: m2, wrong: "우판 ", correct: "후판")
      expect(again.id).to eq(first.id)
      expect(again.hit_count).to eq(2)
      expect(again.first_meeting_id).to eq(m1.id)
      expect(again.last_meeting_id).to eq(m2.id)
      expect(again.last_seen_at).to be > first.last_seen_at
      expect(described_class.count).to eq(1)
    end

    it "record! 는 hit_count 증가, excluded 유지, confirmed 를 undecided 로 강등하지 않음" do
      r = rec("confirmed")
      expect(rec("undecided").reload).to have_attributes(status: "confirmed", hit_count: 2)

      r.update!(status: "excluded")
      expect(rec("confirmed").reload).to have_attributes(status: "excluded", hit_count: 3)
      expect(rec("undecided").reload).to have_attributes(status: "excluded", hit_count: 4)
    end

    it "undecided 는 confirmed 로 승격" do
      rec("undecided")
      expect(rec("confirmed").status).to eq("confirmed")
    end

    it "status nil 은 hit 만 증가(새로 만들면 undecided)" do
      created = rec(nil)
      expect(created).to have_attributes(status: "undecided", hit_count: 1)
      created.update!(status: "excluded")
      expect(rec(nil)).to have_attributes(status: "excluded", hit_count: 2)
    end

    it "meeting nil 이어도 동작하고 기존 회의 id 는 유지" do
      rec("confirmed")
      r = rec("confirmed", meeting: nil)
      expect(r).to have_attributes(hit_count: 2, first_meeting_id: m1.id, last_meeting_id: m1.id)
    end

    it "프로젝트 별로 분리" do
      rec("confirmed")
      other = described_class.record!(project_id: create(:project).id, wrong: "우판", correct: "후판", status: "undecided", meeting: nil)
      expect(other.hit_count).to eq(1)
      expect(described_class.count).to eq(2)
    end

    it "project_id 가 nil 이면 기록하지 않고 nil" do
      expect(described_class.record!(project_id: nil, wrong: "우판", correct: "후판", status: "confirmed", meeting: nil)).to be_nil
      expect(described_class.count).to eq(0)
    end
  end

  describe ".status_for_verdict" do
    it "verdict 별 기록 대상 판정" do
      %w[registered merged_existing already_known].each { |v| expect(described_class.status_for_verdict(v)).to eq("confirmed") }
      %w[skipped_conflict skipped_low_confidence].each { |v| expect(described_class.status_for_verdict(v)).to eq("undecided") }
      expect(described_class.status_for_verdict("skipped_excluded")).to eq(:hit_only)
      %w[skipped_invalid skipped_not_in_transcript skipped_no_level].each { |v| expect(described_class.status_for_verdict(v)).to be_nil }
    end
  end

  describe ".record_verdict!" do
    it "APPLIED → confirmed, conflict/low_confidence → undecided" do
      r = described_class.record_verdict!(meeting: m1, wrong: "우판", correct: "후판", verdict: "registered")
      expect(r.status).to eq("confirmed")
      u = described_class.record_verdict!(meeting: m1, wrong: "엠이", correct: "MES", verdict: "skipped_low_confidence")
      expect(u.status).to eq("undecided")
    end

    it "skipped_excluded 는 hit 만 증가(excluded 유지)" do
      ex = create(:stt_misrecognition, project: project, wrong: "우판", correct: "후판", status: "excluded", hit_count: 3)
      r = described_class.record_verdict!(meeting: m1, wrong: "우판", correct: "후판", verdict: "skipped_excluded")
      expect(r.id).to eq(ex.id)
      expect(r.reload).to have_attributes(status: "excluded", hit_count: 4)
    end

    it "invalid·not_in_transcript·no_level 은 기록하지 않음" do
      %w[skipped_invalid skipped_not_in_transcript skipped_no_level].each do |v|
        expect(described_class.record_verdict!(meeting: m1, wrong: "우판", correct: "후판", verdict: v)).to be_nil
      end
      expect(described_class.count).to eq(0)
    end

    it "회의에 project 가 없으면 기록하지 않음" do
      m = build(:meeting, project: nil) # DB 는 project_id NOT NULL — 방어 경로만 확인
      expect(described_class.record_verdict!(meeting: m, wrong: "우판", correct: "후판", verdict: "registered")).to be_nil
      expect(described_class.count).to eq(0)
    end
  end

  it "factory 는 여러 번 만들어도 key 쌍이 충돌하지 않는다" do
    expect { 3.times { create(:stt_misrecognition, project: project) } }.to change(described_class, :count).by(3)
  end
end
