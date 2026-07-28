require "rails_helper"

# 계약: POST /minutes/folder(§4c). 워크리스트 §7.2~§7.3-b.
# ⚠️ WebMock 없음 — DflowClient 를 instance_double 로 스텁하는 기존 관례(dflow_upload_service_spec)를 따른다.
RSpec.describe DflowFolderMigrationService, type: :service do
  let(:actor_email) { "donseok75@gmail.com" }
  let(:project)     { create(:project) }
  let(:root_folder) { create(:folder, project: project, name: "MES") }
  let(:client)      { instance_double(DflowClient) }

  let(:empty_summary) { { "total" => 0, "moved" => 0, "already_correct" => 0, "skipped" => 0, "not_found" => 0, "failed" => 0 } }
  let(:probe_response) { { "ok" => true, "dry_run" => true, "summary" => empty_summary, "results" => [] } }

  before do
    allow(DflowClient).to receive(:new).and_return(client)
    allow(AppSettings).to receive(:load).and_return("dflow" => { "enabled" => true })
  end

  def synced_meeting(folder: root_folder, deleted: false, public_uid: SecureRandom.uuid_v7)
    m = create(:meeting, project: project, folder: folder, status: "completed",
               dflow_synced_at: 1.day.ago, public_uid: public_uid)
    m.update_columns(deleted_at: Time.current) if deleted
    m
  end

  def ext_id(meeting)
    "ddobak:#{meeting.public_uid}"
  end

  # ── 전제 검증 (probe 이전에 걸러야 한다 — 클라이언트 호출 자체가 없어야 함) ──

  describe "전제 검증" do
    it "actor_email 이 비어있으면 ActorEmailRequiredError, 클라이언트를 만들지도 않는다" do
      expect(DflowClient).not_to receive(:new)
      expect { described_class.call(actor_email: "") }.to raise_error(described_class::ActorEmailRequiredError)
    end

    it "dflow.enabled=false 면 NotEnabledError, 클라이언트를 호출하지 않는다" do
      allow(AppSettings).to receive(:load).and_return("dflow" => { "enabled" => false })
      expect(client).not_to receive(:folder_batch)
      expect { described_class.call(actor_email: actor_email) }.to raise_error(described_class::NotEnabledError)
    end

    it "overwrite_manual: true 인데 meeting_ids 가 없으면 OverwriteManualRequiresScopeError(§7.3-b ⑤)" do
      expect(client).not_to receive(:folder_batch)
      expect { described_class.call(actor_email: actor_email, overwrite_manual: true) }
        .to raise_error(described_class::OverwriteManualRequiresScopeError)
    end

    it "overwrite_manual: true + meeting_ids 가 있으면 통과한다" do
      m = synced_meeting
      allow(client).to receive(:folder_batch).and_return(probe_response, probe_response)

      described_class.call(actor_email: actor_email, overwrite_manual: true, meeting_ids: [ m.id ])
      expect(client).to have_received(:folder_batch)
        .with(hash_including(overwrite_manual: true)).once
    end
  end

  # ── 프로브(§7.0) ──

  describe "프로브" do
    it "빈 items + dry_run:true 로 먼저 호출한 뒤에만 실제 대상을 보낸다(순서 보장)" do
      m = synced_meeting
      allow(client).to receive(:folder_batch)
        .with(hash_including(items: [])).ordered.and_return(probe_response)
      allow(client).to receive(:folder_batch)
        .with(hash_including(items: array_including(hash_including(external_id: ext_id(m))))).ordered
        .and_return({ "summary" => empty_summary, "results" => [] })

      described_class.call(actor_email: actor_email)
      expect(client).to have_received(:folder_batch).twice
    end

    it "프로브가 UnknownUserError 를 내면 대상 1건도 보내지 않고 그대로 전파한다" do
      synced_meeting
      allow(client).to receive(:folder_batch)
        .with(hash_including(items: [])).and_raise(DflowClient::UnknownUserError, "no such user")

      expect { described_class.call(actor_email: actor_email) }.to raise_error(DflowClient::UnknownUserError)
      expect(client).to have_received(:folder_batch).once # 프로브 1회뿐 — 실제 배치 호출 없음
    end

    it "프로브가 403 forbidden_role(ApiError) 를 내도 대상을 보내지 않고 전파한다" do
      synced_meeting
      allow(client).to receive(:folder_batch)
        .and_raise(DflowClient::ApiError.new("role 부족", code: "forbidden_role", status: 403))

      expect { described_class.call(actor_email: actor_email) }
        .to raise_error(DflowClient::ApiError) { |e| expect(e.code).to eq("forbidden_role") }
      expect(client).to have_received(:folder_batch).once
    end
  end

  # ── 대상 선정(§7.2) ──

  describe "대상 선정" do
    before { allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response) }

    it "dflow_synced_at 이 nil 인 회의는 대상에서 제외된다" do
      not_synced = create(:meeting, project: project, folder: root_folder, status: "completed",
                           dflow_synced_at: nil, public_uid: SecureRandom.uuid_v7)
      allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response)
      expect(client).not_to receive(:folder_batch).with(hash_including(items: array_including(hash_including(external_id: ext_id(not_synced)))))

      result = described_class.call(actor_email: actor_email)
      expect(result[:total_targets]).to eq(0)
    end

    it "소프트 삭제된(deleted_at 있음) 회의는 대상에서 제외된다(§7.2 요건 8)" do
      deleted = synced_meeting(deleted: true)
      allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response)

      result = described_class.call(actor_email: actor_email)
      expect(result[:total_targets]).to eq(0)
      expect(client).not_to receive(:folder_batch).with(hash_including(items: array_including(hash_including(external_id: ext_id(deleted)))))
    end

    it "public_uid 가 비어있으면(비정상 데이터) 방어적으로 제외된다" do
      m = create(:meeting, project: project, folder: root_folder, status: "completed", dflow_synced_at: 1.day.ago)
      m.update_columns(public_uid: nil)

      result = described_class.call(actor_email: actor_email)
      expect(result[:total_targets]).to eq(0)
    end

    it "meeting_ids 를 주면 그 범위로만 좁힌다" do
      m1 = synced_meeting
      m2 = synced_meeting
      allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response)
      allow(client).to receive(:folder_batch)
        .with(hash_including(items: array_including(hash_including(external_id: ext_id(m1))))).and_return({ "summary" => empty_summary, "results" => [] })

      result = described_class.call(actor_email: actor_email, meeting_ids: [ m1.id ])
      expect(result[:total_targets]).to eq(1)
      expect(client).not_to have_received(:folder_batch).with(hash_including(items: array_including(hash_including(external_id: ext_id(m2)))))
    end
  end

  # ── items 조립 ──

  describe "items 조립" do
    before { allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response) }

    it "folder_path 는 dflow_folder_path_names(W1과 동일 코드 경로)를 그대로 쓴다" do
      mid  = create(:folder, project: project, name: "품질", parent: root_folder)
      leaf = create(:folder, project: project, name: "주간정례", parent: mid)
      m = synced_meeting(folder: leaf)

      allow(client).to receive(:folder_batch)
        .with(hash_including(items: [ { external_id: ext_id(m), folder_path: %w[MES 품질 주간정례] } ]))
        .and_return({ "summary" => empty_summary, "results" => [] })

      described_class.call(actor_email: actor_email)
      expect(client).to have_received(:folder_batch)
        .with(hash_including(items: [ { external_id: ext_id(m), folder_path: %w[MES 품질 주간정례] } ]))
    end

    it "items[] 에 team 키를 넣지 않는다(§7.2 요건 2)" do
      m = synced_meeting
      captured = nil
      allow(client).to receive(:folder_batch) do |args|
        captured = args[:items] unless args[:items].empty?
        { "summary" => empty_summary, "results" => [] }
      end

      described_class.call(actor_email: actor_email)
      expect(captured.first).not_to have_key(:team)
      expect(ext_id(m)).to eq(captured.first[:external_id])
    end

    it "APPLY 없으면(apply: false) dry_run: true 를 보낸다" do
      synced_meeting
      captured = []
      allow(client).to receive(:folder_batch) { |args| captured << args; { "summary" => empty_summary, "results" => [] } }

      described_class.call(actor_email: actor_email, apply: false)
      expect(captured.last[:dry_run]).to eq(true)
    end

    it "apply: true 면 dry_run: false 를 명시적으로 보낸다" do
      synced_meeting
      captured = []
      allow(client).to receive(:folder_batch) { |args| captured << args; { "summary" => empty_summary, "results" => [] } }

      described_class.call(actor_email: actor_email, apply: true)
      expect(captured.last[:dry_run]).to eq(false)
    end
  end

  # ── 200건 초과 분할(§7.2 요건 3) ──

  describe "200건 초과 분할" do
    before do
      stub_const("#{described_class}::BATCH_SIZE", 2)
      allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response)
    end

    it "BATCH_SIZE 단위로 나눠 여러 번 호출한다" do
      3.times { synced_meeting }
      chunks = []
      allow(client).to receive(:folder_batch) do |args|
        chunks << args[:items] unless args[:items].empty?
        { "summary" => empty_summary, "results" => [] }
      end

      described_class.call(actor_email: actor_email)
      expect(chunks.map(&:size)).to eq([ 2, 1 ])
    end
  end

  # ── 응답 집계 ──

  describe "응답 집계" do
    it "already_correct 를 moved 에 섞지 않고 그대로 relay 한다" do
      m1 = synced_meeting
      m2 = synced_meeting
      summary = empty_summary.merge("total" => 2, "moved" => 1, "already_correct" => 1)
      results = [
        { "external_id" => ext_id(m1), "status" => "moved", "from" => nil, "to" => %w[MES], "folder_id" => "f1", "folder_path_status" => "exact" },
        { "external_id" => ext_id(m2), "status" => "already_correct", "from" => %w[MES], "folder_id" => "f2" }
      ]
      allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response)
      allow(client).to receive(:folder_batch)
        .with(hash_including(items: array_including(Hash))).and_return({ "summary" => summary, "results" => results })

      result = described_class.call(actor_email: actor_email)
      expect(result[:summary]["moved"]).to eq(1)
      expect(result[:summary]["already_correct"]).to eq(1)
    end

    it "from: null(미분류) 과 from 키 부재를 구분해 보존한다(§7.2 요건 9)" do
      m1 = synced_meeting
      m2 = synced_meeting
      results = [
        { "external_id" => ext_id(m1), "status" => "moved", "from" => nil, "to" => %w[MES], "folder_id" => "f1", "folder_path_status" => "exact" },
        { "external_id" => ext_id(m2), "status" => "not_found" }
      ]
      allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response)
      allow(client).to receive(:folder_batch)
        .with(hash_including(items: array_including(Hash))).and_return({ "summary" => empty_summary, "results" => results })

      result = described_class.call(actor_email: actor_email)
      moved_entry = result[:results].find { |r| r[:status] == "moved" }
      not_found_entry = result[:results].find { |r| r[:status] == "not_found" }

      expect(moved_entry).to have_key(:from)
      expect(moved_entry[:from]).to be_nil
      expect(not_found_entry).not_to have_key(:from)
    end

    it "조상 규칙 skip(manual_placement) 을 reason 그대로 전달한다" do
      m = synced_meeting
      results = [ { "external_id" => ext_id(m), "status" => "skipped", "reason" => "manual_placement", "from" => %w[MES 조업및표준화] } ]
      allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response)
      allow(client).to receive(:folder_batch)
        .with(hash_including(items: array_including(Hash))).and_return({ "summary" => empty_summary.merge("skipped" => 1), "results" => results })

      result = described_class.call(actor_email: actor_email)
      expect(result[:results].first[:reason]).to eq("manual_placement")
    end

    it "부분 실패(failed)를 삼키지 않고 reason 과 함께 집계한다" do
      m = synced_meeting
      results = [ { "external_id" => ext_id(m), "status" => "failed", "reason" => "no_team_root", "from" => %w[MES] } ]
      allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response)
      allow(client).to receive(:folder_batch)
        .with(hash_including(items: array_including(Hash))).and_return({ "summary" => empty_summary.merge("failed" => 1), "results" => results })

      result = described_class.call(actor_email: actor_email)
      expect(result[:summary]["failed"]).to eq(1)
      expect(result[:results].first).to include(status: "failed", reason: "no_team_root")
    end

    it "truncated 를 별도로 뽑아 report 한다" do
      m = synced_meeting
      results = [ { "external_id" => ext_id(m), "status" => "moved", "from" => nil, "to" => %w[MES 가 나 다 라 마], "folder_id" => nil, "folder_path_status" => "truncated" } ]
      allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response)
      allow(client).to receive(:folder_batch)
        .with(hash_including(items: array_including(Hash))).and_return({ "summary" => empty_summary.merge("moved" => 1), "results" => results })

      result = described_class.call(actor_email: actor_email)
      expect(result[:truncated_or_partial].size).to eq(1)
      expect(result[:folder_path_status_counts]).to eq({ "truncated" => 1 })
    end
  end

  # ── 61자 이상 폴더명 사전 제외(§7.2 요건 7) ──

  describe "폴더명 길이 사전 검사" do
    it "체인에 61자 이상 폴더가 있으면 전송하지 않고 excluded 목록에만 담는다" do
      long_name = "가" * 61
      offending = create(:folder, project: project, name: long_name, parent: root_folder)
      m = synced_meeting(folder: offending)

      allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response)
      expect(client).not_to receive(:folder_batch).with(hash_including(items: array_including(hash_including(external_id: ext_id(m)))))

      result = described_class.call(actor_email: actor_email)
      expect(result[:excluded_folder_name_too_long].size).to eq(1)
      expect(result[:excluded_folder_name_too_long].first).to include(meeting_id: m.id, folder_name: long_name, length: 61)
      expect(result[:total_targets]).to eq(1) # 대상이었지만 전송에서만 제외됨
    end

    it "정확히 60자면 통과한다" do
      ok_name = "나" * 60
      ok_folder = create(:folder, project: project, name: ok_name, parent: root_folder)
      m = synced_meeting(folder: ok_folder)

      allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response)
      allow(client).to receive(:folder_batch)
        .with(hash_including(items: array_including(hash_including(external_id: ext_id(m))))).and_return({ "summary" => empty_summary, "results" => [] })

      result = described_class.call(actor_email: actor_email)
      expect(result[:excluded_folder_name_too_long]).to be_empty
    end

    # NFC 정규화 결함 회귀(dflow-drift-2026-07-28.md 조치 ②) — W1(dflow_upload_service_spec)의
    # 동명 케이스와 동일 원인·동일 상수(DflowFolderName) 공유를 확인한다.
    # NFC 50자(→NFD 100자)가 Folder 모델 100자 한도(app/models/folder.rb) 안에서 만들 수 있는
    # 최대치다 — 근거는 dflow_upload_service_spec.rb의 동명 주석 참고.
    it "NFD로 저장된 폴더명도 NFC 기준 60자 이내면 통과한다(맥OS NFD 결함 회귀)" do
      nfc_name = "나" * 50
      nfd_name = nfc_name.unicode_normalize(:nfd)
      expect(nfd_name.length).to be > 60 # 전제 확인: NFD 원문 길이가 실제로 더 길다(100자)

      nfd_folder = create(:folder, project: project, name: nfd_name, parent: root_folder)
      m = synced_meeting(folder: nfd_folder)

      allow(client).to receive(:folder_batch).with(hash_including(items: [])).and_return(probe_response)
      allow(client).to receive(:folder_batch)
        .with(hash_including(items: array_including(hash_including(external_id: ext_id(m))))).and_return({ "summary" => empty_summary, "results" => [] })

      result = described_class.call(actor_email: actor_email)
      expect(result[:excluded_folder_name_too_long]).to be_empty
      expect(result[:total_targets]).to eq(1)
    end
  end
end
