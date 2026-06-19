require "numo/narray"

# 의미검색(브루트포스 exact cosine). VectorIndex 추상화 — 추후 pgvector 교체 지점.
# 벡터는 저장 시 L2 정규화돼 있으므로 dot product = cosine.
# ⚠️ meeting_ids·model_version 필터가 인가 경계 — 빼면 privilege escalation.
class TranscriptVectorSearch
  def self.search(query_text:, meeting_ids:, limit: 40)
    new(query_text, meeting_ids, limit).search
  end

  def initialize(query_text, meeting_ids, limit)
    @query_text  = query_text.to_s
    @meeting_ids = Array(meeting_ids)
    @limit       = limit
  end

  def search
    return [] if @query_text.blank? || @meeting_ids.empty?

    qvec = SidecarClient.new.embed([@query_text])&.first
    return [] if qvec.blank?

    rows = TranscriptEmbedding
             .where(meeting_id: @meeting_ids, model_version: TranscriptEmbedding::MODEL_VERSION)
             .pluck(:transcript_id, :embedding)
    return [] if rows.empty?

    q = Numo::SFloat.cast(qvec)
    mat = Numo::SFloat.zeros(rows.size, qvec.size)
    rows.each_with_index { |(_, blob), i| mat[i, true] = Numo::SFloat.cast(blob.unpack("e*")) }

    scores = mat.dot(q)                       # (n,) cosine
    order = scores.sort_index.to_a.reverse    # 내림차순 인덱스
    order.first(@limit).map { |i| { transcript_id: rows[i][0], score: scores[i].to_f } }
  end
end
