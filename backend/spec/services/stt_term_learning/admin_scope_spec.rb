require "rails_helper"

RSpec.describe SttTermLearning::AdminScope do
  it "projects(user) 는 Project#blocks_admin_override? 와 같은 판정" do
    me = create(:user, role: "admin")
    other = create(:user)
    [create(:project, creator: me), create(:project, creator: other),
           create(:project, creator: me, personal: true), create(:project, creator: other, personal: true)]
    expected = Project.kept.to_a.reject { |p| p.blocks_admin_override?(me) }
    expect(described_class.projects(me).to_a).to match_array(expected)
  end
end
