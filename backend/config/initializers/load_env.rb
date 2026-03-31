# 프로젝트 루트의 .env 파일에서 환경 변수를 로드한다.
# 이미 설정된 ENV 값은 덮어쓰지 않는다 (Tauri 등에서 직접 전달한 값 우선).
env_path = Rails.root.join("..", ".env")

if File.exist?(env_path)
  File.readlines(env_path).each do |line|
    line = line.strip
    next if line.empty? || line.start_with?("#")

    key, value = line.split("=", 2)
    next unless key && value

    key = key.strip
    value = value.strip
    # 따옴표 제거
    value = value[1..-2] if (value.start_with?('"') && value.end_with?('"')) ||
                            (value.start_with?("'") && value.end_with?("'"))

    ENV[key] ||= value
  end
end
