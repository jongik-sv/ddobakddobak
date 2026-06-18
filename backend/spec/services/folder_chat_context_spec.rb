require "rails_helper"

RSpec.describe FolderChatContext do
  let(:project) { create(:project) }
  let(:owner) { project.creator }
  let(:folder) { create(:folder, project: project) }
  let(:child)  { create(:folder, project: project, parent: folder) }

  def transcript_for(meeting, content, ms: 1000)
    create(:transcript, meeting: meeting, speaker_label: "화자 1", content: content, started_at_ms: ms, sequence_number: 0)
  end

  it "폴더 + 재귀 하위폴더의 회의 발췌를 포함한다" do
    m1 = create(:meeting, project: project, folder: folder, creator: owner)
    m2 = create(:meeting, project: project, folder: child, creator: owner)
    transcript_for(m1, "예산은 오천만원입니다")
    transcript_for(m2, "예산 집행 일정은 칠월입니다")

    out = described_class.build(scope_type: "folder", scope_id: folder.id, user: owner, keywords: %w[예산])
    expect(out[:system_prompt]).to eq(LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT)
    expect(out[:user_content]).to include("오천만원").and include("칠월")
    expect(out[:user_content]).to include("[회의:#{m1.id}").and include("[회의:#{m2.id}")
  end

  it "접근 불가(공유 안 된 타인) 회의는 발췌에서 제외한다" do
    other = create(:user)
    private_m = create(:meeting, :private_meeting, project: project, folder: folder, creator: owner)
    transcript_for(private_m, "비밀 예산 내용")

    out = described_class.build(scope_type: "folder", scope_id: folder.id, user: other, keywords: %w[예산])
    expect(out[:user_content]).not_to include("비밀 예산 내용")
  end

  it "프로젝트 스코프는 프로젝트 전체 회의를 대상으로 한다" do
    m = create(:meeting, project: project, folder: nil, creator: owner)
    transcript_for(m, "프로젝트 차원 예산")
    out = described_class.build(scope_type: "project", scope_id: project.id, user: owner, keywords: %w[예산])
    expect(out[:user_content]).to include("프로젝트 차원 예산")
  end

  it "발췌 라인에 회의ID·ms 원값을 노출해 인용에 쓰게 한다" do
    m = create(:meeting, project: project, folder: folder, creator: owner)
    transcript_for(m, "예산 확정", ms: 125_000)
    out = described_class.build(scope_type: "folder", scope_id: folder.id, user: owner, keywords: %w[예산])
    expect(out[:user_content]).to include("125000ms")
    expect(out[:user_content]).to include("[회의:#{m.id}")
  end

  it "직전 대화 history를 scope 단위로 포함한다" do
    create(:chat_message, meeting: nil, scope_type: "folder", scope_id: folder.id, user: owner, role: "user", content: "이전질문")
    create(:chat_message, meeting: nil, scope_type: "folder", scope_id: folder.id, user: owner, role: "assistant", status: "complete", content: "이전답변")
    out = described_class.build(scope_type: "folder", scope_id: folder.id, user: owner, keywords: %w[예산])
    expect(out[:user_content]).to include("이전 대화:").and include("이전질문")
  end
end
