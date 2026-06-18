module Trash
  class SoftDeleter
    def self.call(record, by:)
      new(record, by: by).call
    end

    def initialize(record, by:)
      @record = record
      @by = by
      @group = SecureRandom.uuid
    end

    def call
      ActiveRecord::Base.transaction do
        case @record
        when Meeting then trash_meeting(@record, root: true)
        when Folder  then trash_folder(@record, root: true)
        when Project then trash_project(@record, root: true)
        else raise ArgumentError, "지원하지 않는 타입: #{@record.class}"
        end
      end
      @group
    end

    private

    def trash(rec, root:)
      rec.soft_delete!(by: @by, group: @group, root: root)
    end

    def trash_meeting(meeting, root:)
      trash(meeting, root: root)
    end

    def trash_folder(folder, root:)
      trash(folder, root: root)
      folder.meetings.kept.each { |m| trash_meeting(m, root: false) }
      folder.children.kept.each { |c| trash_folder(c, root: false) }
    end

    def trash_project(project, root:)
      trash(project, root: root)
      project.folders.kept.each { |f| trash_folder(f, root: false) }
      project.meetings.kept.where(trash_group_id: nil).each { |m| trash_meeting(m, root: false) }
    end
  end
end
