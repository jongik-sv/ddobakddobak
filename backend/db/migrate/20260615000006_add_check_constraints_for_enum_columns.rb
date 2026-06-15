class AddCheckConstraintsForEnumColumns < ActiveRecord::Migration[8.1]
  # #11 잔여: enum/inclusion 컬럼에 DB CHECK 제약 추가(스키마 무결성 갭).
  # 각 제약은 모델의 `validates ... inclusion`(또는 `enum`) 화이트리스트를 그대로 미러한다 —
  # 앱이 이미 거부하는 값만 거부하므로 정상 플로우의 동작·출력은 불변(기능변경0). 검증을
  # 우회하는 경로(update_all/update_columns 등)에 대한 방어선만 추가한다. SQLite CHECK는
  # NULL을 통과시키므로(`x IN (...)` → NULL), nullable 컬럼의 NULL 허용도 그대로 유지된다.
  # 대상에서 제외: meeting_attachments.content_type(조건부 `if: :file?`라 무조건 미러 불가),
  # meetings.summary_restructure(boolean — 타입으로 이미 제약).
  def change
    add_check_constraint :meetings, "status IN ('pending','recording','transcribing','completed')",
                         name: "chk_meetings_status"
    add_check_constraint :meetings, "source IN ('live','upload')",
                         name: "chk_meetings_source"
    add_check_constraint :meetings,
                         "summary_verbosity IN ('very_concise','concise','standard','detailed','very_detailed')",
                         name: "chk_meetings_summary_verbosity"
    add_check_constraint :action_items, "status IN ('todo','in_progress','done')",
                         name: "chk_action_items_status"
    add_check_constraint :decisions, "status IN ('active','revised','cancelled')",
                         name: "chk_decisions_status"
    add_check_constraint :summaries, "summary_type IN ('realtime','final')",
                         name: "chk_summaries_summary_type"
    add_check_constraint :team_memberships, "role IN ('admin','member')",
                         name: "chk_team_memberships_role"
    add_check_constraint :meeting_participants, "role IN ('host','viewer')",
                         name: "chk_meeting_participants_role"
    add_check_constraint :users, "role IN ('admin','member')",
                         name: "chk_users_role"
    add_check_constraint :blocks,
                         "block_type IN ('text','heading1','heading2','heading3'," \
                         "'bullet_list','numbered_list','checkbox','quote','divider')",
                         name: "chk_blocks_block_type"
    add_check_constraint :meeting_attachments, "kind IN ('file','link')",
                         name: "chk_meeting_attachments_kind"
    add_check_constraint :meeting_attachments, "category IN ('agenda','reference','minutes','business_card')",
                         name: "chk_meeting_attachments_category"
  end
end
