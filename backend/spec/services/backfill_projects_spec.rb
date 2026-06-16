require "rails_helper"

RSpec.describe BackfillProjects do
  describe ".call" do
    it "유저가 없으면 아무것도 안 한다" do
      expect { described_class.call }.not_to change(Project, :count)
    end

    context "기존 유저·레거시 데이터가 있을 때" do
      let!(:admin)  { create(:user, :admin) }
      let!(:member) { create(:user) }
      # 레거시 = 멤버 0인 비개인 프로젝트(옛 휴면 teams 잔재 모사).
      # creator 를 기존 admin 으로 지정해야 추가 유저가 생기지 않는다(실제 시나리오: 옛 팀들도
      # 기존 유저가 created_by). 그래야 멱등 테스트의 멤버 수(admin+member=2)가 성립한다.
      let!(:legacy) { create(:project, name: "옛팀", personal: false, creator: admin) }
      let!(:legacy_meeting) { create(:meeting, project: legacy, creator: admin) }
      let!(:legacy_folder)  { create(:folder, project: legacy) }
      let!(:legacy_tag)     { create(:tag, project: legacy) }

      it "기본 프로젝트를 만들고 전 유저를 멤버로 넣는다" do
        described_class.call
        base = Project.find_by(name: "기본", personal: false)
        expect(base).to be_present
        expect(base.member?(admin)).to be true
        expect(base.member?(member)).to be true
        expect(base.admin?(admin)).to be true   # 전역 admin → 프로젝트 admin
      end

      it "유저마다 개인 프로젝트를 만든다" do
        described_class.call
        expect(admin.projects.where(personal: true).count).to eq(1)
        expect(member.projects.where(personal: true).count).to eq(1)
      end

      it "레거시(멤버0) 프로젝트의 회의·폴더·태그를 기본으로 이관(파괴 없이)" do
        expect { described_class.call }.not_to change(Meeting, :count)
        base = Project.find_by(name: "기본", personal: false)
        expect(legacy_meeting.reload.project_id).to eq(base.id)
        expect(legacy_folder.reload.project_id).to eq(base.id)
        expect(legacy_tag.reload.project_id).to eq(base.id)
      end

      it "레거시 프로젝트 껍데기는 삭제하지 않고 유지한다(사용자 결정)" do
        described_class.call
        expect(Project.exists?(legacy.id)).to be true
      end

      it "두 번 호출해도 안전(멱등)" do
        described_class.call
        base = Project.find_by(name: "기본", personal: false)
        moved_pid = legacy_meeting.reload.project_id
        expect { described_class.call }.not_to change(Project, :count)
        expect(ProjectMembership.where(project: base).count).to eq(2)
        expect(legacy_meeting.reload.project_id).to eq(moved_pid)   # 재이동 없음
        expect(Meeting.where.not(project_id: base.id)).to be_empty  # 전부 기본 소속 유지
      end
    end
  end
end
