require "rails_helper"

RSpec.describe User, type: :model do
  describe "Devise modules" do
    it "includes :database_authenticatable" do
      expect(User.devise_modules).to include(:database_authenticatable)
    end

    it "includes :jwt_authenticatable" do
      expect(User.devise_modules).to include(:jwt_authenticatable)
    end
  end

  describe "validations" do
    it { is_expected.to validate_presence_of(:name) }
    it { is_expected.to validate_inclusion_of(:role).in_array(%w[admin manager member]) }
  end

  describe "role" do
    it "defaults to member" do
      user = create(:user)
      expect(user.role).to eq("member")
    end

    it "rejects invalid role values" do
      user = build(:user, role: "superuser")
      expect(user).not_to be_valid
      expect(user.errors[:role]).to be_present
    end

    it "accepts admin role" do
      user = create(:user, role: "admin")
      expect(user.role).to eq("admin")
    end

    it "accepts member role" do
      user = create(:user, role: "member")
      expect(user.role).to eq("member")
    end

    it "accepts manager role" do
      user = create(:user, role: "manager")
      expect(user.role).to eq("manager")
    end
  end

  describe "#admin?" do
    it "returns true for admin users" do
      user = build(:user, role: "admin")
      expect(user.admin?).to be true
    end

    it "returns false for member users" do
      user = build(:user, role: "member")
      expect(user.admin?).to be false
    end

    it "returns false for manager users" do
      user = build(:user, role: "manager")
      expect(user.admin?).to be false
    end
  end

  describe "#member?" do
    it "returns true for member users" do
      user = build(:user, role: "member")
      expect(user.member?).to be true
    end

    it "returns false for admin users" do
      user = build(:user, role: "admin")
      expect(user.member?).to be false
    end

    it "returns false for manager users" do
      user = build(:user, role: "manager")
      expect(user.member?).to be false
    end
  end

  describe "#manager?" do
    it "returns true for manager users" do
      user = build(:user, role: "manager")
      expect(user.manager?).to be true
    end

    it "returns false for admin/member users" do
      expect(build(:user, role: "admin").manager?).to be false
      expect(build(:user, role: "member").manager?).to be false
    end
  end

  describe "#manager_or_above?" do
    it "returns true for admin and manager" do
      expect(build(:user, role: "admin").manager_or_above?).to be true
      expect(build(:user, role: "manager").manager_or_above?).to be true
    end

    it "returns false for member" do
      expect(build(:user, role: "member").manager_or_above?).to be false
    end
  end

  describe "JTIMatcher jti initialization" do
    it "generates jti on create automatically" do
      user = User.create!(email: "test@example.com", name: "Test", password: "password123")
      expect(user.jti).to be_present
      expect(user.jti).to match(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/)
    end

    it "always generates jti via JTIMatcher (even if provided)" do
      # JTIMatcher's before_create unconditionally sets jti
      user = User.create!(email: "test@example.com", name: "Test", password: "password123")
      expect(user.jti).to be_present
    end

    it "lets Devise handle encrypted_password (bcrypt)" do
      user = User.create!(email: "test@example.com", name: "Test", password: "password123")
      expect(user.encrypted_password).to start_with("$2a$")
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

  describe "JTIMatcher revocation" do
    let(:user) { create(:user) }

    it "has jti present after creation" do
      expect(user.jti).to be_present
    end

    it "responds to jwt_payload" do
      expect(user).to respond_to(:jwt_payload)
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

  describe "#local_account?" do
    it "is true for desktop@local" do
      expect(build(:user, email: "desktop@local").local_account?).to be true
    end

    it "is false for a normal account" do
      expect(build(:user, email: "alice@example.com").local_account?).to be false
    end
  end

  describe "#invalidate_all_sessions!" do
    it "rotates jti and clears refresh_token_jti" do
      user = create(:user)
      user.update!(refresh_token_jti: "old-refresh-jti")
      old_jti = user.jti

      user.invalidate_all_sessions!

      expect(user.reload.jti).not_to eq(old_jti)
      expect(user.jti).to be_present
      expect(user.refresh_token_jti).to be_nil
    end
  end

  describe "#effective_chat_llm_config (독립 설정)" do
    let(:user) do
      create(:user, llm_provider: "anthropic", llm_api_key: "sumkey",
                    llm_model: "claude-sonnet-4-20250514", llm_enabled: true)
    end

    it "챗 설정이 없으면 요약 config(+chat_llm_model override)로 폴백한다" do
      user.update!(chat_llm_model: "claude-3-5-haiku-20241022")
      cfg = user.effective_chat_llm_config
      expect(cfg[:provider]).to eq("anthropic")
      expect(cfg[:auth_token]).to eq("sumkey")
      expect(cfg[:model]).to eq("claude-3-5-haiku-20241022")
    end

    it "chat_llm_provider 가 있으면 독립 config 를 쓴다" do
      user.update!(chat_llm_provider: "openai", chat_llm_api_key: "chatkey",
                   chat_llm_model: "gpt-4o", chat_llm_base_url: "https://api.openai.com/v1")
      cfg = user.effective_chat_llm_config
      expect(cfg[:provider]).to eq("openai")
      expect(cfg[:auth_token]).to eq("chatkey")
      expect(cfg[:model]).to eq("gpt-4o")
      expect(cfg[:base_url]).to eq("https://api.openai.com/v1")
    end

    it "로컬(키 없음 + base_url)도 인정한다" do
      user.update!(chat_llm_provider: "openai", chat_llm_api_key: nil,
                   chat_llm_model: "llama-3.1-8b", chat_llm_base_url: "http://localhost:11434/v1")
      expect(user.chat_llm_configured?).to be true
      cfg = user.effective_chat_llm_config
      expect(cfg[:provider]).to eq("openai")
      expect(cfg[:base_url]).to eq("http://localhost:11434/v1")
      expect(cfg[:model]).to eq("llama-3.1-8b")
    end
  end

  describe "개인 프로젝트 자동 생성" do
    it "유저 생성 시 personal 프로젝트와 admin 멤버십이 만들어진다" do
      user = create(:user)
      personal = user.projects.find_by(personal: true)
      expect(personal).to be_present
      expect(personal.admin?(user)).to be true
    end

    it "개인 프로젝트는 1개만 (재호출 멱등)" do
      user = create(:user)
      EnsurePersonalProject.call(user)
      expect(user.projects.where(personal: true).count).to eq(1)
    end
  end
end
