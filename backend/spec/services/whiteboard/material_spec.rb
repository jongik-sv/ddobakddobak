require "rails_helper"

RSpec.describe Whiteboard::Material do
  let(:meeting) { create(:meeting, title: "주간", started_at: Time.utc(2026, 7, 14, 20, 0)) }

  it "요약이 없으면 nil" do
    expect(described_class.build(meeting)).to be_nil
  end

  it "notes_markdown 우선, 일시는 KST 기준(UTC 20:00 -> 다음날 05:00)" do
    create(:summary, meeting: meeting, notes_markdown: "# 노트")
    m = described_class.build(meeting)
    expect(m.markdown).to eq("# 노트")
    expect(m.date).to eq("2026-07-15")
    expect(m.datetime).to eq("2026-07-15 05:00")
    expect(m.title).to eq("주간")
  end

  it "json_fields 는 헤더+목록으로 합성하고 빈 섹션은 뺀다" do
    create(:summary, meeting: meeting, notes_markdown: nil, key_points: %w[가 나].to_json,
                     decisions: [].to_json, discussion_details: "상세".to_json)
    expect(described_class.build(meeting).markdown).to eq("## 핵심 요약\n- 가\n- 나\n\n## 상세 논의\n- 상세")
  end

  it "json_fields 의 문자열이 아닌 원소는 빈 항목으로 버린다(TS 와 동일)" do
    create(:summary, meeting: meeting, notes_markdown: nil, key_points: [ "가", 5, nil, { "a" => 1 }, [ "x" ], "나" ].to_json,
                     decisions: [].to_json, discussion_details: [].to_json)
    expect(described_class.build(meeting).markdown).to eq("## 핵심 요약\n- 가\n- 나")
  end

  it "유니코드 공백뿐인 노트는 비어 있는 것으로 보고 nil" do
    create(:summary, meeting: meeting, notes_markdown: "\u00A0\u3000 \n", key_points: [].to_json, decisions: [].to_json, discussion_details: "")
    expect(described_class.build(meeting)).to be_nil
  end

  it "셋 다 비면 nil" do
    create(:summary, meeting: meeting, notes_markdown: nil, key_points: [].to_json, decisions: [].to_json, discussion_details: "")
    expect(described_class.build(meeting)).to be_nil
  end

  it "started_at 없으면 date 미정 유지" do
    meeting.update_columns(started_at: nil)
    create(:summary, meeting: meeting, notes_markdown: "x")
    m = described_class.build(meeting.reload)
    expect(m.date).to eq("미정")
    expect(m.datetime).to eq("미정")
  end

  it "digest = sha256('wb-v1\\n'+title+'\\n'+datetime+'\\n'+markdown)" do
    m = described_class.new(title: "t", date: "d", datetime: "dt", markdown: "md")
    expect(m.digest).to eq(Digest::SHA256.hexdigest("wb-v1\nt\ndt\nmd"))
  end
end
