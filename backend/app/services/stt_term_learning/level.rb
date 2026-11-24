module SttTermLearning
  # 학습 레벨(Folder / Project / global) 값 객체.
  Level = Struct.new(:type, :owner) do
    def self.global
      new("global", nil)
    end

    def self.for(owner)
      case owner
      when ::Folder then new("Folder", owner)
      when ::Project then new("Project", owner)
      else raise ArgumentError, "unsupported owner: #{owner.inspect}"
      end
    end

    def self.from_ref(type:, id:)
      case type.to_s
      when "global" then global
      when "Folder" then self.for(::Folder.find(id))
      when "Project" then self.for(::Project.find(id))
      else raise ActiveRecord::RecordNotFound, "unknown level type: #{type}"
      end
    end

    def global? = type == "global"

    def key
      global? ? "global" : "#{type}:#{owner.id}"
    end

    def ref
      { type: type, id: owner&.id }
    end

    def name
      global? ? "전역" : owner.name
    end

    def project_id
      case type
      when "Folder" then owner.project_id
      when "Project" then owner.id
      end
    end

    def linked_files
      if global?
        [::DomainFile.stt_auto.find_by(auto_owner_type: nil, project_id: nil)].compact
      else
        owner.domain_files.order("domain_file_links.id").to_a
      end
    end

    def parent
      case type
      when "Folder"
        if owner.parent
          self.class.for(owner.parent)
        elsif owner.project
          self.class.for(owner.project)
        else
          self.class.global
        end
      when "Project" then self.class.global
      end
    end

    def descendant_levels
      case type
      when "Folder"
        ids = owner.subtree_ids - [owner.id]
        ::Folder.kept.where(id: ids).order(:id).map { |f| self.class.for(f) }
      when "Project"
        ::Folder.kept.where(project_id: owner.id).order(:id).map { |f| self.class.for(f) }
      else
        ::Project.kept.order(:id).flat_map { |p| [self.class.for(p)] + self.class.for(p).descendant_levels }
      end
    end

    def ==(other)
      other.is_a?(Level) && key == other.key
    end
    alias_method :eql?, :==

    def hash
      key.hash
    end
  end
end
