require "rails_helper"

RSpec.describe DomainFile, "학습 줄 조작 헬퍼" do
  let(:human_line) { "- **MES** [시스템명] (발음: 엠에스): 제조실행시스템" }
  let(:f) { create(:domain_file, content: "머리말\n#{human_line}") }

  it "find_term / term_line" do
    expect(f.find_term("mes")).to include(term: "MES", category: "시스템명", line_no: 1)
    expect(f.find_term("zzz")).to be_nil
    expect(f.term_line("mes")).to eq(human_line)
    expect(f.term_line("zzz")).to be_nil
  end

  it "apply_learning! merges 는 사람 줄의 용어·분류·설명을 보존하고 오인식만 추가" do
    lines = f.apply_learning!(merges: { "mes" => ["엠이에스"] })
    expect(f.reload.content).to eq("머리말\n- **MES** [시스템명] (오인식: 엠에스, 엠이에스): 제조실행시스템")
    expect(lines).to eq("mes" => "- **MES** [시스템명] (오인식: 엠에스, 엠이에스): 제조실행시스템")
  end

  it "이미 있는 변형이면 저장하지 않고 {} 반환" do
    f
    expect { expect(f.apply_learning!(merges: { "mes" => ["엠에스"] })).to eq({}) }
      .not_to change { f.reload.updated_at }
  end

  it "존재하지 않는 key 의 merge 는 무시" do
    expect(f.apply_learning!(merges: { "nope" => ["x"] })).to eq({})
  end

  it "new_terms 는 끝에 append, 분류 없으면 [분류] 생략" do
    lines = f.apply_learning!(new_terms: [{ term: "후판", category: "", definition: "두꺼운 강판", mispronunciations: ["우판"] }])
    expect(f.reload.content).to end_with("\n- **후판** (오인식: 우판): 두꺼운 강판")
    expect(lines).to eq("후판" => "- **후판** (오인식: 우판): 두꺼운 강판")
  end

  it "new_terms 의 같은 key 가 이미 있으면 merge 규칙" do
    lines = f.apply_learning!(new_terms: [{ term: "mes", category: "X", definition: "다름", mispronunciations: ["엠이에스"] }])
    expect(lines["mes"]).to eq("- **MES** [시스템명] (오인식: 엠에스, 엠이에스): 제조실행시스템")
    expect(f.reload.content.split("\n").size).to eq(2)
  end

  it "한 번만 저장한다" do
    f
    expect(f).to receive(:update!).once.and_call_original
    f.apply_learning!(merges: { "mes" => ["a"] }, new_terms: [{ term: "T", category: "", definition: "d", mispronunciations: [] }])
  end

  it "remove_term_line! 은 그 줄만 지우고 자유 텍스트는 보존, 원래 줄 반환" do
    expect(f.remove_term_line!("mes")).to eq(human_line)
    expect(f.reload.content).to eq("머리말")
    expect(f.remove_term_line!("mes")).to be_nil
  end

  it "remove_mispronunciation! 은 변형 하나만 제거(마지막 하나면 괄호 제거)" do
    g = create(:domain_file, content: "- **A** [B] (오인식: x, y): d")
    expect(g.remove_mispronunciation!("a", "x")).to be true
    expect(g.reload.content).to eq("- **A** [B] (오인식: y): d")
    expect(g.remove_mispronunciation!("a", "y")).to be true
    expect(g.reload.content).to eq("- **A** [B]: d")
    expect(g.remove_mispronunciation!("a", "y")).to be false
    expect(g.remove_mispronunciation!("zz", "y")).to be false
  end

  it "중복 key 는 첫 줄 기준(find_term 과 일치)" do
    g = create(:domain_file, content: "- **MES** [A] (오인식: x): first\n- **MES** [B]: second")
    expect(g.apply_learning!(merges: { "mes" => ["x"] })).to eq({})
    g.apply_learning!(merges: { "mes" => ["y"] })
    expect(g.reload.content).to eq("- **MES** [A] (오인식: x, y): first\n- **MES** [B]: second")
    expect(g.remove_mispronunciation!("mes", "y")).to be true
    expect(g.reload.content).to eq("- **MES** [A] (오인식: x): first\n- **MES** [B]: second")
  end

  it "CRLF 줄 끝 \\r 보존" do
    g = create(:domain_file, content: "- **A** [B] (오인식: x): d\r\n- **C**: e\r\n")
    lines = g.apply_learning!(merges: { "a" => ["y"] })
    expect(lines["a"]).to eq("- **A** [B] (오인식: x, y): d\r")
    expect(g.reload.content).to eq("- **A** [B] (오인식: x, y): d\r\n- **C**: e\r\n")
    g.remove_mispronunciation!("a", "x")
    expect(g.reload.content).to eq("- **A** [B] (오인식: y): d\r\n- **C**: e\r\n")
  end
end
