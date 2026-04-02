require "rails_helper"

RSpec.describe DefaultUserLookup do
  let(:controller_class) do
    Class.new(ActionController::API) do
      include DefaultUserLookup
      public :default_user, :server_mode?
    end
  end
  let(:controller) { controller_class.new }

  context "LOCAL mode (SERVER_MODE not set)" do
    around do |example|
      original = ENV["SERVER_MODE"]
      ENV["SERVER_MODE"] = nil
      example.run
    ensure
      ENV["SERVER_MODE"] = original
    end

    it "returns desktop@local user" do
      user = controller.default_user
      expect(user.email).to eq("desktop@local")
      expect(user.name).to eq("사용자")
    end

    it "creates the user if not present" do
      expect { controller.default_user }.to change(User, :count).by(1)
    end

    it "returns the same user on subsequent calls" do
      first = controller.default_user
      second = controller.default_user
      expect(first.id).to eq(second.id)
    end

    it "server_mode? returns false" do
      expect(controller.server_mode?).to be false
    end
  end

  context "SERVER mode (SERVER_MODE=true)" do
    around do |example|
      original = ENV["SERVER_MODE"]
      ENV["SERVER_MODE"] = "true"
      example.run
    ensure
      ENV["SERVER_MODE"] = original
    end

    it "raises error when default_user is called" do
      expect { controller.default_user }.to raise_error(RuntimeError, /server mode/)
    end

    it "server_mode? returns true" do
      expect(controller.server_mode?).to be true
    end
  end
end
