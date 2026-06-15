class DropRedundantSingleColumnIndexes < ActiveRecord::Migration[8.1]
  # 스키마 무결성 갭(theme #6): 단일컬럼 인덱스 8개가 같은 컬럼을 leftmost-prefix로
  # 갖는 복합 인덱스에 이미 커버됨 → 중복. 제거해도 쿼리플래너가 복합 인덱스의 prefix를
  # 그대로 사용하므로 읽기 결과·플랜 동일, 쓰기(인덱스 유지비)·디스크만 절감(기능변경0).
  # unique 인덱스는 건드리지 않는다(복합쪽 유지). FK 컬럼 lookup도 복합 prefix가 서빙한다.
  # 각 remove_index는 column+name 명시 → add_index로 가역.
  def change
    remove_index :folders, column: :team_id, name: "index_folders_on_team_id"
    remove_index :meeting_attachments, column: :meeting_id, name: "index_meeting_attachments_on_meeting_id"
    remove_index :meeting_bookmarks, column: :meeting_id, name: "index_meeting_bookmarks_on_meeting_id"
    remove_index :meeting_participants, column: :meeting_id, name: "index_meeting_participants_on_meeting_id"
    remove_index :meetings, column: :created_by_id, name: "index_meetings_on_created_by_id"
    remove_index :meetings, column: :team_id, name: "index_meetings_on_team_id"
    remove_index :taggings, column: :tag_id, name: "index_taggings_on_tag_id"
    remove_index :tags, column: :team_id, name: "index_tags_on_team_id"
  end
end
