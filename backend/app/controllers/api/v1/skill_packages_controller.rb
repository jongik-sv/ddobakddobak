module Api
  module V1
    # 저장소 루트 ext_skill/ (LLM 에이전트용 회의 API 스킬 패키지)을
    # .env.ddobak(dotenv 형식 설정 템플릿)과 함께 zip으로 묶어 내려준다.
    # ⚠️ 인증된 사용자면 누구나 다운로드 가능 — 패키지 자체엔 토큰이 없고
    # 사용자가 별도로 발급받은 API 토큰을 스스로 채워 넣는 구조.
    class SkillPackagesController < ApplicationController
      before_action :authenticate_user!

      SOURCE_DIR = Rails.root.join("..", "ext_skill").expand_path.freeze

      # GET /api/v1/skill_package (Task A가 routes.rb에 추가 — Api::V1 네임스페이스,
      # 계약표의 /api/ext/v1/* PAT 엔드포인트와는 별도 라우트).
      def show
        unless SOURCE_DIR.directory?
          return render json: { error: { code: "skill_package_missing", message: "ext_skill/ 디렉토리를 찾을 수 없습니다" } },
            status: :internal_server_error
        end

        buffer = Zip::OutputStream.write_buffer do |zos|
          source_files.each do |path|
            entry_name = path.relative_path_from(SOURCE_DIR).to_s
            zos.put_next_entry(entry_name)
            zos.write(path.read(mode: "rb"))
          end

          zos.put_next_entry(".env.ddobak")
          zos.write(dotenv_template)
        end

        send_data buffer.string,
          type:        "application/zip",
          disposition: "attachment",
          filename:    "ddobak-skill.zip"
      end

      private

      # 스크립트가 그대로 읽는 dotenv 형식 설정 템플릿. api_url만 채워서 내려주고
      # 토큰·INSECURE 줄은 주석 처리해 사용자가 직접 채우게 한다.
      def dotenv_template
        <<~ENV
          DDOBAK_API_URL=#{request.base_url}
          # DDOBAK_API_TOKEN=ddbk_...   ← 설정 → API 토큰에서 발급한 값을 넣거나, 발급 화면에서 이 파일을 통째로 내려받아 교체하세요
          # DDOBAK_API_INSECURE=1       ← 자체 서명 인증서(사설 HTTPS)일 때만 주석 해제
        ENV
      end

      # ext_skill/ 하위 전체 파일(디렉토리·__pycache__·*.pyc 제외)을 재귀 수집.
      def source_files
        return [] unless SOURCE_DIR.directory?

        Dir.glob(SOURCE_DIR.join("**", "*"))
          .map { |p| Pathname.new(p) }
          .select(&:file?)
          .reject { |p| p.to_s.include?("__pycache__") || p.extname == ".pyc" }
      end
    end
  end
end
