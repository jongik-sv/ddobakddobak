require "rails_helper"

RSpec.describe "STT term learning models" do
  let(:meeting) { create(:meeting) }
  let(:summary) { create(:summary, meeting: meeting) }
  let!(:run) { create(:stt_term_learning_run, meeting: meeting, summary: summary) }

  it "run 삭제 시 items 가 함께 지워진다(FK cascade)" do
    create(:stt_term_learning_item, run: run)
    expect { run.delete }.to change(SttTermLearningItem, :count).by(-1)
  end

  it "meeting 삭제 시 runs 가 지워진다" do
    expect { meeting.destroy }.to change(SttTermLearningRun, :count).by(-1)
  end

  it "summary 삭제 시 run.summary_id 가 nil 이 된다(FK nullify)" do
    summary.destroy
    expect(run.reload.summary_id).to be_nil
  end

  it "전역 자동 파일은 두 개 만들 수 없다" do
    create(:domain_file, auto_kind: "stt_auto", name: "A")
    expect { create(:domain_file, auto_kind: "stt_auto", name: "B") }.to raise_error(ActiveRecord::RecordNotUnique)
  end

  it "global_auto? 는 auto_owner_type 이 남은 고아 파일을 전역으로 보지 않는다" do
    f = create(:domain_file, auto_kind: "stt_auto", auto_owner_type: "Project", auto_owner_id: 999, project_id: nil)
    expect(f.global_auto?).to be(false)
    expect(create(:domain_file, name: "plain").stt_auto?).to be(false)
  end

  it "misrecognition (project, wrong_key, correct_key) 유니크" do
    m = create(:stt_misrecognition)
    expect {
      create(:stt_misrecognition, project: m.project)
    }.to raise_error(ActiveRecord::RecordNotUnique)
  end

  it "misrecognition 상태 scope" do
    m = create(:stt_misrecognition, status: "confirmed")
    expect(SttMisrecognition.confirmed).to include(m)
    expect(SttMisrecognition.undecided).not_to include(m)
  end

  it "item#change_data 는 nil 이면 {} 를 돌려준다" do
    item = create(:stt_term_learning_item, run: run, change: nil)
    expect(item.change_data).to eq({})
    item.update!(change: { a: 1 }.to_json)
    expect(item.change_data).to eq("a" => 1)
  end

  it "move_log actor 는 optional" do
    expect(SttTermMoveLog.create!(moves: "[]", result: "{}")).to be_persisted
  end
end
