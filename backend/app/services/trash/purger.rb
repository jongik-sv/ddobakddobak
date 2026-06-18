module Trash
  class Purger
    def self.call(group_id)
      ActiveRecord::Base.transaction do
        Meeting.where(trash_group_id: group_id).find_each do |m|
          FileUtils.rm_f(m.audio_file_path) if m.audio_file_path.present?
          m.destroy
        end
        Folder.where(trash_group_id: group_id).find_each(&:destroy)
        Project.where(trash_group_id: group_id).find_each(&:destroy)
      end
    end
  end
end
