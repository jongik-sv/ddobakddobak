require "rails_helper"

# PATCH /api/v1/meetings/:id/owner — 회의 소유자 이관.
# 대상은 그 회의 프로젝트의 멤버만. 수행 권한: 현 소유자 / 프로젝트 관리자(시스템 manager 이상) / 시스템 admin.
RSpec.describe "Api::V1::Meetings owner transfer", type: :request do
  let(:owner) { create(:user, role: "manager") }
  let(:project) do
    p = create(:project, creator: owner, personal: false)
    create(:project_membership, user: owner, project: p, role: "admin")
    p
  end
  let!(:meeting) { create(:meeting, project: project, creator: owner) }
  let!(:member_target) do
    u = create(:user)
    create(:project_membership, user: u, project: project, role: "member")
    u
  end

  it "소유자가 같은 프로젝트 멤버에게 이관한다" do
    login_as(owner)

    patch "/api/v1/meetings/#{meeting.id}/owner", params: { user_id: member_target.id }, as: :json

    expect(response).to have_http_status(:ok)
    expect(meeting.reload.created_by_id).to eq(member_target.id)
  end

  it "프로젝트 비멤버에게는 이관할 수 없다 (422)" do
    outsider = create(:user)
    login_as(owner)

    patch "/api/v1/meetings/#{meeting.id}/owner", params: { user_id: outsider.id }, as: :json

    expect(response).to have_http_status(:unprocessable_entity)
    expect(meeting.reload.created_by_id).to eq(owner.id)
  end

  it "프로젝트 관리자(시스템 manager)는 남의 회의도 이관할 수 있다" do
    co_admin = create(:user, role: "manager")
    create(:project_membership, user: co_admin, project: project, role: "admin")
    login_as(co_admin)

    patch "/api/v1/meetings/#{meeting.id}/owner", params: { user_id: member_target.id }, as: :json

    expect(response).to have_http_status(:ok)
    expect(meeting.reload.created_by_id).to eq(member_target.id)
  end

  it "일반 멤버(비소유자)는 이관할 수 없다 (403)" do
    login_as(member_target)

    patch "/api/v1/meetings/#{meeting.id}/owner", params: { user_id: member_target.id }, as: :json

    expect(response).to have_http_status(:forbidden)
    expect(meeting.reload.created_by_id).to eq(owner.id)
  end

  it "시스템 admin은 팀 프로젝트 회의를 이관할 수 있다" do
    admin = create(:user, :admin)
    login_as(admin)

    patch "/api/v1/meetings/#{meeting.id}/owner", params: { user_id: member_target.id }, as: :json

    expect(response).to have_http_status(:ok)
    expect(meeting.reload.created_by_id).to eq(member_target.id)
  end

  it "존재하지 않는 대상이면 404" do
    login_as(owner)

    patch "/api/v1/meetings/#{meeting.id}/owner", params: { user_id: 999_999 }, as: :json

    expect(response).to have_http_status(:not_found)
    expect(meeting.reload.created_by_id).to eq(owner.id)
  end
end
