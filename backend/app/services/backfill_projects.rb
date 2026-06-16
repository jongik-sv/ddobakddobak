# 1회성 백필 — 공용 "기본" 프로젝트 + 전 유저 멤버 + 개인 프로젝트 + 기존 데이터 이관.
# 원칙: INSERT/UPDATE만. destroy/delete/NOT IN 절대 금지. 멱등(재실행 안전).
# 사용자 결정(2026-06-16): 멤버 0인 옛 더미(레거시) 프로젝트에 남은 폴더·태그·회의도 "기본"으로
#   이관하되, 옛 프로젝트 껍데기는 삭제하지 않고 유지한다.
class BackfillProjects
  def self.call
    users = User.order(:id).to_a
    return if users.empty?

    owner = User.find_by(email: User::LOCAL_EMAIL) ||
            User.where(role: "admin").order(:id).first ||
            users.first

    base = Project.find_or_create_by!(name: "기본", personal: false) do |p|
      p.created_by_id = owner.id
      p.icon_type = "lucide"
      p.icon_value = "home"
      p.color = "#6366f1"
    end

    users.each do |u|
      ProjectMembership.find_or_create_by!(project_id: base.id, user_id: u.id) do |pm|
        pm.role = u.admin? ? "admin" : "member"
      end
      EnsurePersonalProject.call(u)
    end

    # 레거시 = 개인 아님 + 기본 아님(옛 휴면 teams 잔재). 그 안의 콘텐츠를 기본으로 이관.
    # 멱등: 2회차엔 레거시가 비어 있어 no-op. NOT IN 미사용(IS NULL / IN 만).
    legacy_ids = Project.where(personal: false).where.not(id: base.id).pluck(:id)
    [ Meeting, Folder, Tag ].each do |klass|
      klass.where(project_id: [ nil, *legacy_ids ]).update_all(project_id: base.id)
    end

    base
  end
end
