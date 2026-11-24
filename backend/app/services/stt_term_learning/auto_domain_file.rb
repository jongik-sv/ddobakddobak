module SttTermLearning
  # 레벨별 "STT 오인식(자동)" 도메인 파일의 조회·생성.
  module AutoDomainFile
    NAME_PREFIX = "STT 오인식(자동)".freeze
    MAX_NAME = 100

    module_function

    def find_for(level)
      scope = ::DomainFile.stt_auto
      if level.global?
        scope.find_by(auto_owner_type: nil, project_id: nil)
      else
        scope.find_by(auto_owner_type: level.type, auto_owner_id: level.owner.id)
      end
    end

    def find_or_create_for!(level, fallback_creator:)
      file = find_for(level)
      unless file
        begin
          file = ::DomainFile.create!(
            name: name_for(level),
            content: "",
            project_id: level.project_id,
            creator: ::User.where(role: "admin").order(:id).first || fallback_creator,
            auto_kind: ::DomainFile::AUTO_KIND_STT,
            auto_owner_type: level.global? ? nil : level.type,
            auto_owner_id: level.global? ? nil : level.owner.id
          )
        rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
          # 동시 생성 경합(유니크 인덱스/이름 검증) → 재조회. 없으면 진짜 오류.
          file = find_for(level)
          raise unless file
        end
      end
      ::DomainFileLink.find_or_create_by!(domain_file: file, owner: level.owner) unless level.global?
      file
    end

    def name_for(level)
      case level.type
      when "global" then NAME_PREFIX
      when "Project" then fit("#{NAME_PREFIX} · ", level.owner.name, "")
      else
        folder = level.owner
        path = (folder.ancestor_records.reverse + [folder]).map(&:name).join("/")
        fit("#{NAME_PREFIX} · ", path, " [F#{folder.id}]")
      end
    end

    # 가운데(경로)만 잘라 전체 길이를 MAX_NAME 이하로 맞춘다. 접두·접미는 보존.
    def fit(prefix, body, suffix)
      room = MAX_NAME - prefix.length - suffix.length
      "#{prefix}#{body.to_s[0, [room, 0].max]}#{suffix}"
    end
  end
end
