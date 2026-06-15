class CleanupOrphansAndAddMeetingFks < ActiveRecord::Migration[8.1]
  # #11 2단계: transcripts/summaries → meetings cascade FK.
  #
  # 사전조건: 부모 meeting이 사라진 garbage 자식행(앱에서 도달 불가)을 먼저 제거해야
  # FK 추가가 가능하다. 이 garbage는 어떤 화면/쿼리에도 노출되지 않으므로(meeting 부재)
  # 삭제해도 사용자 가시 동작 변경 0 — 무결성 위반 잔재 정리일 뿐이다.
  #
  # FTS(transcripts_fts/summaries_fts)는 DB 트리거가 아니라 Rails 콜백(FtsIndexable)으로
  # 유지된다. 따라서 raw DELETE 대신 모델 destroy를 거쳐 after_destroy(fts_delete)가
  # garbage의 FTS 엔트리까지 동일 경로로 정리하게 한다.
  #
  # on_delete: :cascade 는 Meeting has_many :transcripts/:summaries, dependent: :destroy 를
  # 그대로 미러링한다. 정상 삭제는 Rails가 자식을 먼저 destroy(FTS 정리)한 뒤 meeting을
  # 지우므로 DB cascade는 no-op → 정상 경로 동작 동일. cascade는 콜백을 우회하는
  # 직접 삭제 시의 안전망(참조 무결성 보강)일 뿐이다.

  def up
    say_with_time "Removing orphan transcripts/summaries (parent meeting gone)" do
      orphans = Transcript.where("meeting_id NOT IN (SELECT id FROM meetings)")
      summaries = Summary.where("meeting_id NOT IN (SELECT id FROM meetings)")
      n = orphans.count + summaries.count
      orphans.destroy_all  # after_destroy → transcripts_fts 정리
      summaries.destroy_all # after_destroy → summaries_fts 정리
      n
    end

    # 방어적 FTS 정합화: source_id가 가리키는 행이 사라진 phantom FTS 엔트리 제거.
    # (콜백을 우회한 과거 삭제 등으로 생긴 잔재 — 검색이 유령 히트를 반환하지 않도록.)
    say_with_time "Sweeping orphaned FTS rows" do
      a = execute("DELETE FROM transcripts_fts WHERE source_id NOT IN (SELECT id FROM transcripts)")
      b = execute("DELETE FROM summaries_fts WHERE source_id NOT IN (SELECT id FROM summaries)")
      (a.respond_to?(:cmd_tuples) ? a.cmd_tuples : 0) + (b.respond_to?(:cmd_tuples) ? b.cmd_tuples : 0)
    end

    add_foreign_key :transcripts, :meetings, column: :meeting_id, on_delete: :cascade
    add_foreign_key :summaries, :meetings, column: :meeting_id, on_delete: :cascade
  end

  def down
    remove_foreign_key :transcripts, :meetings, column: :meeting_id
    remove_foreign_key :summaries, :meetings, column: :meeting_id
    # garbage 삭제는 비가역(복구 불가). 의도된 정리이므로 down에서 복원하지 않는다.
  end
end
