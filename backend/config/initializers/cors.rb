# Be sure to restart your server when you modify this file.

# Avoid CORS issues when API is called from the frontend app.
# Handle Cross-Origin Resource Sharing (CORS) in order to accept cross-origin Ajax requests.

# Read more: https://github.com/cyu/rack-cors

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    # Default origins (Tauri local development)
    allowed_origins = [
      "http://localhost:13325",
      "tauri://localhost",
      "https://tauri.localhost"
    ]

    # Server mode: CORS_ORIGIN env var for additional origins
    if ENV["CORS_ORIGIN"].present?
      allowed_origins += ENV["CORS_ORIGIN"].split(",").map(&:strip)
    end

    origins(*allowed_origins)

    resource "*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head],
      expose: ["Authorization"]
  end
end
