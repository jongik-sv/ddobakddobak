require "rails_helper"
require "tmpdir"

RSpec.describe "Api::V1::Admin::SttTermLearning", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:member) { create(:user) }
  let(:project) { create(:project, creator: admin) }
  let(:parent) { create(:folder, project: project) }
  let(:child) { create(:folder, project: project, parent: parent) }
  let(:level) { SttTermLearning::Level }

  def auto_file(lv, content)
    SttTermLearning::AutoDomainFile.find_or_create_for!(lv, fallback_creator: admin).tap { |f| f.update!(content: content) }
  end

  def json = response.parsed_body

  context "server mode" do
    include_context "server mode"

    it "비관리자 403" do
      login_as(member)
      get "/api/v1/admin/stt_term_learning/tree"
      expect(response).to have_http_status(:forbidden)
      get "/api/v1/admin/stt_term_learning/terms"
      expect(response).to have_http_status(:forbidden)
      post "/api/v1/admin/stt_term_learning/moves", params: { moves: [] }, as: :json
      expect(response).to have_http_status(:forbidden)
      get "/api/v1/admin/stt_term_learning/settings"
      expect(response).to have_http_status(:forbidden)
    end

    it "비관리자 403 — impact·terms/delete·PUT settings" do
      login_as(member)
      [
        -> { post "/api/v1/admin/stt_term_learning/impact", params: { targets: [] }, as: :json },
        -> { post "/api/v1/admin/stt_term_learning/terms/delete", params: { items: [] }, as: :json },
        -> { put "/api/v1/admin/stt_term_learning/settings", params: { enabled: false }, as: :json }
      ].each do |call|
        instance_exec(&call)
        expect(response).to have_http_status(:forbidden)
      end
    end
  end

  # 남의 personal 프로젝트의 자동 파일.
  def hidden_auto_file(content)
    other = create(:user)
    hp = other.projects.find_by!(personal: true)
    SttTermLearning::AutoDomainFile.find_or_create_for!(level.for(hp), fallback_creator: other).tap { |f| f.update!(content: content) }
  end

  describe "as admin" do
    before { login_as(admin) }

    it "tree 응답이 계약 키를 갖고 남의 personal 프로젝트는 뺀다" do
      auto_file(level.for(child), "- **후판** [STT] (오인식: 우판): 강판")
      other = create(:user)
      hidden = create(:project, creator: other, personal: true)

      get "/api/v1/admin/stt_term_learning/tree"

      expect(response).to have_http_status(:ok)
      expect(json["global"]).to eq("term_count" => 0, "new_count" => 0)
      ids = json["projects"].map { |p| p["id"] }
      expect(ids).to include(project.id)
      expect(ids).not_to include(hidden.id)
      p = json["projects"].find { |x| x["id"] == project.id }
      expect(p.keys).to contain_exactly("id", "name", "term_count", "new_count", "promote_candidates", "folders")
      f = p["folders"].find { |x| x["id"] == child.id }
      expect(f).to include("name" => child.name, "parent_id" => parent.id, "term_count" => 1, "new_count" => 0,
                           "promote_candidates" => [])
    end

    describe "GET terms" do
      it "레벨 지정 시 TermRow 계약 키" do
        file = auto_file(level.for(child), "- **후판** [STT] (오인식: 우판): 강판")

        get "/api/v1/admin/stt_term_learning/terms", params: { level_type: "Folder", level_id: child.id }

        expect(response).to have_http_status(:ok)
        row = json["terms"].sole
        expect(row.keys).to contain_exactly("row_id", "term", "key", "category", "definition", "mispronunciations",
                                            "domain_file", "level", "source", "meeting_ids", "is_new",
                                            "applied_meeting_count", "duplicate_group", "merge_target")
        expect(row).to include("term" => "후판", "key" => "후판", "mispronunciations" => [ "우판" ], "source" => "auto",
                               "is_new" => false, "applied_meeting_count" => 0, "duplicate_group" => nil)
        expect(row["domain_file"]).to eq("id" => file.id, "name" => file.name, "auto" => true)
        expect(row["level"]).to eq("type" => "Folder", "id" => child.id, "name" => child.name,
                                   "path" => [ project.name, parent.name, child.name ])
      end

      it "global + include_descendants=1 (level_id 생략) 이면 하위 전부, 레벨 생략이면 전체" do
        auto_file(level.for(child), "- **후판**: a")
        auto_file(level.for(project), "- **냉연**: b")

        get "/api/v1/admin/stt_term_learning/terms", params: { level_type: "global", include_descendants: "1" }
        expect(json["terms"].map { |r| r["key"] }).to contain_exactly("후판", "냉연")

        get "/api/v1/admin/stt_term_learning/terms", params: { level_type: "global" }
        expect(json["terms"]).to eq([])

        get "/api/v1/admin/stt_term_learning/terms"
        expect(json["terms"].map { |r| r["key"] }).to contain_exactly("후판", "냉연")
      end
    end

    it "impact: 남의 personal 프로젝트 레벨은 404" do
      hp = create(:user).projects.find_by!(personal: true)
      post "/api/v1/admin/stt_term_learning/impact",
           params: { targets: [ { level: { type: "Project", id: hp.id } } ] }, as: :json
      expect(response).to have_http_status(:not_found)
    end

    it "impact 은 counts 배열" do
      create(:meeting, project: project, folder: child)
      create(:meeting, project: project)

      post "/api/v1/admin/stt_term_learning/impact",
           params: { targets: [ { level: { type: "Folder", id: child.id } }, { level: { type: "Project", id: project.id } },
                                { level: { type: "global", id: nil } } ] }, as: :json

      expect(response).to have_http_status(:ok)
      expect(json).to eq("counts" => [ 1, 2, Meeting.kept.count ])
    end

    describe "POST moves" do
      it "성공 200 { moved, merged }" do
        source = auto_file(level.for(child), "- **후판** [STT] (오인식: 우판): 강판")

        post "/api/v1/admin/stt_term_learning/moves",
             params: { moves: [ { domain_file_id: source.id, term_keys: [ "후판" ], target: { type: "Project", id: project.id } } ] },
             as: :json

        expect(response).to have_http_status(:ok)
        expect(json).to eq("moved" => 1, "merged" => 0)
        expect(source.reload.content).not_to include("후판")
        expect(SttTermLearning::AutoDomainFile.find_for(level.for(project)).content).to include("**후판**")
      end

      it "실패 시 422 + 도메인 파일 변경 없음(전부 롤백)" do
        source = auto_file(level.for(child), "- **후판**: a\n- **냉연**: b")
        before = source.content

        post "/api/v1/admin/stt_term_learning/moves",
             params: { moves: [
               { domain_file_id: source.id, term_keys: [ "후판" ], target: { type: "Project", id: project.id } },
               { domain_file_id: source.id, term_keys: [ "없는용어" ], target: { type: "Project", id: project.id } }
             ] }, as: :json

        expect(response).to have_http_status(:unprocessable_entity)
        expect(json["error"]).to include("없는용어")
        expect(source.reload.content).to eq(before)
        expect(SttTermLearning::AutoDomainFile.find_for(level.for(project))&.content.to_s).not_to include("후판")
      end

      it "없는 대상 레벨은 422" do
        source = auto_file(level.for(child), "- **후판**: a")
        post "/api/v1/admin/stt_term_learning/moves",
             params: { moves: [ { domain_file_id: source.id, term_keys: nil, target: { type: "Folder", id: 0 } } ] }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json).to have_key("error")
      end

      it "범위 밖(남의 personal) 파일을 원본으로 쓰면 422 + 내용 그대로" do
        hidden = hidden_auto_file("- **후판**: a")
        post "/api/v1/admin/stt_term_learning/moves",
             params: { moves: [ { domain_file_id: hidden.id, term_keys: [ "후판" ], target: { type: "Project", id: project.id } } ] },
             as: :json
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json).to eq("error" => "이동할 수 없는 파일입니다")
        expect(hidden.reload.content).to eq("- **후판**: a")
        expect(SttTermLearning::AutoDomainFile.find_for(level.for(project))).to be_nil
      end

      it "남의 personal 프로젝트로는 옮기지 않는다(422)" do
        hidden = create(:project, creator: create(:user), personal: true)
        source = auto_file(level.for(child), "- **후판**: a")
        post "/api/v1/admin/stt_term_learning/moves",
             params: { moves: [ { domain_file_id: source.id, term_keys: [ "후판" ], target: { type: "Project", id: hidden.id } } ] },
             as: :json
        expect(response).to have_http_status(:unprocessable_entity)
        expect(source.reload.content).to include("후판")
      end
    end

    describe "POST terms/delete" do
      it "{ deleted }" do
        source = auto_file(level.for(child), "- **후판**: a\n- **냉연**: b")
        post "/api/v1/admin/stt_term_learning/terms/delete",
             params: { items: [ { domain_file_id: source.id, term_key: "후판" } ] }, as: :json
        expect(response).to have_http_status(:ok)
        expect(json).to eq("deleted" => 1)
        expect(source.reload.content).to eq("- **냉연**: b")
      end

      it "범위 밖(남의 personal) 파일은 422 + 내용 그대로" do
        hidden = hidden_auto_file("- **후판**: a")
        post "/api/v1/admin/stt_term_learning/terms/delete",
             params: { items: [ { domain_file_id: hidden.id, term_key: "후판" } ] }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json).to eq("error" => "이동할 수 없는 파일입니다")
        expect(hidden.reload.content).to eq("- **후판**: a")
      end

      it "없는 용어는 422" do
        source = auto_file(level.for(child), "- **냉연**: b")
        post "/api/v1/admin/stt_term_learning/terms/delete",
             params: { items: [ { domain_file_id: source.id, term_key: "후판" } ] }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    describe "settings", stt_settings_io: true do
      let(:tmp_dir) { Dir.mktmpdir("stt-learn-settings") }
      let(:tmp_path) { File.join(tmp_dir, "settings.yaml") }

      before { stub_const("AppSettings::SETTINGS_PATH", tmp_path) }
      after { FileUtils.remove_entry(tmp_dir) if File.exist?(tmp_dir) }

      it "GET 은 기본값" do
        get "/api/v1/admin/stt_term_learning/settings"
        expect(response).to have_http_status(:ok)
        expect(json).to eq("enabled" => true, "idle_minutes" => 30, "min_confidence" => 0.6)
      end

      it "PUT 은 tmp settings.yaml 에 3키만 저장하고 클램프·불리언 캐스트를 반영해 돌려준다" do
        File.write(tmp_path, { "whiteboard" => { "web_mode" => "copy" } }.to_yaml)

        put "/api/v1/admin/stt_term_learning/settings",
            params: { enabled: "false", idle_minutes: 1, min_confidence: 0.5, evil: "x" }, as: :json

        expect(response).to have_http_status(:ok)
        expect(json).to eq("enabled" => false, "idle_minutes" => 5, "min_confidence" => 0.5)
        saved = YAML.safe_load(File.read(tmp_path))
        expect(saved["whiteboard"]).to eq("web_mode" => "copy")
        expect(saved["stt_term_learning"].keys).to contain_exactly("enabled", "idle_minutes", "min_confidence")
        expect(saved["stt_term_learning"]["enabled"]).to eq(false)

        get "/api/v1/admin/stt_term_learning/settings"
        expect(json["enabled"]).to eq(false)
      end
    end
  end
end
