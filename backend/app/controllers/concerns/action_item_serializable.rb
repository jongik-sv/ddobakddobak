module ActionItemSerializable
  extend ActiveSupport::Concern

  private

  def serialize_item(item)
    {
      id: item.id,
      content: item.content,
      status: item.status,
      due_date: item.due_date,
      ai_generated: item.ai_generated,
      assignee: item.assignee ? { id: item.assignee.id, name: item.assignee.name } : nil,
      created_at: item.created_at
    }
  end
end
