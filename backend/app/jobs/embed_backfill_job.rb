# 임베딩 없거나 구버전 model_version인 전사를 배치 임베딩·upsert. 재실행 가능(idempotent).
# 초기 적재 + 모델 교체 재임베딩에 사용. 1회성 스크립트 금지 — 항상 이 잡 경유.
class EmbedBackfillJob < ApplicationJob
  queue_as :default

  def perform(batch_size: 64)
    pending_transcript_ids.each_slice(batch_size) do |ids|
      transcripts = Transcript.where(id: ids).where.not(content: [nil, ""]).to_a
      next if transcripts.empty?

      vecs = SidecarClient.new.embed(transcripts.map(&:content))
      transcripts.each_with_index do |t, i|
        vec = vecs[i]
        next if vec.blank?
        rec = TranscriptEmbedding.find_or_initialize_by(transcript_id: t.id)
        rec.meeting_id    = t.meeting_id
        rec.model_version = TranscriptEmbedding::MODEL_VERSION
        rec.dim           = vec.size
        rec.embedding     = TranscriptEmbedding.pack_vector(vec)
        rec.save!
      end
    end
  end

  private

  # 현 모델 버전 임베딩이 없는 전사 id. (없음 OR 구버전 둘 다 포함)
  def pending_transcript_ids
    current = TranscriptEmbedding.where(model_version: TranscriptEmbedding::MODEL_VERSION).select(:transcript_id)
    Transcript.where.not(id: current).where.not(content: [nil, ""]).pluck(:id)
  end
end
