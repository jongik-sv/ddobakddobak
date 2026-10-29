require "rails_helper"

RSpec.describe ChatStreaming do
  # concern 을 포함한 더미 잡으로 단위 테스트.
  let(:dummy_class) do
    Class.new do
      include ChatStreaming
      attr_reader :topic
      def initialize(topic) = @topic = topic
      def broadcast_topic(_answer) = @topic
    end
  end

  let(:user) { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }
  let(:answer) { meeting.chat_messages.create!(user: user, role: "assistant", content: "", status: "pending") }

  it "델타를 누적해 throttle 간격마다 broadcast 하고 전체를 반환한다" do
    job = dummy_class.new("topic_x")
    config = { provider: "anthropic", auth_token: "k", model: "claude-sonnet-4-20250514" }

    fake = instance_double(LlmService)
    allow(LlmService).to receive(:new).and_return(fake)
    allow(fake).to receive(:answer_question) do |_sys, _user, &blk|
      ("a" * 200).each_char { |c| blk.call(c) } # 200자 → 글자 임계(80) 두 번 이상 flush
      "a" * 200
    end

    broadcasts = []
    allow(job).to receive(:broadcast_chat) { |a, model_name:| broadcasts << [a.status, model_name] }

    full = job.send(:stream_answer, answer, config, "sys", "q", "Claude Sonnet 4")
    expect(full).to eq("a" * 200)
    expect(broadcasts.size).to be >= 1
    expect(broadcasts.all? { |s, m| s == "streaming" && m == "Claude Sonnet 4" }).to be true
    expect(answer.reload.content).to eq("a" * 200) # 마지막 update_column 까지 반영
  end

  it "플러시 시점에 DB에도 status=streaming 과 부분 본문을 저장한다 (폴링이 pending 으로 덮지 않게)" do
    job = dummy_class.new("topic_x")
    config = { provider: "anthropic", auth_token: "k", model: "m" }
    fake = instance_double(LlmService)
    allow(LlmService).to receive(:new).and_return(fake)
    snapshots = []
    allow(job).to receive(:broadcast_chat) do |a, **|
      row = ChatMessage.unscoped.find(a.id)
      snapshots << [row.status, row.content.length]
    end
    allow(fake).to receive(:answer_question) do |_s, _u, &blk|
      ("a" * 100).each_char { |c| blk.call(c) }
      "a" * 100
    end

    job.send(:stream_answer, answer, config, "sys", "q", "M")
    expect(snapshots).not_to be_empty
    expect(snapshots.all? { |st, len| st == "streaming" && len.positive? }).to be true
    expect(snapshots.first[1]).to be < 100
    expect(answer.reload.status).to eq("streaming")
    expect(answer.content).to eq("a" * 100)
  end

  it "완료 처리(update!) 후 complete 로 전환된다" do
    answer.update_columns(content: "부분", status: "streaming")
    expect(answer.reload.update!(content: "전체", status: "complete")).to be true
    expect(answer.reload.status).to eq("complete")
  end
end
