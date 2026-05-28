require "rails_helper"

RSpec.describe "Self-registration disabled", type: :request do
  it "has no JSON self-registration route (POST /auth)" do
    expect {
      Rails.application.routes.recognize_path("/auth", method: :post)
    }.to raise_error(ActionController::RoutingError)
  end

  it "has no HTML register route (GET /auth/web_register)" do
    expect {
      Rails.application.routes.recognize_path("/auth/web_register", method: :get)
    }.to raise_error(ActionController::RoutingError)
  end

  it "still allows login route (POST /auth/login)" do
    expect(
      Rails.application.routes.recognize_path("/auth/login", method: :post)
    ).to include(controller: "auth/sessions", action: "create")
  end
end
