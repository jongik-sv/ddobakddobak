require "rails_helper"

RSpec.describe AppSettings do
  let(:yaml) do
    <<~YAML
      diarization:
        enabled: true
        similarity_threshold: 0.5
        merge_threshold: 0.62
        max_embeddings_per_speaker: 12
    YAML
  end

  it "settings.yaml의 diarization 블록을 sidecar diarization_config로 변환한다" do
    allow(File).to receive(:exist?).and_return(true)
    allow(File).to receive(:read).and_return(yaml)
    config = described_class.diarization_config
    expect(config).to eq(
      "enable" => true,
      "ahc_threshold" => 0.3,
      "clustering_threshold" => 0.6,
      "similarity_threshold" => 0.5,
      "merge_threshold" => 0.62,
      "max_embeddings_per_speaker" => 12
    )
  end

  it "파일이 없으면 기본값(비활성)을 반환한다" do
    allow(File).to receive(:exist?).and_return(false)
    expect(described_class.diarization_config["enable"]).to eq(false)
  end

  it "clustering_threshold 기본값 0.6을 포함한다" do
    allow(File).to receive(:exist?).and_return(false)
    expect(described_class.diarization_config["clustering_threshold"]).to eq(0.6)
  end

  it "settings.yaml에 clustering_threshold가 있으면 그 값을 반환한다" do
    yaml_with_threshold = <<~YAML
      diarization:
        enabled: true
        clustering_threshold: 0.55
    YAML
    allow(File).to receive(:exist?).and_return(true)
    allow(File).to receive(:read).and_return(yaml_with_threshold)
    expect(described_class.diarization_config["clustering_threshold"]).to eq(0.55)
  end
end
