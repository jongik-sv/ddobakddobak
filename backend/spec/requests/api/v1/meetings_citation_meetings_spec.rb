require "rails_helper"

# 연결 회의 시드 마커 각인(⟦m:<id>/t:..⟧) + show(full) 응답의 citation_meetings 맵.
# 프론트가 인용 마커를 inert 배지로 렌더할 때 표시용 제목을 얻는 경로를 검증한다.
RSpec.describe "Api::V1::Meetings citation_meetings map", type: :request do
  let(:user)    { create(:user) }
  let(:other)   { create(:user) }
  let(:project) { create(:project, creator: user) }
  let!(:membership) { create(:project_membership, user: user, project: project, role: "admin") }

  before { login_as(user) }

  describe "GET /api/v1/meetings/:id (show, full)" do
    it "활성 요약의 m: 마커에서 회의id를 스캔해 {id => title} 맵을 내려준다" do
      cited = create(:meeting, project: project, creator: user, title: "지난 회의")
      m = create(:meeting, project: project, creator: user, status: "recording")
      create(:summary, meeting: m, summary_type: "realtime",
             notes_markdown: "합의됨. ⟦m:#{cited.id}/t:5000/s:화자 1⟧", generated_at: Time.current)

      get "/api/v1/meetings/#{m.id}"

      json = response.parsed_body
      expect(json["meeting"]["citation_meetings"]).to eq({ cited.id.to_s => "지난 회의" })
    end

    it "연쇄 연결로 여러 id가 공존하면 전부 해석한다" do
      a = create(:meeting, project: project, creator: user, title: "회의A")
      b = create(:meeting, project: project, creator: user, title: "회의B")
      m = create(:meeting, project: project, creator: user, status: "recording")
      create(:summary, meeting: m, summary_type: "realtime",
             notes_markdown: "⟦m:#{a.id}/t:1000/s:화자 1⟧ ⟦m:#{b.id}/t:2000/s:화자 2⟧",
             generated_at: Time.current)

      get "/api/v1/meetings/#{m.id}"

      json = response.parsed_body
      expect(json["meeting"]["citation_meetings"]).to eq(
        { a.id.to_s => "회의A", b.id.to_s => "회의B" }
      )
    end

    it "삭제되거나 접근 불가한 회의id는 맵에서 제외한다" do
      inaccessible = create(:meeting, creator: other, shared: false)
      deleted_id = 999_999
      m = create(:meeting, project: project, creator: user, status: "recording")
      create(:summary, meeting: m, summary_type: "realtime",
             notes_markdown: "⟦m:#{inaccessible.id}/t:1000/s:화자 1⟧ ⟦m:#{deleted_id}/t:2000/s:화자 2⟧",
             generated_at: Time.current)

      get "/api/v1/meetings/#{m.id}"

      json = response.parsed_body
      expect(json["meeting"]["citation_meetings"]).to eq({})
    end

    it "m: 마커가 없으면 빈 맵" do
      m = create(:meeting, project: project, creator: user, status: "recording")
      create(:summary, meeting: m, summary_type: "realtime",
             notes_markdown: "마커 없는 요약", generated_at: Time.current)

      get "/api/v1/meetings/#{m.id}"

      json = response.parsed_body
      expect(json["meeting"]["citation_meetings"]).to eq({})
    end

    it "요약이 없으면 빈 맵" do
      m = create(:meeting, project: project, creator: user, status: "recording")

      get "/api/v1/meetings/#{m.id}"

      json = response.parsed_body
      expect(json["meeting"]["citation_meetings"]).to eq({})
    end

    # idea 44: accessible_by 스코프(admin/소유자/프로젝트멤버+shared)만으로는 폴더 상속 협업자가
    # 빠진다 — 폴더 상속 협업자가 shared:false 이전 회의를 연결한 경우도 authorize_meeting_read!와
    # 동등하게 맵에 제목이 포함돼야 한다(실제로는 열람 가능한데 폴백으로 떨어지면 안 됨).
    it "폴더 상속 협업자면 shared:false 이전 회의도 맵에 제목을 포함한다" do
      other_owner = create(:user)
      other_project = create(:project, creator: other_owner)
      root = create(:folder, project: other_project)
      leaf = create(:folder, project: other_project, parent: root)
      cited = create(:meeting, project: other_project, creator: other_owner, folder: leaf,
                     title: "비공유 지난 회의", shared: false)
      FolderCollaborator.create!(folder: root, user: user) # 조상 폴더 상속(2단계 이상)

      m = create(:meeting, project: project, creator: user, status: "recording")
      create(:summary, meeting: m, summary_type: "realtime",
             notes_markdown: "합의됨. ⟦m:#{cited.id}/t:5000/s:화자 1⟧", generated_at: Time.current)

      get "/api/v1/meetings/#{m.id}"

      json = response.parsed_body
      expect(json["meeting"]["citation_meetings"]).to eq({ cited.id.to_s => "비공유 지난 회의" })
    end

    it "직접 지정 협업자(MeetingCollaborator)면 shared:false 이전 회의도 맵에 제목을 포함한다" do
      other_owner = create(:user)
      other_project = create(:project, creator: other_owner)
      cited = create(:meeting, project: other_project, creator: other_owner,
                     title: "비공유 회의B", shared: false)
      MeetingCollaborator.create!(meeting: cited, user: user)

      m = create(:meeting, project: project, creator: user, status: "recording")
      create(:summary, meeting: m, summary_type: "realtime",
             notes_markdown: "⟦m:#{cited.id}/t:1000/s:화자 1⟧", generated_at: Time.current)

      get "/api/v1/meetings/#{m.id}"

      json = response.parsed_body
      expect(json["meeting"]["citation_meetings"]).to eq({ cited.id.to_s => "비공유 회의B" })
    end

    it "협업자도 아니고 접근 불가한 shared:false 회의는 계속 제외된다(회귀)" do
      other_owner = create(:user)
      other_project = create(:project, creator: other_owner)
      not_a_collaborator = create(:meeting, project: other_project, creator: other_owner,
                                   title: "완전 비공개 회의", shared: false)

      m = create(:meeting, project: project, creator: user, status: "recording")
      create(:summary, meeting: m, summary_type: "realtime",
             notes_markdown: "⟦m:#{not_a_collaborator.id}/t:1000/s:화자 1⟧", generated_at: Time.current)

      get "/api/v1/meetings/#{m.id}"

      json = response.parsed_body
      expect(json["meeting"]["citation_meetings"]).to eq({})
    end
  end
end
