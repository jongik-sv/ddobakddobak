module Api
  module V1
    # 저장소 루트 ext_skill/ (LLM 에이전트용 회의 API 스킬 패키지)을
    # config.json({"api_url": ...})과 함께 zip으로 묶어 내려준다.
    # ⚠️ 인증된 사용자면 누구나 다운로드 가능 — 패키지 자체엔 토큰이 없고
    # 사용자가 별도로 발급받은 API 토큰을 스스로 채워 넣는 구조.
    class SkillPackagesController < ApplicationController
      before_action :authenticate_user!

      SOURCE_DIR = Rails.root.join("..", "ext_skill").expand_path.freeze

      # GET /api/ext/v1/skill_package (라우트는 Task A가 추가 예정)
      def show
        buffer = Zip::OutputStream.write_buffer do |zos|
          source_files.each do |path|
            entry_name = path.relative_path_from(SOURCE_DIR).to_s
            zos.put_next_entry(entry_name)
            zos.write(path.read(mode: "rb"))
          end

          zos.put_next_entry("config.json")
          zos.write(JSON.generate({ api_url: request.base_url }))
        end

        send_data buffer.string,
          type:        "application/zip",
          disposition: "attachment",
          filename:    "ddobak-skill.zip"
      end

      private

      # ext_skill/ 하위 전체 파일(디렉토리 제외)을 재귀 수집.
      def source_files
        return [] unless SOURCE_DIR.directory?

        Dir.glob(SOURCE_DIR.join("**", "*")).map { |p| Pathname.new(p) }.select(&:file?)
      end
    end
  end
end
