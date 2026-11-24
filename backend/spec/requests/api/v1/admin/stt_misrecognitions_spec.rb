require "rails_helper"

RSpec.describe "Api::V1::Admin::SttMisrecognitions", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:member) { create(:user) }
  let(:project) { create(:project, creator: admin) }
  let(:folder) { create(:folder, project: project) }
  let(:level) { SttTermLearning::Level }

  def json = response.parsed_body

  def mis(wrong, correct, **attrs)
    create(:stt_misrecognition, project: project, wrong: wrong, correct: correct, **attrs)
  end

  context "server mode" do
    include_context "server mode"

    it "비관리자 403" do
      login_as(member)
      get "/api/v1/admin/stt_term_learning/misrecognitions"
      expect(response).to have_http_status(:forbidden)
      record = mis("우판", "후판")
      patch "/api/v1/admin/stt_term_learning/misrecognitions/#{record.id}", params: { status: "excluded" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "as admin" do
    before { login_as(admin) }

    describe "GET misrecognitions" do
      it "계약 키·counts, 남의 personal 프로젝트는 뺀다" do
        meeting = create(:meeting, project: project)
        record = mis("우판", "후판", status: "confirmed", hit_count: 2, last_seen_at: Time.current,
                     first_meeting: meeting, last_meeting: meeting)
        mis("냉현", "냉연")
        hidden_project = create(:project, creator: create(:user), personal: true)
        create(:stt_misrecognition, project: hidden_project, wrong: "숨김", correct: "숨김2")

        get "/api/v1/admin/stt_term_learning/misrecognitions"

        expect(response).to have_http_status(:ok)
        expect(json["counts"]).to eq("total" => 2, "undecided" => 1)
        expect(json["misrecognitions"].map { |m| m["wrong"] }).to contain_exactly("우판", "냉현")
        m = json["misrecognitions"].find { |x| x["id"] == record.id }
        expect(m.keys).to contain_exactly("id", "wrong", "correct", "status", "hit_count", "meeting_ids", "registered",
                                          "last_seen_at")
        expect(m).to include("correct" => "후판", "status" => "confirmed", "hit_count" => 2, "meeting_ids" => [ meeting.id ],
                             "registered" => nil)
        expect(m["last_seen_at"]).to be_present
      end

      it "status 필터" do
        mis("우판", "후판", status: "excluded")
        mis("냉현", "냉연")
        get "/api/v1/admin/stt_term_learning/misrecognitions", params: { status: "excluded" }
        expect(json["misrecognitions"].map { |m| m["wrong"] }).to eq([ "우판" ])
        expect(json["counts"]).to eq("total" => 2, "undecided" => 1)
      end

      it "q 에 '%' 가 들어가도 리터럴 매치(wrong·correct 둘 다)" do
        mis("50%할인", "오십퍼센트")
        mis("50할인", "오십")
        mis("abc", "x_y")
        mis("abc2", "xzy")

        get "/api/v1/admin/stt_term_learning/misrecognitions", params: { q: "0%" }
        expect(json["misrecognitions"].map { |m| m["wrong"] }).to eq([ "50%할인" ])

        get "/api/v1/admin/stt_term_learning/misrecognitions", params: { q: "x_" }
        expect(json["misrecognitions"].map { |m| m["wrong"] }).to eq([ "abc" ])
      end

      it "registered = 최신 적용 item 위치" do
        meeting = create(:meeting, project: project, folder: folder)
        file = SttTermLearning::AutoDomainFile.find_or_create_for!(level.for(folder), fallback_creator: admin)
        file.update!(content: "- **후판** [STT] (오인식: 우판): 강판")
        record = mis("우판", "후판", status: "confirmed")
        run = create(:stt_term_learning_run, meeting: meeting, status: "done", finished_at: Time.current)
        create(:stt_term_learning_item, run: run, domain_file: file, misrecognition: record,
               level_owner_type: "Folder", level_owner_id: folder.id)

        get "/api/v1/admin/stt_term_learning/misrecognitions"

        m = json["misrecognitions"].find { |x| x["id"] == record.id }
        expect(m["registered"]).to eq("domain_file_id" => file.id, "term_key" => "후판", "auto" => true,
                                      "level" => { "type" => "Folder", "id" => folder.id, "name" => folder.name,
                                                   "path" => [ project.name, folder.name ] })
      end
    end

    describe "PATCH misrecognitions/:id" do
      it "confirmed + last_meeting 없음 → 프로젝트 레벨 자동 파일에 등록, registered 를 돌려주고 목록에도 남는다" do
        record = mis("우판", "후판")

        patch "/api/v1/admin/stt_term_learning/misrecognitions/#{record.id}", params: { status: "confirmed" }, as: :json

        expect(response).to have_http_status(:ok)
        file = SttTermLearning::AutoDomainFile.find_for(level.for(project))
        expect(file.content).to include("**후판**")
        expected = { "domain_file_id" => file.id, "term_key" => "후판", "auto" => true,
                     "level" => { "type" => "Project", "id" => project.id, "name" => project.name, "path" => [ project.name ] } }
        expect(json["misrecognition"]).to include("id" => record.id, "status" => "confirmed", "registered" => expected)
        expect(record.reload.status).to eq("confirmed")

        get "/api/v1/admin/stt_term_learning/misrecognitions"
        expect(json["misrecognitions"].find { |x| x["id"] == record.id }["registered"]).to eq(expected)
      end

      it "confirmed + last_meeting 있음 → 그 회의 폴더 레벨에 등록" do
        meeting = create(:meeting, project: project, folder: folder)
        record = mis("우판", "후판", last_meeting: meeting)

        patch "/api/v1/admin/stt_term_learning/misrecognitions/#{record.id}", params: { status: "confirmed" }, as: :json

        expect(response).to have_http_status(:ok)
        expect(json["misrecognition"]["registered"]["level"]).to include("type" => "Folder", "id" => folder.id)
      end

      it "correct 를 함께 바꾸면 바뀐 용어로 등록" do
        record = mis("우판", "후반")
        patch "/api/v1/admin/stt_term_learning/misrecognitions/#{record.id}",
              params: { status: "confirmed", correct: "후판" }, as: :json
        expect(response).to have_http_status(:ok)
        expect(json["misrecognition"]).to include("correct" => "후판")
        expect(json["misrecognition"]["registered"]["term_key"]).to eq("후판")
        expect(record.reload.correct_key).to eq("후판")
      end

      it "excluded 로 바꾸면 등록하지 않는다" do
        record = mis("우판", "후판")
        patch "/api/v1/admin/stt_term_learning/misrecognitions/#{record.id}", params: { status: "excluded" }, as: :json
        expect(response).to have_http_status(:ok)
        expect(json["misrecognition"]).to include("status" => "excluded", "registered" => nil)
        expect(SttTermLearning::AutoDomainFile.find_for(level.for(project))).to be_nil
      end

      describe "excluded 로 바꾸면 등록 위치에서 그 변형을 뺀다(I2)" do
        let(:meeting) { create(:meeting, project: project, folder: folder) }

        def applied_item(file, record)
          run = create(:stt_term_learning_run, meeting: meeting, status: "done", finished_at: Time.current)
          create(:stt_term_learning_item, run: run, domain_file: file, misrecognition: record,
                 level_owner_type: "Folder", level_owner_id: folder.id)
        end

        it "자동 파일 줄에 다른 변형도 있으면 이 변형만 빼고 줄은 남긴다" do
          file = SttTermLearning::AutoDomainFile.find_or_create_for!(level.for(folder), fallback_creator: admin)
          file.update!(content: "- **후판** [STT] (오인식: 우판, 후반): 강판\n- **냉연** [STT] (오인식: 냉현): 냉간")
          record = mis("우판", "후판", status: "confirmed", last_meeting: meeting)
          applied_item(file, record)

          patch "/api/v1/admin/stt_term_learning/misrecognitions/#{record.id}", params: { status: "excluded" }, as: :json

          expect(response).to have_http_status(:ok)
          expect(json["misrecognition"]).to include("status" => "excluded", "registered" => nil)
          expect(file.reload.content).to eq("- **후판** [STT] (오인식: 후반): 강판\n- **냉연** [STT] (오인식: 냉현): 냉간")
          get "/api/v1/admin/stt_term_learning/misrecognitions"
          expect(json["misrecognitions"].find { |x| x["id"] == record.id }["registered"]).to be_nil
        end

        it "자동 파일의 새 줄이고 변형이 이것 하나면 줄 전체를 지운다" do
          file = SttTermLearning::AutoDomainFile.find_or_create_for!(level.for(folder), fallback_creator: admin)
          file.update!(content: "- **냉연** [STT] (오인식: 냉현): 냉간\n- **후판** [STT] (오인식: 우판): 강판")
          record = mis("우판", "후판", status: "confirmed", last_meeting: meeting)
          applied_item(file, record)

          patch "/api/v1/admin/stt_term_learning/misrecognitions/#{record.id}", params: { status: "excluded" }, as: :json

          expect(response).to have_http_status(:ok)
          expect(json["misrecognition"]).to include("status" => "excluded", "registered" => nil)
          expect(file.reload.content).to eq("- **냉연** [STT] (오인식: 냉현): 냉간")
        end

        it "사람 파일 줄은 그 변형만 빼고 줄(용어·분류·설명·다른 줄)은 그대로" do
          human = create(:domain_file, content: "# 제강\n- **후판** [설비] (오인식: 우판): 두꺼운 강판\n- **냉연**: 냉간 압연")
          DomainFileLink.create!(owner: folder, domain_file: human)
          record = mis("우판", "후판", status: "confirmed", last_meeting: meeting)

          get "/api/v1/admin/stt_term_learning/misrecognitions"
          expect(json["misrecognitions"].find { |x| x["id"] == record.id }["registered"])
            .to include("domain_file_id" => human.id, "auto" => false)

          patch "/api/v1/admin/stt_term_learning/misrecognitions/#{record.id}", params: { status: "excluded" }, as: :json

          expect(response).to have_http_status(:ok)
          expect(json["misrecognition"]).to include("status" => "excluded", "registered" => nil)
          expect(human.reload.content).to eq("# 제강\n- **후판** [설비]: 두꺼운 강판\n- **냉연**: 냉간 압연")
        end

        it "등록된 적 없는 미정 기록을 excluded 로 바꿔도 파일은 그대로" do
          human = create(:domain_file, content: "- **후판** (오인식: 우판): 강판")
          DomainFileLink.create!(owner: folder, domain_file: human)
          record = mis("우판", "후판", status: "undecided", last_meeting: meeting)

          patch "/api/v1/admin/stt_term_learning/misrecognitions/#{record.id}", params: { status: "excluded" }, as: :json

          expect(response).to have_http_status(:ok)
          expect(human.reload.content).to eq("- **후판** (오인식: 우판): 강판")
        end
      end

      it "잘못된 status 는 422" do
        record = mis("우판", "후판")
        patch "/api/v1/admin/stt_term_learning/misrecognitions/#{record.id}", params: { status: "bogus" }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "등록 실패(ManualRegistration::Error)는 422 이고 correct 변경도 롤백" do
        record = mis("우판", "후반")
        allow(SttTermLearning::ManualRegistration).to receive(:register_pair!)
          .and_raise(SttTermLearning::ManualRegistration::Error, "등록하지 못했습니다: skipped_invalid")
        patch "/api/v1/admin/stt_term_learning/misrecognitions/#{record.id}",
              params: { status: "confirmed", correct: "후판" }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json["error"]).to include("등록하지 못했습니다")
        expect(record.reload.correct).to eq("후반")
      end

      it "같은 쌍이 이미 있으면 422" do
        mis("우판", "후판")
        record = mis("우판", "후반")
        patch "/api/v1/admin/stt_term_learning/misrecognitions/#{record.id}",
              params: { status: "undecided", correct: "후판" }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    describe "GET misrecognitions project_id 필터" do
      it "그 프로젝트 기록·counts 만, 숨김 프로젝트는 404, 무파라미터는 전체" do
        project2 = create(:project, creator: admin)
        mine = mis("우판", "후판")
        theirs = create(:stt_misrecognition, project: project2, wrong: "냉현", correct: "냉연")

        get "/api/v1/admin/stt_term_learning/misrecognitions", params: { project_id: project.id }
        expect(response).to have_http_status(:ok)
        expect(json["misrecognitions"].map { |m| m["id"] }).to eq([ mine.id ])
        expect(json["counts"]["total"]).to eq(1)

        get "/api/v1/admin/stt_term_learning/misrecognitions"
        expect(json["misrecognitions"].map { |m| m["id"] }).to include(mine.id, theirs.id)

        hidden = create(:project, creator: create(:user), personal: true)
        get "/api/v1/admin/stt_term_learning/misrecognitions", params: { project_id: hidden.id }
        expect(response).to have_http_status(:not_found)
      end
    end
  end
end
