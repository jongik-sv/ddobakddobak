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

  # 라이브 핫패스 보호: 이 상태의 회의 전사는 백필 대상에서 제외한다. 전역(주기/수동) 백필이
  # 진행 중인 녹음·전사 회의를 건드리면, 제거하려던 SQLite writer-lock 경합(임베딩 INSERT vs
  # 실시간 전사·하트비트)을 그대로 재유발하기 때문. 종료 경계의 meeting_id 스코핑 호출은 회의가
  # 이미 completed 라 영향 없음. 활성 회의 전사는 종료 후 reconcile/다음 백필이 흡수.
  ACTIVE_MEETING_STATUSES = %w[recording transcribing].freeze

  private

  # 현 모델 버전 임베딩이 없는 전사 id. (없음 OR 구버전 둘 다 포함) 활성(녹음/전사중) 회의는
  # 제외. meeting_id로 선택 스코핑.
  def pending_transcript_ids(meeting_id = nil)
    current = TranscriptEmbedding.where(model_version: TranscriptEmbedding::MODEL_VERSION).select(:transcript_id)
    active  = Meeting.where(status: ACTIVE_MEETING_STATUSES).select(:id)
    scope = Transcript.where.not(id: current)
                      .where.not(meeting_id: active)
                      .where.not(content: [nil, ""])
    scope = scope.where(meeting_id: meeting_id) if meeting_id
    scope.pluck(:id)
  end
end
