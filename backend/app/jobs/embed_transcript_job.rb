# 전사 1건을 sidecar /embed로 임베딩 → transcript_embeddings upsert.
# 실패는 ActiveJob 재시도. FTS는 항상 fresh라 검색 graceful 저하.
class EmbedTranscriptJob < ApplicationJob
  queue_as :default

  def perform(transcript_id)
    t = Transcript.find_by(id: transcript_id)
    return if t.nil? || t.content.blank?

    vecs = SidecarClient.new.embed([t.content])
    vec = vecs&.first
    return if vec.blank?

    rec = TranscriptEmbedding.find_or_initialize_by(transcript_id: t.id)
    rec.meeting_id     = t.meeting_id
    rec.model_version  = TranscriptEmbedding::MODEL_VERSION
    rec.dim            = vec.size
    rec.embedding      = TranscriptEmbedding.pack_vector(vec)
    rec.save!
  end
end
