class AddSpeakerNameToTranscriptsFts < ActiveRecord::Migration[8.1]
  # transcripts_fts에 speaker_name 컬럼 추가.
  # 이름으로 검색하면 해당 화자의 발화가 잡히고, 분리된 라벨들이 같은 이름으로
  # 통합돼도 (speaker_name이 모든 transcript 행에 비정규화로 들어있어) 모두 매치된다.
  # FTS 동기화는 DB 트리거가 아니라 FtsIndexable의 Ruby 콜백(fts_upsert/fts_delete)으로만
  # 이뤄지므로 재생성할 트리거는 없다. content를 0번 컬럼으로 유지해
  # search_service.rb의 snippet(transcripts_fts, 0, ...)이 그대로 동작한다.
  def up
    execute "DROP TABLE IF EXISTS transcripts_fts;"

    execute <<~SQL
      CREATE VIRTUAL TABLE transcripts_fts
      USING fts5(content, speaker_label, speaker_name, source_id UNINDEXED, tokenize='unicode61');
    SQL

    # 기존 데이터 FTS에 다시 채우기
    execute <<~SQL
      INSERT INTO transcripts_fts(source_id, content, speaker_label, speaker_name)
      SELECT id, content, speaker_label, speaker_name FROM transcripts;
    SQL
  end

  def down
    execute "DROP TABLE IF EXISTS transcripts_fts;"

    execute <<~SQL
      CREATE VIRTUAL TABLE transcripts_fts
      USING fts5(content, speaker_label, source_id UNINDEXED, tokenize='unicode61');
    SQL

    execute <<~SQL
      INSERT INTO transcripts_fts(source_id, content, speaker_label)
      SELECT id, content, speaker_label FROM transcripts;
    SQL
  end
end
