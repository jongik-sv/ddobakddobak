module DefaultUserLookup
  extend ActiveSupport::Concern

  private

  def server_mode?
    ENV["SERVER_MODE"] == "true"
  end

  # Local mode only: find or create the default desktop@local user.
  # Callers must check server_mode? before invoking this method.
  def local_default_user
    User.find_or_create_by!(email: "desktop@local") do |u|
      u.name = "사용자"
    end
  end
end
