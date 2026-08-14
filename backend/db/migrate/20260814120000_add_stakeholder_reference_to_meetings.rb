class AddStakeholderReferenceToMeetings < ActiveRecord::Migration[8.0]
  def change
    # 이해관계자(stakeholder) 첨부를 업로드 시점에 LLM으로 압축해 캐시한다.
    # agenda_reference/agenda_reference_applied_at 과 동일한 계약(AddAgendaReferenceToMeetings 참고).
    add_column :meetings, :stakeholder_reference, :text
    # 1회 주입 추적: realtime/타이머 요약은 이 값이 nil일 때(=업로드 후 첫 요약)만 이해관계자
    # 정보를 주입하고, 성공하면 현재시각으로 채운다. 새 첨부 업로드 시 다시 nil로 리셋해
    # 1회 더 주입한다. final(종료·재생성) 경로는 이 플래그와 무관하게 항상 전체를 주입한다.
    add_column :meetings, :stakeholder_reference_applied_at, :datetime
  end
end
