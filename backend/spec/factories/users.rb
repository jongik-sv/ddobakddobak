FactoryBot.define do
  factory :user do
    sequence(:email) { |n| "user#{n}@example.com" }
    name { "Test User" }
    password { "password123" }

    trait :with_llm_config do
      llm_provider { "anthropic" }
      llm_api_key { "sk-ant-test-key-12345" }
      llm_model { "claude-sonnet-4-6" }
    end

    trait :with_openai_config do
      llm_provider { "openai" }
      llm_api_key { "sk-openai-test-key-12345" }
      llm_model { "gpt-4o" }
    end

    trait :with_custom_endpoint do
      llm_provider { "openai" }
      llm_api_key { "ollama" }
      llm_model { "qwen3.5:latest" }
      llm_base_url { "http://localhost:11434/v1" }
    end
  end
end
