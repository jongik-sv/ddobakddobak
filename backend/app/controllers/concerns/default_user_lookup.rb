module DefaultUserLookup
  extend ActiveSupport::Concern

  private

  def default_user
    raise_server_mode_error! if server_mode?

    User.find_or_create_by!(email: "desktop@local") do |u|
      u.name = "사용자"
    end
  end

  def server_mode?
    ENV["SERVER_MODE"] == "true"
  end

  def raise_server_mode_error!
    raise "default_user should not be called in server mode. Use JWT authentication instead."
  end
end
