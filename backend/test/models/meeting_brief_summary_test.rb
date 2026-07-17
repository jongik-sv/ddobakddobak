require "test_helper"

# extract_brief_summary는 DB를 쓰지 않는 순수 텍스트 함수 — 인용 마커 제거를 검증한다.
class MeetingBriefSummaryTest < ActiveSupport::TestCase
  test "인용 마커를 제거하고 요약 텍스트만 남긴다" do
    notes = <<~MD
      # 회의 요약
      APS와 MES 통합에 따른 3개월 롤링 계획 웹 버전 구현 ⟦t:16000/s:화자 1⟧ 및 전산 자동 등록 도입 예정.
    MD
    result = Meeting.extract_brief_summary(notes)
    assert_no_match(/⟦/, result)
    assert_match(/롤링 계획 웹 버전 구현/, result)
  end

  test "마커 제거 후 150자 절단 — 반토막 마커 조각이 남지 않는다" do
    long_body = "긴 본문 문장입니다. " * 20
    notes = "#{long_body}⟦t:743000/s:화자 5⟧ 후속 내용"
    result = Meeting.extract_brief_summary(notes)
    assert_no_match(/⟦/, result)
    assert result.length <= 153 # max_length + "..."
  end

  test "cross-meeting 마커(m: 형태)도 제거한다" do
    notes = "폴더 요약 내용 ⟦m:12/t:5000/s:화자 2⟧ 이어지는 내용"
    result = Meeting.extract_brief_summary(notes)
    assert_equal "폴더 요약 내용 이어지는 내용", result
  end

  test "마커 제거 후 이중 공백은 한 칸으로" do
    notes = "앞 문장 ⟦t:1000/s:A⟧ 뒷 문장"
    assert_equal "앞 문장 뒷 문장", Meeting.extract_brief_summary(notes)
  end
end
