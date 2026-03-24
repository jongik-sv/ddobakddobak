require "rails_helper"

RSpec.describe SidecarClient, type: :service do
  let(:client) { described_class.new }
  let(:mock_http) { instance_double(Net::HTTP) }

  before do
    allow(Net::HTTP).to receive(:new).and_return(mock_http)
    allow(mock_http).to receive(:open_timeout=)
    allow(mock_http).to receive(:read_timeout=)
    allow(mock_http).to receive(:keep_alive_timeout=)
    allow(mock_http).to receive(:start).and_yield(mock_http)
  end

  def stub_response(body, code: "200")
    instance_double(Net::HTTPResponse, code: code, body: body.to_json)
  end

  describe "#health" do
    it "returns parsed JSON on success" do
      response = stub_response({ "status" => "ok" })
      allow(mock_http).to receive(:request).with(instance_of(Net::HTTP::Get)).and_return(response)

      result = client.health
      expect(result).to eq({ "status" => "ok" })
    end

    it "raises SidecarError on non-2xx response" do
      response = stub_response({ "error" => "Internal Server Error" }, code: "500")
      allow(mock_http).to receive(:request).with(instance_of(Net::HTTP::Get)).and_return(response)

      expect { client.health }.to raise_error(SidecarClient::SidecarError, /500/)
    end
  end

  describe "#transcribe" do
    let(:segments) do
      [
        {
          "type" => "final",
          "text" => "Hello world",
          "speaker" => "SPEAKER_01",
          "started_at_ms" => 0,
          "ended_at_ms" => 3000,
          "seq" => 1
        }
      ]
    end

    it "sends base64 audio and returns segments" do
      response = stub_response({ "segments" => segments })
      allow(mock_http).to receive(:request).with(instance_of(Net::HTTP::Post)).and_return(response)

      result = client.transcribe("base64encodedaudio")
      expect(result["segments"]).to be_an(Array)
      expect(result["segments"].first["text"]).to eq("Hello world")
    end

    it "raises SidecarError on non-2xx response" do
      response = stub_response({ "error" => "Bad Request" }, code: "400")
      allow(mock_http).to receive(:request).with(instance_of(Net::HTTP::Post)).and_return(response)

      expect { client.transcribe("bad_audio") }.to raise_error(SidecarClient::SidecarError, /400/)
    end
  end

  describe "#summarize" do
    it "posts transcript_id and returns summary" do
      response = stub_response({ "summary" => "Meeting summary text" })
      allow(mock_http).to receive(:request).with(instance_of(Net::HTTP::Post)).and_return(response)

      result = client.summarize(42)
      expect(result["summary"]).to eq("Meeting summary text")
    end
  end

  describe "#summarize_action_items" do
    it "posts transcript_id and returns action items" do
      response = stub_response({ "action_items" => [ "Follow up with team" ] })
      allow(mock_http).to receive(:request).with(instance_of(Net::HTTP::Post)).and_return(response)

      result = client.summarize_action_items(42)
      expect(result["action_items"]).to eq([ "Follow up with team" ])
    end
  end

  describe "error handling" do
    it "raises TimeoutError on Net::ReadTimeout" do
      allow(mock_http).to receive(:start).and_raise(Net::ReadTimeout)

      expect { client.health }.to raise_error(SidecarClient::TimeoutError, /timed out/)
    end

    it "raises TimeoutError on Net::OpenTimeout" do
      allow(mock_http).to receive(:start).and_raise(Net::OpenTimeout)

      expect { client.health }.to raise_error(SidecarClient::TimeoutError, /timed out/)
    end

    it "raises ConnectionError on ECONNREFUSED" do
      allow(mock_http).to receive(:start).and_raise(Errno::ECONNREFUSED)

      expect { client.health }.to raise_error(SidecarClient::ConnectionError, /Cannot connect/)
    end

    it "raises ConnectionError on SocketError" do
      allow(mock_http).to receive(:start).and_raise(SocketError.new("getaddrinfo: nodename"))

      expect { client.health }.to raise_error(SidecarClient::ConnectionError, /Cannot connect/)
    end
  end

  describe "configuration" do
    it "uses SIDECAR_HOST and SIDECAR_PORT environment variables" do
      allow(ENV).to receive(:fetch).with("SIDECAR_HOST", "localhost").and_return("sidecar-host")
      allow(ENV).to receive(:fetch).with("SIDECAR_PORT", "8000").and_return("9000")

      expect(Net::HTTP).to receive(:new).with("sidecar-host", 9000).and_return(mock_http)
      allow(mock_http).to receive(:request).and_return(stub_response({ "status" => "ok" }))

      described_class.new.health
    end
  end
end
