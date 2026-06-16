# 유저의 개인 프로젝트(personal: true)를 보장한다. 멱등.
class EnsurePersonalProject
  def self.call(user)
    existing = user.projects.find_by(personal: true)
    return existing if existing

    ActiveRecord::Base.transaction do
      project = Project.create!(
        name: "내 회의",
        creator: user,
        personal: true,
        icon_type: "lucide",
        icon_value: "user",
        color: "#6366f1"
      )
      ProjectMembership.create!(project: project, user: user, role: "admin")
      project
    end
  end
end
