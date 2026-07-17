require "rails_helper"

RSpec.describe MeetingDomainFile do
  it "같은 meeting에 같은 domain_file 중복 선택은 무효" do
    meeting = create(:meeting)
    domain_file = create(:domain_file)
    create(:meeting_domain_file, meeting: meeting, domain_file: domain_file)

    dup = MeetingDomainFile.new(meeting: meeting, domain_file: domain_file)
    expect(dup).not_to be_valid
  end

  it "다른 meeting이면 같은 domain_file을 선택해도 유효" do
    domain_file = create(:domain_file)
    create(:meeting_domain_file, meeting: create(:meeting), domain_file: domain_file)

    other = MeetingDomainFile.new(meeting: create(:meeting), domain_file: domain_file)
    expect(other).to be_valid
  end

  it "meeting 삭제 시 연결 레코드가 cascade로 함께 삭제된다" do
    meeting = create(:meeting)
    domain_file = create(:domain_file)
    create(:meeting_domain_file, meeting: meeting, domain_file: domain_file)

    expect { meeting.destroy }.to change(MeetingDomainFile, :count).by(-1)
    expect(DomainFile.exists?(domain_file.id)).to be true
  end
end
