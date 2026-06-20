require "rails_helper"

RSpec.describe SidecarClient, "#embed", type: :service do
  let(:client) { described_class.new }
  let(:mock_http) { instance_double(Net::HTTP) }

  before do
    allow(Net::HTTP).to receive(:new).and_return(mock_http)
    allow(mock_http).to receive(:open_timeout=)
    allow(mock_http).to receive(:read_timeout=)
    allow(mock_http).to receive(:keep_alive_timeout=)
    allow(mock_http).to receive(:start).and_yield(mock_http)
  end

  it "POSTs texts and returns embeddings array" do
    resp = instance_double(Net::HTTPResponse, code: "200",
      body: { embeddings: [[0.1, 0.2]], model: "kure-v1", dim: 2 }.to_json)
    expect(mock_http).to receive(:request).with(instance_of(Net::HTTP::Post)).and_return(resp)

    result = client.embed(["회의 예산"])
    expect(result).to eq([[0.1, 0.2]])
  end

  it "raises SidecarError on 500" do
    resp = instance_double(Net::HTTPResponse, code: "500", body: { error: "boom" }.to_json)
    allow(mock_http).to receive(:request).and_return(resp)
    expect { client.embed(["x"]) }.to raise_error(SidecarClient::SidecarError, /500/)
  end
end
