require "rails_helper"

# idea 44: 회의 개별 협업자 CRUD + authorize_meeting_read!/authorize_meeting_control! 협업자 분기.
RSpec.describe "Api::V1::Meetings collaborators", type: :request do
  let(:owner) { create(:user) }
  let(:project) { create(:project, creator: owner) }
  let!(:owner_membership) { create(:project_membership, user: owner, project: project, role: "member") }
  let!(:meeting) { create(:meeting, :private_meeting, project: project, creator: owner) }
  let!(:member) do
    u = create(:user)
    create(:project_membership, user: u, project: project, role: "member")
    u
  end
  let(:outsider) { create(:user) } # 프로젝트 비멤버

  describe "GET /api/v1/meetings/:id/collaborators" do
    # set_meeting이 항상 authorize_meeting_read!를 강제해 안전하지만(폴더 쪽 IDOR와 달리),
    # 이 안전성을 지켜주는 회귀 테스트가 없었다 — collaborators가 set_meeting only 목록에서
    # 빠지거나 skip_before_action이 추가돼도 지금은 아무 테스트도 못 잡는다.
    it "프로젝트 비멤버(outsider)는 403" do
      login_as(outsider)
      get "/api/v1/meetings/#{meeting.id}/collaborators"
      expect(response).to have_http_status(:forbidden)
    end

    it "직접(direct)과 상속(inherited, folder_id/folder_name 포함)이 구분되어 응답" do
      root = create(:folder, project: project)
      meeting.update!(folder: root)
      FolderCollaborator.create!(folder: root, user: member)
      other_direct = create(:user)
      create(:project_membership, user: other_direct, project: project, role: "member")
      MeetingCollaborator.create!(meeting: meeting, user: other_direct)

      login_as(owner)
      get "/api/v1/meetings/#{meeting.id}/collaborators"

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["direct"].map { |c| c["user_id"] }).to eq([ other_direct.id ])
      expect(body["inherited"].map { |c| c["user_id"] }).to eq([ member.id ])
      expect(body["inherited"].first["folder_id"]).to eq(root.id)
      expect(body["inherited"].first["folder_name"]).to eq(root.name)
    end
  end

  describe "POST /api/v1/meetings/:id/collaborators" do
    it "소유자가 같은 프로젝트 멤버를 협업자로 추가 -> 201" do
      login_as(owner)
      post "/api/v1/meetings/#{meeting.id}/collaborators", params: { user_id: member.id }, as: :json

      expect(response).to have_http_status(:created)
      expect(MeetingCollaborator.exists?(meeting_id: meeting.id, user_id: member.id)).to be true
    end

    it "프로젝트 비멤버 대상이면 422" do
      login_as(owner)
      post "/api/v1/meetings/#{meeting.id}/collaborators", params: { user_id: outsider.id }, as: :json

      expect(response).to have_http_status(:unprocessable_entity)
      expect(MeetingCollaborator.exists?(meeting_id: meeting.id, user_id: outsider.id)).to be false
    end

    it "일반 협업자(비소유자)가 호출하면 403 — 권한 상승 회귀 방지 핵심 케이스" do
      MeetingCollaborator.create!(meeting: meeting, user: member)
      another_member = create(:user)
      create(:project_membership, user: another_member, project: project, role: "member")

      login_as(member) # member는 이제 이 회의의 협업자지만 소유자는 아님
      post "/api/v1/meetings/#{meeting.id}/collaborators", params: { user_id: another_member.id }, as: :json

      expect(response).to have_http_status(:forbidden)
      expect(MeetingCollaborator.exists?(meeting_id: meeting.id, user_id: another_member.id)).to be false
    end

    it "admin은 호출 가능" do
      admin = create(:user, :admin)
      login_as(admin)
      post "/api/v1/meetings/#{meeting.id}/collaborators", params: { user_id: member.id }, as: :json

      expect(response).to have_http_status(:created)
    end
  end

  describe "DELETE /api/v1/meetings/:id/collaborators/:user_id" do
    it "소유자가 제거 -> 204, 이후 editable_by? false로 전환" do
      MeetingCollaborator.create!(meeting: meeting, user: member)
      login_as(owner)

      delete "/api/v1/meetings/#{meeting.id}/collaborators/#{member.id}"

      expect(response).to have_http_status(:no_content)
      expect(meeting.reload.editable_by?(member)).to be false
    end

    # 모델 메서드(editable_by?)만이 아니라 실제 API 요청 레벨에서도 편집이 막히는지 확인 —
    # authorize_meeting_control!은 meeting_collaborator?(별도 헬퍼)를 쓰므로 완전히 같은 로직은 아니다.
    it "제거 후 실제 PATCH 요청도 403으로 전환된다" do
      MeetingCollaborator.create!(meeting: meeting, user: member)
      login_as(owner)
      delete "/api/v1/meetings/#{meeting.id}/collaborators/#{member.id}"
      expect(response).to have_http_status(:no_content)

      login_as(member)
      patch "/api/v1/meetings/#{meeting.id}", params: { title: "제거후시도" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "존재하지 않는 대상은 404" do
      login_as(owner)
      delete "/api/v1/meetings/#{meeting.id}/collaborators/#{member.id}"
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "authorize_meeting_read! 협업자 분기" do
    it "폴더 상속 협업자가 비공유(private) 회의를 읽을 수 있다 — 핵심 회귀 방지" do
      root = create(:folder, project: project)
      meeting.update!(folder: root)
      FolderCollaborator.create!(folder: root, user: member)

      login_as(member)
      get "/api/v1/meetings/#{meeting.id}"

      expect(response).to have_http_status(:ok)
    end

    it "무관한 프로젝트 멤버는 비공유 회의를 읽을 수 없다(403, 기존 동작 유지)" do
      login_as(member)
      get "/api/v1/meetings/#{meeting.id}"
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "authorize_meeting_control! 협업자 분기" do
    it "직접 협업자가 회의를 수정(update)할 수 있다" do
      MeetingCollaborator.create!(meeting: meeting, user: member)
      login_as(member)

      patch "/api/v1/meetings/#{meeting.id}", params: { title: "협업자수정" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(meeting.reload.title).to eq("협업자수정")
    end

    it "폴더상속 협업자가 회의를 수정(update)할 수 있다" do
      root = create(:folder, project: project)
      meeting.update!(folder: root)
      FolderCollaborator.create!(folder: root, user: member)
      login_as(member)

      patch "/api/v1/meetings/#{meeting.id}", params: { title: "폴더협업자수정" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(meeting.reload.title).to eq("폴더협업자수정")
    end

    it "무관한 사용자는 여전히 403" do
      login_as(member)
      patch "/api/v1/meetings/#{meeting.id}", params: { title: "해킹" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  # idea 44: editable_by?(협업자 포함)가 destroy/lock/unlock 같은 파괴적·소유자 전용 액션에
  # 그대로 재사용되면 협업자가 소유자 회의를 삭제하거나 소유자의 잠금을 풀 수 있다 — 이는
  # #44 원 요구사항("수정 권한 공유")의 범위를 넘는다. owner/admin 전용으로 좁혀야 한다.
  describe "DELETE /api/v1/meetings/:id (destroy) — 협업자는 삭제 불가" do
    it "직접 협업자는 403" do
      MeetingCollaborator.create!(meeting: meeting, user: member)
      login_as(member)

      delete "/api/v1/meetings/#{meeting.id}"

      expect(response).to have_http_status(:forbidden)
      expect(meeting.reload.trashed?).to be false
    end

    it "폴더상속 협업자는 403" do
      root = create(:folder, project: project)
      meeting.update!(folder: root)
      FolderCollaborator.create!(folder: root, user: member)
      login_as(member)

      delete "/api/v1/meetings/#{meeting.id}"

      expect(response).to have_http_status(:forbidden)
      expect(meeting.reload.trashed?).to be false
    end

    it "소유자는 여전히 204 — 회귀 방지" do
      login_as(owner)
      delete "/api/v1/meetings/#{meeting.id}"
      expect(response).to have_http_status(:no_content)
    end
  end

  # idea 44: editable_by?(협업자 포함)가 update 액션 안 shared 토글 가드에 그대로 재사용되면
  # 협업자가 프로젝트 전체 공개 여부(shared)를 바꿀 수 있다 — 주석("소유자/admin만 가능")이
  # 명시하는 의도 위반이자 destroy/lock과 같은 급의 소유자 전용 액션이다. shared 파라미터만
  # 무시되고 나머지 필드(title 등)는 정상 반영되어야 협업자의 일반 편집권은 보존된다.
  describe "PATCH /api/v1/meetings/:id — shared 토글은 협업자에게 무시된다" do
    it "직접 협업자가 shared:true로 PATCH해도 shared는 그대로, 다른 필드(title)는 반영된다" do
      MeetingCollaborator.create!(meeting: meeting, user: member)
      login_as(member)

      patch "/api/v1/meetings/#{meeting.id}", params: { shared: true, title: "협업자편집" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["meeting"]["shared"]).to be false
      meeting.reload
      expect(meeting.shared).to be false
      expect(meeting.title).to eq("협업자편집")
    end

    it "폴더상속 협업자가 shared:true로 PATCH해도 shared는 그대로, 다른 필드(title)는 반영된다" do
      root = create(:folder, project: project)
      meeting.update!(folder: root)
      FolderCollaborator.create!(folder: root, user: member)
      login_as(member)

      patch "/api/v1/meetings/#{meeting.id}", params: { shared: true, title: "폴더협업자편집" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["meeting"]["shared"]).to be false
      meeting.reload
      expect(meeting.shared).to be false
      expect(meeting.title).to eq("폴더협업자편집")
    end

    it "소유자가 shared를 토글하면 정상 반영된다 — 회귀 방지" do
      login_as(owner)

      patch "/api/v1/meetings/#{meeting.id}", params: { shared: true }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["meeting"]["shared"]).to be true
      expect(meeting.reload.shared).to be true
    end
  end

  describe "POST/DELETE /api/v1/meetings/:id/lock — 협업자는 잠금/해제 불가" do
    it "직접 협업자는 lock 403" do
      MeetingCollaborator.create!(meeting: meeting, user: member)
      login_as(member)

      post "/api/v1/meetings/#{meeting.id}/lock"

      expect(response).to have_http_status(:forbidden)
      expect(meeting.reload.locked?).to be false
    end

    it "폴더상속 협업자는 unlock 403(이미 잠긴 회의)" do
      root = create(:folder, project: project)
      meeting.update!(folder: root, locked_at: Time.current)
      FolderCollaborator.create!(folder: root, user: member)
      login_as(member)

      delete "/api/v1/meetings/#{meeting.id}/lock"

      expect(response).to have_http_status(:forbidden)
      expect(meeting.reload.locked?).to be true
    end

    it "소유자는 여전히 lock/unlock 가능 — 회귀 방지" do
      login_as(owner)
      post "/api/v1/meetings/#{meeting.id}/lock"
      expect(response).to have_http_status(:ok)
      delete "/api/v1/meetings/#{meeting.id}/lock"
      expect(response).to have_http_status(:ok)
    end
  end
end
