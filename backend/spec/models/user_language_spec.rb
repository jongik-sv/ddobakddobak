require "rails_helper"

RSpec.describe User, "language settings", type: :model do
  describe "migration" do
    it "adds language columns to users table" do
      columns = User.column_names
      expect(columns).to include("language_mode")
      expect(columns).to include("selected_languages")
    end
  end

  describe "#selected_languages_list" do
    it "parses a comma-separated string into an array" do
      user = build(:user, selected_languages: "ko,en,ja")
      expect(user.selected_languages_list).to eq(%w[ko en ja])
    end

    it "trims whitespace and drops blanks" do
      user = build(:user, selected_languages: " ko , , en ")
      expect(user.selected_languages_list).to eq(%w[ko en])
    end

    it "returns an empty array when nil" do
      user = build(:user, selected_languages: nil)
      expect(user.selected_languages_list).to eq([])
    end
  end

  describe "#language_configured?" do
    it "is true when the user has selected languages" do
      user = build(:user, selected_languages: "ko")
      expect(user.language_configured?).to be true
    end

    it "is false when no languages are selected" do
      user = build(:user, selected_languages: nil)
      expect(user.language_configured?).to be false
    end
  end

  describe "#effective_language_config" do
    context "when the user has personal language settings" do
      it "returns the user's mode and languages" do
        user = build(:user, language_mode: "multi", selected_languages: "ko,en")
        expect(user.effective_language_config).to eq(mode: "multi", languages: %w[ko en])
      end

      it "defaults mode to single when blank" do
        user = build(:user, language_mode: nil, selected_languages: "ko")
        expect(user.effective_language_config).to eq(mode: "single", languages: %w[ko])
      end
    end

    context "when the user has no personal language settings" do
      it "falls back to the server default" do
        user = build(:user, selected_languages: nil)
        allow(described_class).to receive(:server_default_language_config)
          .and_return(mode: "single", languages: %w[ko])
        expect(user.effective_language_config).to eq(mode: "single", languages: %w[ko])
      end
    end
  end

  describe ".server_default_language_config" do
    before do
      allow(ENV).to receive(:fetch).and_call_original
    end

    it "reads mode and languages from ENV" do
      allow(ENV).to receive(:fetch).with("LANGUAGE_MODE", "single").and_return("multi")
      allow(ENV).to receive(:fetch).with("SELECTED_LANGUAGES", "ko").and_return("ko,en")
      expect(described_class.server_default_language_config)
        .to eq(mode: "multi", languages: %w[ko en])
    end

    it "defaults to single Korean when ENV is unset" do
      allow(ENV).to receive(:fetch).with("LANGUAGE_MODE", "single").and_return("single")
      allow(ENV).to receive(:fetch).with("SELECTED_LANGUAGES", "ko").and_return("ko")
      expect(described_class.server_default_language_config)
        .to eq(mode: "single", languages: %w[ko])
    end
  end
end
