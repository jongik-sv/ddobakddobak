module DecisionSerializable
  extend ActiveSupport::Concern

  private

  def serialize_decision(decision)
    {
      id: decision.id,
      content: decision.content,
      context: decision.context,
      decided_at: decision.decided_at,
      participants: decision.participants,
      status: decision.status,
      ai_generated: decision.ai_generated,
      created_at: decision.created_at
    }
  end
end
