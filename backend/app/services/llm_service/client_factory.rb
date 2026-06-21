class LlmService
  # LLM 설정 해석 + SDK 클라이언트 구성 — 인스턴스 상태에 의존하지 않는 순수 팩토리.
  # module_function 으로 모듈 함수 + private 인스턴스 메서드를 동시에 제공한다.
  # (LlmService 가 include 하므로 기존 private 인스턴스 메서드 계약도 보존된다.)
  # 중첩(class LlmService > module ClientFactory)으로 둬 build_client 의 CLI_PROVIDERS 등
  # LlmService 상수가 lexical scope 로 해석되게 한다.
  module ClientFactory
    module_function

    def resolve_config(llm_config)
      if llm_config.present?
        {
          provider: llm_config[:provider] || llm_config["provider"] || "anthropic",
          auth_token: llm_config[:auth_token] || llm_config["auth_token"],
          model: llm_config[:model] || llm_config["model"],
          base_url: llm_config[:base_url] || llm_config["base_url"],
          max_output_tokens: (llm_config[:max_output_tokens] || llm_config["max_output_tokens"])&.to_i
        }
      else
        server_default_config
      end
    end

    def server_default_config
      provider = ENV.fetch("LLM_PROVIDER", "anthropic")
      {
        provider: provider,
        auth_token: provider == "openai" ? ENV["OPENAI_API_KEY"] : ENV["ANTHROPIC_AUTH_TOKEN"],
        model: ENV.fetch("LLM_MODEL", "claude-sonnet-4-20250514"),
        base_url: provider == "openai" ? ENV["OPENAI_BASE_URL"] : ENV["ANTHROPIC_BASE_URL"],
        max_output_tokens: ENV.fetch("LLM_MAX_OUTPUT_TOKENS", "10000").to_i
      }
    end

    def build_client(config)
      case config[:provider]
      when "openai"
        OpenAI::Client.new(
          access_token: config[:auth_token].presence || "local",
          uri_base: config[:base_url].presence,
          request_timeout: ENV.fetch("LLM_REQUEST_TIMEOUT", "600").to_i
        )
      when *CLI_PROVIDERS
        nil # CLI 프로바이더는 SDK 클라이언트 불필요 — 실행 시점에 Open3 로 호출
      else # anthropic (default)
        kwargs = { api_key: config[:auth_token] }
        kwargs[:base_url] = config[:base_url] if config[:base_url].present?
        Anthropic::Client.new(**kwargs)
      end
    end
  end
end
