require "rails_helper"

RSpec.describe MeetingExportSerializer do
  it "date/start_time/end_time 을 KST 기준으로 낸다 (UTC 자정 전후 경계)" do
    meeting = create(:meeting, started_at: Time.utc(2026, 7, 14, 20, 0), ended_at: Time.utc(2026, 7, 14, 21, 30))
    m = described_class.new(meeting, include_summary: false, include_memo: false, include_transcript: false).call[:meeting]
    expect(m[:date]).to eq("2026-07-15")
    expect(m[:start_time]).to eq("05:00")
    expect(m[:end_time]).to eq("06:30")
  end

  it "KST 에서도 같은 날인 시각은 그대로 날짜 유지" do
    meeting = create(:meeting, started_at: Time.utc(2026, 7, 14, 14, 59))
    m = described_class.new(meeting, include_summary: false, include_memo: false, include_transcript: false).call[:meeting]
    expect(m[:date]).to eq("2026-07-14")
    expect(m[:start_time]).to eq("23:59")
  end

  it "started_at 없으면 미정" do
    meeting = create(:meeting, started_at: nil)
    m = described_class.new(meeting, include_summary: false, include_memo: false, include_transcript: false).call[:meeting]
    expect(m[:date]).to eq("미정")
  end
end
