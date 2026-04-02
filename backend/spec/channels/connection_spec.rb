require "rails_helper"

RSpec.describe ApplicationCable::Connection, type: :channel do
  let(:user) { create(:user, password: "password123") }

  context "LOCAL mode" do
    around do |example|
      original = ENV["SERVER_MODE"]
      ENV["SERVER_MODE"] = nil
      example.run
    ensure
      ENV["SERVER_MODE"] = original
    end

    it "connects without token (uses desktop@local)" do
      connect
      expect(connection.current_user.email).to eq("desktop@local")
    end

    it "creates desktop@local user on connect" do
      expect { connect }.to change { User.where(email: "desktop@local").count }.by(1)
    end
  end

  context "SERVER mode" do
    around do |example|
      original = ENV["SERVER_MODE"]
      ENV["SERVER_MODE"] = "true"
      example.run
    ensure
      ENV["SERVER_MODE"] = original
    end

    it "connects with valid JWT token" do
      token = JwtService.encode_access_token(user)
      connect params: { token: token }
      expect(connection.current_user).to eq(user)
    end

    it "rejects connection without token" do
      expect { connect }.to have_rejected_connection
    end

    it "rejects connection with invalid token" do
      expect { connect params: { token: "invalid" } }.to have_rejected_connection
    end

    it "rejects connection with expired token" do
      expired_token = travel_to(25.hours.ago) do
        JwtService.encode_access_token(user)
      end
      expect { connect params: { token: expired_token } }.to have_rejected_connection
    end
  end
end
