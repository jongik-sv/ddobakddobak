require "rails_helper"

RSpec.describe Recurrence do
  # 모든 반환값은 UTC Time. tz 는 규칙의 wall-clock 해석에만 쓰인다.
  describe ".next_occurrence" do
    describe "weekly" do
      # 2026-06-21 은 일요일(wday=0). days=[1](월) 규칙.
      let(:rule) { { "freq" => "weekly", "days" => [ 1 ], "time" => "10:00", "tz" => "Asia/Seoul" } }

      it "after 보다 엄격히 미래인 가장 가까운 해당 요일·시각을 UTC 로 반환한다" do
        # 일요일 09:00(KST) 기준 → 다음 월요일 10:00 KST = 월요일 01:00 UTC
        after = ActiveSupport::TimeZone["Asia/Seoul"].local(2026, 6, 21, 9, 0) # 일
        result = described_class.next_occurrence(rule, after: after)

        expect(result).to be_a(Time)
        expect(result.utc?).to be true
        kst = result.in_time_zone("Asia/Seoul")
        expect(kst.wday).to eq(1)            # 월요일
        expect([ kst.hour, kst.min ]).to eq([ 10, 0 ])
        expect(kst.to_date).to eq(Date.new(2026, 6, 22)) # 바로 다음 월요일
      end

      it "현재 시각이 정확히 그 시각이면 now 가 아니라 다음 주를 반환한다(엄격히 미래)" do
        # 월요일 10:00 KST 정각에서 호출 → 같은 시각이 아니라 다음 주 월요일
        after = ActiveSupport::TimeZone["Asia/Seoul"].local(2026, 6, 22, 10, 0) # 월 10:00
        result = described_class.next_occurrence(rule, after: after).in_time_zone("Asia/Seoul")
        expect(result.to_date).to eq(Date.new(2026, 6, 29)) # 다음 주 월요일
      end

      it "그 요일의 시각이 오늘 이미 지났으면 다음 주 같은 요일로 넘어간다" do
        after = ActiveSupport::TimeZone["Asia/Seoul"].local(2026, 6, 22, 11, 0) # 월 11:00 (10시 지남)
        result = described_class.next_occurrence(rule, after: after).in_time_zone("Asia/Seoul")
        expect(result.to_date).to eq(Date.new(2026, 6, 29)) # 다음 주 월요일
      end

      it "여러 요일 중 가장 가까운 미래 요일을 고른다" do
        multi = { "freq" => "weekly", "days" => [ 1, 3 ], "time" => "10:00", "tz" => "Asia/Seoul" } # 월·수
        after = ActiveSupport::TimeZone["Asia/Seoul"].local(2026, 6, 22, 11, 0) # 월 11:00
        result = described_class.next_occurrence(multi, after: after).in_time_zone("Asia/Seoul")
        expect(result.to_date).to eq(Date.new(2026, 6, 24)) # 수요일
      end

      it "심볼 키 규칙도 받는다" do
        sym_rule = { freq: "weekly", days: [ 1 ], time: "10:00", tz: "Asia/Seoul" }
        after = ActiveSupport::TimeZone["Asia/Seoul"].local(2026, 6, 21, 9, 0)
        result = described_class.next_occurrence(sym_rule, after: after)
        expect(result).to be_a(Time)
      end
    end

    describe "daily" do
      let(:rule) { { "freq" => "daily", "time" => "09:30", "tz" => "Asia/Seoul" } }

      it "오늘 시각이 아직 안 지났으면 오늘, 지났으면 내일을 반환한다(엄격히 미래)" do
        before_time = ActiveSupport::TimeZone["Asia/Seoul"].local(2026, 6, 21, 8, 0)
        today = described_class.next_occurrence(rule, after: before_time).in_time_zone("Asia/Seoul")
        expect(today.to_date).to eq(Date.new(2026, 6, 21))
        expect([ today.hour, today.min ]).to eq([ 9, 30 ])

        after_time = ActiveSupport::TimeZone["Asia/Seoul"].local(2026, 6, 21, 10, 0)
        tomorrow = described_class.next_occurrence(rule, after: after_time).in_time_zone("Asia/Seoul")
        expect(tomorrow.to_date).to eq(Date.new(2026, 6, 22))
      end

      it "정확히 그 시각이면 다음 날을 반환한다" do
        exact = ActiveSupport::TimeZone["Asia/Seoul"].local(2026, 6, 21, 9, 30)
        result = described_class.next_occurrence(rule, after: exact).in_time_zone("Asia/Seoul")
        expect(result.to_date).to eq(Date.new(2026, 6, 22))
      end

      it "daily 는 days 를 무시한다" do
        with_days = { "freq" => "daily", "days" => [ 0 ], "time" => "09:30", "tz" => "Asia/Seoul" }
        before_time = ActiveSupport::TimeZone["Asia/Seoul"].local(2026, 6, 22, 8, 0) # 월요일(days 무관)
        result = described_class.next_occurrence(with_days, after: before_time).in_time_zone("Asia/Seoul")
        expect(result.to_date).to eq(Date.new(2026, 6, 22))
      end
    end

    describe "타임존·DST" do
      it "지정 tz 의 wall-clock 으로 해석한다(다른 tz 면 다른 UTC)" do
        kst_rule = { "freq" => "daily", "time" => "10:00", "tz" => "Asia/Seoul" }
        ny_rule  = { "freq" => "daily", "time" => "10:00", "tz" => "America/New_York" }
        after = Time.utc(2026, 6, 21, 0, 0)
        kst = described_class.next_occurrence(kst_rule, after: after)
        ny  = described_class.next_occurrence(ny_rule, after: after)
        expect(kst).not_to eq(ny)
      end

      it "DST 경계를 넘어도 벽시계 시각을 보존한다(산술이 아니라 in-zone 구성)" do
        # 미국 동부 2026 DST 종료 = 11/1 02:00 → 01:00 로 되돌아감.
        # 매일 10:00 규칙은 DST 전후 모두 현지 10:00 이어야 한다.
        rule = { "freq" => "daily", "time" => "10:00", "tz" => "America/New_York" }
        before_dst = ActiveSupport::TimeZone["America/New_York"].local(2026, 10, 31, 12, 0)
        after_dst  = ActiveSupport::TimeZone["America/New_York"].local(2026, 11, 2, 12, 0)

        r1 = described_class.next_occurrence(rule, after: before_dst).in_time_zone("America/New_York")
        r2 = described_class.next_occurrence(rule, after: after_dst).in_time_zone("America/New_York")
        expect([ r1.hour, r1.min ]).to eq([ 10, 0 ])
        expect([ r2.hour, r2.min ]).to eq([ 10, 0 ])
      end

      it "tz 가 유효하지 않거나 없으면 Time.zone 으로 폴백한다" do
        rule = { "freq" => "daily", "time" => "10:00", "tz" => "Not/AZone" }
        expect(described_class.next_occurrence(rule, after: Time.current)).to be_a(Time)
      end
    end

    describe "빈/비반복 규칙" do
      it "nil 규칙이면 nil" do
        expect(described_class.next_occurrence(nil, after: Time.current)).to be_nil
      end

      it "빈 해시면 nil" do
        expect(described_class.next_occurrence({}, after: Time.current)).to be_nil
      end

      it "time 이 비면 nil" do
        expect(described_class.next_occurrence({ "freq" => "weekly", "days" => [ 1 ], "tz" => "Asia/Seoul" }, after: Time.current)).to be_nil
      end

      it "weekly 인데 days 가 비면 nil" do
        expect(described_class.next_occurrence({ "freq" => "weekly", "days" => [], "time" => "10:00", "tz" => "Asia/Seoul" }, after: Time.current)).to be_nil
      end
    end
  end
end
