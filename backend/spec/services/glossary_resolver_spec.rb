require "rails_helper"

RSpec.describe GlossaryResolver do
  let(:root) { create(:folder) }
  let(:sub)  { create(:folder, parent: root) }
  let(:meeting) { create(:meeting, folder_id: sub.id) }

  def entries_for(meeting)
    GlossaryResolver.for(meeting)
  end

  it "회의 > 폴더 > 조상 순으로 수집하고 구체적 레벨이 override" do
    root.glossary_entries.create!(from_text: "AA", to_text: "root")
    sub.glossary_entries.create!(from_text: "AA", to_text: "sub")     # override root
    meeting.glossary_entries.create!(from_text: "BB", to_text: "meet")

    result = entries_for(meeting)
    aa = result.find { |e| e[:from] == "AA" }
    expect(aa[:to]).to eq("sub")                                       # 더 구체적
    expect(result.map { |e| e[:from] }).to include("BB")
  end

  it "literal 은 from_text 길이 내림차순 정렬" do
    sub.glossary_entries.create!(from_text: "이사", to_text: "의사")
    sub.glossary_entries.create!(from_text: "이사회", to_text: "의사회")
    result = entries_for(meeting).select { |e| e[:match_type] == "literal" }
    expect(result.map { |e| e[:from] }).to eq(%w[이사회 이사])         # 긴 것 먼저
  end

  it "regex 엔트리는 literal 뒤에 온다" do
    sub.glossary_entries.create!(from_text: "x", to_text: "y")
    sub.glossary_entries.create!(from_text: "a.", to_text: "z", match_type: "regex")
    types = entries_for(meeting).map { |e| e[:match_type] }
    expect(types).to eq(%w[literal regex])
  end

  it "disabled 엔트리는 제외" do
    sub.glossary_entries.create!(from_text: "off", to_text: "x", enabled: false)
    expect(entries_for(meeting).map { |e| e[:from] }).not_to include("off")
  end

  it "폴더 없는 회의도 회의 엔트리만으로 동작" do
    m = create(:meeting, folder_id: nil)
    m.glossary_entries.create!(from_text: "z", to_text: "Z")
    expect(entries_for(m).map { |e| e[:from] }).to eq(["z"])
  end
end
