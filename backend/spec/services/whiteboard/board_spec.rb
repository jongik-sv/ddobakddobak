require "rails_helper"

RSpec.describe Whiteboard::Board do
  def board(zones = nil)
    { "title" => "t", "date" => "2026-01-01", "headline" => "h",
      "zones" => zones || [ { "title" => "z", "kind" => "topic", "items" => [ { "text" => "a" } ] } ] }
  end

  it "펜스·앞뒤 설명을 제거하고 파싱, 누락 필드는 null" do
    out = "```json\n#{board.to_json}\n```"
    r = described_class.parse_response(out)
    expect(r["zones"][0]["items"][0]).to eq("text" => "a", "tag" => nil, "who" => nil, "due" => nil)
  end

  it "빈 who/due 는 null, trim, 길이 절단" do
    z = [ { "title" => " z ", "kind" => "todo", "items" => [ { "text" => "x" * 400, "tag" => "확정", "who" => " ", "due" => "d" * 100 } ] } ]
    it = described_class.validate(board(z))["zones"][0]["items"][0]
    expect(it["text"].length).to eq(300)
    expect(it["who"]).to be_nil
    expect(it["due"].length).to eq(60)
  end

  it "빈 items 구역은 제거, 전부 비면 실패" do
    z = [ { "title" => "e", "kind" => "topic", "items" => [] }, board["zones"][0] ]
    expect(described_class.validate(board(z))["zones"].size).to eq(1)
    expect { described_class.validate(board([ z[0] ])) }.to raise_error(Whiteboard::ValidationError)
  end

  it "zones 12개 초과 절단" do
    z = Array.new(15) { board["zones"][0] }
    expect(described_class.validate(board(z))["zones"].size).to eq(12)
  end

  [
    [ "JSON 없음", "그냥 글" ],
    [ "kind 위반", { "title" => "t", "date" => "d", "headline" => "h", "zones" => [ { "title" => "z", "kind" => "bad", "items" => [ { "text" => "a" } ] } ] }.to_json ],
    [ "tag 위반", { "title" => "t", "date" => "d", "headline" => "h", "zones" => [ { "title" => "z", "kind" => "topic", "items" => [ { "text" => "a", "tag" => "x" } ] } ] }.to_json ],
    [ "text 빈 문자열", { "title" => "t", "date" => "d", "headline" => "h", "zones" => [ { "title" => "z", "kind" => "topic", "items" => [ { "text" => " " } ] } ] }.to_json ],
    [ "zones 비어 있음", { "title" => "t", "date" => "d", "headline" => "h", "zones" => [] }.to_json ],
    [ "title 타입", { "title" => 1, "date" => "d", "headline" => "h", "zones" => [] }.to_json ]
  ].each do |name, text|
    it "실패: #{name}" do
      expect { described_class.parse_response(text) }.to raise_error(Whiteboard::ValidationError)
    end
  end

  it "유니코드 공백(NBSP·전각)만 있는 필수 문자열은 빈 문자열로 trim 되어 text 검증에서 실패" do
    z = [ { "title" => "z", "kind" => "topic", "items" => [ { "text" => "\u00A0\u3000" } ] } ]
    expect { described_class.validate(board(z)) }.to raise_error(Whiteboard::ValidationError, /빈 문자열/)
  end

  it "앞뒤 유니코드 공백은 제거된다" do
    z = [ { "title" => "\u3000z\u00A0", "kind" => "topic", "items" => [ { "text" => "\u00A0a\u3000", "who" => "\u3000" } ] } ]
    r = described_class.validate(board(z))["zones"][0]
    expect(r["title"]).to eq("z")
    expect(r["items"][0]).to include("text" => "a", "who" => nil)
  end
end
