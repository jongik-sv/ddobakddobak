require "rails_helper"

RSpec.describe User, "JWT", type: :model do
  describe "Devise modules" do
    it { is_expected.to validate_presence_of(:name) }

    it "includes :database_authenticatable" do
      expect(User.devise_modules).to include(:database_authenticatable)
    end

    it "includes :jwt_authenticatable" do
      expect(User.devise_modules).to include(:jwt_authenticatable)
    end
  end

  describe "JTIMatcher revocation strategy" do
    it "includes JTIMatcher module" do
      expect(User.ancestors).to include(Devise::JWT::RevocationStrategies::JTIMatcher)
    end
  end

  describe "jti on create" do
    it "generates a jti automatically via JTIMatcher" do
      user = create(:user)
      expect(user.jti).to be_present
      expect(user.jti).to match(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/)
    end

    it "generates unique jti for each user" do
      user1 = create(:user)
      user2 = create(:user)
      expect(user1.jti).not_to eq(user2.jti)
    end
  end

  describe "#generate_refresh_token_jti!" do
    let(:user) { create(:user) }

    it "sets refresh_token_jti and returns it" do
      jti = user.generate_refresh_token_jti!
      expect(jti).to be_present
      expect(user.reload.refresh_token_jti).to eq(jti)
    end

    it "generates a UUID format" do
      jti = user.generate_refresh_token_jti!
      expect(jti).to match(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/)
    end

    it "changes the value on subsequent calls" do
      jti1 = user.generate_refresh_token_jti!
      jti2 = user.generate_refresh_token_jti!
      expect(jti1).not_to eq(jti2)
    end
  end

  describe "#revoke_refresh_token!" do
    let(:user) { create(:user) }

    it "sets refresh_token_jti to nil" do
      user.generate_refresh_token_jti!
      expect(user.refresh_token_jti).to be_present

      user.revoke_refresh_token!
      expect(user.reload.refresh_token_jti).to be_nil
    end
  end

  describe "password handling" do
    it "encrypts the password with bcrypt" do
      user = create(:user, password: "testpass123")
      expect(user.encrypted_password).to be_present
      expect(user.valid_password?("testpass123")).to be true
      expect(user.valid_password?("wrongpass")).to be false
    end
  end
end
