namespace :embeddings do
  desc "임베딩 없거나 구버전인 전사를 백필(재실행 가능)"
  task backfill: :environment do
    EmbedBackfillJob.perform_now
    puts "[embeddings:backfill] 완료 — 임베딩 #{TranscriptEmbedding.count}건"
  end
end
