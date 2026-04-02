module TokenMasking
  extend ActiveSupport::Concern

  private

  def mask_token(token)
    return "****" if token.blank? || token.length <= 8
    "#{token[0..3]}#{"*" * (token.length - 8)}#{token[-4..]}"
  end
end
