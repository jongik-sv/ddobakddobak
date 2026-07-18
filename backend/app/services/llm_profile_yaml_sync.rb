# 서버 풀 프로필 참조(active_profile_id/chat_profile_id)를 settings.yaml의 기존 구조
# (active_preset + presets[preset_id] / chat)로 실체화한다. 부팅 load_env.rb가 DB 없이
# yaml만 읽어도 되게 하는 캐시 계층 — 참조 의미론(프로필 편집 즉시 반영)은
# after_server_pool_change 훅이 재실체화로 보장한다.
class LlmProfileYamlSync
  def self.apply!(cfg)
    llm = (cfg["llm"] ||= {})

    if (pid = llm["active_profile_id"]).present?
      if (profile = LlmProfile.server_pool.find_by(id: pid))
        llm["active_preset"] = profile.preset_id
        (llm["presets"] ||= {})[profile.preset_id] = materialize(profile)
      else
        llm.delete("active_profile_id")
      end
    end

    if (cid = llm["chat_profile_id"]).present?
      if (profile = LlmProfile.server_pool.find_by(id: cid))
        llm["chat"] = {
          "preset_id" => profile.preset_id,
          "provider" => profile.provider,
          "auth_token" => profile.auth_token.to_s,
          "base_url" => profile.base_url.to_s,
          "model" => profile.model.to_s
        }.reject { |_, v| v.blank? }
      else
        llm.delete("chat_profile_id")
      end
    end

    cfg
  end

  def self.materialize(profile)
    {
      "provider" => profile.provider,
      "auth_token" => profile.auth_token,
      "base_url" => profile.base_url,
      "model" => profile.model,
      "max_input_tokens" => profile.max_input_tokens || 200_000,
      "max_output_tokens" => profile.max_output_tokens || 10_000
    }.compact
  end
end
