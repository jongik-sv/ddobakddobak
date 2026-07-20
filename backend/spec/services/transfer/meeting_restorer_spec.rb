require "rails_helper"

# Transfer::MeetingRestorer 의 D'Flow 연동 필드(public_uid·dflow_synced_at·dflow_url)
# 왕복 보존 + public_uid unique 충돌 처리를 검증한다.
#
# meeting_hash 는 Transfer::MeetingSerializer#as_hash 를 JSON 직렬화/역직렬화해
# 실제 tar.gz manifest.json 경로(JSON.parse 로 문자열 키가 되는 경로)를 그대로 재현한다.
RSpec.describe Transfer::MeetingRestorer do
  before(:all) { Transcript.ensure_fts_tables! }

  let!(:owner)         { create(:user, name: "원작성자") }
  let!(:importer_user) { create(:user, name: "가져온사람") }
  let!(:src_project)   { create(:project, creator: owner, name: "소스팀") }
  let!(:dst_project)   { create(:project, creator: importer_user, name: "대상팀") }

  let!(:meeting) do
    create(:meeting, project: src_project, creator: owner, title: "D'Flow 연동 회의",
                     public_uid: "0199abc0-0000-7000-8000-000000000001",
                     dflow_synced_at: Time.zone.parse("2026-07-01 10:00:00"),
                     dflow_url: "https://dflow.example.com/meetings/abc")
  end

  # tar.gz manifest.json 왕복과 동일하게(JSON 직렬화→파싱), 자식 컬렉션 키도 문자열 키가 된다.
  def meeting_hash_for(m)
    JSON.parse(Transfer::MeetingSerializer.new(m).as_hash.to_json)
  end

  def build_restorer(meeting_hash, project: dst_project)
    Transfer::MeetingRestorer.new(
      meeting_hash,
      user:                 importer_user,
      project:              project,
      file_lookup:          {},
      folder_id:            nil,
      previous_meeting_id:  nil,
      tag_resolver:         ->(_old_id) { nil }
    )
  end

  describe "public_uid / dflow_synced_at / dflow_url 왕복 보존" do
    it "로컬에 동일 uid 가 없으면(서버 이동 시나리오) 3필드를 그대로 보존한다" do
      hash = meeting_hash_for(meeting)
      original_public_uid   = meeting.public_uid
      original_dflow_synced = meeting.dflow_synced_at
      original_dflow_url    = meeting.dflow_url
      # 원본을 삭제해 "다른 서버(로컬에 해당 uid 없음)"로 이동하는 상황을 재현한다.
      # (동일 테스트 DB 안에서는 원본이 남아있으면 그 자체가 충돌 유발자가 되어 버린다.)
      meeting.destroy!

      restorer    = build_restorer(hash)
      new_meeting = restorer.restore!

      expect(new_meeting.public_uid).to eq(original_public_uid)
      expect(new_meeting.dflow_synced_at).to be_within(1).of(original_dflow_synced)
      expect(new_meeting.dflow_url).to eq(original_dflow_url)
      expect(restorer.warnings).to be_empty
    end

    it "public_uid 가 없는 회의는 충돌 검사 없이 정상 복원된다" do
      meeting.update_columns(public_uid: nil, dflow_synced_at: nil, dflow_url: nil)

      restorer    = build_restorer(meeting_hash_for(meeting))
      new_meeting = restorer.restore!

      expect(new_meeting.public_uid).to be_nil
      expect(restorer.warnings).to be_empty
    end
  end

  describe "public_uid unique 충돌 처리" do
    # public_uid 는 전역 unique index 이므로, 원본 `meeting` 이 그 uid 로 이미 DB 에
    # 존재하는 것 자체가 "로컬에 동일 uid 가 이미 존재" 상황이다(같은 아카이브를 중복
    # import 하거나, 원본이 아직 남아있는 상태로 사본을 import 하는 시나리오와 동치).
    # meeting_hash_for(meeting) 이 캡처한 그 uid 그대로 다른 프로젝트로 복원을 시도한다.

    it "로컬에 동일 uid 가 이미 존재하면(같은 아카이브 중복 import 등) 3필드를 null 로 복원하고 경고 1줄을 남긴다" do
      restorer    = build_restorer(meeting_hash_for(meeting))
      new_meeting = restorer.restore!

      expect(new_meeting.public_uid).to be_nil
      expect(new_meeting.dflow_synced_at).to be_nil
      expect(new_meeting.dflow_url).to be_nil
      expect(restorer.warnings).to contain_exactly(
        "D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨 — 연결 관리에서 재설정"
      )
    end

    it "충돌 상황에서도 나머지 데이터(제목 등)는 정상 복원된다" do
      restorer    = build_restorer(meeting_hash_for(meeting))
      new_meeting = restorer.restore!

      expect(new_meeting.title).to eq("D'Flow 연동 회의")
      expect(new_meeting.project_id).to eq(dst_project.id)
    end

    it "충돌이 RecordNotUnique 예외 없이 사전 검사로 처리된다" do
      restorer = build_restorer(meeting_hash_for(meeting))
      expect { restorer.restore! }.not_to raise_error
    end
  end

  # meeting_export_serializer_spec.rb 가 별도로 없으므로 이 왕복 스펙에서 확인한다.
  describe MeetingExportSerializer do
    it "public_uid 키를 포함한다" do
      data = MeetingExportSerializer.new(meeting).call
      expect(data[:meeting][:public_uid]).to eq(meeting.public_uid)
    end
  end
end
