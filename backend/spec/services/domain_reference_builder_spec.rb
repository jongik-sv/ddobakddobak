require "rails_helper"

RSpec.describe DomainReferenceBuilder do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user) }

  describe ".build" do
    context "실효 도메인 파일이 없으면" do
      it "nil을 반환한다" do
        expect(described_class.build(meeting)).to be_nil
      end
    end

    context "실효 도메인 파일이 전부 content blank면" do
      it "nil을 반환한다" do
        file = create(:domain_file, creator: user, content: "")
        DomainFileLink.create!(owner: meeting, domain_file: file)

        expect(described_class.build(meeting)).to be_nil
      end
    end

    context "선택된 도메인 파일이 있으면" do
      it "'## 파일명' 헤더 + content 포맷으로 선택 순서(id순) join한다" do
        file_a = create(:domain_file, creator: user, name: "공정 용어집", content: "- **MO**: Manufacturing Order")
        file_b = create(:domain_file, creator: user, name: "설비 용어집", content: "- **PLC**: 프로그램 제어기")
        # 역순으로 선택해도 domain_file_links id순(선택 순서)을 따른다.
        DomainFileLink.create!(owner: meeting, domain_file: file_b)
        DomainFileLink.create!(owner: meeting, domain_file: file_a)

        result = described_class.build(meeting)

        expected = "## 설비 용어집\n- **PLC**: 프로그램 제어기\n\n## 공정 용어집\n- **MO**: Manufacturing Order"
        expect(result).to eq(expected)
      end

      it "content blank인 파일은 결과에서 제외한다" do
        blank_file = create(:domain_file, creator: user, name: "빈 파일", content: "")
        real_file = create(:domain_file, creator: user, name: "실제 파일", content: "- **ERP**: 전사자원관리")
        DomainFileLink.create!(owner: meeting, domain_file: blank_file)
        DomainFileLink.create!(owner: meeting, domain_file: real_file)

        result = described_class.build(meeting)

        expect(result).not_to include("빈 파일")
        expect(result).to include("## 실제 파일")
      end
    end

    context "폴더/프로젝트 상속분을 포함할 때" do
      it "meeting > 폴더 > 프로젝트 순으로 배치한다" do
        folder = create(:folder, project: project)
        meeting.update!(folder: folder)

        meeting_file = create(:domain_file, creator: user, name: "회의", content: "- **A**: a")
        folder_file = create(:domain_file, creator: user, name: "폴더", content: "- **B**: b")
        project_file = create(:domain_file, creator: user, name: "프로젝트", content: "- **C**: c")
        DomainFileLink.create!(owner: meeting, domain_file: meeting_file)
        DomainFileLink.create!(owner: folder, domain_file: folder_file)
        DomainFileLink.create!(owner: project, domain_file: project_file)

        result = described_class.build(meeting)

        expect(result.index("## 회의")).to be < result.index("## 폴더")
        expect(result.index("## 폴더")).to be < result.index("## 프로젝트")
      end
    end

    context "누적 길이가 8000자를 넘으면" do
      it "초과 파일의 content를 남은 자수까지 자르고 '…(이하 생략)'를 붙인 뒤 이후 파일을 스킵한다" do
        file_a = create(:domain_file, creator: user, name: "A", content: "가" * 7900)
        file_b = create(:domain_file, creator: user, name: "B", content: "나" * 500)
        file_c = create(:domain_file, creator: user, name: "C", content: "다" * 100)
        DomainFileLink.create!(owner: meeting, domain_file: file_a)
        DomainFileLink.create!(owner: meeting, domain_file: file_b)
        DomainFileLink.create!(owner: meeting, domain_file: file_c)

        result = described_class.build(meeting)

        expect(result).to include("## A")
        expect(result).to include("## B")
        expect(result).to include("…(이하 생략)")
        # C는 캡 초과로 스킵되어야 한다.
        expect(result).not_to include("## C")
      end

      it "이미 캡을 채운 이후 파일은 완전히 스킵한다(빈 조각도 남기지 않음)" do
        file_a = create(:domain_file, creator: user, name: "A", content: "가" * 8000)
        file_b = create(:domain_file, creator: user, name: "B", content: "나" * 100)
        DomainFileLink.create!(owner: meeting, domain_file: file_a)
        DomainFileLink.create!(owner: meeting, domain_file: file_b)

        result = described_class.build(meeting)

        expect(result).to include("## A")
        expect(result).not_to include("## B")
      end

      it "캡 초과 시 project 소속분이 먼저 잘려나가고 meeting 자체 선택분이 끝까지 살아남는다" do
        folder = create(:folder, project: project)
        meeting.update!(folder: folder)

        project_file = create(:domain_file, creator: user, name: "프로젝트", content: "가" * 7950)
        meeting_file = create(:domain_file, creator: user, name: "회의", content: "나" * 200)
        DomainFileLink.create!(owner: project, domain_file: project_file)
        DomainFileLink.create!(owner: meeting, domain_file: meeting_file)

        result = described_class.build(meeting)

        expect(result).to include("## 회의")
        expect(result).to start_with("## 회의")
      end
    end
  end
end
