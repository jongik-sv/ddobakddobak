module DefaultUserLookup
  extend ActiveSupport::Concern

  private

  def default_user
    User.find_or_create_by!(email: "desktop@local") do |u|
      u.name = "사용자"
    end
  end
end
