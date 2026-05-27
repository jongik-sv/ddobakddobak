require "rails_helper"

RSpec.describe RecordingLock do
  before { described_class.reset! }

  let(:meeting_id) { 42 }

  describe ".acquire" do
    it "returns true when the lock is free" do
      expect(described_class.acquire(meeting_id, "token-a")).to be(true)
    end

    it "returns false when held by a different token" do
      described_class.acquire(meeting_id, "token-a")
      expect(described_class.acquire(meeting_id, "token-b")).to be(false)
    end

    it "returns true again for the same token (idempotent)" do
      described_class.acquire(meeting_id, "token-a")
      expect(described_class.acquire(meeting_id, "token-a")).to be(true)
    end

    it "isolates locks per meeting" do
      described_class.acquire(meeting_id, "token-a")
      expect(described_class.acquire(99, "token-b")).to be(true)
    end
  end

  describe ".release" do
    it "frees the lock so another token can acquire" do
      described_class.acquire(meeting_id, "token-a")
      described_class.release(meeting_id, "token-a")
      expect(described_class.acquire(meeting_id, "token-b")).to be(true)
    end

    it "does not free the lock when the token does not match" do
      described_class.acquire(meeting_id, "token-a")
      described_class.release(meeting_id, "token-b")
      expect(described_class.acquire(meeting_id, "token-b")).to be(false)
      expect(described_class.holder(meeting_id)).to eq("token-a")
    end
  end

  describe ".clear" do
    it "removes the lock regardless of token" do
      described_class.acquire(meeting_id, "token-a")
      described_class.clear(meeting_id)
      expect(described_class.holder(meeting_id)).to be_nil
    end
  end

  describe ".holder" do
    it "returns the current holder token, or nil when free" do
      expect(described_class.holder(meeting_id)).to be_nil
      described_class.acquire(meeting_id, "token-a")
      expect(described_class.holder(meeting_id)).to eq("token-a")
    end
  end
end
