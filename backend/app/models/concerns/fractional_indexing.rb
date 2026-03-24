module FractionalIndexing
  DEFAULT_START = 1000.0
  DEFAULT_GAP   = 1000.0
  REBALANCE_THRESHOLD = 0.001

  # 맨 앞에 삽입: position = next_position / 2
  def self.before(next_pos)
    next_pos / 2.0
  end

  # 맨 뒤에 삽입: position = last_position + DEFAULT_GAP
  def self.after(prev_pos)
    prev_pos + DEFAULT_GAP
  end

  # 두 블록 사이 삽입: position = (prev + next) / 2
  def self.between(prev_pos, next_pos)
    (prev_pos + next_pos) / 2.0
  end

  # gap이 너무 작은지 확인
  def self.needs_rebalance?(prev_pos, next_pos)
    (next_pos - prev_pos).abs < REBALANCE_THRESHOLD
  end

  # meeting 내 전체 블록 position 재정렬
  def self.rebalance!(meeting)
    blocks = meeting.blocks.order(:position)
    blocks.each_with_index do |block, index|
      block.update_column(:position, (index + 1) * DEFAULT_GAP)
    end
  end

  # 삽입 위치 계산
  # prev_block, next_block: Block 인스턴스 또는 nil
  # meeting: 블록이 없을 때 기본값 계산에 사용
  def self.position_for(prev_block, next_block, meeting)
    if prev_block.nil? && next_block.nil?
      last = meeting.blocks.order(:position).last
      last ? after(last.position) : DEFAULT_START
    elsif prev_block.nil?
      before(next_block.position)
    elsif next_block.nil?
      after(prev_block.position)
    else
      between(prev_block.position, next_block.position)
    end
  end
end
