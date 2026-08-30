require "rails_helper"

RSpec.describe ApiToken do
  let(:user) { create(:user) }

  describe ".issue!" do
    it "평문은 ddbk_ 접두 + digest는 저장되지 않는다" do
      token, plaintext = ApiToken.issue!(
        user: user, name: "테스트 토큰", scopes: %w[meetings:read], expires_at: 1.day.from_now
      )

      expect(plaintext).to start_with("ddbk_")
      expect(token.token_prefix).to eq(plaintext[0, 12])
      expect(token.token_digest).to eq(Digest::SHA256.hexdigest(plaintext))
      expect(token.reload.attributes).not_to have_value(plaintext)
    end

    it "만료 시각이 과거면 실패한다" do
      expect {
        ApiToken.issue!(user: user, name: "x", scopes: %w[meetings:read], expires_at: 1.day.ago)
      }.to raise_error(ActiveRecord::RecordInvalid)
    end

    it "허용되지 않은 스코프는 실패한다" do
      expect {
        ApiToken.issue!(user: user, name: "x", scopes: %w[not_a_real_scope], expires_at: 1.day.from_now)
      }.to raise_error(ActiveRecord::RecordInvalid)
    end

    it "스코프가 비어있으면 실패한다" do
      expect {
        ApiToken.issue!(user: user, name: "x", scopes: [], expires_at: 1.day.from_now)
      }.to raise_error(ActiveRecord::RecordInvalid)
    end

    it "project_ids/folder_ids 미지정이면 nil(제한 없음)로 왕복한다" do
      token, = ApiToken.issue!(user: user, name: "x", scopes: %w[meetings:read], expires_at: 1.day.from_now)
      expect(token.reload.project_ids).to be_nil
      expect(token.reload.folder_ids).to be_nil
    end

    it "project_ids/folder_ids를 지정하면 정수 배열로 왕복한다" do
      token, = ApiToken.issue!(
        user: user, name: "x", scopes: %w[meetings:read], expires_at: 1.day.from_now,
        project_ids: [ 1, 2 ], folder_ids: [ 3 ]
      )
      expect(token.reload.project_ids).to eq([ 1, 2 ])
      expect(token.reload.folder_ids).to eq([ 3 ])
    end

    # 오케스트레이터 판단(수정 라운드 1): []는 "회의 0건으로 제한"이 아니라 nil과 동일하게
    # "제한 없음"으로 취급한다.
    it "project_ids/folder_ids가 []이면 nil(제한 없음)로 정규화된다" do
      token, = ApiToken.issue!(
        user: user, name: "x", scopes: %w[meetings:read], expires_at: 1.day.from_now,
        project_ids: [], folder_ids: []
      )
      expect(token.reload.project_ids).to be_nil
      expect(token.reload.folder_ids).to be_nil
    end
  end

  describe ".authenticate" do
    it "정상 토큰은 인증된다" do
      _, plaintext = ApiToken.issue!(user: user, name: "x", scopes: %w[meetings:read], expires_at: 1.day.from_now)
      expect(ApiToken.authenticate(plaintext)).to be_a(ApiToken)
    end

    it "존재하지 않는 평문은 nil" do
      expect(ApiToken.authenticate("ddbk_" + SecureRandom.alphanumeric(43))).to be_nil
    end

    it "만료된 토큰은 nil" do
      token, plaintext = ApiToken.issue!(user: user, name: "x", scopes: %w[meetings:read], expires_at: 1.day.from_now)
      token.update_column(:expires_at, 1.hour.ago)
      expect(ApiToken.authenticate(plaintext)).to be_nil
    end

    it "폐기된 토큰은 nil" do
      token, plaintext = ApiToken.issue!(user: user, name: "x", scopes: %w[meetings:read], expires_at: 1.day.from_now)
      token.revoke!
      expect(ApiToken.authenticate(plaintext)).to be_nil
    end

    it "blank 입력은 nil" do
      expect(ApiToken.authenticate(nil)).to be_nil
      expect(ApiToken.authenticate("")).to be_nil
    end
  end

  describe "#revoke!" do
    it "만료된 토큰도 revoke! 가능하다 (update_column, validation 미경유)" do
      token, = ApiToken.issue!(user: user, name: "x", scopes: %w[meetings:read], expires_at: 1.day.from_now)
      token.update_column(:expires_at, 1.hour.ago)
      expect { token.revoke! }.not_to raise_error
      expect(token.reload.revoked_at).to be_present
    end
  end

  describe "#has_scope?" do
    it "스코프 포함 여부를 반환한다" do
      token = create(:api_token, scopes: %w[meetings:read search:read])
      expect(token.has_scope?("meetings:read")).to be true
      expect(token.has_scope?("meetings:write")).to be false
    end
  end

  describe "#touch_last_used!" do
    it "last_used_at이 nil이면 갱신한다" do
      token = create(:api_token)
      expect { token.touch_last_used! }.to change { token.reload.last_used_at }.from(nil)
    end

    it "60초 이내 재호출은 갱신하지 않는다" do
      token = create(:api_token, last_used_at: 10.seconds.ago)
      expect { token.touch_last_used! }.not_to(change { token.reload.last_used_at })
    end

    it "60초 경과 후에는 갱신한다" do
      token = create(:api_token, last_used_at: 61.seconds.ago)
      expect { token.touch_last_used! }.to(change { token.reload.last_used_at })
    end
  end
end
