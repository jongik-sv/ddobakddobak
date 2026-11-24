require "rails_helper"

# 서버 모드: 용어 학습은 "내가 프로젝트 admin 인 프로젝트"로만 한정된다(시스템 admin 도 동일).
# 전역 레벨은 프로젝트 관리자에게 읽기 전용, 학습 설정 변경은 시스템 admin 만.
RSpec.describe "STT 용어 학습 프로젝트 관리자 범위", type: :request do
  include_context "server mode"

  let(:sys_admin) { create(:user, :admin) }
  let(:padmin) { create(:user) }   # 시스템 role member, 프로젝트 A 의 admin
  let(:plain) { create(:user) }    # 프로젝트 A 의 일반 member
  let!(:proj_a) { create(:project, creator: sys_admin) }
  let!(:proj_b) { create(:project, creator: sys_admin) }
  let(:level) { SttTermLearning::Level }
  let(:base) { "/api/v1/admin/stt_term_learning" }

  def json = response.parsed_body

  def auto_file(lv, content, creator: sys_admin)
    SttTermLearning::AutoDomainFile.find_or_create_for!(lv, fallback_creator: creator).tap { |f| f.update!(content: content) }
  end

  before do
    create(:project_membership, project: proj_a, user: padmin, role: "admin")
    create(:project_membership, project: proj_a, user: plain, role: "member")
    create(:project_membership, project: proj_b, user: sys_admin, role: "admin") # sys_admin 은 B 만 관리
  end

  describe "접근 자격" do
    it "프로젝트 일반 member 는 403" do
      login_as(plain)
      get "#{base}/tree"
      expect(response).to have_http_status(:forbidden)
      get "#{base}/runs"
      expect(response).to have_http_status(:forbidden)
      get "#{base}/misrecognitions"
      expect(response).to have_http_status(:forbidden)
      get "#{base}/projects"
      expect(response).to have_http_status(:forbidden)
    end

    it "프로젝트 admin(비 시스템 admin)은 접근하고 관리 프로젝트만 본다" do
      login_as(padmin)
      get "#{base}/projects"
      expect(response).to have_http_status(:ok)
      expect(json["projects"].map { |p| p["id"] }).to eq([ proj_a.id ])
      get "#{base}/tree"
      expect(json["projects"].map { |p| p["id"] }).to eq([ proj_a.id ])
    end

    it "시스템 admin 도 admin 멤버십이 있는 프로젝트만 본다" do
      login_as(sys_admin)
      get "#{base}/projects"
      expect(json["projects"].map { |p| p["id"] }).to eq([ proj_b.id ])
      get "#{base}/tree"
      expect(json["projects"].map { |p| p["id"] }).to eq([ proj_b.id ])
    end

    it "관리 프로젝트가 아닌 project_id 는 404" do
      login_as(padmin)
      get "#{base}/tree", params: { project_id: proj_b.id }
      expect(response).to have_http_status(:not_found)
    end

    it "개인(personal) 프로젝트 admin 멤버십만으로는 자격이 없다" do
      user = create(:user) # 가입 시 개인 프로젝트 admin 멤버로 자동 생성
      login_as(user)
      get "#{base}/tree"
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "데이터 범위" do
    it "용어·회의 id: 전역 용어의 meeting_ids 에 남의 프로젝트 회의가 새지 않는다" do
      gfile = auto_file(level.global, "- **후판** [STT] (오인식: 우판): x")
      mine = create(:meeting, project: proj_a, creator: sys_admin)
      other = create(:meeting, project: proj_b, creator: sys_admin)
      [ mine, other ].each do |mt|
        run = create(:stt_term_learning_run, meeting: mt, status: "done", finished_at: Time.current)
        create(:stt_term_learning_item, run: run, domain_file: gfile, correct_key: "후판", level_owner_type: "global")
      end
      login_as(padmin)
      get "#{base}/terms", params: { level_type: "global" }
      expect(json["terms"].sole["meeting_ids"]).to eq([ mine.id ])
    end

    it "runs: 관리 프로젝트의 run 만 목록에 나오고 남의 run 은 상세·되돌리기 404" do
      mine = create(:meeting, project: proj_a, creator: sys_admin)
      other = create(:meeting, project: proj_b, creator: sys_admin)
      r1 = create(:stt_term_learning_run, meeting: mine, status: "done", finished_at: Time.current)
      r2 = create(:stt_term_learning_run, meeting: other, status: "done", finished_at: Time.current)
      login_as(padmin)
      get "#{base}/runs"
      expect(json["runs"].map { |r| r["id"] }).to eq([ r1.id ])
      get "#{base}/runs/#{r2.id}"
      expect(response).to have_http_status(:not_found)
      post "#{base}/runs/#{r2.id}/revert"
      expect(response).to have_http_status(:not_found)
      post "#{base}/meetings/#{other.id}/analyze"
      expect(response).to have_http_status(:not_found)
    end

    it "오인식 기록: 관리 프로젝트만 목록, 남의 것 변경은 404" do
      m1 = create(:stt_misrecognition, project: proj_a)
      m2 = create(:stt_misrecognition, project: proj_b)
      login_as(padmin)
      get "#{base}/misrecognitions"
      expect(json["misrecognitions"].map { |m| m["id"] }).to eq([ m1.id ])
      patch "#{base}/misrecognitions/#{m2.id}", params: { status: "excluded" }, as: :json
      expect(response).to have_http_status(:not_found)
      expect(m2.reload.status).to eq("undecided")
    end

    it "impact: 남의 프로젝트 레벨은 404, 전역은 읽기 가능" do
      login_as(padmin)
      post "#{base}/impact", params: { targets: [ { level: { type: "Project", id: proj_b.id } } ] }, as: :json
      expect(response).to have_http_status(:not_found)
      post "#{base}/impact", params: { targets: [ { level: { type: "global" } } ] }, as: :json
      expect(response).to have_http_status(:ok)
    end
  end

  describe "전역 레벨 쓰기" do
    let!(:gfile) { auto_file(level.global, "- **냉연** [STT] (오인식: 냉년): x") }
    let!(:pfile) { auto_file(level.for(proj_a), "- **후판** [STT] (오인식: 우판): y", creator: padmin) }

    def move(file, key, target)
      post "#{base}/moves", params: { moves: [ { domain_file_id: file.id, term_keys: [ key ], target: target } ] }, as: :json
    end

    it "프로젝트 admin: 전역으로 이동·복사는 403, 전역 용어 이동·삭제도 403" do
      login_as(padmin)
      move(pfile, "후판", { type: "global" })
      expect(response).to have_http_status(:forbidden)
      expect(pfile.reload.content).to include("후판")
      move(gfile, "냉연", { type: "Project", id: proj_a.id })
      expect(response).to have_http_status(:forbidden)
      post "#{base}/terms/delete", params: { items: [ { domain_file_id: gfile.id, term_key: "냉연" } ] }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(gfile.reload.content).to include("냉연")
    end

    it "프로젝트 admin: 관리 프로젝트 안 이동·삭제는 성공" do
      login_as(padmin)
      folder = create(:folder, project: proj_a)
      move(pfile, "후판", { type: "Folder", id: folder.id })
      expect(response).to have_http_status(:ok)
      post "#{base}/terms/delete", params: { items: [ { domain_file_id: SttTermLearning::AutoDomainFile.find_or_create_for!(level.for(folder), fallback_creator: padmin).id, term_key: "후판" } ] }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "프로젝트 admin: 남의 프로젝트 파일 이동은 거부" do
      bfile = auto_file(level.for(proj_b), "- **열연**: z")
      login_as(padmin)
      move(bfile, "열연", { type: "Project", id: proj_a.id })
      expect(response).to have_http_status(:unprocessable_entity)
      expect(bfile.reload.content).to include("열연")
    end

    it "시스템 admin: 전역 쓰기 가능" do
      bfile = auto_file(level.for(proj_b), "- **열연**: z")
      login_as(sys_admin)
      move(bfile, "열연", { type: "global" })
      expect(response).to have_http_status(:ok)
      expect(gfile.reload.content).to include("열연")
    end

    it "되돌리기: 전역에 쓴 run 은 프로젝트 admin 에게 403" do
      meeting = create(:meeting, project: proj_a, creator: sys_admin)
      run = create(:stt_term_learning_run, meeting: meeting, status: "done", finished_at: Time.current)
      create(:stt_term_learning_item, run: run, domain_file: gfile, level_owner_type: "global",
                                      verdict: "registered",
                                      change: { kind: "add_line", domain_file_id: gfile.id, term_key: "x", line: "x" }.to_json)
      login_as(padmin)
      post "#{base}/runs/#{run.id}/revert"
      expect(response).to have_http_status(:forbidden)
      expect(run.reload.status).to eq("done")
    end
  end

  describe "학습 설정" do
    it "GET 은 프로젝트 admin 도 가능, PUT 은 시스템 admin 만" do
      login_as(padmin)
      get "#{base}/settings"
      expect(response).to have_http_status(:ok)
      put "#{base}/settings", params: { enabled: false }, as: :json
      expect(response).to have_http_status(:forbidden)
      login_as(sys_admin)
      allow(AppSettings).to receive(:save_stt_term_learning!).and_return({ "enabled" => false })
      put "#{base}/settings", params: { enabled: false }, as: :json
      expect(response).to have_http_status(:ok)
    end
  end

  describe "로컬 모드(변경 없음)" do
    include_context "local mode"

    it "자격·가시 범위는 기존 그대로(admin 이 전 팀 프로젝트를 본다)" do
      get "#{base}/tree"
      expect(response).to have_http_status(:ok)
      expect(json["projects"].map { |p| p["id"] }).to include(proj_a.id, proj_b.id)
    end
  end
end
