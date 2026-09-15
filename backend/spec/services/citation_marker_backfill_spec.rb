require "rails_helper"

RSpec.describe CitationMarkerBackfill do
  let(:meeting) { create(:meeting, audio_duration_ms: 3_172_560) }

  describe ".fix_field" do
    context "실서버 실측(회의 194 / 오타사전 {from: '250', to: '임가공'}) 회귀" do
      before { meeting.glossary_entries.create!(from_text: "250", to_text: "임가공") }

      it "⟦t:1056임가공/s:화자 5⟧ 를 ⟦t:1056250/s:화자 5⟧ 로 역치환 복원한다" do
        text, events = described_class.fix_field("⟦t:1056임가공/s:화자 5⟧", meeting: meeting)
        expect(text).to eq("⟦t:1056250/s:화자 5⟧")
        expect(events.map(&:kind)).to eq([ :glossary_restored ])
      end

      it "⟦t:2임가공050/s:화자 1⟧ 를 ⟦t:2250050/s:화자 1⟧ 로 역치환 복원한다" do
        text, = described_class.fix_field("⟦t:2임가공050/s:화자 1⟧", meeting: meeting)
        expect(text).to eq("⟦t:2250050/s:화자 1⟧")
      end

      it "⟦t:218임가공0/s:화자 1⟧ 를 ⟦t:2182500/s:화자 1⟧ 로 역치환 복원한다" do
        text, = described_class.fix_field("⟦t:218임가공0/s:화자 1⟧", meeting: meeting)
        expect(text).to eq("⟦t:2182500/s:화자 1⟧")
      end

      it "⟦t:172임가공:0/s:화자 1⟧ 는 역치환 후보를 normalize 로 한 번 더 통과시켜 콜론 폭주를 바로잡은 뒤 채택한다" do
        # 역치환 후보 ⟦t:172250:0/s:화자 1⟧ 는 정규식은 통과하지만, 그대로 두면 콜론 시간
        # 해석에서 10,335,000,000ms 로 폭주한다(마지막 필드 "0"이 2자리 zero-pad 가 아님).
        # normalize 의 콜론 시간 sanity 규칙(app/services/llm_prompts/citation_markers.rb
        # #sanitize_colon_time_overflow)이 이를 감지해 ⟦t:1722500/...⟧ 로 바로잡아 주므로,
        # 2차 normalize 통과를 빠뜨리지 않았다면 1,722,500ms(상한 이내)로 정상 채택된다.
        text, events = described_class.fix_field("⟦t:172임가공:0/s:화자 1⟧", meeting: meeting)
        expect(text).to eq("⟦t:1722500/s:화자 1⟧")
        expect(events.map(&:kind)).to eq([ :glossary_restored ])
      end

      it "같은 회의가 아닌 다른 회의의 사전은 사용하지 않는다(무관 회의 오복원 방지)" do
        other_meeting = create(:meeting, audio_duration_ms: 3_172_560)
        text, events = described_class.fix_field("⟦t:1056임가공/s:화자 5⟧", meeting: other_meeting)
        # other_meeting 에는 해당 글로서리 엔트리가 없으므로 역치환 후보가 없다 → 2단계(normalize)로
        # 넘어간다(이 테스트의 핵심은 :glossary_restored 가 아니라 :normalize_restored 로 분류되는
        # 것 — 즉 "그 회의의" 글로서리만 썼다는 증거다). normalize 자체가 시간부 비숫자 오염을
        # "검증 없이 최대한" 복구하는 규칙(다른 워커가 동시 작업 중인 citation_markers.rb #6)을
        # 갖고 있어 결과값 자체(250 대신 그냥 숫자만 이어붙인 값)는 이 서비스의 책임 밖이므로
        # 정확한 문자열은 단언하지 않는다 — 대신 "진짜 250 값으로는 복원되지 않았다"만 확인한다.
        expect(events.map(&:kind)).to eq([ :normalize_restored ])
        expect(text).not_to eq("⟦t:1056250/s:화자 5⟧")
      end
    end

    context "역치환 후보가 2개 이상(보류)" do
      before do
        # 서로 다른 두 엔트리의 to_text 가 우연히 같은 오염 문자열("가")을 만들 수 있다 —
        # 각각으로 역치환하면 둘 다 독립적으로 정본이 되므로 진짜 모호한 경우다.
        meeting.glossary_entries.create!(from_text: "1", to_text: "가")
        meeting.glossary_entries.create!(from_text: "9", to_text: "가")
      end

      it "서로 다른 정본 후보가 나오면 원본을 그대로 두고 보류로 로깅한다" do
        original = "⟦t:100가/s:화자 1⟧"
        text, events = described_class.fix_field(original, meeting: meeting)
        expect(text).to eq(original)
        expect(events.map(&:kind)).to eq([ :held ])
        expect(events.first.reason).to match(/역치환 후보 \d+개/)
      end

      it "본문에 플레이스홀더 토큰과 우연히 같은 문자열이 있어도 보류 마커를 엉뚱한 자리에 복원하지 않는다" do
        # 내부적으로 " HELD0 " 형태 토큰으로 보류 마커를 잠시 빼뒀다가 되돌리는데, 본문에 이미
        # 같은 문자열이 있으면(우연이라도) 충돌 회피가 없으면 최종 sub 가 엉뚱한 위치를 바꾼다.
        original = "안내 HELD0 입니다 ⟦t:100가/s:화자 1⟧"
        text, events = described_class.fix_field(original, meeting: meeting)
        expect(text).to eq(original) # 보류 마커·본문 리터럴 모두 무변형이어야 정상
        expect(events.map(&:kind)).to eq([ :held ])
      end
    end

    context "글로서리 엔트리에 치환 이스케이프로 오해될 문자가 섞인 경우" do
      it "from_text 의 백슬래시가 gsub 치환 이스케이프(\\1 등)로 해석되지 않는다" do
        # 문자열 인자 형태 gsub("깨짐", entry[:from]) 였다면 entry[:from] 안의 '\1' 이 (패턴이
        # 문자열이라 캡처그룹이 없으므로) 빈 문자열로 조용히 사라진다 — 블록 형태여야 그대로 보존.
        entries = [ { from: "\\1시", to: "깨짐", match_type: "literal" } ]
        whole = "⟦t:100깨짐/s:화자 1⟧"

        candidates = described_class.glossary_reverse_candidates(whole, entries)

        # 블록형이 맞다면: "100" + "\1시" → 숫자만 남기면 "100"+"1"(백슬래시 뒤 '1') = "1001".
        # 문자열형(버그)이면 '\1' 이 통째로 사라져 "100" 만 남는다 — 값 자체가 달라져 검출된다.
        expect(candidates).to eq([ "⟦t:1001/s:화자 1⟧" ])
      end
    end

    context "마커 사이 텍스트만 바뀌는 경우(개별 마커 이벤트로 귀속 안 됨)" do
      it "⟧~⟦ 범위 병합처럼 특정 마커에 속하지 않는 변경도 텍스트에는 반영된다(이벤트는 .call 쪽 책임)" do
        # CitationMarkers.normalize 1단계(⟧~⟦ → ⟧ ⟦)는 두 "이미 정본인" 마커 사이의 텍스트만
        # 바꾼다 — 어느 쪽 마커도 개별적으로 안 바뀌므로 fix_field 단독으로는 이벤트가 안 남는다
        # (call 쪽의 "기타" 폴백에서 다룬다 — 아래 .call 스펙 참고).
        original = "⟦t:125000/s:화자 1⟧~⟦t:126000/s:화자 1⟧"
        text, events = described_class.fix_field(original, meeting: meeting)
        expect(text).to eq("⟦t:125000/s:화자 1⟧ ⟦t:126000/s:화자 1⟧")
        expect(events).to be_empty
      end
    end

    context "챗 저장 경로 미정규화(정규화 복원)" do
      it "ms 접미사를 제거해 정규화 복원한다" do
        text, events = described_class.fix_field("⟦t:175000ms/s:화자 1⟧", meeting: meeting)
        expect(text).to eq("⟦t:175000/s:화자 1⟧")
        expect(events.map(&:kind)).to eq([ :normalize_restored ])
      end
    end

    context "복구 불가한 조각(삭제)" do
      it "⟦m:122⟧ 처럼 t: 가 없는 조각은 삭제한다" do
        text, events = described_class.fix_field("⟦m:122⟧", meeting: meeting)
        expect(text).to eq("")
        expect(events.map(&:kind)).to eq([ :deleted ])
      end
    end

    it "정상 마커는 그대로 보존한다(이벤트 없음)" do
      text, events = described_class.fix_field("⟦t:125000/s:화자 1⟧", meeting: meeting)
      expect(text).to eq("⟦t:125000/s:화자 1⟧")
      expect(events).to be_empty
    end

    it "meeting 이 nil 이면(폴더/프로젝트 스코프 챗) 역치환을 건너뛰고 normalize 만 적용한다" do
      text, events = described_class.fix_field("⟦t:175000ms/s:화자 1⟧", meeting: nil)
      expect(text).to eq("⟦t:175000/s:화자 1⟧")
      expect(events.map(&:kind)).to eq([ :normalize_restored ])
    end

    it "nil/공백 텍스트는 그대로 반환한다" do
      expect(described_class.fix_field(nil, meeting: meeting)).to eq([ nil, [] ])
      expect(described_class.fix_field("", meeting: meeting)).to eq([ "", [] ])
    end

    it "멱등하다 — 이미 교정된 텍스트를 다시 돌려도 추가 변경이 없다" do
      meeting.glossary_entries.create!(from_text: "250", to_text: "임가공")
      first, = described_class.fix_field("⟦t:1056임가공/s:화자 5⟧", meeting: meeting)
      second, events = described_class.fix_field(first, meeting: meeting)
      expect(second).to eq(first)
      expect(events).to be_empty
    end
  end

  describe ".call" do
    it "Summary/ChatMessage/Block 세 모델을 모두 스캔하고 DRY_RUN 이면 DB를 바꾸지 않는다" do
      summary = Summary.create!(meeting: meeting, summary_type: "final", generated_at: Time.current,
                                 notes_markdown: "⟦t:175000ms/s:화자 1⟧")
      chat = create(:chat_message, meeting: meeting, content: "⟦m:122⟧")
      block = create(:block, meeting: meeting, content: "⟦t:175000ms/s:화자 1⟧")

      result = described_class.call(dry_run: true)

      expect(result.changed).to be >= 3
      expect(summary.reload.notes_markdown).to eq("⟦t:175000ms/s:화자 1⟧")
      expect(chat.reload.content).to eq("⟦m:122⟧")
      expect(block.reload.content).to eq("⟦t:175000ms/s:화자 1⟧")
    end

    it "DRY_RUN 아니면 실제로 갱신하고, 재실행해도 추가 변경이 없다(멱등)" do
      summary = Summary.create!(meeting: meeting, summary_type: "final", generated_at: Time.current,
                                 notes_markdown: "⟦t:175000ms/s:화자 1⟧")

      described_class.call(dry_run: false)
      expect(summary.reload.notes_markdown).to eq("⟦t:175000/s:화자 1⟧")

      second = described_class.call(dry_run: false)
      expect(second.changed).to eq(0)
    end

    it "폴더 스코프 챗(meeting_id 없음)도 스캔하며 normalize 만 적용된다" do
      user = create(:user)
      chat = ChatMessage.create!(user: user, role: "user", content: "질문 ⟦t:175000ms/s:화자 1⟧",
                                  scope_type: "folder", scope_id: create(:folder).id)

      result = described_class.call(dry_run: false)
      expect(chat.reload.content).to eq("질문 ⟦t:175000/s:화자 1⟧")
      restored = result.events.find { |e| e.record_id == chat.id }
      expect(restored.kind).to eq(:normalize_restored)
    end

    it "마커 자체가 아니라 마커 사이 텍스트만 바뀌는 변경도 '기타'로 눈에 보이게 남긴다" do
      # fix_field 단독으로는 이벤트가 안 남는 케이스(위 .fix_field 스펙 참고) — .call 이
      # 레코드 단위로 "바뀌었는데 이벤트가 없다"를 감지해 기타 이벤트를 보강해야 한다.
      summary = Summary.create!(meeting: meeting, summary_type: "final", generated_at: Time.current,
                                 notes_markdown: "⟦t:125000/s:화자 1⟧~⟦t:126000/s:화자 1⟧")

      result = described_class.call(dry_run: true)

      other = result.events.find { |e| e.record_id == summary.id && e.record_class == "Summary" }
      expect(other).not_to be_nil
      expect(other.kind).to eq(:other)
    end
  end
end
