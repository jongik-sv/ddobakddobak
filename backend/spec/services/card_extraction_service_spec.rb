require "rails_helper"

RSpec.describe CardExtractionService do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }
  let(:attachment) do
    meeting.meeting_attachments.create!(
      kind: "file", category: "business_card", display_name: "card.jpg",
      original_filename: "card.jpg", content_type: "image/jpeg",
      file_size: 3, file_path: "/tmp/does-not-matter.jpg",
      uploaded_by_id: user.id, position: 1
    )
  end

  subject(:service) { described_class.new(attachment) }

  it "parses a JSON object into one contact with all fields + extra + raw_text" do
    allow(service).to receive(:call_vision).and_return(<<~JSON)
      {"name":"홍길동","company":"또박","department":"개발","title":"팀장",
       "mobile":"010-1","phone":"02-2","fax":"02-3","email":"h@x.io",
       "website":"https://x.io","address":"서울","kakao":"hong",
       "raw_text":"홍길동 또박 개발팀장"}
    JSON

    result = service.call
    expect(result.size).to eq(1)
    c = result.first
    expect(c[:name]).to eq("홍길동")
    expect(c[:title]).to eq("팀장")
    expect(c[:extra]).to eq("kakao" => "hong")
    expect(c[:raw_text]).to include("홍길동")
  end

  it "parses a JSON array (multiple cards in one image)" do
    allow(service).to receive(:call_vision).and_return('[{"name":"A"},{"name":"B"}]')
    expect(service.call.map { |c| c[:name] }).to eq(%w[A B])
  end

  it "retries once on bad JSON then falls back to raw_text-only" do
    call_count = 0
    allow(service).to receive(:call_vision) { call_count += 1; "not json at all" }
    result = service.call
    expect(call_count).to eq(2)
    expect(result.size).to eq(1)
    expect(result.first[:raw_text]).to eq("not json at all")
    expect(result.first[:name]).to be_nil
  end

  it "raises VisionUnavailable when the Claude CLI is unavailable" do
    original = ENV["CLAUDE_CLI_PATH"]
    ENV["CLAUDE_CLI_PATH"] = "claude-does-not-exist-xyz"
    expect { service.send(:call_vision, "/tmp/card.jpg") }
      .to raise_error(CardExtractionService::VisionUnavailable)
  ensure
    ENV["CLAUDE_CLI_PATH"] = original
  end

  it "strips ```json fences before parsing" do
    allow(service).to receive(:call_vision).and_return("```json\n{\"name\":\"A\"}\n```")
    expect(service.call.first[:name]).to eq("A")
  end
end
