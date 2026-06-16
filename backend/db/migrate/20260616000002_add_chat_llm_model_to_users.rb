class AddChatLlmModelToUsers < ActiveRecord::Migration[8.0]
  def change
    # AI Chat은 요약과 같은 provider/key를 쓰되 모델만 별도로 둘 수 있다.
    # 모델명만 저장한다(비밀값 아님). 빈값이면 요약 모델로 폴백한다.
    add_column :users, :chat_llm_model, :string
  end
end
