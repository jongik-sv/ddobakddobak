module ApplicationCable
  class Connection < ActionCable::Connection::Base
    include DefaultUserLookup

    identified_by :current_user

    def connect
      self.current_user = default_user
    end
  end
end
