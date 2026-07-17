require "rails_helper"

RSpec.describe DomainFile do
  let(:creator) { create(:user) }

  describe "validations" do
    it "name이 없으면 무효" do
      f = DomainFile.new(name: "", creator: creator)
      expect(f).not_to be_valid
    end

    it "동일 project_id 내에서 name 중복 금지" do
      project = create(:project)
      create(:domain_file, name: "공정 용어집", project: project, creator: creator)
      dup = DomainFile.new(name: "공정 용어집", project: project, creator: creator)
      expect(dup).not_to be_valid
    end

    it "전역(project_id nil) 파일끼리도 name 중복 금지" do
      create(:domain_file, name: "전역 용어집", project: nil, creator: creator)
      dup = DomainFile.new(name: "전역 용어집", project: nil, creator: creator)
      expect(dup).not_to be_valid
    end

    it "다른 project면 같은 name 허용" do
      p1 = create(:project)
      p2 = create(:project)
      create(:domain_file, name: "같은 이름", project: p1, creator: creator)
      other = DomainFile.new(name: "같은 이름", project: p2, creator: creator)
      expect(other).to be_valid
    end

    it "content가 50000자를 넘으면 무효" do
      f = DomainFile.new(name: "긴 파일", creator: creator, content: "가" * 50_001)
      expect(f).not_to be_valid
    end

    it "content가 50000자면 유효" do
      f = DomainFile.new(name: "긴 파일", creator: creator, content: "가" * 50_000)
      expect(f).to be_valid
    end
  end

  describe ".accessible_by" do
    let(:member_project) { create(:project) }
    let(:other_project) { create(:project) }
    let(:user) { create(:user) }

    before do
      create(:project_membership, user: user, project: member_project)
    end

    it "전역 파일과 본인 소속 프로젝트 파일만 접근 가능" do
      global_file = create(:domain_file, project: nil, creator: creator)
      member_file = create(:domain_file, project: member_project, creator: creator)
      other_file = create(:domain_file, project: other_project, creator: creator)

      result = DomainFile.accessible_by(user)
      expect(result).to include(global_file, member_file)
      expect(result).not_to include(other_file)
    end

    it "admin은 전체 파일에 접근 가능" do
      admin = create(:user, :admin)
      global_file = create(:domain_file, project: nil, creator: creator)
      other_file = create(:domain_file, project: other_project, creator: creator)

      result = DomainFile.accessible_by(admin)
      expect(result).to include(global_file, other_file)
    end
  end

  describe "#editable_by?" do
    it "작성자 본인은 수정 가능" do
      f = create(:domain_file, creator: creator)
      expect(f.editable_by?(creator)).to be true
    end

    it "작성자가 아니면 수정 불가" do
      f = create(:domain_file, creator: creator)
      other = create(:user)
      expect(f.editable_by?(other)).to be false
    end

    it "admin은 항상 수정 가능" do
      f = create(:domain_file, creator: creator)
      admin = create(:user, :admin)
      expect(f.editable_by?(admin)).to be true
    end

    it "user가 nil이면 false" do
      f = create(:domain_file, creator: creator)
      expect(f.editable_by?(nil)).to be false
    end
  end

  describe "#merge_terms!" do
    it "새 용어를 파일 끝에 append한다" do
      f = create(:domain_file, creator: creator, content: "- **기존용어**: 기존 설명")
      result = f.merge_terms!([{ "term" => "신규용어", "category" => "공정명", "definition" => "신규 설명" }])

      expect(result).to eq({ added: 1, replaced: 0 })
      expect(f.content).to eq("- **기존용어**: 기존 설명\n- **신규용어** [공정명]: 신규 설명")
    end

    it "같은 key(정규화)의 용어가 있으면 그 라인을 교체한다" do
      f = create(:domain_file, creator: creator, content: "- **용어A** [공정명]: 옛 설명")
      result = f.merge_terms!([{ "term" => "용어A", "category" => "라인명", "definition" => "새 설명" }])

      expect(result).to eq({ added: 0, replaced: 1 })
      expect(f.content).to eq("- **용어A** [라인명]: 새 설명")
    end

    it "대소문자만 다른 영문 용어는 같은 key로 취급해 교체한다" do
      f = create(:domain_file, creator: creator, content: "- **ABC**: 옛 설명")
      result = f.merge_terms!([{ "term" => "abc", "category" => "", "definition" => "새 설명" }])

      expect(result).to eq({ added: 0, replaced: 1 })
      expect(f.content).to eq("- **abc**: 새 설명")
    end

    it "자유 텍스트 라인은 건드리지 않는다" do
      f = create(:domain_file, creator: creator, content: "# 제목\n자유 텍스트 설명\n- **용어A**: 설명")
      f.merge_terms!([{ "term" => "용어B", "category" => "", "definition" => "설명B" }])

      expect(f.content).to eq("# 제목\n자유 텍스트 설명\n- **용어A**: 설명\n- **용어B**: 설명B")
    end

    it "term이 blank인 항목은 skip한다" do
      f = create(:domain_file, creator: creator, content: "")
      result = f.merge_terms!([{ "term" => "  ", "category" => "", "definition" => "무시" }])

      expect(result).to eq({ added: 0, replaced: 0 })
      expect(f.content).to eq("")
    end

    it "분류가 없으면 대괄호 없이 라인을 만든다" do
      f = create(:domain_file, creator: creator, content: "")
      f.merge_terms!([{ "term" => "용어C", "category" => "", "definition" => "설명C" }])

      expect(f.content).to eq("- **용어C**: 설명C")
    end
  end

  describe ".normalize_key" do
    it "앞뒤 공백을 제거한다" do
      expect(DomainFile.normalize_key("  용어  ")).to eq("용어")
    end

    it "영문은 소문자로 정규화한다" do
      expect(DomainFile.normalize_key("ABC")).to eq("abc")
    end

    it "한글은 대소문자 개념이 없어 그대로 보존된다" do
      expect(DomainFile.normalize_key("공정명")).to eq("공정명")
    end
  end

  describe ".parse_terms" do
    it "용어 라인만 파싱하고 자유 텍스트는 제외한다" do
      content = "# 제목\n- **용어A** [공정명]: 설명A\n자유 텍스트\n- **용어B**: 설명B"
      terms = DomainFile.parse_terms(content)

      expect(terms).to eq([
        { term: "용어A", category: "공정명", definition: "설명A", line_no: 1 },
        { term: "용어B", category: "", definition: "설명B", line_no: 3 }
      ])
    end
  end
end
