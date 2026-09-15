require "rails_helper"
require "rake"

# lib/tasks/citation_markers.rake 자체(ENV 파싱 + 출력)를 검증한다. 교정 로직 자체의 세부
# 케이스는 spec/services/citation_marker_backfill_spec.rb 에서 다룬다 — 여기서는 rake 태스크가
# DRY_RUN 을 지키고, 마커 단위 출력 포맷을 만들고, 실제 갱신이 멱등한지만 확인한다.
RSpec.describe "citation_markers:normalize_summaries" do
  before(:all) do
    Rails.application.load_tasks unless Rake::Task.task_defined?("citation_markers:normalize_summaries")
  end

  after do
    Rake::Task["citation_markers:normalize_summaries"].reenable
  end

  let(:meeting) { create(:meeting, audio_duration_ms: 3_172_560) }

  def run_task
    output = StringIO.new
    original_stdout = $stdout
    $stdout = output
    Rake::Task["citation_markers:normalize_summaries"].invoke
    output.string
  ensure
    $stdout = original_stdout
  end

  it "DRY_RUN=1 이면 DB를 바꾸지 않고 마커 단위 diff 를 출력한다" do
    meeting.glossary_entries.create!(from_text: "250", to_text: "임가공")
    summary = Summary.create!(meeting: meeting, summary_type: "final", generated_at: Time.current,
                               notes_markdown: "⟦t:1056임가공/s:화자 5⟧")

    ENV["DRY_RUN"] = "1"
    out = run_task
    ENV.delete("DRY_RUN")

    expect(out).to include("[DRY-RUN(미리보기)]")
    expect(out).to include("Summary##{summary.id}")
    expect(out).to include("(meeting=#{meeting.id})")
    expect(out).to include("⟦t:1056임가공/s:화자 5⟧ ⇒ ⟦t:1056250/s:화자 5⟧")
    expect(out).to include("[역치환 복원]")
    expect(out).to match(/역치환 복원 1건/)
    expect(summary.reload.notes_markdown).to eq("⟦t:1056임가공/s:화자 5⟧") # 미변경
  end

  it "삭제·보류 케이스도 각각의 라벨로 출력한다" do
    chat_deleted = create(:chat_message, meeting: meeting, content: "⟦m:122⟧")
    meeting.glossary_entries.create!(from_text: "1", to_text: "가")
    meeting.glossary_entries.create!(from_text: "9", to_text: "가")
    summary_held = Summary.create!(meeting: meeting, summary_type: "final", generated_at: Time.current,
                                    notes_markdown: "⟦t:100가/s:화자 1⟧")

    ENV["DRY_RUN"] = "1"
    out = run_task
    ENV.delete("DRY_RUN")

    expect(out).to include("ChatMessage##{chat_deleted.id}")
    expect(out).to include("⟦m:122⟧ ⇒ (삭제)")
    expect(out).to include("[복구 불가]")

    expect(out).to include("Summary##{summary_held.id}")
    expect(out).to include("⟧ ⇒ (보류)")
    expect(out).to match(/역치환 후보 \d+개/)
  end

  it "DRY_RUN 없이 실행하면 실제로 갱신되고, 재실행 시 변경이 0건이다(멱등)" do
    summary = Summary.create!(meeting: meeting, summary_type: "final", generated_at: Time.current,
                               notes_markdown: "⟦t:175000ms/s:화자 1⟧")

    run_task
    expect(summary.reload.notes_markdown).to eq("⟦t:175000/s:화자 1⟧")

    Rake::Task["citation_markers:normalize_summaries"].reenable
    out2 = run_task
    expect(out2).to match(/변경: 0건/)
  end
end
