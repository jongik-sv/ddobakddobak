class MigrateLlmSettingsToProfiles < ActiveRecord::Migration[8.1]
  # 데이터 이관만 수행(DDL 없음). 로직·멱등성은 LlmProfileLegacyImporter가 담당.
  def up
    ::User.reset_column_information
    LlmProfileLegacyImporter.run!
  end

  def down
    # 비파괴 이관(프로필이 레거시를 대체) — 롤백 없음
  end
end
