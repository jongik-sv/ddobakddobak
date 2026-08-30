# 세컨드 브레인 외부 공개 API(/api/ext) 인증용 PAT(Personal Access Token).
# 평문("ddbk_" + 43자 랜덤)은 발급 시 1회만 반환하고 절대 저장하지 않는다 — 저장되는 건
# SHA256 digest뿐이다. Ext::V1::BaseController#authenticate_api_token! 이 이 모델로 인증한다.
class ApiToken < ApplicationRecord
  belongs_to :user
  has_many :api_token_audit_logs, dependent: :destroy

  PLAINTEXT_PREFIX = "ddbk_".freeze
  SCOPES = %w[meetings:read transcripts:read summaries:read search:read meetings:write].freeze

  # last_used_at을 매 요청마다 쓰지 않기 위한 스로틀 간격.
  LAST_USED_THROTTLE = 60.seconds

  validates :name, presence: true
  validates :token_digest, presence: true, uniqueness: true
  validates :token_prefix, presence: true
  validates :expires_at, presence: true
  validate :scopes_present_and_valid
  validate :expires_at_in_future, on: :create

  # 발급: 평문은 반환값에만 담겨 나가고 레코드엔 digest/prefix만 남는다.
  def self.issue!(user:, name:, scopes:, expires_at:, project_ids: nil, folder_ids: nil)
    plaintext = PLAINTEXT_PREFIX + SecureRandom.alphanumeric(43)
    token = new(
      user: user,
      name: name,
      expires_at: expires_at,
      project_ids: project_ids,
      folder_ids: folder_ids,
      token_digest: digest_for(plaintext),
      token_prefix: plaintext[0, 12]
    )
    token.scopes = scopes
    token.save!
    [ token, plaintext ]
  end

  # 조회: digest 매칭 + 활성(폐기 안 됨·미만료) 상태만 인증 성공으로 취급.
  def self.authenticate(plaintext)
    return nil if plaintext.blank?

    token = find_by(token_digest: digest_for(plaintext))
    return nil unless token&.active?

    token
  end

  def self.digest_for(plaintext)
    Digest::SHA256.hexdigest(plaintext)
  end
  private_class_method :digest_for

  def active?
    revoked_at.nil? && expires_at.present? && expires_at.future?
  end

  def revoke!
    update_column(:revoked_at, Time.current)
  end

  def has_scope?(scope)
    scopes.include?(scope.to_s)
  end

  # 매 요청마다 UPDATE를 내지 않도록 60초 이내 재갱신은 건너뛴다. validation을 타지 않는
  # update_column을 쓴다 — 만료 임박/직후 토큰이라도 최근 사용 기록은 남겨야 하기 때문.
  def touch_last_used!
    return if last_used_at.present? && last_used_at > LAST_USED_THROTTLE.ago

    update_column(:last_used_at, Time.current)
  end

  def scopes
    parsed = JSON.parse(self[:scopes].presence || "[]")
    parsed.is_a?(Array) ? parsed.map(&:to_s) : []
  rescue JSON::ParserError, TypeError
    []
  end

  def scopes=(value)
    self[:scopes] = Array(value).map(&:to_s).to_json
  end

  def project_ids
    parse_id_array(self[:project_ids])
  end

  def project_ids=(value)
    self[:project_ids] = serialize_id_array(value)
  end

  def folder_ids
    parse_id_array(self[:folder_ids])
  end

  def folder_ids=(value)
    self[:folder_ids] = serialize_id_array(value)
  end

  private

  # project_ids/folder_ids는 미지정(제한 없음)을 nil로 표현한다.
  # 오케스트레이터 판단: 빈 배열([])도 "제한 없음"과 동일하게 취급한다(회의 0건으로 좁혀지는
  # 게 아니라 무제한) — serialize_id_array에서 []를 nil로 정규화해 저장하므로, 읽는 쪽은
  # 항상 nil 아니면 비어있지 않은 배열만 보게 된다.
  def parse_id_array(raw)
    return nil if raw.nil?

    parsed = JSON.parse(raw)
    parsed.is_a?(Array) ? parsed.map(&:to_i) : nil
  rescue JSON::ParserError, TypeError
    nil
  end

  def serialize_id_array(value)
    return nil if value.nil?

    ids = Array(value).map(&:to_i)
    ids.empty? ? nil : ids.to_json
  end

  def scopes_present_and_valid
    if scopes.blank?
      errors.add(:scopes, "최소 1개 이상 필요합니다")
    elsif (scopes - SCOPES).any?
      errors.add(:scopes, "허용되지 않은 스코프입니다: #{(scopes - SCOPES).join(', ')}")
    end
  end

  def expires_at_in_future
    return if expires_at.blank?

    errors.add(:expires_at, "미래 시각이어야 합니다") unless expires_at.future?
  end
end
