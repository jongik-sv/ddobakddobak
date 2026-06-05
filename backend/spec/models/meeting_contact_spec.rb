require "rails_helper"

RSpec.describe MeetingContact, type: :model do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  it "belongs to a meeting and stores all card fields incl. extra/raw_text" do
    c = meeting.meeting_contacts.create!(
      name: "홍길동", company: "또박", department: "개발", title: "팀장",
      mobile: "010-1111-2222", phone: "02-000-0000", fax: "02-000-0001",
      email: "hong@ddobak.io", website: "https://ddobak.io", address: "서울",
      extra: { "kakao" => "hong" }, raw_text: "홍길동 또박 개발 팀장 ...",
      created_by_id: user.id
    )
    expect(c.reload.extra).to eq("kakao" => "hong")
    expect(c.raw_text).to include("홍길동")
    expect(meeting.meeting_contacts).to include(c)
  end

  it "allows a raw_text-only contact (recognition failure fallback)" do
    c = meeting.meeting_contacts.create!(raw_text: "읽은 원문만", created_by_id: user.id)
    expect(c).to be_persisted
    expect(c.display_label).to eq("(미인식 명함)")
  end
end

RSpec.describe Meeting, "#append_attendee!", type: :model do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user, attendees: nil) }

  it "appends name (company), skips duplicates, preserves existing text" do
    meeting.append_attendee!("홍길동", "또박")
    expect(meeting.reload.attendees).to eq("홍길동 (또박)")

    meeting.append_attendee!("홍길동", "다른회사")        # dup name → skip
    expect(meeting.reload.attendees).to eq("홍길동 (또박)")

    meeting.update_column(:attendees, "김기존")             # user-entered text
    meeting.append_attendee!("이영희")
    expect(meeting.reload.attendees).to eq("김기존, 이영희")
  end

  it "no-ops on blank name" do
    meeting.append_attendee!("  ")
    expect(meeting.reload.attendees).to be_nil
  end
end
