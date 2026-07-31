require "rails_helper"
require "rubygems/package"
require "stringio"
require "tempfile"
require "delegate"

# Transfer::SpeakerDbTransfer — export/import 양쪽이 공유하는 예외 흡수 계약 단위 테스트.
#
# 계약(적대 검토 #1·#2·#6):
#   - 사이드카 계열 장애(연결 리셋·EOF·본문 파손·타임아웃·HTTP 에러)는 흡수한다.
#   - 진짜 코드 버그(NoMethodError·ArgumentError 등)는 흡수하지 않고 그대로 올린다.
#   - 흡수 집합은 export/import 가 **같은 상수**를 쓴다(두 경로가 갈라지지 않도록).
RSpec.describe Transfer::SpeakerDbTransfer do
  let(:sidecar) { instance_double(SidecarClient) }
  let(:payload) do
    { "next_num" => 2, "speakers" => { "SPEAKER_00" => [ "AACAPwAAAEA=" ] }, "names" => { "SPEAKER_00" => "앨리스" } }
  end

  before { allow(SidecarClient).to receive(:new).and_return(sidecar) }

  # 사이드카 다운/장애로 간주해 흡수해야 하는 예외들.
  # (SidecarClient#with_connection 이 SidecarError 로 변환하지 **못하는** 것들이 핵심)
  absorbed = {
    "SidecarError(HTTP 5xx)"      => -> { SidecarClient::SidecarError.new("500 boom") },
    "ConnectionError(연결 거부)"   => -> { SidecarClient::ConnectionError.new("refused") },
    "TimeoutError(응답 없음)"      => -> { SidecarClient::TimeoutError.new("timeout") },
    "Errno::ECONNRESET(응답 중 리셋)" => -> { Errno::ECONNRESET.new("reset by peer") },
    "Errno::EPIPE(쓰기 중 끊김)"   => -> { Errno::EPIPE.new("broken pipe") },
    "EOFError(응답 도중 EOF)"      => -> { EOFError.new("end of file reached") },
    "JSON::ParserError(200인데 본문 파손)" => -> { JSON::ParserError.new("unexpected token") },
    "Net::HTTPBadResponse(응답 파손)" => -> { Net::HTTPBadResponse.new("wrong status line") }
  }

  # 흡수하면 안 되는 진짜 버그.
  not_absorbed = {
    "NoMethodError" => -> { NoMethodError.new("undefined method 'foo'") },
    "ArgumentError" => -> { ArgumentError.new("wrong number of arguments") },
    "TypeError"     => -> { TypeError.new("no implicit conversion") }
  }

  describe ".export_bytes" do
    it "정상 payload 를 JSON 바이트열로 돌려준다" do
      allow(sidecar).to receive(:get_speaker_db).with(7).and_return(payload)

      expect(JSON.parse(described_class.export_bytes(7))).to eq(payload)
    end

    absorbed.each do |label, builder|
      it "#{label} 을 흡수하고 nil 을 돌려준다(export 를 실패시키지 않음)" do
        allow(sidecar).to receive(:get_speaker_db).and_raise(builder.call)

        expect(described_class.export_bytes(7)).to be_nil
      end
    end

    not_absorbed.each do |label, builder|
      it "#{label}(진짜 버그)는 흡수하지 않고 그대로 올린다" do
        allow(sidecar).to receive(:get_speaker_db).and_raise(builder.call)

        expect { described_class.export_bytes(7) }.to raise_error(builder.call.class)
      end
    end

    it "로스터가 비어 있으면(next_num 기본 + speakers/names 빈 값) nil — tar 엔트리를 만들지 않는다" do
      allow(sidecar).to receive(:get_speaker_db)
        .and_return({ "next_num" => 1, "speakers" => {}, "names" => {} })

      expect(described_class.export_bytes(7)).to be_nil
    end

    it "이름만 있어도(임베딩 없음) 비어있지 않다 — 로스터를 보존한다" do
      allow(sidecar).to receive(:get_speaker_db)
        .and_return({ "next_num" => 1, "speakers" => {}, "names" => { "SPEAKER_00" => "앨리스" } })

      expect(described_class.export_bytes(7)).not_to be_nil
    end
  end

  describe described_class::Exporter do
    it "사이드카가 응답 불가면 첫 실패 이후 회의는 아예 호출하지 않는다(circuit-break)" do
      allow(sidecar).to receive(:get_speaker_db).and_raise(SidecarClient::ConnectionError, "down")
      exporter = described_class.new

      expect(exporter.bytes_for(1)).to be_nil
      expect(exporter.bytes_for(2)).to be_nil
      expect(exporter.bytes_for(3)).to be_nil
      expect(sidecar).to have_received(:get_speaker_db).once
      expect(exporter).to be_degraded
    end

    it "회의 단위 실패(HTTP 5xx·본문 파손)는 단축하지 않고 다음 회의를 계속 시도한다" do
      allow(sidecar).to receive(:get_speaker_db).with(1).and_raise(SidecarClient::SidecarError, "500")
      allow(sidecar).to receive(:get_speaker_db).with(2).and_return(payload)
      exporter = described_class.new

      expect(exporter.bytes_for(1)).to be_nil
      expect(JSON.parse(exporter.bytes_for(2))).to eq(payload)
    end

    # R2: 응답 **도중** 끊기는 일시적 실패로 이후 회의를 전부 포기하면 안 된다.
    { "Errno::ECONNRESET" => -> { Errno::ECONNRESET.new("reset") },
      "Errno::EPIPE"      => -> { Errno::EPIPE.new("broken pipe") },
      "EOFError"          => -> { EOFError.new("eof") } }.each do |label, builder|
      it "#{label}(일시적 끊김)이면 다음 회의는 여전히 호출한다" do
        allow(sidecar).to receive(:get_speaker_db).with(1).and_raise(builder.call)
        allow(sidecar).to receive(:get_speaker_db).with(2).and_return(payload)
        exporter = described_class.new

        expect(exporter.bytes_for(1)).to be_nil
        expect(JSON.parse(exporter.bytes_for(2))).to eq(payload)
        expect(exporter).not_to be_degraded
        expect(sidecar).to have_received(:get_speaker_db).with(2)
      end
    end

    it "Errno::ECONNREFUSED(연결 자체 불가)면 다음 회의는 호출하지 않는다" do
      allow(sidecar).to receive(:get_speaker_db).with(1).and_raise(Errno::ECONNREFUSED)
      allow(sidecar).to receive(:get_speaker_db).with(2).and_return(payload)
      exporter = described_class.new

      expect(exporter.bytes_for(1)).to be_nil
      expect(exporter.bytes_for(2)).to be_nil
      expect(exporter).to be_degraded
      expect(sidecar).not_to have_received(:get_speaker_db).with(2)
    end

    # R6: import 에는 MAX_ROSTER_BYTES 가 있는데 export 에 없으면
    # 같은 코드베이스의 importer 가 자기가 만든 아카이브를 거부한다.
    it "상한을 넘는 로스터는 엔트리를 만들지 않고 열화로 기록한다" do
      stub_const("Transfer::SpeakerDbTransfer::MAX_ROSTER_BYTES", 8)
      allow(sidecar).to receive(:get_speaker_db).and_return(payload)
      exporter = described_class.new

      expect(exporter.bytes_for(1)).to be_nil
      expect(exporter).not_to be_degraded          # 사이드카는 멀쩡 → 단축하지 않는다
      expect(exporter).to be_any_roster_dropped    # 그러나 아카이브는 열화 상태
    end

    it "로스터가 비어 있을 뿐이면 열화가 아니다" do
      allow(sidecar).to receive(:get_speaker_db)
        .and_return({ "next_num" => 1, "speakers" => {}, "names" => {} })
      exporter = described_class.new

      expect(exporter.bytes_for(1)).to be_nil
      expect(exporter).not_to be_any_roster_dropped
    end

    it "사이드카 실패로 로스터를 놓치면 열화로 기록한다" do
      allow(sidecar).to receive(:get_speaker_db).and_raise(SidecarClient::SidecarError, "500")
      exporter = described_class.new

      expect(exporter.bytes_for(1)).to be_nil
      expect(exporter).to be_any_roster_dropped
    end
  end

  # R4: import 쪽에도 export 와 대칭인 circuit-break 가 필요하다.
  # (사이드카가 "붙어는 있는데 응답 없음"이면 회의당 TIMEOUT 30초 × 100건 = 50분)
  describe described_class::Importer do
    it "Errno::ECONNREFUSED 이후 회의는 PUT 을 시도하지 않는다(circuit-break)" do
      allow(sidecar).to receive(:put_speaker_db).and_raise(Errno::ECONNREFUSED)
      importer = described_class.new

      expect(importer.import_bytes(1, JSON.generate(payload))).to be(false)
      expect(importer.import_bytes(2, JSON.generate(payload))).to be(false)
      expect(importer.import_bytes(3, JSON.generate(payload))).to be(false)
      expect(sidecar).to have_received(:put_speaker_db).once
      expect(importer).to be_degraded
    end

    it "SidecarClient::TimeoutError 이후 회의도 단축한다" do
      allow(sidecar).to receive(:put_speaker_db).and_raise(SidecarClient::TimeoutError, "no response")
      importer = described_class.new

      importer.import_bytes(1, JSON.generate(payload))
      importer.import_bytes(2, JSON.generate(payload))
      expect(sidecar).to have_received(:put_speaker_db).once
    end

    it "Errno::ECONNRESET(일시적 끊김)이면 다음 회의는 여전히 PUT 한다" do
      call = 0
      allow(sidecar).to receive(:put_speaker_db) do
        call += 1
        raise Errno::ECONNRESET, "reset" if call == 1
        { "ok" => true }
      end
      importer = described_class.new

      expect(importer.import_bytes(1, JSON.generate(payload))).to be(false)
      expect(importer.import_bytes(2, JSON.generate(payload))).to be(true)
      expect(sidecar).to have_received(:put_speaker_db).twice
      expect(importer).not_to be_degraded
    end

    it "스테이징 파일이 없어(Errno::ENOENT) 실패해도 circuit 을 열지 않는다" do
      allow(sidecar).to receive(:put_speaker_db).and_return({ "ok" => true })
      importer = described_class.new

      expect(importer.import_file(1, "/nonexistent/roster.json")).to be(false)
      expect(importer).not_to be_degraded

      Tempfile.create([ "roster", ".json" ]) do |f|
        f.binmode
        f.write(JSON.generate(payload))
        f.flush
        expect(importer.import_file(2, f.path)).to be(true)
      end
    end

    it "SidecarClient 인스턴스를 회의마다 새로 만들지 않고 재사용한다" do
      allow(sidecar).to receive(:put_speaker_db).and_return({ "ok" => true })
      importer = described_class.new

      importer.import_bytes(1, JSON.generate(payload))
      importer.import_bytes(2, JSON.generate(payload))

      expect(SidecarClient).to have_received(:new).once
    end
  end

  describe ".import_bytes" do
    it "성공하면 true 를 돌려주고 새 meeting_id 로 PUT 한다" do
      allow(sidecar).to receive(:put_speaker_db).and_return({ "ok" => true })

      expect(described_class.import_bytes(99, JSON.generate(payload))).to be(true)
      expect(sidecar).to have_received(:put_speaker_db).with(99, payload)
    end

    absorbed.each do |label, builder|
      it "#{label} 을 흡수하고 false 를 돌려준다" do
        allow(sidecar).to receive(:put_speaker_db).and_raise(builder.call)

        expect(described_class.import_bytes(99, JSON.generate(payload))).to be(false)
      end
    end

    not_absorbed.each do |label, builder|
      it "#{label}(진짜 버그)는 흡수하지 않고 그대로 올린다" do
        allow(sidecar).to receive(:put_speaker_db).and_raise(builder.call)

        expect { described_class.import_bytes(99, JSON.generate(payload)) }
          .to raise_error(builder.call.class)
      end
    end

    it "아카이브 본문이 JSON 이 아니면 false (import 전체를 실패시키지 않음)" do
      allow(sidecar).to receive(:put_speaker_db)

      expect(described_class.import_bytes(99, "\x00\xFFnot json")).to be(false)
      expect(sidecar).not_to have_received(:put_speaker_db)
    end
  end

  describe ".import_file" do
    it "스테이징 파일을 읽어 PUT 한다" do
      allow(sidecar).to receive(:put_speaker_db).and_return({ "ok" => true })
      Tempfile.create([ "roster", ".json" ]) do |f|
        f.binmode
        f.write(JSON.generate(payload))
        f.flush

        expect(described_class.import_file(99, f.path)).to be(true)
      end
      expect(sidecar).to have_received(:put_speaker_db).with(99, payload)
    end

    # 커밋 후 경로에서 raise 하면 호출자(ProjectImporter#run!)의 rescue 가
    # 이미 커밋된 import 의 복사 파일을 지운다 → 파일 I/O 실패도 여기서 흡수해야 한다.
    it "스테이징 파일이 사라져도 raise 하지 않고 false 를 돌려준다" do
      allow(sidecar).to receive(:put_speaker_db)

      expect { described_class.import_file(99, "/nonexistent/roster.json") }.not_to raise_error
      expect(described_class.import_file(99, "/nonexistent/roster.json")).to be(false)
    end

    it "상한을 넘는 로스터 파일은 PUT 하지 않고 false 를 돌려준다" do
      allow(sidecar).to receive(:put_speaker_db)
      stub_const("#{described_class}::MAX_ROSTER_BYTES", 16)

      Tempfile.create([ "roster", ".json" ]) do |f|
        f.binmode
        f.write(JSON.generate(payload)) # 16 bytes 초과
        f.flush

        expect(described_class.import_file(99, f.path)).to be(false)
      end
      expect(sidecar).not_to have_received(:put_speaker_db)
    end
  end

  describe ".read_entry_capped" do
    # tar 엔트리 1개를 담은 TarReader::Entry 를 만들어 넘긴다.
    def with_entry(name, bytes)
      io = StringIO.new
      Gem::Package::TarWriter.new(io) do |tar|
        tar.add_file_simple(name, 0o644, bytes.bytesize) { |e| e.write(bytes) }
      end
      io.rewind
      Gem::Package::TarReader.new(io) do |tar|
        tar.each { |entry| return yield(entry) }
      end
    end

    it "엔트리 바이트를 그대로 돌려주고 청크마다 accountant 를 호출한다" do
      body    = "x" * (200 * 1024) # 64KB 청크 3+개
      chunks  = []
      result  = with_entry("speakers/1.json", body) do |entry|
        described_class.read_entry_capped(entry) { |n| chunks << n }
      end

      expect(result.bytesize).to eq(body.bytesize)
      expect(chunks.size).to be > 1          # 통째로 읽지 않고 청크로 읽었다
      expect(chunks.sum).to eq(body.bytesize)
    end

    # ⚠️ 이 예제는 2라운드의 "한 바이트도 읽지 않고 nil" 을 **강화**한 것이다(약화 아님).
    # 읽지 않고 return 하면 Gem::Package::TarReader#each 가 Entry#close 를 부르고,
    # close → seek(0, SEEK_END) 는 Zlib::GzipReader 가 :seek 에 응답하지 않으므로
    # `while pending > 0 { @io.read(...) }` 드레인 루프로 떨어진다. 그 경로는
    # 호출자의 계량 블록(Transfer::Archive.account_bytes!)을 **타지 않는다** →
    # 204KB 압축 → 200MB 해제가 2바이트로 계량되는 zip-bomb 계량 우회.
    # 그래서 "버퍼링은 하지 않되 계량하며 끝까지 드레인" 이 올바른 계약이다.
    it "선언 크기(header.size)가 상한을 넘으면 버퍼링 없이 nil 이지만 계량하며 끝까지 드레인한다" do
      stub_const("#{described_class}::MAX_ROSTER_BYTES", 1024)
      body   = "y" * (200 * 1024)
      chunks = []
      result = with_entry("speakers/1.json", body) do |entry|
        described_class.read_entry_capped(entry) { |n| chunks << n }
      end

      expect(result).to be_nil                    # 메모리에 버퍼링하지 않는다
      expect(chunks.sum).to eq(body.bytesize)     # 그러나 실제 압축해제 바이트는 전부 계량된다
      expect(chunks.size).to be > 1               # 청크 단위(통짜 read 아님)
    end

    it "선언 크기 초과 엔트리의 드레인 도중 계량 블록이 raise 하면 그대로 올린다(zip-bomb 가드 발화)" do
      stub_const("#{described_class}::MAX_ROSTER_BYTES", 1024)
      counter = [ 0 ]

      expect {
        with_entry("speakers/1.json", "y" * (200 * 1024)) do |entry|
          described_class.read_entry_capped(entry) do |n|
            counter[0] += n
            raise Transfer::Archive::InvalidArchiveError, "boom" if counter[0] > 64 * 1024
          end
        end
      }.to raise_error(Transfer::Archive::InvalidArchiveError)
    end

    it "header 가 없는 엔트리에서 읽는 도중 상한을 넘어도 계량하며 드레인한다" do
      stub_const("#{described_class}::MAX_ROSTER_BYTES", 1024)
      body   = "z" * (200 * 1024)
      chunks = []

      result = with_entry("speakers/1.json", body) do |entry|
        # header 를 못 읽는(선언 크기 미상) 엔트리를 흉내 → 선검사 우회, 읽기 중 초과 경로
        headerless = SimpleDelegator.new(entry)
        def headerless.respond_to?(name, *) = name.to_sym == :header ? false : super
        described_class.read_entry_capped(headerless) { |n| chunks << n }
      end

      expect(result).to be_nil
      expect(chunks.sum).to eq(body.bytesize)
    end
  end

  describe ".drain_entry" do
    def with_entry(name, bytes)
      io = StringIO.new
      Gem::Package::TarWriter.new(io) do |tar|
        tar.add_file_simple(name, 0o644, bytes.bytesize) { |e| e.write(bytes) }
      end
      io.rewind
      Gem::Package::TarReader.new(io) do |tar|
        tar.each { |entry| return yield(entry) }
      end
    end

    it "데이터는 버리고 드레인한 바이트 수를 돌려주며 청크마다 계량한다" do
      body   = "q" * (200 * 1024)
      chunks = []
      drained = with_entry("speakers/1.json", body) do |entry|
        described_class.drain_entry(entry) { |n| chunks << n }
      end

      expect(drained).to eq(body.bytesize)
      expect(chunks.sum).to eq(body.bytesize)
      expect(chunks.size).to be > 1
    end
  end

  describe ".unreachable?" do
    # 트립 집합 = "다음 호출도 확정적으로 실패하는가?" 가 yes 인 것만.
    trips = {
      "SidecarClient::TimeoutError"  => -> { SidecarClient::TimeoutError.new("timeout") },
      "SidecarClient::ConnectionError" => -> { SidecarClient::ConnectionError.new("refused") },
      "SocketError(DNS 실패)"        => -> { SocketError.new("getaddrinfo") },
      "Errno::ECONNREFUSED"          => -> { Errno::ECONNREFUSED.new("refused") },
      "Errno::EHOSTUNREACH"          => -> { Errno::EHOSTUNREACH.new("no route") },
      "Errno::ENETUNREACH"           => -> { Errno::ENETUNREACH.new("net unreachable") },
      "Timeout::Error"               => -> { Timeout::Error.new("timeout") }
    }

    # 응답 **도중** 끊기는 일시적·요청 단위 실패. 다음 회의는 성공할 수 있다.
    no_trips = {
      "Errno::ECONNRESET"       => -> { Errno::ECONNRESET.new("reset by peer") },
      "Errno::EPIPE"            => -> { Errno::EPIPE.new("broken pipe") },
      "EOFError"                => -> { EOFError.new("end of file reached") },
      "Errno::ENOENT(파일 I/O)" => -> { Errno::ENOENT.new("no such file") },
      "JSON::ParserError"       => -> { JSON::ParserError.new("unexpected token") },
      "Net::HTTPBadResponse"    => -> { Net::HTTPBadResponse.new("wrong status line") },
      "SidecarError(HTTP 5xx)"  => -> { SidecarClient::SidecarError.new("500 boom") }
    }

    trips.each do |label, builder|
      it "#{label} 은 '도달 불가' 로 판정한다" do
        expect(described_class.unreachable?(builder.call)).to be(true)
      end
    end

    no_trips.each do |label, builder|
      it "#{label} 은 '도달 불가' 가 아니다(그 회의만 스킵)" do
        expect(described_class.unreachable?(builder.call)).to be(false)
      end
    end

    it "트립하지 않는 예외도 흡수 대상에는 남아 있다" do
      no_trips.each_value do |builder|
        error = builder.call
        expect(described_class::ABSORBED_ERRORS.any? { |k| error.is_a?(k) })
          .to be(true), "#{error.class} 가 ABSORBED_ERRORS 에서 빠졌다"
      end
    end
  end
end
