# 전사 행 단위 임베딩(brute-force 의미검색). fp32 LE BLOB 저장.
# ⚠️ vector store 추상화의 저장층 — 검색은 TranscriptVectorSearch 경유.
class TranscriptEmbedding < ApplicationRecord
  MODEL_VERSION = "kure-v1".freeze
  DIM = 1024

  belongs_to :transcript

  def self.pack_vector(floats)
    floats.map(&:to_f).pack("e*") # little-endian float32
  end

  def self.unpack_vector(blob)
    blob.to_s.unpack("e*")
  end

  def vector
    self.class.unpack_vector(embedding)
  end
end
