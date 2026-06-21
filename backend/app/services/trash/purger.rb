module Trash
  class Purger
    def self.call(group_id)
      ActiveRecord::Base.transaction do
        Meeting.where(trash_group_id: group_id).find_each { |m| purge_meeting(m) }
        Folder.where(trash_group_id: group_id).find_each(&:destroy!)
        Project.where(trash_group_id: group_id).find_each { |p| purge_project(p) }
      end
    end

    # Project#destroy 는 meetings·folders 에 dependent: :restrict_with_error 라
    # 다른 그룹에서 따로 휴지통에 들어간 자식이 project_id(NOT NULL)를 그대로
    # 들고 있으면 막힌다. plain destroy 는 false 를 삼켜 프로젝트가 휴지통에
    # 남는다. project_id 는 NOT NULL 이라 nullify 불가 → 이미 휴지통에 있는
    # (trashed) 자식은 함께 영구삭제해 FK 일관성을 유지한다. 살아있는(kept)
    # 자식이 남아 restrict 가 걸리면 destroy! 가 예외로 표면화한다.
    def self.purge_project(project)
      project.meetings.trashed.find_each { |m| purge_meeting(m) }
      project.folders.trashed.find_each(&:destroy!)
      project.destroy!
    end

    def self.purge_meeting(meeting)
      FileUtils.rm_f(meeting.audio_file_path) if meeting.audio_file_path.present?
      meeting.destroy!
    end
  end
end
