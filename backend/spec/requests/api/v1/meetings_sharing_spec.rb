require "rails_helper"

# 회의 공유/비공개 (#6)
#
# 공유 범위 = 전체 로그인 사용자.
#  - shared=true  → 임의 로그인 사용자가 열람 가능(수정·삭제는 본인 소유만)
#  - shared=false → 소유자(+admin)만 열람·수정·삭제
#  - admin        → god-mode (비공개 포함 전체)
#  - 생성 기본 shared=true
RSpec.describe "Api::V1::Meetings 공유/비공개", type: :request do
  let(:user)       { create(:user) }
  let(:other_user) { create(:user) }
  let(:admin)      { create(:user, :admin) }

  # 공유 가시성은 같은 프로젝트 멤버 사이에서만 성립한다(Phase 4 프로젝트 격리).
  # 현실 시나리오 = user·other_user 가 한 프로젝트의 멤버이고 그 안에서 회의를 공유한다.
  # 회의 팩토리가 각 creator 를 멤버로 자동등록하므로, 뷰어(user)도 명시적으로 멤버로 둔다.
  let(:project) { create(:project) }
  let!(:user_membership) { create(:project_membership, user: user, project: project, role: "member") }

  let!(:own_private) { create(:meeting, :private_meeting, project: project, creator: user, title: "내 비공개") }
  let!(:own_shared)  { create(:meeting, project: project, creator: user, shared: true, title: "내 공유") }
  let!(:foreign_private) { create(:meeting, :private_meeting, project: project, creator: other_user, title: "남 비공개") }
  let!(:foreign_shared)  { create(:meeting, project: project, creator: other_user, shared: true, title: "남 공유") }

  # ============================================================
  # 가시성 매트릭스
  # ============================================================
  describe "가시성 (index / show)" do
    context "비-admin 사용자" do
      before { login_as(user) }

      it "index: 본인 private+shared, 타인 shared 는 보이고, 타인 private 은 제외" do
        get "/api/v1/meetings"

        titles = response.parsed_body["meetings"].map { |m| m["title"] }
        expect(titles).to include("내 비공개", "내 공유", "남 공유")
        expect(titles).not_to include("남 비공개")
      end

      it "index meta.total 은 타인 shared 회의를 포함한다" do
        get "/api/v1/meetings"
        # own_private + own_shared + foreign_shared = 3 (foreign_private 제외)
        expect(response.parsed_body["meta"]["total"]).to eq(3)
      end

      it "status_counts(대시보드) 는 타인 shared 회의를 집계한다" do
        # 본인 회의엔 completed 없음 → foreign_shared 만 completed 로 두면 count=1
        foreign_shared.update!(status: "completed")
        get "/api/v1/meetings"
        counts = response.parsed_body["meta"]["status_counts"]
        expect(counts["completed"]).to eq(1)
        expect(counts["pending"]).to eq(2) # own_private + own_shared
      end

      it "show: 본인 private 200" do
        get "/api/v1/meetings/#{own_private.id}"
        expect(response).to have_http_status(:ok)
      end

      it "show: 타인 shared 200" do
        get "/api/v1/meetings/#{foreign_shared.id}"
        expect(response).to have_http_status(:ok)
      end

      it "show: 타인 private 403" do
        get "/api/v1/meetings/#{foreign_private.id}"
        expect(response).to have_http_status(:forbidden)
      end
    end

    context "admin 사용자" do
      before { login_as(admin) }

      it "index: 타인 private 포함 전체를 본다" do
        get "/api/v1/meetings"
        titles = response.parsed_body["meetings"].map { |m| m["title"] }
        expect(titles).to include("내 비공개", "내 공유", "남 비공개", "남 공유")
      end

      it "show: 타인 private 200" do
        get "/api/v1/meetings/#{foreign_private.id}"
        expect(response).to have_http_status(:ok)
      end
    end
  end

  # ============================================================
  # 폴더 공유 우선순위 (추가요청 #2): 유효 가시성 = meetings.shared AND folders.shared
  # 폴더를 비공개로 두면 안의 회의는 개별 shared 여부와 무관하게 타인에게 안 보인다.
  # ============================================================
  describe "폴더 공유 우선순위" do
    let!(:private_folder) { create(:folder, shared: false) }
    let!(:shared_folder)  { create(:folder, shared: true) }

    context "비-admin 사용자" do
      before { login_as(user) }

      it "index: 타인 shared 회의라도 비공개 폴더에 있으면 제외" do
        foreign_shared.update!(folder: private_folder)
        get "/api/v1/meetings"
        titles = response.parsed_body["meetings"].map { |m| m["title"] }
        expect(titles).not_to include("남 공유")
      end

      it "show: 타인 shared 회의가 비공개 폴더면 403" do
        foreign_shared.update!(folder: private_folder)
        get "/api/v1/meetings/#{foreign_shared.id}"
        expect(response).to have_http_status(:forbidden)
      end

      it "show: 타인 shared 회의가 공유 폴더면 200" do
        foreign_shared.update!(folder: shared_folder)
        get "/api/v1/meetings/#{foreign_shared.id}"
        expect(response).to have_http_status(:ok)
      end

      it "show: 본인 회의는 비공개 폴더여도 본인에겐 보인다(소유자 우선)" do
        own_shared.update!(folder: private_folder)
        get "/api/v1/meetings/#{own_shared.id}"
        expect(response).to have_http_status(:ok)
      end
    end

    context "admin 사용자" do
      before { login_as(admin) }

      it "show: 비공개 폴더의 타인 회의도 본다(god-mode)" do
        foreign_shared.update!(folder: private_folder)
        get "/api/v1/meetings/#{foreign_shared.id}"
        expect(response).to have_http_status(:ok)
      end
    end
  end

  # ============================================================
  # 직렬화: shared / editable 필드
  # ============================================================
  describe "직렬화 필드" do
    before { login_as(user) }

    it "본인 회의는 editable=true, shared 값 노출" do
      get "/api/v1/meetings/#{own_shared.id}"
      json = response.parsed_body["meeting"]
      expect(json["shared"]).to eq(true)
      expect(json["editable"]).to eq(true)
    end

    it "타인 shared 회의는 editable=false" do
      get "/api/v1/meetings/#{foreign_shared.id}"
      json = response.parsed_body["meeting"]
      expect(json["shared"]).to eq(true)
      expect(json["editable"]).to eq(false)
    end
  end

  # ============================================================
  # 수정 권한 (update / destroy)
  # ============================================================
  describe "수정/삭제 권한" do
    it "비소유자는 타인 shared 회의를 PATCH 할 수 없다(403)" do
      login_as(other_user) # foreign_shared 소유자가 아닌 제3자 관점: user 의 회의로 검증
      patch "/api/v1/meetings/#{own_shared.id}", params: { title: "해킹" }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(own_shared.reload.title).not_to eq("해킹")
    end

    it "비소유자는 타인 shared 회의를 DELETE 할 수 없다(403)" do
      login_as(other_user)
      expect {
        delete "/api/v1/meetings/#{own_shared.id}"
      }.not_to change(Meeting, :count)
      expect(response).to have_http_status(:forbidden)
    end

    it "소유자는 본인 회의를 PATCH 할 수 있다(200)" do
      login_as(user)
      patch "/api/v1/meetings/#{own_shared.id}", params: { title: "새 제목" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(own_shared.reload.title).to eq("새 제목")
    end

    it "소유자는 본인 회의를 DELETE(소프트 삭제) 할 수 있다(204)" do
      login_as(user)
      target = create(:meeting, creator: user)
      delete "/api/v1/meetings/#{target.id}"
      expect(response).to have_http_status(:no_content)
      expect(target.reload.trashed?).to be true
    end

    it "admin 은 타인 회의를 PATCH 할 수 있다(200)" do
      login_as(admin)
      patch "/api/v1/meetings/#{foreign_private.id}", params: { title: "관리자수정" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(foreign_private.reload.title).to eq("관리자수정")
    end

    it "admin 은 타인 회의를 DELETE(소프트 삭제) 할 수 있다(204)" do
      login_as(admin)
      target = create(:meeting, creator: other_user)
      delete "/api/v1/meetings/#{target.id}"
      expect(response).to have_http_status(:no_content)
      expect(target.reload.trashed?).to be true
    end
  end

  # ============================================================
  # shared 파라미터
  # ============================================================
  describe "shared 파라미터" do
    before { login_as(user) }

    it "create 는 기본 shared=true 로 생성된다" do
      post "/api/v1/meetings", params: { title: "기본", project_id: project.id }, as: :json
      expect(response).to have_http_status(:created)
      expect(Meeting.last.shared).to eq(true)
      expect(response.parsed_body["meeting"]["shared"]).to eq(true)
    end

    it "create shared:false 면 비공개로 저장된다" do
      post "/api/v1/meetings", params: { title: "비공개생성", project_id: project.id, shared: false }, as: :json
      expect(response).to have_http_status(:created)
      expect(Meeting.last.shared).to eq(false)
    end

    it "소유자는 update 로 shared 를 토글할 수 있다" do
      patch "/api/v1/meetings/#{own_shared.id}", params: { shared: false }, as: :json
      expect(response).to have_http_status(:ok)
      expect(own_shared.reload.shared).to eq(false)
    end

    it "비소유 host 의 update 는 shared 변경을 무시한다" do
      # foreign_shared(타인 소유)에 user 를 host 로 참여시킴 → control 권한은 host 로 통과하지만
      # shared 변경은 editable_by?(소유/admin) 가 아니므로 무시되어야 한다.
      create(:meeting_participant, meeting: foreign_shared, user: user, role: "host")
      patch "/api/v1/meetings/#{foreign_shared.id}", params: { shared: false }, as: :json
      expect(response).to have_http_status(:ok)
      expect(foreign_shared.reload.shared).to eq(true)
    end
  end

  # ============================================================
  # move_to_folder: 타인 회의 미이동
  # ============================================================
  describe "move_to_folder" do
    # 폴더는 회의와 같은 프로젝트여야 한다(교차 프로젝트 이동은 Phase 4 가드가 403).
    let(:folder) { create(:folder, project: project) }

    before { login_as(user) }

    it "타인 shared 회의는 일괄 폴더이동 대상에서 제외된다" do
      post "/api/v1/meetings/move_to_folder",
           params: { meeting_ids: [ foreign_shared.id ], folder_id: folder.id }
      expect(foreign_shared.reload.folder_id).to be_nil
    end

    it "본인 회의는 일괄 폴더이동된다" do
      post "/api/v1/meetings/move_to_folder",
           params: { meeting_ids: [ own_shared.id ], folder_id: folder.id }
      expect(own_shared.reload.folder_id).to eq(folder.id)
    end
  end

  # ============================================================
  # 중첩 mutating 권한 매트릭스 (R1: privilege escalation 방지)
  #   타인 shared 회의: read 는 200, 모든 mutating 은 403
  # ============================================================
  describe "중첩 mutating 권한 (타인 shared 회의)" do
    before { login_as(user) }

    it "action_items create 403 (read index 는 200)" do
      get "/api/v1/meetings/#{foreign_shared.id}/action_items"
      expect(response).to have_http_status(:ok)

      post "/api/v1/meetings/#{foreign_shared.id}/action_items",
           params: { action_item: { content: "해킹 액션" } }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "decisions create 403 (read index 는 200)" do
      get "/api/v1/meetings/#{foreign_shared.id}/decisions"
      expect(response).to have_http_status(:ok)

      post "/api/v1/meetings/#{foreign_shared.id}/decisions",
           params: { decision: { content: "해킹 결정" } }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "transcripts destroy_batch 403" do
      t = create(:transcript, meeting: foreign_shared, sequence_number: 1)
      delete "/api/v1/meetings/#{foreign_shared.id}/transcripts/destroy_batch",
             params: { ids: [ t.id ] }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(foreign_shared.transcripts.count).to eq(1)
    end

    it "transcripts update_content 403" do
      t = create(:transcript, meeting: foreign_shared, sequence_number: 1, content: "원본")
      patch "/api/v1/meetings/#{foreign_shared.id}/transcripts/#{t.id}/update_content",
            params: { content: "변조" }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(t.reload.content).to eq("원본")
    end

    it "transcripts bulk_create 403" do
      post "/api/v1/meetings/#{foreign_shared.id}/transcripts/bulk",
           params: { transcripts: [ { content: "x", sequence_number: 1, started_at_ms: 0, ended_at_ms: 1 } ] },
           as: :json
      expect(response).to have_http_status(:forbidden)
      expect(foreign_shared.transcripts.count).to eq(0)
    end

    it "blocks create 403" do
      post "/api/v1/meetings/#{foreign_shared.id}/blocks",
           params: { block: { block_type: "text", content: "해킹" } }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(foreign_shared.blocks.count).to eq(0)
    end

    it "attachments create 403 (read index 는 200)" do
      get "/api/v1/meetings/#{foreign_shared.id}/attachments"
      expect(response).to have_http_status(:ok)

      post "/api/v1/meetings/#{foreign_shared.id}/attachments",
           params: { url: "https://example.com", category: "reference" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "audio create 403 (read show 는 별개)" do
      # authorize_meeting_control! 가 params.require(:audio) 보다 먼저 실행되므로
      # 파일 없이도 403 이 떨어진다.
      post "/api/v1/meetings/#{foreign_shared.id}/audio"
      expect(response).to have_http_status(:forbidden)
    end

    it "feedback 403" do
      post "/api/v1/meetings/#{foreign_shared.id}/feedback",
           params: { corrections: [ { from: "a", to: "b" } ] }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "동일 read(transcripts index) 는 200" do
      get "/api/v1/meetings/#{foreign_shared.id}/transcripts"
      expect(response).to have_http_status(:ok)
    end
  end

  # ============================================================
  # 최상위 action_items / decisions update·destroy (#6 R1 보강)
  #   비소유자는 타인 shared 회의의 항목 ID를 index 로 수집할 수 있으므로,
  #   회의 단위 제어 인가 없이 최상위 PATCH/DELETE 가 열려 있으면 권한상승이다.
  # ============================================================
  describe "최상위 action_items / decisions 변조 권한 (타인 shared 회의)" do
    before { login_as(user) }

    it "action_items#update 403 (내용 불변)" do
      ai = create(:action_item, meeting: foreign_shared, content: "원본")
      patch "/api/v1/action_items/#{ai.id}", params: { action_item: { content: "변조" } }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(ai.reload.content).to eq("원본")
    end

    it "action_items#destroy 403 (삭제 안 됨)" do
      ai = create(:action_item, meeting: foreign_shared)
      expect { delete "/api/v1/action_items/#{ai.id}" }.not_to change(ActionItem, :count)
      expect(response).to have_http_status(:forbidden)
    end

    it "decisions#update 403 (내용 불변)" do
      d = create(:decision, meeting: foreign_shared, content: "원본")
      patch "/api/v1/decisions/#{d.id}", params: { decision: { content: "변조" } }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(d.reload.content).to eq("원본")
    end

    it "decisions#destroy 403 (삭제 안 됨)" do
      d = create(:decision, meeting: foreign_shared)
      expect { delete "/api/v1/decisions/#{d.id}" }.not_to change(Decision, :count)
      expect(response).to have_http_status(:forbidden)
    end

    it "소유자는 본인 회의 action_item 을 update 할 수 있다(200)" do
      ai = create(:action_item, meeting: own_shared, content: "원본")
      patch "/api/v1/action_items/#{ai.id}", params: { action_item: { content: "수정" } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(ai.reload.content).to eq("수정")
    end
  end

  # ============================================================
  # 북마크: 공유 회의 쓰기는 제어 티어(비소유자 403), 열람은 read-tier
  # ============================================================
  describe "북마크 권한 (타인 shared 회의)" do
    before { login_as(user) }

    it "비소유자 bookmark create 403" do
      post "/api/v1/meetings/#{foreign_shared.id}/bookmarks",
           params: { timestamp_ms: 1000, label: "x" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "비소유자 bookmark destroy 403 (삭제 안 됨)" do
      bm = create(:meeting_bookmark, meeting: foreign_shared)
      expect {
        delete "/api/v1/meetings/#{foreign_shared.id}/bookmarks/#{bm.id}"
      }.not_to change(MeetingBookmark, :count)
      expect(response).to have_http_status(:forbidden)
    end

    it "비소유자도 bookmark index(열람)는 200" do
      get "/api/v1/meetings/#{foreign_shared.id}/bookmarks"
      expect(response).to have_http_status(:ok)
    end

    it "소유자는 bookmark create 가능(201)" do
      post "/api/v1/meetings/#{own_shared.id}/bookmarks",
           params: { timestamp_ms: 1000, label: "x" }, as: :json
      expect(response).to have_http_status(:created)
    end
  end
end
