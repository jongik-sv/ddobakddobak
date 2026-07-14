# This file should ensure the existence of records required to run the application in every environment (production,
# development, test). The code here should be idempotent so that it can be executed at any point in every environment.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).
#
# Example:
#
#   ["Action", "Comedy", "Drama", "Horror"].each do |genre_name|
#     MovieGenre.find_or_create_by!(name: genre_name)
#   end

# 회의 유형별 프롬프트 템플릿
PromptTemplate::DEFAULT_TEMPLATES.each do |meeting_type, attrs|
  PromptTemplate.find_or_create_by!(meeting_type: meeting_type) do |t|
    t.label = attrs[:label]
    t.sections_prompt = attrs[:sections_prompt]
    t.is_default = true
  end
end

# 로컬(맥 데스크톱 단독) 자동로그인 admin 계정 — loopback 요청의 기본 사용자.
# DefaultUserLookup#local_default_user 와 동일(멱등 find_or_create). 비밀번호 없이 생성
# (로컬은 loopback 신뢰 인증이라 비번 불필요). fresh DB에서도 처음부터 존재하도록 seed에 포함.
User.find_or_create_by!(email: User::LOCAL_EMAIL) do |u|
  u.name = "관리자"
  u.role = "admin"
end
