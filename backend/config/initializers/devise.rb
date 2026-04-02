Devise.setup do |config|
  config.mailer_sender = "noreply@ddobak.local"

  require "devise/orm/active_record"

  # ── API mode settings ──
  config.navigational_formats = []       # API only (no redirects)
  config.sign_out_via = :delete

  # ── JWT settings ──
  config.jwt do |jwt|
    jwt.secret = Rails.application.credentials.devise_jwt_secret_key ||
                 ENV.fetch("DEVISE_JWT_SECRET_KEY") { Rails.application.secret_key_base }
    jwt.expiration_time = 24.hours.to_i   # Access Token expiry: 24 hours
    jwt.dispatch_requests = [
      ["POST", %r{^/auth/login$}]
    ]
    jwt.revocation_requests = [
      ["DELETE", %r{^/auth/logout$}]
    ]
  end
end
