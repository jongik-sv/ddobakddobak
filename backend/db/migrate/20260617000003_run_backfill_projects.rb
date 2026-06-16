# 마이그 클래스명을 서비스(BackfillProjects)와 다르게 둔다.
# 동일 이름이면 ::BackfillProjects 가 마이그 클래스 자신으로 해석돼 service.call 이 안 잡힌다.
class RunBackfillProjects < ActiveRecord::Migration[8.1]
  def up
    Project.reset_column_information
    ProjectMembership.reset_column_information
    Meeting.reset_column_information
    Folder.reset_column_information
    Tag.reset_column_information
    say_with_time "Backfilling projects (기본 + 개인 + 레거시 이관)" do
      ::BackfillProjects.call
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
