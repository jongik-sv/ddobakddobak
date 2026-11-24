class SttTermMoveLog < ApplicationRecord
  belongs_to :actor, class_name: "User", optional: true
end
