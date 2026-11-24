module SttTermLearning
  module LevelChain
    module_function

    # 가까운 폴더 → 상위 폴더 … → 프로젝트 → global. 회의 자체 링크는 포함하지 않는다.
    def for_meeting(meeting)
      chain = []
      folder = meeting.folder
      if folder
        chain << Level.for(folder)
        folder.ancestor_records.each { |f| chain << Level.for(f) }
      end
      project = meeting.project || folder&.project
      chain << Level.for(project) if project
      chain << Level.global
    end

    def upward_from(level)
      chain = []
      current = level
      while current
        chain << current
        current = current.parent
      end
      chain
    end
  end
end
