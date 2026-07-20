require "rails_helper"

RSpec.describe DflowUploadService, type: :service do
  let(:project)     { create(:project) }
  let(:root_folder) { create(:folder, project: project, name: "MES") }
  let(:user)        { create(:user, email: "sender@example.com") }
  let(:meeting) do
    create(:meeting, project: project, folder: root_folder, creator: user, status: "completed",
           title: "물류공정_260716", started_at: Time.utc(2026, 7, 16, 5, 0, 0)) # UTC 05:00 = KST 14:00, 같은 날짜
  end
  let(:dflow_client) { instance_double(DflowClient) }

  before do
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "회의 내용")
    allow(DflowClient).to receive(:new).and_return(dflow_client)
    allow(AppSettings).to receive(:load).and_return("dflow" => { "enabled" => true })
    allow(dflow_client).to receive(:meta).and_return({ "teams" => %w[PMO ERP MES 가공 MDM] })
  end

  def stub_upload_success(url: "https://dflow.example.com/minutes/abc")
    allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => url })
  end

  # ── ① 최초 전송: uuid 발급 → 커밋 후 전송 ──

  describe "최초 전송" do
    it "public_uid 를 발급·커밋한 뒤 전송한다(전송 스텁이 DB의 public_uid 를 확인)" do
      expect(meeting.public_uid).to be_nil

      allow(dflow_client).to receive(:upload_minute) do |payload|
        # 발급 순서 불변 규칙(§1.2): 전송 시점엔 이미 DB에 커밋되어 있어야 한다.
        committed_uid = meeting.reload.public_uid
        expect(committed_uid).to be_present
        expect(payload[:external_id]).to eq("ddobak:#{committed_uid}")
        { "ok" => true, "url" => "https://dflow.example.com/minutes/abc" }
      end

      DflowUploadService.call(meeting, user)

      expect(meeting.reload.public_uid).to match(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/)
    end
  end

  # ── ② 전송 실패해도 public_uid 유지 ──

  describe "전송 실패" do
    it "업로드가 예외를 던져도 이미 발급된 public_uid 는 유지된다(재발급 금지)" do
      allow(dflow_client).to receive(:upload_minute).and_raise(DflowClient::ConnectionError, "down")

      expect { DflowUploadService.call(meeting, user) }.to raise_error(DflowClient::ConnectionError)
      uid = meeting.reload.public_uid
      expect(uid).to be_present

      # 재시도해도 같은 키 재사용(재발급 없음)
      allow(dflow_client).to receive(:upload_minute).and_raise(DflowClient::ConnectionError, "still down")
      expect { DflowUploadService.call(meeting, user) }.to raise_error(DflowClient::ConnectionError)
      expect(meeting.reload.public_uid).to eq(uid)
    end
  end

  # ── ③ 재전송: 같은 external_id·replace ──

  describe "재전송(이미 public_uid 보유)" do
    it "재발급 없이 같은 external_id 로 on_conflict=replace 전송한다" do
      meeting.update!(public_uid: "0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77")

      expect(dflow_client).to receive(:upload_minute) do |payload|
        expect(payload[:external_id]).to eq("ddobak:0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77")
        expect(payload[:on_conflict]).to eq("replace")
        { "ok" => true, "url" => "https://dflow.example.com/minutes/abc" }
      end

      DflowUploadService.call(meeting, user)
      expect(meeting.reload.public_uid).to eq("0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77")
    end
  end

  # ── ④ 100k 초과 → 미전송 ──

  describe "본문 100,000자 초과" do
    it "전송하지 않고 BodyTooLongError 를 낸다(자동 절단 금지)" do
      allow_any_instance_of(MarkdownExporter).to receive(:call).and_return("a" * 100_001)
      expect(dflow_client).not_to receive(:upload_minute)

      expect { DflowUploadService.call(meeting, user) }.to raise_error(DflowUploadService::BodyTooLongError)
      expect(meeting.reload.public_uid).to be_nil # uuid 발급도 안 됨(전송 전 단계에서 중단)
    end
  end

  # ── ⑤ team 판정 ──

  describe "team 판정" do
    it "root 폴더명이 meta.teams 에 있으면 그 값을 사용한다" do
      allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })

      DflowUploadService.call(meeting, user)
      expect(dflow_client).to have_received(:upload_minute).with(hash_including(team: "MES"))
    end

    it "root 폴더명이 meta.teams 에 없으면 team_required 에러" do
      other_root = create(:folder, project: project, name: "임원 인터뷰")
      meeting.update!(folder: other_root)
      expect(dflow_client).not_to receive(:upload_minute)

      expect { DflowUploadService.call(meeting, user) }.to raise_error(DflowUploadService::TeamRequiredError)
    end

    it "폴더가 없는 회의도 team_required 에러" do
      meeting.update!(folder: nil)
      expect(dflow_client).not_to receive(:upload_minute)

      expect { DflowUploadService.call(meeting, user) }.to raise_error(DflowUploadService::TeamRequiredError)
    end

    it "team_override 가 있으면 자동판정보다 우선하고 meta 조회를 하지 않는다" do
      allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })
      expect(dflow_client).not_to receive(:meta)

      DflowUploadService.call(meeting, user, team_override: "가공")
      expect(dflow_client).to have_received(:upload_minute).with(hash_including(team: "가공"))
    end
  end

  # ── ⑥ title override ──

  describe "title" do
    it "title_override 가 있으면 자동조립 제목보다 우선한다" do
      allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })
      DflowUploadService.call(meeting, user, title_override: "커스텀 제목")
      expect(dflow_client).to have_received(:upload_minute).with(hash_including(title: "커스텀 제목"))
    end

    it "override 없으면 meeting.dflow_auto_title(하위폴더-원제목)을 사용한다" do
      sub_folder = create(:folder, project: project, name: "물류", parent: root_folder)
      meeting.update!(folder: sub_folder)
      allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })

      DflowUploadService.call(meeting, user)
      expect(dflow_client).to have_received(:upload_minute).with(hash_including(title: "물류-물류공정_260716"))
    end
  end

  # ── ⑦ transcript 제외 export 사용 ──

  describe "export" do
    it "MarkdownExporter 를 include_transcript: false 로 호출한다" do
      exporter = instance_double(MarkdownExporter, call: "본문")
      expect(MarkdownExporter).to receive(:new).with(meeting, include_transcript: false).and_return(exporter)
      stub_upload_success

      DflowUploadService.call(meeting, user)
    end
  end

  # ── 전제 검증 ──

  describe "전제 검증" do
    it "dflow.enabled=false 면 NotEnabledError" do
      allow(AppSettings).to receive(:load).and_return("dflow" => { "enabled" => false })
      expect(dflow_client).not_to receive(:upload_minute)
      expect { DflowUploadService.call(meeting, user) }.to raise_error(DflowUploadService::NotEnabledError)
    end

    it "dflow 섹션 자체가 없으면(false 취급) NotEnabledError" do
      allow(AppSettings).to receive(:load).and_return({})
      expect { DflowUploadService.call(meeting, user) }.to raise_error(DflowUploadService::NotEnabledError)
    end

    it "status != completed 면 NotCompletedError" do
      meeting.update_column(:status, "pending")
      expect { DflowUploadService.call(meeting, user) }.to raise_error(DflowUploadService::NotCompletedError)
    end

    it "current_notes_markdown 이 비어있으면 NotesBlankError" do
      meeting.summaries.destroy_all
      expect { DflowUploadService.call(meeting, user) }.to raise_error(DflowUploadService::NotesBlankError)
    end
  end

  # ── payload 필드 ──

  describe "payload 구성" do
    it "date 를 started_at 의 KST YYYY-MM-DD 로 보낸다" do
      allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })
      DflowUploadService.call(meeting, user)
      expect(dflow_client).to have_received(:upload_minute).with(hash_including(date: "2026-07-16"))
    end

    it "user_email 을 호출자(user)의 이메일로 채운다" do
      allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })
      DflowUploadService.call(meeting, user)
      expect(dflow_client).to have_received(:upload_minute).with(hash_including(user_email: "sender@example.com"))
    end

    it "meeting_id 필드를 payload 에 포함하지 않는다(v1 미전송 확정)" do
      allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })
      DflowUploadService.call(meeting, user)
      expect(dflow_client).to have_received(:upload_minute) do |payload|
        expect(payload).not_to have_key(:meeting_id)
      end
    end
  end

  # ── 성공 후 처리 ──

  describe "성공 후 처리" do
    it "meeting.dflow_synced_at·dflow_url 을 갱신한다" do
      stub_upload_success(url: "https://dflow.example.com/minutes/xyz")
      freeze_time do
        DflowUploadService.call(meeting, user)
        expect(meeting.reload.dflow_url).to eq("https://dflow.example.com/minutes/xyz")
        expect(meeting.reload.dflow_synced_at).to eq(Time.current)
      end
    end
  end
end
