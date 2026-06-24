# 임베딩 없거나 구버전 model_version인 전사를 배치 임베딩·upsert. 재실행 가능(idempotent).
# 초기 적재 + 모델 교체 재임베딩 + 라이브 밖 지연 백필에 사용. 1회성 스크립트 금지 — 항상 이 잡 경유.
class EmbedBackfillJob < ApplicationJob
  queue_as :default

  # meeting_id 주면 그 회의 전사만, nil이면 전역. 둘 다 diff(현버전 임베딩 없는 전사)만 처리.
  def perform(batch_size: 64, meeting_id: nil)
    pending_transcript_ids(meeting_id).each_slice(batch_size) do |ids|
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

  # 현 모델 버전 임베딩이 없는 전사 id. (없음 OR 구버전 둘 다 포함) meeting_id로 선택 스코핑.
  def pending_transcript_ids(meeting_id = nil)
    current = TranscriptEmbedding.where(model_version: TranscriptEmbedding::MODEL_VERSION).select(:transcript_id)
    scope = Transcript.where.not(id: current).where.not(content: [nil, ""])
    scope = scope.where(meeting_id: meeting_id) if meeting_id
    scope.pluck(:id)
  end
end
