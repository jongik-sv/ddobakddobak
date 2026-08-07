require "rails_helper"

# 이전 회의 응축(condense_previous_meeting_body) 결과 캐시 — "요약 재생성"이 summaries 를 지우고
# seed_summary_from_previous! 를 다시 태울 때, previous_meeting 이 그대로면 LLM 재호출 없이
# prev_condensed_notes/prev_condensed_digest 컬럼에 저장된 결과를 재사용한다.
RSpec.describe Meeting, type: :model do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:previous) { create(:meeting, project: project, creator: user, status: "completed") }
  let(:meeting)  { create(:meeting, project: project, creator: user, status: "recording", previous_meeting: previous) }

  before do
    create(:summary, meeting: previous, summary_type: "final",
           notes_markdown: "## 지난 회의\n- 결정: A안 채택", generated_at: 1.day.ago)
  end

  describe "캐시 miss (첫 호출)" do
    it "LlmService#condense_previous_notes 를 1회 호출하고 결과를 캐시 컬럼에 저장한다" do
      expect_any_instance_of(LlmService).to receive(:condense_previous_notes).once.and_return("압축본")

      meeting.seed_summary_from_previous!(summary_type: "realtime")
      meeting.reload

      expect(meeting.prev_condensed_notes).to eq("압축본")
      expect(meeting.prev_condensed_digest).to be_present
    end

    it "압축이 nil(실패)이면 캐시 컬럼을 쓰지 않는다" do
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes).and_return(nil)

      meeting.seed_summary_from_previous!(summary_type: "realtime")
      meeting.reload

      expect(meeting.prev_condensed_notes).to be_nil
      expect(meeting.prev_condensed_digest).to be_nil
    end
  end

  describe "캐시 hit (요약 재생성 재현)" do
    it "previous_meeting 이 그대로면 재요약 시 LLM 을 다시 호출하지 않고 캐시를 반환한다" do
      expect_any_instance_of(LlmService).to receive(:condense_previous_notes).once.and_return("압축본")

      meeting.seed_summary_from_previous!(summary_type: "realtime")

      # "요약 재생성"(regenerate_notes/reset_content) 시뮬레이션: summaries 만 지운다.
      meeting.summaries.destroy_all
      meeting.reload

      meeting.seed_summary_from_previous!(summary_type: "final")

      seeded = meeting.summaries.order(:id).last
      expect(seeded.notes_markdown).to include("압축본")
    end

    it "캐시 hit 시 운영 로그를 남긴다" do
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes).and_return("압축본")
      meeting.seed_summary_from_previous!(summary_type: "realtime")
      meeting.summaries.destroy_all
      meeting.reload

      expect(Rails.logger).to receive(:info).with(/condense cache hit meeting=#{meeting.id}/)
      meeting.seed_summary_from_previous!(summary_type: "final")
    end

    it "purge_transcription_content!(요약 재생성이 경유하는 초기화)는 캐시 컬럼을 지우지 않는다" do
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes).and_return("압축본")
      meeting.seed_summary_from_previous!(summary_type: "realtime")
      meeting.reload
      expect(meeting.prev_condensed_notes).to be_present

      meeting.purge_transcription_content!(include_attachments: true)
      meeting.reload

      expect(meeting.prev_condensed_notes).to eq("압축본")
      expect(meeting.prev_condensed_digest).to be_present
    end
  end

  describe "캐시 무효화" do
    it "이전 회의 내용(source)이 바뀌면 캐시를 무효화하고 다시 압축한다" do
      call_count = 0
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes) do
        call_count += 1
        "압축본#{call_count}"
      end

      meeting.seed_summary_from_previous!(summary_type: "realtime")
      meeting.summaries.destroy_all

      previous.summaries.last.update!(notes_markdown: "## 지난 회의\n- 결정: B안 채택")
      meeting.reload

      meeting.seed_summary_from_previous!(summary_type: "final")

      expect(call_count).to eq(2)
      seeded = meeting.summaries.order(:id).last
      expect(seeded.notes_markdown).to include("압축본2")
    end

    it "CONDENSE_CACHE_VERSION 이 오르면(프롬프트 개정) 캐시를 무효화하고 다시 압축한다" do
      call_count = 0
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes) do
        call_count += 1
        "압축본#{call_count}"
      end

      meeting.seed_summary_from_previous!(summary_type: "realtime")
      meeting.summaries.destroy_all
      meeting.reload

      stub_const("Meeting::CONDENSE_CACHE_VERSION", "v2")
      meeting.seed_summary_from_previous!(summary_type: "final")

      expect(call_count).to eq(2)
    end

    it "이전 회의 제목만 바뀌어도(본문 불변) 캐시를 무효화하고 다시 압축한다" do
      # condense_previous_notes 프롬프트가 "회의 제목: <title>"을 실어 응축 출력에 제목이
      # 스며들 수 있으므로, body 가 그대로여도 title 변경은 stale 캐시 재사용을 막아야 한다.
      call_count = 0
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes) do
        call_count += 1
        "압축본#{call_count}"
      end

      meeting.seed_summary_from_previous!(summary_type: "realtime")
      meeting.summaries.destroy_all

      previous.update!(title: "#{previous.title} (개정)")
      meeting.reload

      meeting.seed_summary_from_previous!(summary_type: "final")

      expect(call_count).to eq(2)
      seeded = meeting.summaries.order(:id).last
      expect(seeded.notes_markdown).to include("압축본2")
    end

    it "LLM provider/model 이 바뀌면(모델 변경 후 요약 재생성) 캐시를 무효화하고 다시 압축한다" do
      call_count = 0
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes) do
        call_count += 1
        "압축본#{call_count}"
      end
      # and_return(a, b) 는 allow_any_instance_of 에서 인스턴스별로 순번이 매겨진다 —
      # meeting.reload 후 meeting.creator 는 association 캐시가 비어 새 User 인스턴스를
      # 반환하므로 "그 인스턴스의 첫 호출"로 리셋돼 항상 a 만 반환된다(관찰로 확인). 인스턴스
      # 정체성과 무관하게 두 번째 호출부터 다른 값을 주기 위해 공유 카운터 블록을 쓴다.
      cfg_call_count = 0
      allow_any_instance_of(User).to receive(:effective_llm_config) do
        cfg_call_count += 1
        { provider: "anthropic", model: cfg_call_count == 1 ? "claude-a" : "claude-b" }
      end

      meeting.seed_summary_from_previous!(summary_type: "realtime")
      meeting.summaries.destroy_all
      meeting.reload

      meeting.seed_summary_from_previous!(summary_type: "final")

      expect(call_count).to eq(2)
      seeded = meeting.summaries.order(:id).last
      expect(seeded.notes_markdown).to include("압축본2")
    end
  end
end
