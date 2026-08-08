require "rails_helper"

RSpec.describe "Api::V1::Search", type: :request do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }

  before { login_as(user) }

  # ─────────────────────────────────────────────────────────
  # GET /api/v1/search
  # ─────────────────────────────────────────────────────────
  describe "GET /api/v1/search" do
    let!(:meeting) { create(:meeting, project: project, creator: user, title: "주간 회의") }

    context "트랜스크립트 검색" do
      before do
        create(:transcript, meeting: meeting, content: "프로젝트 일정을 논의합니다", speaker_label: "SPEAKER_00")
        create(:transcript, meeting: meeting, content: "예산 관련 이야기입니다", speaker_label: "SPEAKER_01")
      end

      it "키워드로 트랜스크립트를 검색한다" do
        get "/api/v1/search", params: { q: "프로젝트" }
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        expect(json["total"]).to eq(1)
        expect(json["results"].first["type"]).to eq("transcript")
        expect(json["results"].first["meeting_id"]).to eq(meeting.id)
        expect(json["results"].first["meeting_title"]).to eq("주간 회의")
        expect(json["results"].first["snippet"]).to include("프로젝트")
      end

      it "화자 필터로 검색 결과를 제한한다" do
        get "/api/v1/search", params: { q: "프로젝트", speaker: "SPEAKER_01" }
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        expect(json["total"]).to eq(0)
      end

      it "화자 이름으로 화자 필터가 매칭된다 (exact match)" do
        create(:transcript, meeting: meeting, content: "프로젝트 마감 임박",
               speaker_label: "SPEAKER_02", speaker_name: "앨리스")

        get "/api/v1/search", params: { q: "프로젝트", speaker: "앨리스" }

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["total"]).to eq(1)
        expect(json["results"].first["speaker"]).to eq("앨리스")
      end

      it "라벨 필터도 계속 동작하고 결과 speaker는 표시 이름을 반환한다" do
        create(:transcript, meeting: meeting, content: "프로젝트 회고 진행",
               speaker_label: "SPEAKER_03", speaker_name: "밥")

        get "/api/v1/search", params: { q: "프로젝트", speaker: "SPEAKER_03" }

        json = response.parsed_body
        expect(json["total"]).to eq(1)
        expect(json["results"].first["speaker"]).to eq("밥")
      end

      it "이름이 없으면 결과 speaker는 라벨을 반환한다" do
        get "/api/v1/search", params: { q: "프로젝트", speaker: "SPEAKER_00" }

        json = response.parsed_body
        expect(json["total"]).to eq(1)
        expect(json["results"].first["speaker"]).to eq("SPEAKER_00")
      end
    end

    context "요약 검색" do
      before do
        create(:summary, meeting: meeting, notes_markdown: "프로젝트 킥오프 회의록입니다")
      end

      it "키워드로 요약을 검색한다" do
        get "/api/v1/search", params: { q: "킥오프" }
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        expect(json["total"]).to eq(1)
        expect(json["results"].first["type"]).to eq("summary")
        expect(json["results"].first["snippet"]).to include("킥오프")
      end
    end

    context "통합 검색 (트랜스크립트 + 요약)" do
      before do
        create(:transcript, meeting: meeting, content: "디자인 리뷰를 진행합니다", speaker_label: "SPEAKER_00")
        create(:summary, meeting: meeting, notes_markdown: "디자인 리뷰 결과 정리")
      end

      it "두 종류 모두 반환한다" do
        get "/api/v1/search", params: { q: "디자인" }
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        expect(json["total"]).to eq(2)
        types = json["results"].map { |r| r["type"] }
        expect(types).to include("transcript", "summary")
      end
    end

    context "필터" do
      let(:folder) { create(:folder, project: project) }
      let!(:meeting_in_folder) { create(:meeting, project: project, creator: user, folder: folder) }
      let!(:completed_meeting) { create(:meeting, project: project, creator: user, status: "completed") }

      before do
        create(:transcript, meeting: meeting_in_folder, content: "폴더 안의 내용입니다", speaker_label: "SPEAKER_00")
        create(:transcript, meeting: completed_meeting, content: "완료된 회의 내용입니다", speaker_label: "SPEAKER_00")
        create(:transcript, meeting: meeting, content: "일반 내용입니다", speaker_label: "SPEAKER_00")
      end

      it "folder_id 필터로 검색 범위를 제한한다" do
        get "/api/v1/search", params: { q: "내용", folder_id: folder.id }
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        expect(json["total"]).to eq(1)
        expect(json["results"].first["meeting_id"]).to eq(meeting_in_folder.id)
      end

      it "status 필터로 검색 범위를 제한한다" do
        get "/api/v1/search", params: { q: "내용", status: "completed" }
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        expect(json["total"]).to eq(1)
        expect(json["results"].first["meeting_id"]).to eq(completed_meeting.id)
      end

      it "date_from, date_to 필터로 검색 범위를 제한한다" do
        future_meeting = create(:meeting, project: project, creator: user, created_at: 3.days.from_now)
        create(:transcript, meeting: future_meeting, content: "미래 내용입니다", speaker_label: "SPEAKER_00")

        get "/api/v1/search", params: { q: "내용", date_from: Date.today.to_s, date_to: Date.today.to_s }
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        meeting_ids = json["results"].map { |r| r["meeting_id"] }
        expect(meeting_ids).not_to include(future_meeting.id)
      end
    end

    # SearchService: 필터가 하나도 없으면 SQLite에 넘기던 거대 IN(pluck한 전체 접근가능
    # meeting_id) 목록을 FTS 서브쿼리(IN (SELECT id FROM meetings WHERE ...))로 대체했다.
    # 결과 집합이 기존과 동일한지(여러 프로젝트·폴더에 걸친 회의를 모두 포함, soft-delete는
    # 계속 제외) 회귀 방지용으로 고정한다.
    context "무필터(전건) 검색 — pluck+거대 IN → FTS 서브쿼리 재작성 회귀 방지" do
      let(:other_project) { create(:project, creator: user) }
      let!(:other_membership) { create(:project_membership, user: user, project: other_project, role: "admin") }
      let!(:folder) { create(:folder, project: project) }
      let!(:meeting_in_folder) { create(:meeting, project: project, creator: user, folder: folder) }
      let!(:meeting_other_project) { create(:meeting, project: other_project, creator: user) }
      let!(:deleted_meeting) { create(:meeting, project: project, creator: user) }

      before do
        create(:transcript, meeting: meeting, content: "무필터매칭 기본 회의", speaker_label: "SPEAKER_00")
        create(:transcript, meeting: meeting_in_folder, content: "무필터매칭 폴더 회의", speaker_label: "SPEAKER_00")
        create(:transcript, meeting: meeting_other_project, content: "무필터매칭 다른 프로젝트 회의", speaker_label: "SPEAKER_00")
        create(:transcript, meeting: deleted_meeting, content: "무필터매칭 삭제된 회의", speaker_label: "SPEAKER_00")
        deleted_meeting.update_columns(deleted_at: Time.current)
      end

      it "필터 없이도 여러 프로젝트·폴더에 걸친 접근가능 회의를 모두 반환한다" do
        get "/api/v1/search", params: { q: "무필터매칭" }
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        meeting_ids = json["results"].map { |r| r["meeting_id"] }
        expect(meeting_ids).to contain_exactly(meeting.id, meeting_in_folder.id, meeting_other_project.id)
      end

      it "soft-delete된 회의는 필터 없이도 계속 제외된다" do
        get "/api/v1/search", params: { q: "무필터매칭" }

        json = response.parsed_body
        meeting_ids = json["results"].map { |r| r["meeting_id"] }
        expect(meeting_ids).not_to include(deleted_meeting.id)
      end

      # 서브쿼리를 raw SQL에 문자열로 박아넣으면서, 필터 값(사용자 입력)에 리터럴 "?"가 들어있으면
      # sanitize_sql_array의 순진한 gsub(/\?/) 바인딩과 충돌할 위험이 생긴다. status는
      # ActiveRecord enum이 아니라 permit된 사용자 입력 문자열을 그대로 .where(status: ...)에
      # 태우므로, 매치되는 값이 없어 빈 결과가 되더라도 500(바인드 개수 불일치)이 나면 안 된다.
      it "필터 값에 물음표(?)가 섞여도 깨지지 않는다(바인드 매칭 오염 회귀 방지)" do
        get "/api/v1/search", params: { q: "무필터매칭", status: "abc?def", speaker: "누구?" }
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        expect(json["total"]).to eq(0)
      end
    end

    context "페이지네이션" do
      before do
        25.times do |i|
          create(:transcript, meeting: meeting, content: "검색 대상 문서 #{i}", speaker_label: "SPEAKER_00")
        end
      end

      it "기본 per_page=20으로 페이지네이션한다" do
        get "/api/v1/search", params: { q: "검색" }
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        expect(json["total"]).to eq(25)
        expect(json["results"].length).to eq(20)
        expect(json["page"]).to eq(1)
        expect(json["per_page"]).to eq(20)
      end

      it "2페이지를 요청하면 나머지를 반환한다" do
        get "/api/v1/search", params: { q: "검색", page: 2 }
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        expect(json["results"].length).to eq(5)
        expect(json["page"]).to eq(2)
      end
    end

    context "빈 쿼리" do
      it "q가 빈 문자열이면 빈 결과를 반환한다" do
        get "/api/v1/search", params: { q: "" }
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        expect(json["total"]).to eq(0)
        expect(json["results"]).to eq([])
      end

      it "q가 없으면 빈 결과를 반환한다" do
        get "/api/v1/search"
        expect(response).to have_http_status(:ok)

        json = response.parsed_body
        expect(json["total"]).to eq(0)
      end
    end

    context "응답 형식" do
      before do
        create(:transcript, meeting: meeting, content: "응답 형식 테스트 내용", speaker_label: "SPEAKER_00")
      end

      it "올바른 응답 구조를 반환한다" do
        get "/api/v1/search", params: { q: "응답" }

        json = response.parsed_body
        result = json["results"].first

        expect(result).to have_key("meeting_id")
        expect(result).to have_key("meeting_title")
        expect(result).to have_key("type")
        expect(result).to have_key("snippet")
        expect(result).to have_key("speaker")
        expect(result).to have_key("created_at")
      end
    end
  end
end
