require "rails_helper"

RSpec.describe PromptTemplate, type: :model do
  # config.yaml 실제 내용과 결합하지 않기 위해 DEFAULT_TEMPLATES를 고정값으로 stub.
  let(:defaults) do
    {
      "general" => { label: "일반 회의", sections_prompt: "일반 프롬프트" },
      "training" => { label: "교육", sections_prompt: "교육 프롬프트" }
    }
  end

  before do
    stub_const("PromptTemplate::DEFAULT_TEMPLATES", defaults)
  end

  describe ".sync_defaults!" do
    context "DB가 비어 있을 때" do
      it "DEFAULT_TEMPLATES 전부를 is_default: true로 생성한다" do
        expect { PromptTemplate.sync_defaults! }.to change(PromptTemplate, :count).by(2)

        general = PromptTemplate.find_by(meeting_type: "general")
        training = PromptTemplate.find_by(meeting_type: "training")

        expect(general).to have_attributes(label: "일반 회의", sections_prompt: "일반 프롬프트", is_default: true)
        expect(training).to have_attributes(label: "교육", sections_prompt: "교육 프롬프트", is_default: true)
      end

      it "생성된 meeting_type 배열을 반환한다" do
        result = PromptTemplate.sync_defaults!
        expect(result).to contain_exactly("general", "training")
      end
    end

    context "일부만 있을 때" do
      it "누락분만 생성하고, 기존 행의 관리자 수정본은 보존한다" do
        existing = PromptTemplate.create!(
          meeting_type: "general",
          label: "관리자가 바꾼 라벨",
          sections_prompt: "관리자가 바꾼 프롬프트",
          is_default: true
        )

        expect { PromptTemplate.sync_defaults! }.to change(PromptTemplate, :count).by(1)

        existing.reload
        expect(existing.label).to eq("관리자가 바꾼 라벨")
        expect(existing.sections_prompt).to eq("관리자가 바꾼 프롬프트")

        expect(PromptTemplate.find_by(meeting_type: "training")).to have_attributes(
          label: "교육", sections_prompt: "교육 프롬프트", is_default: true
        )
      end

      it "생성한 meeting_type만 반환한다" do
        PromptTemplate.create!(meeting_type: "general", label: "일반 회의", sections_prompt: "일반 프롬프트", is_default: true)

        expect(PromptTemplate.sync_defaults!).to eq([ "training" ])
      end
    end

    context "커스텀 유형(is_default: false)이 있을 때" do
      it "그대로 유지된다" do
        custom = PromptTemplate.create!(
          meeting_type: "custom_type",
          label: "커스텀",
          sections_prompt: "커스텀 프롬프트",
          is_default: false
        )

        PromptTemplate.sync_defaults!

        custom.reload
        expect(custom.label).to eq("커스텀")
        expect(custom.is_default).to eq(false)
        expect(PromptTemplate.exists?(meeting_type: "custom_type")).to eq(true)
      end
    end

    context "경합(레이스 컨디션) 상황" do
      it "ActiveRecord::RecordNotUnique 발생 시 예외를 던지지 않고 반환값에서 제외한다" do
        allow(PromptTemplate).to receive(:create!).and_raise(ActiveRecord::RecordNotUnique.new("duplicate"))

        result = nil
        expect { result = PromptTemplate.sync_defaults! }.not_to raise_error
        expect(result).to eq([])
      end

      it "ActiveRecord::RecordInvalid(uniqueness validation 충돌) 발생 시 예외를 던지지 않고 반환값에서 제외한다" do
        invalid_record = PromptTemplate.new
        invalid_record.errors.add(:meeting_type, "has already been taken")
        allow(PromptTemplate).to receive(:create!).and_raise(ActiveRecord::RecordInvalid.new(invalid_record))

        result = nil
        expect { result = PromptTemplate.sync_defaults! }.not_to raise_error
        expect(result).to eq([])
      end
    end

    context "전부 있을 때" do
      it "아무것도 생성하지 않는다" do
        defaults.each do |meeting_type, attrs|
          PromptTemplate.create!(meeting_type: meeting_type, label: attrs[:label], sections_prompt: attrs[:sections_prompt], is_default: true)
        end

        expect { PromptTemplate.sync_defaults! }.not_to change(PromptTemplate, :count)
        expect(PromptTemplate.sync_defaults!).to eq([])
      end
    end
  end
end
