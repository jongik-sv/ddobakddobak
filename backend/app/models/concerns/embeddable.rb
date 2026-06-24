# 임베딩은 전사 content에서 파생된 검색 인덱스다. 행 콜백은 임베딩을 인라인 계산하지 않는다
# (라이브 핫패스에서 SQLite writer-lock 경합 → 녹음 끊김의 원인). 계산은 EmbedBackfillJob가
# content 확정 경계(stop/heal/파일STT/import/glossary/단건편집)에서 배치로만 수행한다.
# 콜백의 책임은 content가 바뀐 행의 stale 임베딩을 무효화(삭제)하는 것뿐 — 다음 백필이 재생성한다.
module Embeddable
  extend ActiveSupport::Concern

  class_methods do
    def embeddable(content_column: :content)
      after_update_commit :invalidate_embedding
      define_method(:embeddable_content_column) { content_column }
    end
  end

  private

  # content가 변경된 경우에만 stale 임베딩 행을 삭제한다(로컬 write만, sidecar 호출 0).
  def invalidate_embedding
    col = embeddable_content_column.to_s
    return unless saved_change_to_attribute?(col)

    TranscriptEmbedding.where(transcript_id: id).delete_all
  end
end
