class AddAgendaReferenceToMeetings < ActiveRecord::Migration[8.0]
  def change
    # 안건 첨부(.md/.txt)를 업로드 시점에 LLM으로 8000자 미만으로 압축해 캐시한다.
    # 회의록 요약 시 이 텍스트를 참고자료로 주입한다(원본 파일은 매 요약마다 다시 읽지 않음).
    add_column :meetings, :agenda_reference, :text
    # 1회 주입 추적: realtime/타이머 요약은 이 값이 nil일 때(=업로드 후 첫 요약)만 안건을 주입하고
    # 성공하면 현재시각으로 채운다. 새 안건 업로드 시 다시 nil로 리셋해 1회 더 주입한다.
    # final(종료·재생성) 경로는 이 플래그와 무관하게 항상 전체 안건을 주입한다.
    add_column :meetings, :agenda_reference_applied_at, :datetime
  end
end
