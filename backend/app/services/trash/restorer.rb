module Trash
  class Restorer
    TYPES = [Meeting, Folder, Project].freeze

    def self.call(group_id)
      ActiveRecord::Base.transaction do
        TYPES.each do |klass|
          klass.where(trash_group_id: group_id).find_each do |rec|
            rec.restore!
            detach_orphan(rec)
          end
        end
      end
    end

    def self.detach_orphan(rec)
      if rec.is_a?(Meeting) && rec.folder_id.present?
        folder = Folder.find_by(id: rec.folder_id)
        rec.update_columns(folder_id: nil) if folder&.trashed?
      end
    end
  end
end
