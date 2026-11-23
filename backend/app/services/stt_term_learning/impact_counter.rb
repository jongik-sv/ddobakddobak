module SttTermLearning
  # 레벨에 적용되는 회의 수(휴지통 제외). domain_file_id 를 주면 그 파일을 exclude 한 회의는 뺀다.
  module ImpactCounter
    module_function

    def count(level, domain_file_id: nil)
      scope = ::Meeting.kept
      case level.type
      when "Project" then scope = scope.where(project_id: level.owner.id)
      when "Folder" then scope = scope.where(folder_id: ::Folder.kept.where(id: level.owner.subtree_ids).select(:id))
      end
      if domain_file_id
        excluded = ::DomainFileLink.excluded.where(owner_type: "Meeting", domain_file_id: domain_file_id).select(:owner_id)
        scope = scope.where.not(id: excluded)
      end
      scope.count
    end
  end
end
