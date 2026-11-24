require "rails_helper"

# 프로젝트 관리자(비 시스템 admin)는 관리 범위 안이어도 "쓸 권한이 없는" 도메인 파일
# (공유 파일·다른 프로젝트 소유 파일·남이 만든 사람 파일)을 변경할 수 없다.
RSpec.describe "STT 용어 학습 도메인 파일 쓰기 권한", type: :request do
  include_context "server mode"

  let(:sys_admin) { create(:user, :admin) }
  let(:padmin) { create(:user) }
  let!(:proj_a) { create(:project, creator: sys_admin) }
  let!(:proj_b) { create(:project, creator: sys_admin) }
  let(:base) { "/api/v1/admin/stt_term_learning" }
  let(:deny_msg) { SttTermLearningJson::FILE_WRITE_MESSAGE }

  before do
    create(:project_membership, project: proj_a, user: padmin, role: "admin")
    create(:project_membership, project: proj_b, user: sys_admin, role: "admin")
  end

  def linked_file(owner, content, project_id:, creator:)
    create(:domain_file, creator: creator, project_id: project_id, content: content).tap do |f|
      DomainFileLink.create!(domain_file: f, owner: owner)
    end
  end

  let!(:shared_file)  { linked_file(proj_a, "- **후판** [STT] (오인식: 우판): s", project_id: nil, creator: sys_admin) }
  let!(:other_proj)   { linked_file(proj_a, "- **열연** [STT] (오인식: 열년): o", project_id: proj_b.id, creator: sys_admin) }
  let!(:others_file)  { linked_file(proj_a, "- **냉연** [STT] (오인식: 냉년): x", project_id: proj_a.id, creator: sys_admin) }
  let!(:own_file)     { linked_file(proj_a, "- **강판** [STT] (오인식: 강반): m", project_id: proj_a.id, creator: padmin) }

  def delete_term(file, key)
    post "#{base}/terms/delete", params: { items: [ { domain_file_id: file.id, term_key: key } ] }, as: :json
  end

  describe "terms/delete" do
    it "공유·타 프로젝트·남이 만든 파일은 403, 내가 만든 프로젝트 파일은 허용" do
      login_as(padmin)
      { shared_file => "후판", other_proj => "열연", others_file => "냉연" }.each do |file, key|
        delete_term(file, key)
        expect(response).to have_http_status(:forbidden)
        expect(response.parsed_body["error"]).to eq(deny_msg)
        expect(file.reload.content).to include(key)
      end
      delete_term(own_file, "강판")
      expect(response).to have_http_status(:ok)
    end

    it "관리 프로젝트 자동 파일은 허용" do
      auto = SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.for(proj_a), fallback_creator: sys_admin)
      auto.update!(content: "- **압연** [STT]: a")
      login_as(padmin)
      delete_term(auto, "압연")
      expect(response).to have_http_status(:ok)
    end

    it "시스템 admin 은 (보이는 범위 안) 파일을 쓸 수 있다" do
      f = linked_file(proj_b, "- **후판** [STT]: s", project_id: nil, creator: padmin)
      login_as(sys_admin)
      delete_term(f, "후판")
      expect(response).to have_http_status(:ok)
    end
  end

  describe "moves" do
    def move(file, key, copy: false)
      post "#{base}/moves", params: { moves: [ { domain_file_id: file.id, term_keys: [ key ], copy: copy,
                                                 target: { type: "Project", id: proj_a.id } } ] }, as: :json
    end

    it "공유 파일에서 꺼내는 이동은 403, 복사는 허용" do
      login_as(padmin)
      move(shared_file, "후판")
      expect(response).to have_http_status(:forbidden)
      expect(shared_file.reload.content).to include("후판")
      move(shared_file, "후판", copy: true)
      expect(response).to have_http_status(:ok)
      expect(shared_file.reload.content).to include("후판")
    end

    it "타 프로젝트 파일 이동은 403" do
      login_as(padmin)
      move(other_proj, "열연")
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "moves merge_descendants" do
    let!(:child) { create(:folder, project: proj_a) }
    let(:global_auto) do
      SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.global, fallback_creator: sys_admin)
        .tap { |f| f.update!(content: "- **강판** [STT] (오인식: 강환): g") }
    end
    let(:other_auto) do
      SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.for(proj_b), fallback_creator: sys_admin)
        .tap { |f| f.update!(content: "- **강판** [STT] (오인식: 강팍): o") }
    end
    let(:child_auto) do
      SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.for(child), fallback_creator: sys_admin)
        .tap { |f| f.update!(content: "- **강판** [STT] (오인식: 강핀): c") }
    end

    def merge_move(copy:)
      post "#{base}/moves", params: { moves: [ { domain_file_id: own_file.id, term_keys: [ "강판" ], copy: copy,
                                                 merge_descendants: true,
                                                 target: { type: "Project", id: proj_a.id } } ] }, as: :json
    end

    [ false, true ].each do |copy|
      it "링크만 된 전역·타 프로젝트 자동 파일은 건드리지 않고 하위가 소유한 자동 파일만 병합(copy=#{copy})" do
        [ global_auto, other_auto ].each { |f| DomainFileLink.create!(domain_file: f, owner: child) }
        child_auto
        login_as(padmin)
        merge_move(copy: copy)
        expect(response).to have_http_status(:ok)
        expect(global_auto.reload.content).to include("강판")
        expect(other_auto.reload.content).to include("강판")
        expect(child_auto.reload.content).not_to include("강판")
        target = SttTermLearning::AutoDomainFile.find_for(SttTermLearning::Level.for(proj_a))
        expect(target.content).to include("강핀")
      end
    end

    it "시스템 admin 도 링크만 된 전역 자동 파일은 건드리지 않는다" do
      DomainFileLink.create!(domain_file: global_auto, owner: child)
      create(:project_membership, project: proj_a, user: sys_admin, role: "admin")
      login_as(sys_admin)
      merge_move(copy: true)
      expect(response).to have_http_status(:ok)
      expect(global_auto.reload.content).to include("강판")
    end
  end

  describe "오인식 confirmed" do
    it "공유 파일의 용어에 합쳐지게 되면 403 이고 전체 롤백" do
      rec = create(:stt_misrecognition, project: proj_a, wrong: "후판이", correct: "후판", status: "undecided")
      login_as(padmin)
      patch "#{base}/misrecognitions/#{rec.id}", params: { status: "confirmed" }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"]).to eq(SttTermLearningJson::EXISTING_TERM_MESSAGE)
      expect(shared_file.reload.content).not_to include("후판이")
      expect(rec.reload.status).to eq("undecided")
    end

    it "이미 그 변형이 있으면(already_known) 아무것도 쓰지 않으므로 403 아님" do
      rec = create(:stt_misrecognition, project: proj_a, wrong: "우판", correct: "후판", status: "undecided")
      login_as(padmin)
      patch "#{base}/misrecognitions/#{rec.id}", params: { status: "confirmed" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(rec.reload.status).to eq("confirmed")
    end
  end

  describe "run 항목 register / revert" do
    let(:meeting) { create(:meeting, project: proj_a, creator: sys_admin) }
    let(:run) { create(:stt_term_learning_run, meeting: meeting, status: "done", finished_at: Time.current) }

    it "register: 공유 파일에 합쳐지게 되면 403 이고 롤백" do
      item = create(:stt_term_learning_item, run: run, wrong: "후판이", correct: "후판", wrong_key: "후판이",
                                             correct_key: "후판", verdict: "skipped_excluded")
      login_as(padmin)
      post "#{base}/runs/#{run.id}/items/#{item.id}/register"
      expect(response).to have_http_status(:forbidden)
      expect(shared_file.reload.content).not_to include("후판이")
      expect(item.reload.verdict).to eq("skipped_excluded")
    end

    it "revert: 공유 파일에 쓴 run 은 403, 되돌려지지 않음" do
      create(:stt_term_learning_item, run: run, domain_file: shared_file, level_owner_type: "Project", level_owner_id: proj_a.id,
                                      verdict: "registered",
                                      change: { kind: "add_line", domain_file_id: shared_file.id, term_key: "후판", line: "x" }.to_json)
      login_as(padmin)
      post "#{base}/runs/#{run.id}/revert"
      expect(response).to have_http_status(:forbidden)
      expect(run.reload.status).to eq("done")
    end

    it "revert: 파일을 건드리지 않는 항목(already_known 등)은 공유 파일이어도 막지 않는다" do
      auto = SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.for(proj_a), fallback_creator: sys_admin)
      create(:stt_term_learning_item, run: run, domain_file: shared_file, level_owner_type: "global", level_owner_id: nil,
                                      verdict: "already_known")
      create(:stt_term_learning_item, run: run, domain_file: auto, level_owner_type: "Project", level_owner_id: proj_a.id,
                                      verdict: "registered",
                                      change: { kind: "add_line", domain_file_id: auto.id, term_key: "압연", line: "x" }.to_json)
      login_as(padmin)
      post "#{base}/runs/#{run.id}/revert"
      expect(response).to have_http_status(:ok)
      expect(run.reload.status).to eq("reverted")
    end

    it "register: 이미 알려진 쌍(already_known)은 공유 파일이어도 403 아님" do
      shared_file.update!(content: "- **후판** [STT] (오인식: 후판이): s")
      item = create(:stt_term_learning_item, run: run, wrong: "후판이", correct: "후판", wrong_key: "후판이",
                                             correct_key: "후판", verdict: "skipped_excluded")
      login_as(padmin)
      post "#{base}/runs/#{run.id}/items/#{item.id}/register"
      expect(response).to have_http_status(:ok)
      expect(shared_file.reload.content).to eq("- **후판** [STT] (오인식: 후판이): s")
    end

    it "revert: 관리 프로젝트 자동 파일만 쓴 run 은 허용" do
      auto = SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.for(proj_a), fallback_creator: sys_admin)
      create(:stt_term_learning_item, run: run, domain_file: auto, level_owner_type: "Project", level_owner_id: proj_a.id)
      login_as(padmin)
      post "#{base}/runs/#{run.id}/revert"
      expect(response).to have_http_status(:ok)
    end
  end

  describe "impact(전역 레벨)" do
    it "프로젝트 관리자에겐 관리 프로젝트 회의만 센다" do
      create(:meeting, project: proj_a, creator: sys_admin)
      create(:meeting, project: proj_b, creator: sys_admin)
      login_as(padmin)
      post "#{base}/impact", params: { targets: [ { level: { type: "global" } } ] }, as: :json
      expect(response.parsed_body["counts"]).to eq([ 1 ])
    end
  end
end
