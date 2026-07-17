require "rails_helper"

RSpec.describe Project, type: :model do
  describe "validations" do
    it { is_expected.to validate_presence_of(:name) }

    it "icon_type을 lucide/emoji/image로 제한한다" do
      expect(build(:project, icon_type: "lucide")).to be_valid
      expect(build(:project, icon_type: "bogus")).not_to be_valid
      expect(build(:project, icon_type: nil)).to be_valid
    end
  end

  describe "#deletable?" do
    let(:project) { create(:project) }

    it "회의·폴더가 없으면 true" do
      expect(project.deletable?).to be true
    end

    it "회의가 있으면 false" do
      create(:meeting, project: project, creator: project.creator)
      expect(project.deletable?).to be false
    end

    it "폴더가 있으면 false" do
      create(:folder, project: project)
      expect(project.deletable?).to be false
    end

    it "개인 프로젝트는 비어 있어도 false" do
      personal = create(:project, personal: true)
      expect(personal.deletable?).to be false
    end
  end

  describe "#owned_domain_files (project_id 소속, dependent: :nullify)" do
    it "프로젝트 삭제 시 소속 도메인 파일은 삭제되지 않고 전역(project_id nil)으로 남는다" do
      project = create(:project)
      file = create(:domain_file, :with_project, project: project)

      project.destroy
      expect(DomainFile.exists?(file.id)).to be true
      expect(file.reload.project_id).to be_nil
    end
  end

  describe "#domain_files (domain_file_links를 통한 링크, dependent: :destroy)" do
    it "프로젝트에 링크된 도메인 파일과 소속(project_id) 파일은 별개다" do
      project = create(:project)
      owned_file = create(:domain_file, :with_project, project: project)
      linked_file = create(:domain_file)
      DomainFileLink.create!(owner: project, domain_file: linked_file)

      expect(project.owned_domain_files).to contain_exactly(owned_file)
      expect(project.domain_files).to contain_exactly(linked_file)
    end

    it "프로젝트 삭제 시 domain_file_links는 cascade로 삭제되지만 도메인 파일 자체는 남는다" do
      project = create(:project)
      file = create(:domain_file)
      DomainFileLink.create!(owner: project, domain_file: file)

      expect { project.destroy }.to change(DomainFileLink, :count).by(-1)
      expect(DomainFile.exists?(file.id)).to be true
    end
  end

  describe "#admin?" do
    it "해당 유저의 멤버십 role이 admin이면 true" do
      project = create(:project)
      user = create(:user)
      create(:project_membership, project: project, user: user, role: "admin")
      expect(project.admin?(user)).to be true
    end

    it "member면 false" do
      project = create(:project)
      user = create(:user)
      create(:project_membership, project: project, user: user, role: "member")
      expect(project.admin?(user)).to be false
    end
  end
end
