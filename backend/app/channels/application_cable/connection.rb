module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    def connect
      self.current_user = default_user
    end

    private

    def default_user
      User.find_or_create_by!(email: "desktop@local") { |u|
        u.name = "사용자"
      }
    end
  end
end
