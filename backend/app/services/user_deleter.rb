# 사용자 삭제 전 소유 데이터를 이관한다.
#
# 배경: meetings/projects/domain_files/meeting_contacts.created_by_id → users FK에
# on_delete 규칙이 없어, 소유 데이터가 남아 있으면 users DELETE가
# SQLite3::ConstraintException(FOREIGN KEY constraint failed)으로 실패한다(500 사고).
#
# 이관 정책(고정):
# - 회의: 각 회의가 속한 프로젝트의 다른 관리자(멤버십 role=admin, 생성 순 첫 번째)에게.
#   다른 관리자가 없으면(개인 프로젝트 포함) 로컬 관리자 계정(desktop@local)에게.
# - 프로젝트(팀): 로컬 관리자 계정에게.
# - 개인 프로젝트: 로컬 관리자 계정으로 넘기고(personal 해제 + "<이름>의 개인 회의" 개명)
#   내용물째 곧장 휴지통으로. 필요 시 휴지통에서 복원해 열람한다.
# - 기타 귀속 컬럼(도메인파일·첨부·초대·휴지통 귀속 등): 로컬 관리자 계정에게.
class UserDeleter
  def self.call(user)
    local = local_admin_user
    raise ArgumentError, "로컬 계정은 삭제할 수 없습니다" if user.id == local.id

    ActiveRecord::Base.transaction do
      personal = user.created_projects.find_by(personal: true)

      if personal
        # personal 해제를 먼저 — 로컬 계정 멤버십 생성이 개인 프로젝트 멤버 금지
        # 검증(ProjectMembership#creator_only_for_personal_project)에 걸리지 않도록.
        personal.update_columns(
          created_by_id: local.id,
          personal: false,
          name: "#{user.name}의 개인 회의"
        )
        # 복원 시 관리할 수 있도록 로컬 계정을 프로젝트 관리자로 등록.
        ProjectMembership.find_or_create_by!(project_id: personal.id, user_id: local.id) do |pm|
          pm.role = "admin"
        end
      end

      transfer_meetings_to_project_admins(user, fallback: local)

      # FK가 강제하는 소유 컬럼 — 이관하지 않으면 users DELETE가 실패한다.
      Project.where(created_by_id: user.id).update_all(created_by_id: local.id)
      DomainFile.where(created_by_id: user.id).update_all(created_by_id: local.id)
      MeetingContact.where(created_by_id: user.id).update_all(created_by_id: local.id)

      # FK 없는 표시·귀속 컬럼 — 삭제된 id가 남지 않도록 함께 이관(휴지통 필터 등).
      GlossaryEntry.where(created_by_id: user.id).update_all(created_by_id: local.id)
      MeetingAttachment.where(uploaded_by_id: user.id).update_all(uploaded_by_id: local.id)
      ProjectInvite.where(created_by_id: user.id).update_all(created_by_id: local.id)
      [Meeting, Project, Folder].each do |klass|
        klass.where(deleted_by_id: user.id).update_all(deleted_by_id: local.id)
      end

      # 이관이 끝난 옛 개인 프로젝트는 내용물째 휴지통으로 (로컬 계정 휴지통에 표시).
      Trash::SoftDeleter.call(personal, by: local) if personal

      # chat_messages(dependent: :destroy)·project_memberships(FK cascade)는 destroy!가
      # 정리한다. personal은 이미 이관돼 before_destroy(personal destroy_all)는 no-op.
      user.destroy!
    end
  end

  # 회의 소유권을 프로젝트별로 "삭제 대상이 아닌 관리자" 중 첫 번째에게 넘긴다.
  # 관리자가 없으면 fallback(로컬 관리자 계정).
  def self.transfer_meetings_to_project_admins(user, fallback:)
    Meeting.where(created_by_id: user.id).distinct.pluck(:project_id).each do |pid|
      new_owner_id =
        if pid
          ProjectMembership.where(project_id: pid, role: "admin")
                           .where.not(user_id: user.id)
                           .order(:id).pick(:user_id)
        end
      new_owner_id ||= fallback.id
      Meeting.where(created_by_id: user.id, project_id: pid).update_all(created_by_id: new_owner_id)
    end
  end
  private_class_method :transfer_meetings_to_project_admins

  # 로컬 관리자 계정(desktop@local) — DefaultUserLookup#local_default_user와 동일 규약.
  def self.local_admin_user
    ::User.find_or_create_by!(email: ::User::LOCAL_EMAIL) do |u|
      u.name = "관리자"
      u.role = "admin"
    end
  end
  private_class_method :local_admin_user
end
