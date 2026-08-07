require "rails_helper"

# 연결 회의(상단 고정 이전 요약)에서 brief_summary(목록 미리보기)가 상단 내용을 보여주지 않고
# 이 회의 자신의 본문만 반영하는지 — Meeting#refresh_brief_summary! 를 거치는 컨트롤러
# 진입점(update_notes 등)까지 end-to-end 로 검증한다.
RSpec.describe "Api::V1::Meetings previous_meeting brief_summary", type: :request do
  let(:owner) { create(:user) }
  let(:project) { create(:project, creator: owner) }
  let(:cut_line) { Meeting::PREVIOUS_MEETING_CUT_LINE }
  let!(:meeting) { create(:meeting, project: project, creator: owner) }

  before { login_as(owner) }

  describe "PATCH update_notes" do
    it "상단 고정 블록을 포함한 전체 문서를 저장해도 brief_summary 는 본문만 반영한다" do
      doc = "## 이전 회의 요약\n\n### 지난 회의\n\n이전 회의 핵심 결정 사항\n\n#{cut_line}\n\n" \
            "# 현재 회의\n\n오늘 새로 논의한 안건 내용"

      patch "/api/v1/meetings/#{meeting.id}/update_notes", params: { notes_markdown: doc }

      expect(response).to have_http_status(:ok)
      meeting.reload
      expect(meeting.brief_summary).to include("오늘 새로 논의한 안건")
      expect(meeting.brief_summary).not_to include("이전 회의 핵심 결정")
    end
  end
end
