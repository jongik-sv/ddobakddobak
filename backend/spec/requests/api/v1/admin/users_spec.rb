require "rails_helper"

RSpec.describe "Api::V1::Admin::Users", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:member) { create(:user) }

  describe "as admin" do
    before { login_as(admin) }

    describe "GET /api/v1/admin/users" do
      it "returns all users" do
        create_list(:user, 3)

        get "/api/v1/admin/users"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["users"].length).to eq(4) # admin + 3 created
        expect(json["users"].first).to include("id", "email", "name", "role", "created_at")
      end
    end

    describe "POST /api/v1/admin/users" do
      it "creates a new user" do
        expect {
          post "/api/v1/admin/users", params: {
            email: "new@example.com", name: "New User",
            password: "password123", role: "member"
          }, as: :json
        }.to change(User, :count).by(1)

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["user"]["email"]).to eq("new@example.com")
        expect(json["user"]["role"]).to eq("member")
      end

      it "creates an admin user" do
        post "/api/v1/admin/users", params: {
          email: "admin2@example.com", name: "Admin 2",
          password: "password123", role: "admin"
        }, as: :json

        expect(response).to have_http_status(:created)
        expect(response.parsed_body["user"]["role"]).to eq("admin")
      end

      it "creates a manager user" do
        post "/api/v1/admin/users", params: {
          email: "manager1@example.com", name: "Manager 1",
          password: "password123", role: "manager"
        }, as: :json

        expect(response).to have_http_status(:created)
        expect(response.parsed_body["user"]["role"]).to eq("manager")
      end

      it "returns 422 for invalid params" do
        post "/api/v1/admin/users", params: { email: "", name: "" }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    describe "PUT /api/v1/admin/users/:id" do
      it "updates user name and role" do
        put "/api/v1/admin/users/#{member.id}", params: {
          name: "Updated Name", role: "admin"
        }, as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["user"]["name"]).to eq("Updated Name")
        expect(json["user"]["role"]).to eq("admin")
      end

      it "updates user role to manager" do
        put "/api/v1/admin/users/#{member.id}", params: { role: "manager" }, as: :json

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["user"]["role"]).to eq("manager")
      end

      it "returns 404 for non-existent user" do
        put "/api/v1/admin/users/999999", params: { name: "X" }, as: :json
        expect(response).to have_http_status(:not_found)
      end

      it "updates email" do
        put "/api/v1/admin/users/#{member.id}", params: { email: "renamed@example.com" }, as: :json

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["user"]["email"]).to eq("renamed@example.com")
      end

      it "refuses to demote the local account" do
        local = User.find_or_create_by!(email: User::LOCAL_EMAIL) { |u| u.name = "사용자"; u.role = "admin" }
        put "/api/v1/admin/users/#{local.id}", params: { role: "member" }, as: :json

        expect(response).to have_http_status(:forbidden)
        expect(local.reload.role).to eq("admin")
      end

      it "refuses to change the local account email" do
        local = User.find_or_create_by!(email: User::LOCAL_EMAIL) { |u| u.name = "사용자"; u.role = "admin" }
        put "/api/v1/admin/users/#{local.id}", params: { email: "x@example.com" }, as: :json

        expect(response).to have_http_status(:forbidden)
        expect(local.reload.email).to eq(User::LOCAL_EMAIL)
      end
    end

    describe "DELETE /api/v1/admin/users/:id" do
      it "deletes a member user" do
        member # create
        User.find_or_create_by!(email: User::LOCAL_EMAIL) { |u| u.name = "관리자"; u.role = "admin" } # UserDeleter가 요청 중 생성하면 count 상쇄

        expect {
          delete "/api/v1/admin/users/#{member.id}"
        }.to change(User, :count).by(-1)

        expect(response).to have_http_status(:no_content)
      end

      it "prevents admin from deleting themselves" do
        delete "/api/v1/admin/users/#{admin.id}"

        expect(response).to have_http_status(:forbidden)
        expect(response.parsed_body["error"]).to eq("Cannot delete yourself")
      end

      it "returns 404 for non-existent user" do
        delete "/api/v1/admin/users/999999"
        expect(response).to have_http_status(:not_found)
      end

      it "refuses to delete the local account" do
        local = User.find_or_create_by!(email: User::LOCAL_EMAIL) { |u| u.name = "사용자"; u.role = "admin" }
        expect {
          delete "/api/v1/admin/users/#{local.id}"
        }.not_to change(User, :count)

        expect(response).to have_http_status(:forbidden)
      end

      context "소유 데이터가 있는 사용자 — 이관 후 삭제" do
        let!(:victim) { create(:user) }
        let(:victim_personal) { victim.projects.find_by(personal: true) }
        let(:local_user) do
          User.find_or_create_by!(email: User::LOCAL_EMAIL) { |u| u.name = "관리자"; u.role = "admin" }
        end
        let!(:other_admin) { create(:user) }
        # 다른 관리자가 있는 팀 프로젝트 — 회의는 이 관리자에게 가야 한다
        let!(:co_managed_project) do
          p = create(:project, creator: victim, personal: false)
          create(:project_membership, user: victim, project: p, role: "admin")
          create(:project_membership, user: other_admin, project: p, role: "admin")
          p
        end
        let!(:co_managed_meeting) { create(:meeting, project: co_managed_project, creator: victim) }
        # 삭제 대상이 유일한 관리자인 팀 프로젝트 — 회의는 로컬 계정으로 폴백
        let!(:solo_project) do
          p = create(:project, creator: victim, personal: false)
          create(:project_membership, user: victim, project: p, role: "admin")
          p
        end
        let!(:solo_meeting) { create(:meeting, project: solo_project, creator: victim) }
        let!(:personal_folder) { create(:folder, project: victim_personal) }
        let!(:personal_meeting) do
          create(:meeting, project: victim_personal, creator: victim, folder: personal_folder)
        end

        it "회의는 각 프로젝트의 다른 관리자에게, 없으면 로컬 계정에게 이관된다" do
          local_user # 사전 생성 — 요청 중 find_or_create로 만들어지면 User.count 변화가 상쇄된다

          expect {
            delete "/api/v1/admin/users/#{victim.id}"
          }.to change(User, :count).by(-1)
             .and change { co_managed_meeting.reload.created_by_id }.to(other_admin.id)

          expect(response).to have_http_status(:no_content)
          expect(solo_meeting.reload.created_by_id).to eq(local_user.id)
          expect(personal_meeting.reload.created_by_id).to eq(local_user.id)
        end

        it "프로젝트 소유권은 로컬 관리자 계정(desktop@local)에게 넘어간다" do
          local_user # 사전 생성 (User.count 변화 고정)

          delete "/api/v1/admin/users/#{victim.id}"

          expect(response).to have_http_status(:no_content)
          expect(co_managed_project.reload.created_by_id).to eq(local_user.id)
          expect(solo_project.reload.created_by_id).to eq(local_user.id)
        end

        it "개인 프로젝트는 로컬 계정으로 개명·이관 후 내용물째 휴지통으로 간다" do
          local_user
          victim_name = victim.name

          delete "/api/v1/admin/users/#{victim.id}"

          expect(response).to have_http_status(:no_content)
          expect(User.exists?(victim.id)).to be(false)

          old_personal = victim_personal.reload
          expect(old_personal.created_by_id).to eq(local_user.id)
          expect(old_personal.personal).to be(false)
          expect(old_personal.name).to eq("#{victim_name}의 개인 회의")
          expect(old_personal.trashed?).to be(true)
          expect(old_personal.trashed_as_root).to be(true)
          expect(old_personal.deleted_by_id).to eq(local_user.id)
          expect(old_personal.admin?(local_user)).to be(true)

          # 내용물은 프로젝트에 남은 채 같은 휴지통 그룹으로 (복원 시 통째 복구)
          expect(personal_meeting.reload.project_id).to eq(old_personal.id)
          expect(personal_meeting.trashed?).to be(true)
          expect(personal_meeting.trash_group_id).to eq(old_personal.trash_group_id)
          expect(personal_folder.reload.trashed?).to be(true)
        end
      end
    end
  end

  describe "as member" do
    before { login_as(member) }

    it "returns 403 for index" do
      get "/api/v1/admin/users"
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 403 for create" do
      post "/api/v1/admin/users", params: {
        email: "x@x.com", name: "X", password: "p", role: "member"
      }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 403 for update" do
      target = create(:user)
      put "/api/v1/admin/users/#{target.id}", params: { name: "X" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 403 for destroy" do
      target = create(:user)
      delete "/api/v1/admin/users/#{target.id}"
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "POST /api/v1/admin/users/:id/reset_password" do
    include_context "server mode"
    let(:remote) { { "REMOTE_ADDR" => "192.168.1.50" } }

    def login(user, password = "password123")
      post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
      response.parsed_body["access_token"]
    end

    it "resets password, returns temp, and invalidates the target's sessions" do
      admin_pw = create(:user, :admin, password: "password123")
      member_pw = create(:user, password: "password123")
      member_token = login(member_pw)
      admin_token = login(admin_pw)

      post "/api/v1/admin/users/#{member_pw.id}/reset_password",
        headers: remote.merge("Authorization" => "Bearer #{admin_token}"), as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["temp_password"]).to be_present
      expect(response.parsed_body["temp_password"].length).to eq(12)

      get "/api/v1/meetings",
        headers: remote.merge("Authorization" => "Bearer #{member_token}"), as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "lets the target log in with the temp password" do
      admin_pw = create(:user, :admin, password: "password123")
      member_pw = create(:user, password: "password123")
      admin_token = login(admin_pw)

      post "/api/v1/admin/users/#{member_pw.id}/reset_password",
        headers: remote.merge("Authorization" => "Bearer #{admin_token}"), as: :json
      temp = response.parsed_body["temp_password"]

      post "/auth/login", params: { user: { email: member_pw.email, password: temp } }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "returns 403 for a member caller" do
      member_pw = create(:user, password: "password123")
      target = create(:user)
      member_token = login(member_pw)

      post "/api/v1/admin/users/#{target.id}/reset_password",
        headers: remote.merge("Authorization" => "Bearer #{member_token}"), as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "refuses to reset the local account password" do
      admin_pw = create(:user, :admin, password: "password123")
      local = ::User.find_or_create_by!(email: ::User::LOCAL_EMAIL) { |u| u.name = "사용자"; u.role = "admin" }
      admin_token = login(admin_pw)

      post "/api/v1/admin/users/#{local.id}/reset_password",
        headers: remote.merge("Authorization" => "Bearer #{admin_token}"), as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end
end
