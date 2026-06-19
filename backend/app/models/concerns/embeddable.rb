# FtsIndexable 미러. content 변경시에만 비동기 임베딩 잡 enqueue(after_commit).
# 임베딩은 비싸므로 FTS처럼 blind upsert하지 않는다.
module Embeddable
  extend ActiveSupport::Concern

  class_methods do
    def embeddable(content_column: :content)
      after_commit :enqueue_embedding, on: [:create, :update]
      define_method(:embeddable_content_column) { content_column }
    end
  end

  private

  def enqueue_embedding
    col = embeddable_content_column.to_s
    return unless saved_change_to_attribute?(col)
    return if send(col).blank?

    EmbedTranscriptJob.perform_later(id)
  end
end
