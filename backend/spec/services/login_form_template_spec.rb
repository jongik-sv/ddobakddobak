require "rails_helper"

RSpec.describe LoginFormTemplate do
  describe ".render" do
    it "returns a complete HTML document" do
      html = described_class.render(
        callback: "ddobak://",
        error: nil,
        csrf_token: "test-token",
        action_url: "/auth/web_login"
      )

      expect(html).to include("<!DOCTYPE html>")
      expect(html).to include("또박또박")
      expect(html).to include("test-token")
    end

    it "includes form with email and password fields" do
      html = described_class.render(
        callback: "ddobak://",
        error: nil,
        csrf_token: "test-token",
        action_url: "/auth/web_login"
      )

      expect(html).to include('type="email"')
      expect(html).to include('type="password"')
      expect(html).to include('name="email"')
      expect(html).to include('name="password"')
    end

    it "includes callback as hidden field" do
      html = described_class.render(
        callback: "ddobak://mypath",
        error: nil,
        csrf_token: "test-token",
        action_url: "/auth/web_login"
      )

      expect(html).to include("ddobak://mypath")
      expect(html).to include('name="callback"')
    end

    it "includes CSRF token as hidden field" do
      html = described_class.render(
        callback: "ddobak://",
        error: nil,
        csrf_token: "my-csrf-token-123",
        action_url: "/auth/web_login"
      )

      expect(html).to include('name="authenticity_token"')
      expect(html).to include("my-csrf-token-123")
    end

    it "includes error message when present" do
      html = described_class.render(
        callback: "ddobak://",
        error: "잘못된 비밀번호",
        csrf_token: "test-token",
        action_url: "/auth/web_login"
      )

      expect(html).to include("잘못된 비밀번호")
    end

    it "does not include error section when error is nil" do
      html = described_class.render(
        callback: "ddobak://",
        error: nil,
        csrf_token: "test-token",
        action_url: "/auth/web_login"
      )

      expect(html).not_to include("bg-red-50")
    end

    it "escapes XSS in callback parameter" do
      html = described_class.render(
        callback: "<script>alert(1)</script>",
        error: nil,
        csrf_token: "test-token",
        action_url: "/auth/web_login"
      )

      expect(html).not_to include("<script>alert(1)</script>")
      expect(html).to include("&lt;script&gt;")
    end

    it "escapes XSS in error parameter" do
      html = described_class.render(
        callback: "ddobak://",
        error: "<img onerror=alert(1)>",
        csrf_token: "test-token",
        action_url: "/auth/web_login"
      )

      expect(html).not_to include("<img onerror=alert(1)>")
      expect(html).to include("&lt;img onerror=alert(1)&gt;")
    end

    it "includes Tailwind CSS CDN" do
      html = described_class.render(
        callback: "ddobak://",
        error: nil,
        csrf_token: "test-token",
        action_url: "/auth/web_login"
      )

      expect(html).to include("cdn.tailwindcss.com")
    end
  end

  describe ".render_error" do
    it "returns an error HTML page" do
      html = described_class.render_error(message: "오류 메시지")

      expect(html).to include("<!DOCTYPE html>")
      expect(html).to include("오류 메시지")
      expect(html).to include("오류")
    end

    it "escapes XSS in error message" do
      html = described_class.render_error(message: "<script>alert(1)</script>")

      expect(html).not_to include("<script>alert(1)</script>")
      expect(html).to include("&lt;script&gt;")
    end
  end
end
