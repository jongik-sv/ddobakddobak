require "rails_helper"

RSpec.describe DomainFileLink do
  let(:domain_file) { create(:domain_file) }

  describe "validations" do
    it "같은 owner에 같은 domain_file 중복 링크는 무효" do
      meeting = create(:meeting)
      DomainFileLink.create!(owner: meeting, domain_file: domain_file)

      dup = DomainFileLink.new(owner: meeting, domain_file: domain_file)
      expect(dup).not_to be_valid
    end

    it "다른 owner면 같은 domain_file을 링크해도 유효" do
      DomainFileLink.create!(owner: create(:meeting), domain_file: domain_file)

      other = DomainFileLink.new(owner: create(:meeting), domain_file: domain_file)
      expect(other).to be_valid
    end

    it "같은 domain_file이라도 owner_type이 다르면(Meeting vs Folder) 유효" do
      meeting = create(:meeting)
      folder = create(:folder)
      DomainFileLink.create!(owner: meeting, domain_file: domain_file)

      other = DomainFileLink.new(owner: folder, domain_file: domain_file)
      expect(other).to be_valid
    end

    it "owner_type이 Project/Folder/Meeting이 아니면 무효" do
      link = DomainFileLink.new(domain_file: domain_file, owner_type: "User", owner_id: create(:user).id)
      expect(link).not_to be_valid
    end
  end

  describe "polymorphic owner cascade" do
    it "meeting 삭제 시 연결 레코드가 cascade로 함께 삭제된다" do
      meeting = create(:meeting)
      DomainFileLink.create!(owner: meeting, domain_file: domain_file)

      expect { meeting.destroy }.to change(DomainFileLink, :count).by(-1)
      expect(DomainFile.exists?(domain_file.id)).to be true
    end

    it "folder 삭제 시 연결 레코드가 cascade로 함께 삭제된다" do
      folder = create(:folder)
      DomainFileLink.create!(owner: folder, domain_file: domain_file)

      expect { folder.destroy }.to change(DomainFileLink, :count).by(-1)
    end

    it "project 삭제 시 연결 레코드가 cascade로 함께 삭제된다" do
      project = create(:project)
      DomainFileLink.create!(owner: project, domain_file: domain_file)

      expect { project.destroy }.to change(DomainFileLink, :count).by(-1)
    end

    it "domain_file 삭제 시 연결 레코드가 함께 삭제된다" do
      meeting = create(:meeting)
      DomainFileLink.create!(owner: meeting, domain_file: domain_file)

      expect { domain_file.destroy }.to change(DomainFileLink, :count).by(-1)
    end
  end
end
