# 회의별 상속 제외(UX 증분 B): owner=Meeting + exclude=true 링크는 "이 회의에서 해당
# 프로젝트/폴더 상속 파일을 억제한다"는 의미. Folder/Project owner에는 생성 불가(모델 validation).
# domain_file_links는 신규 테이블(자식 FK 없음)이라 add_column 안전 — remove_column 금지 규칙과 무관.
class AddExcludeToDomainFileLinks < ActiveRecord::Migration[8.1]
  def change
    add_column :domain_file_links, :exclude, :boolean, null: false, default: false
  end
end
