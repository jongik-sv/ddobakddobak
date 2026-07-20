require "rails_helper"

RSpec.describe Transfer::Archive do
  describe "error classes" do
    it "UnsafeEntryError inherits StandardError" do
      expect(Transfer::Archive::UnsafeEntryError.ancestors).to include(StandardError)
    end

    it "InvalidArchiveError inherits StandardError" do
      expect(Transfer::Archive::InvalidArchiveError.ancestors).to include(StandardError)
    end
  end

  describe ".guard_entry_name!" do
    it "raises UnsafeEntryError for '../x' (parent traversal)" do
      expect { described_class.guard_entry_name!("../x") }
        .to raise_error(Transfer::Archive::UnsafeEntryError)
    end

    it "raises UnsafeEntryError for '/abs' (absolute path)" do
      expect { described_class.guard_entry_name!("/abs") }
        .to raise_error(Transfer::Archive::UnsafeEntryError)
    end

    it "raises UnsafeEntryError for 'a/../b' (embedded parent traversal)" do
      expect { described_class.guard_entry_name!("a/../b") }
        .to raise_error(Transfer::Archive::UnsafeEntryError)
    end

    it "raises UnsafeEntryError for 'C:\\\\x' (Windows drive absolute path)" do
      expect { described_class.guard_entry_name!('C:\x') }
        .to raise_error(Transfer::Archive::UnsafeEntryError)
    end

    it "does not raise for a safe relative path like 'audio/1.mp3'" do
      expect { described_class.guard_entry_name!("audio/1.mp3") }.not_to raise_error
    end

    it "raises UnsafeEntryError for a name containing a null byte" do
      expect { described_class.guard_entry_name!("audio/evil\x00.mp3") }
        .to raise_error(Transfer::Archive::UnsafeEntryError)
    end

    it "raises UnsafeEntryError for a name that is only a null byte" do
      expect { described_class.guard_entry_name!("\x00") }
        .to raise_error(Transfer::Archive::UnsafeEntryError)
    end
  end

  describe ".gzip_magic?" do
    it "returns true for a gzip stream (magic bytes 0x1f 0x8b)" do
      io = StringIO.new("\x1f\x8b\x00\x00extra data")
      expect(described_class.gzip_magic?(io)).to be true
    end

    it "returns false for a non-gzip stream (e.g. ZIP 'PK')" do
      io = StringIO.new("PK\x03\x04")
      expect(described_class.gzip_magic?(io)).to be false
    end

    it "rewinds io to position 0 after the check" do
      io = StringIO.new("\x1f\x8bextra data")
      described_class.gzip_magic?(io)
      expect(io.pos).to eq(0)
    end

    it "rewinds even when check returns false" do
      io = StringIO.new("PKextra data")
      described_class.gzip_magic?(io)
      expect(io.pos).to eq(0)
    end
  end

  describe ".account_bytes!" do
    it "does not raise when accumulated bytes are under the limit" do
      counter = [0]
      expect { described_class.account_bytes!(1024, counter) }.not_to raise_error
      expect(counter[0]).to eq(1024)
    end

    it "raises InvalidArchiveError when accumulated bytes strictly exceed MAX_DECOMPRESSED_BYTES" do
      # Start the counter exactly at the limit, then add 1 byte to exceed it
      counter = [Transfer::Archive::MAX_DECOMPRESSED_BYTES]
      expect { described_class.account_bytes!(1, counter) }
        .to raise_error(Transfer::Archive::InvalidArchiveError)
    end

    it "does not raise when accumulated bytes exactly equal MAX_DECOMPRESSED_BYTES" do
      counter = [Transfer::Archive::MAX_DECOMPRESSED_BYTES - 1]
      expect { described_class.account_bytes!(1, counter) }.not_to raise_error
    end

    it "accumulates across calls via the shared counter_ref" do
      counter = [0]
      described_class.account_bytes!(100, counter)
      described_class.account_bytes!(200, counter)
      expect(counter[0]).to eq(300)
    end
  end

  describe "MAX_DECOMPRESSED_BYTES" do
    it "equals 3 * 1024**3 (3 GB)" do
      expect(Transfer::Archive::MAX_DECOMPRESSED_BYTES).to eq(3 * 1024**3)
    end
  end

  describe ".sanitize" do
    it "keeps only known model columns and excludes id/created_at/updated_at" do
      attrs = { "id" => 1, "title" => "x", "bogus" => 9 }
      result = described_class.sanitize(Meeting, attrs)
      expect(result).to eq({ "title" => "x" })
    end

    it "excludes created_at and updated_at" do
      attrs = { "id" => 1, "title" => "x", "created_at" => "2024-01-01", "updated_at" => "2024-01-01" }
      result = described_class.sanitize(Meeting, attrs)
      expect(result.keys).not_to include("id", "created_at", "updated_at")
      expect(result["title"]).to eq("x")
    end

    it "allows other valid model columns through" do
      attrs = { "id" => 1, "title" => "meeting", "status" => "done" }
      result = described_class.sanitize(Meeting, attrs)
      expect(result["title"]).to eq("meeting")
      expect(result["status"]).to eq("done")
      expect(result.key?("id")).to be false
    end
  end

  # T7: MeetingRestorer 와 ProjectImporter 가 공유하는 public_uid 충돌 가드.
  # 서비스별 통합 동작(경고 수집·전체 import 성공 등)은 각자의 spec 에서 검증하고,
  # 여기서는 순수 가드 함수 자체의 계약(반환값·attrs mutate)만 단위 검증한다.
  describe ".guard_public_uid_conflict!" do
    let!(:existing) { create(:meeting, public_uid: "0199abc0-0000-7000-8000-000000000001") }

    it "public_uid 가 blank 면 false 를 반환하고 attrs 를 건드리지 않는다" do
      attrs = { "public_uid" => nil, "dflow_synced_at" => nil, "dflow_url" => nil }
      expect(described_class.guard_public_uid_conflict!(attrs)).to be false
      expect(attrs).to eq({ "public_uid" => nil, "dflow_synced_at" => nil, "dflow_url" => nil })
    end

    it "로컬에 동일 uid 가 없으면 false 를 반환하고 3필드를 보존한다" do
      attrs = {
        "public_uid" => "0199abc0-0000-7000-8000-000000000002",
        "dflow_synced_at" => "2026-01-01T00:00:00Z",
        "dflow_url" => "https://dflow.example.com/x"
      }
      expect(described_class.guard_public_uid_conflict!(attrs)).to be false
      expect(attrs["public_uid"]).to eq("0199abc0-0000-7000-8000-000000000002")
    end

    it "로컬에 동일 uid 가 있으면 true 를 반환하고 3필드를 nil 로 mutate 한다" do
      attrs = {
        "public_uid" => existing.public_uid,
        "dflow_synced_at" => "2026-01-01T00:00:00Z",
        "dflow_url" => "https://dflow.example.com/x"
      }
      expect(described_class.guard_public_uid_conflict!(attrs)).to be true
      expect(attrs["public_uid"]).to be_nil
      expect(attrs["dflow_synced_at"]).to be_nil
      expect(attrs["dflow_url"]).to be_nil
    end
  end
end
