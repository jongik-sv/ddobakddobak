# 기존 meeting_domain_files 행을 domain_file_links(owner_type="Meeting")로 복사한 뒤
# meeting_domain_files 테이블을 제거한다.
#
# SQLite 주의: remove_column/테이블 재구성으로 인한 자식 CASCADE 유실 사고 전력이 있어
# (drop_meeting_live_share 마이그레이션 주석 참고) create/copy/drop_table 조합만 사용한다.
# meeting_domain_files 는 다른 테이블이 FK로 참조하는 부모가 아니므로(참조만 하는 leaf 테이블)
# drop_table 자체는 CASCADE 유실 위험이 없다.
class MigrateMeetingDomainFilesToDomainFileLinks < ActiveRecord::Migration[8.1]
  class MigrationMeetingDomainFile < ActiveRecord::Base
    self.table_name = "meeting_domain_files"
  end

  class MigrationDomainFileLink < ActiveRecord::Base
    self.table_name = "domain_file_links"
  end

  def up
    MigrationMeetingDomainFile.reset_column_information
    MigrationDomainFileLink.reset_column_information

    MigrationMeetingDomainFile.find_each do |row|
      MigrationDomainFileLink.create!(
        domain_file_id: row.domain_file_id,
        owner_type: "Meeting",
        owner_id: row.meeting_id,
        created_at: row.created_at,
        updated_at: row.updated_at
      )
    end

    drop_table :meeting_domain_files
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
