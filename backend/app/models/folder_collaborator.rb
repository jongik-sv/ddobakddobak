# idea 44: 폴더 단위 협업자 지정. 하위 폴더·회의에 실시간 상속(Folder#collaborator? 참조).
class FolderCollaborator < ApplicationRecord
  belongs_to :folder
  belongs_to :user

  validates :user_id, uniqueness: { scope: :folder_id }
end
