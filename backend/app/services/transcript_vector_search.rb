require "numo/narray"

# 의미검색(브루트포스 exact cosine). VectorIndex 추상화 — 추후 pgvector 교체 지점.
# 벡터는 저장 시 L2 정규화돼 있으므로 dot product = cosine.
# ⚠️ meeting_ids·model_version 필터가 인가 경계 — 빼면 privilege escalation.
class TranscriptVectorSearch
  # 단일 쿼리: search_multi([q]).first 위임.
  def self.search(query_text:, meeting_ids:, limit: 40)
    search_multi(queries: [ query_text ], meeting_ids: meeting_ids, limit: limit).first || []
  end

  # 다중 쿼리(쿼리 확장): 쿼리별 [{transcript_id:, score:}] 리스트의 배열.
  # 후보벡터 1회 로드 + numo matmul(n×N) 1회로 N개 쿼리를 동시 평가.
  def self.search_multi(queries:, meeting_ids:, limit: 40)
    new(queries, meeting_ids, limit).search_multi
  end

  def initialize(queries, meeting_ids, limit)
    @queries     = Array(queries).map(&:to_s).reject(&:blank?)
    @meeting_ids = Array(meeting_ids)
    @limit       = limit
  end

  def search_multi
    return [] if @queries.empty? || @meeting_ids.empty?

    qvecs = Array(SidecarClient.new.embed(@queries)).reject(&:blank?)
    return [] if qvecs.empty?

    rows = TranscriptEmbedding
             .where(meeting_id: @meeting_ids, model_version: TranscriptEmbedding::MODEL_VERSION)
             .pluck(:transcript_id, :embedding)
    return Array.new(qvecs.size) { [] } if rows.empty?

    dim = qvecs.first.size
    mat = Numo::SFloat.zeros(rows.size, dim)
    rows.each_with_index { |(_, blob), i| mat[i, true] = Numo::SFloat.cast(blob.unpack("e*")) }

    qmat = Numo::SFloat.zeros(dim, qvecs.size)        # (dim × N)
    qvecs.each_with_index { |qv, j| qmat[true, j] = Numo::SFloat.cast(qv) }

    scores = mat.dot(qmat)                            # (n × N) cosine
    qvecs.each_index.map do |j|
      col   = scores[true, j]                         # (n,)
      order = col.sort_index.to_a.reverse             # 내림차순 인덱스
      order.first(@limit).map { |i| { transcript_id: rows[i][0], score: col[i].to_f } }
    end
  end
end
