require "rails_helper"

RSpec.describe Whiteboard::Failure do
  def kind(e) = described_class.classify(e).kind

  it "분류" do
    expect(kind(Whiteboard::ValidationError.new("x"))).to eq("format")
    expect(kind(LlmService::CliTimeoutError.new("t"))).to eq("timeout")
    expect(kind(Errno::ENOENT.new("claude"))).to eq("not_found")
    expect(kind(LlmService::CliError.new("fail", stderr: "Please run /login"))).to eq("auth")
    expect(kind(LlmService::CliError.new("fail", stderr: "429 usage limit reached"))).to eq("rate_limit")
    expect(kind(LlmService::CliError.new("fail", stderr: "boom"))).to eq("unknown")
  end

  it "unknown 일반 예외는 내부 정보를 노출하지 않는다" do
    r = described_class.classify(RuntimeError.new("/secret/path"))
    expect(r.message).not_to include("/secret")
  end

  it "classify_output: 짧은 안내만, 긴 본문은 nil" do
    expect(described_class.classify_output("Not logged in").kind).to eq("auth")
    expect(described_class.classify_output("x" * 1001 + " login")).to be_nil
    expect(described_class.classify_output("그냥 글")).to be_nil
  end

  it "CliError 의 stdout_tail 로도 auth/rate_limit 판정" do
    e = LlmService::CliError.new("fail", stderr: "", stdout_tail: "Not logged in. Please run /login")
    expect(described_class.classify(e).kind).to eq("auth")
    e = LlmService::CliError.new("fail", stderr: "", stdout_tail: "Usage limit reached")
    expect(described_class.classify(e).kind).to eq("rate_limit")
  end
end
