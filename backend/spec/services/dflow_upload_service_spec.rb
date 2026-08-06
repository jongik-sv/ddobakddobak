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

    # W3 회귀 감지: resolve_team! 완화 요구("자유 루트도 override 로 전송 성공")는 이미 라이브다
    # (override 우선 분기가 meta 조회 자체를 건너뛰므로 루트가 팀 목록에 있는지는 애초에 안 본다).
    # 이 케이스가 깨지면 "루트가 teams 에 없으면 무조건 실패"로 되돌아간 것이다.
    it "자유 루트(팀 목록에 없는 폴더명) + team_override 가 있으면 전송이 성공한다(W3 회귀 감지)" do
      free_root = create(:folder, project: project, name: "임원 인터뷰")
      meeting.update!(folder: free_root)
      allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })
      expect(dflow_client).not_to receive(:meta)

      DflowUploadService.call(meeting, user, team_override: "PMO")
      expect(dflow_client).to have_received(:upload_minute).with(hash_including(team: "PMO", folder_path: [ "임원 인터뷰" ]))
    end

    # NFC 정규화 결함 회귀(dflow-drift-2026-07-28.md 조치 ③): meta.teams 중 유일한 한글 team인
    # "가공"은 D'Flow 쪽에서 NFC 리터럴로 온다. 우리 DB에 NFD로 저장된 "가공" 루트 폴더는 원문
    # 비교로는 불일치 판정 → TeamRequiredError 오발동(불필요한 team 셀렉트 노출).
    it "NFD로 저장된 루트 폴더명도 NFC teams 목록과 매칭된다(맥OS NFD 결함 회귀)" do
      nfd_root = create(:folder, project: project, name: "가공".unicode_normalize(:nfd))
      expect(nfd_root.name).not_to eq("가공") # 전제 확인: 실제로 바이트가 다르다(NFD)
      meeting.update!(folder: nfd_root)
      allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })

      DflowUploadService.call(meeting, user)
      # 반환값은 teams 쪽 정본(NFC) — DB 원문(NFD)을 그대로 흘려보내지 않는다.
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

    it "override 없으면 meeting.dflow_auto_title(접두 없는 원제목)을 사용한다" do
      sub_folder = create(:folder, project: project, name: "물류", parent: root_folder)
      meeting.update!(folder: sub_folder)
      allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })

      DflowUploadService.call(meeting, user)
      expect(dflow_client).to have_received(:upload_minute).with(hash_including(title: "물류공정_260716"))
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

  # ── 폴더명 길이 검사(W4): D'Flow 는 61자 이상을 400으로 거절한다. 또박또박은 100자까지 허용하므로
  # 서버가 미리 막아 D'Flow 400 원문이 그대로 노출되지 않게 한다.
  describe "폴더명 길이 검사" do
    it "체인 중 폴더명이 61자 이상이면 FolderNameTooLongError 를 내고 메시지에 폴더명을 포함한다" do
      long_name = "가" * 61
      offending = create(:folder, project: project, name: long_name, parent: root_folder)
      meeting.update!(folder: offending)
      expect(dflow_client).not_to receive(:upload_minute)

      expect { DflowUploadService.call(meeting, user) }
        .to raise_error(DflowUploadService::FolderNameTooLongError, /#{long_name}/)
      expect(meeting.reload.public_uid).to be_nil # 전송 전 단계에서 중단 — uuid 발급도 안 됨
    end

    it "폴더명이 정확히 60자면 통과한다" do
      ok_name = "나" * 60
      ok_folder = create(:folder, project: project, name: ok_name, parent: root_folder)
      meeting.update!(folder: ok_folder)
      allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })

      expect { DflowUploadService.call(meeting, user) }.not_to raise_error
      expect(dflow_client).to have_received(:upload_minute)
        .with(hash_including(folder_path: [ "MES", ok_name ]))
    end

    # NFC 정규화 결함 회귀(dflow-drift-2026-07-28.md 조치 ①): macOS 등에서 만든 한글 폴더명은
    # NFD(자모 분리)로 저장될 수 있다. NFD는 같은 글자라도 codepoint 수가 늘어 원문 길이가
    # 부풀어 보인다 — D'Flow는 NFC 정규화 이후 길이로 60자를 판정하므로(계약 §0 D20), 원문
    # 길이만 재면 D'Flow에선 통과할 이름을 여기서 선제 거절하게 된다.
    # "나"는 초성+중성뿐(종성 없음)이라 NFD 분해 시 2 codepoint — Folder 모델 자체의 100자
    # 한도(app/models/folder.rb) 안에서 "NFD 원문 > 60자, NFC 정규화 후 <=60자" 사례를 만들 수
    # 있는 최대치가 NFC 50자(NFD 100자)다.
    it "NFD로 저장된 폴더명도 NFC 기준 60자 이내면 통과한다(맥OS NFD 결함 회귀)" do
      nfc_name = "나" * 50
      nfd_name = nfc_name.unicode_normalize(:nfd)
      expect(nfd_name.length).to be > 60 # 전제 확인: NFD 원문 길이가 실제로 더 길다(100자)
      expect(nfc_name.length).to be <= 60 # 전제 확인: NFC 정규화하면 60자 이내

      nfd_folder = create(:folder, project: project, name: nfd_name, parent: root_folder)
      meeting.update!(folder: nfd_folder)
      allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })

      expect { DflowUploadService.call(meeting, user) }.not_to raise_error
    end

    # 순수 NFD 61자는 원문이 122자가 되어 Folder 모델의 100자 한도(app/models/folder.rb) 자체에
    # 걸리므로, 일부만 NFD(20자→40코드포인트)로 두고 나머지는 정규화에 영향받지 않는 ASCII(41자)로
    # 채워 "원문 81자(100자 한도 이내) · NFC 정규화 후 61자(60자 초과)"인 경계 사례를 만든다.
    it "NFD 포함 폴더명이 NFC 정규화 후에도 61자 이상이면 여전히 거절한다" do
      nfd_part = ("나" * 20).unicode_normalize(:nfd)
      mixed_name = nfd_part + ("A" * 41)
      expect(mixed_name.length).to be <= 100 # 전제 확인: Folder 모델 한도 이내
      expect(mixed_name.unicode_normalize(:nfc).length).to eq(61) # 전제 확인: NFC 기준으론 61자

      nfd_folder = create(:folder, project: project, name: mixed_name, parent: root_folder)
      meeting.update!(folder: nfd_folder)
      expect(dflow_client).not_to receive(:upload_minute)

      expect { DflowUploadService.call(meeting, user) }
        .to raise_error(DflowUploadService::FolderNameTooLongError, /61자/)
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

    # folder_path 3값 규약(워크리스트 §3.4): 키 부재 / [] / 비어있지 않은 배열.
    # 신버전은 항상 키를 보낸다 — 폴더 없으면 [] (키 생략 아님).
    describe "folder_path" do
      it "다단 폴더 체인을 root-first 순서로 보낸다(dflow_folder_chain 은 leaf-first 라 뒤집어야 한다)" do
        mid  = create(:folder, project: project, name: "품질", parent: root_folder)
        leaf = create(:folder, project: project, name: "주간정례", parent: mid)
        meeting.update!(folder: leaf)
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })

        DflowUploadService.call(meeting, user)
        expect(dflow_client).to have_received(:upload_minute)
          .with(hash_including(folder_path: %w[MES 품질 주간정례]))
      end

      it "폴더가 없는 회의는 folder_path 를 [] 로 보낸다(키 생략 아님)" do
        meeting.update!(folder: nil)
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })

        # 폴더가 없으면 team 자동판정이 불가하므로 override 로 전송 경로에 진입한다.
        DflowUploadService.call(meeting, user, team_override: "MES")
        expect(dflow_client).to have_received(:upload_minute) do |payload|
          expect(payload).to have_key(:folder_path)
          expect(payload[:folder_path]).to eq([])
        end
      end

      it "단일 폴더 회의는 원소 1개짜리 folder_path 를 보낸다" do
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })

        DflowUploadService.call(meeting, user)
        expect(dflow_client).to have_received(:upload_minute)
          .with(hash_including(folder_path: %w[MES]))
      end
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

  # ── meeting 옵션(회의 연결·생성 확장, design §2.2) ──

  describe "meeting 옵션" do
    describe "keep(기본, meeting_option 없음 또는 mode: keep)" do
      it "payload 에 meeting/meeting_id 키를 넣지 않는다" do
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })
        DflowUploadService.call(meeting, user)
        expect(dflow_client).to have_received(:upload_minute) do |payload|
          expect(payload).not_to have_key(:meeting_id)
          expect(payload).not_to have_key(:meeting)
        end
      end

      it "기존 dflow_meeting_* 3필드를 건드리지 않는다(update 대상에서 제외)" do
        meeting.update!(dflow_meeting_id: "existing-id", dflow_meeting_title: "기존 회의", dflow_project_name: "기존 프로젝트")
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })

        DflowUploadService.call(meeting, user, meeting_option: { mode: "keep" })

        meeting.reload
        expect(meeting.dflow_meeting_id).to eq("existing-id")
        expect(meeting.dflow_meeting_title).to eq("기존 회의")
        expect(meeting.dflow_project_name).to eq("기존 프로젝트")
      end
    end

    describe "link" do
      it "payload 에 meeting_id: <uuid> 를 싣는다" do
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u", "meeting_id" => "mtg-uuid-1" })

        DflowUploadService.call(meeting, user, meeting_option: { mode: "link", meeting_id: "mtg-uuid-1" })

        expect(dflow_client).to have_received(:upload_minute).with(hash_including(meeting_id: "mtg-uuid-1"))
      end

      it "성공 시 dflow_meeting_id 를 응답값으로, dflow_meeting_title/project_name 을 display 스냅샷으로 저장한다" do
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u", "meeting_id" => "mtg-uuid-1" })

        DflowUploadService.call(
          meeting, user,
          meeting_option: { mode: "link", meeting_id: "mtg-uuid-1",
                             display: { meeting_title: "주간 정례", project_name: "물류 프로젝트" } }
        )

        meeting.reload
        expect(meeting.dflow_meeting_id).to eq("mtg-uuid-1")
        expect(meeting.dflow_meeting_title).to eq("주간 정례")
        expect(meeting.dflow_project_name).to eq("물류 프로젝트")
      end
    end

    describe "unlink" do
      it "payload 에 meeting_id 키를 포함하고 값은 명시적 null 이다(키 부재와 구분)" do
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })

        DflowUploadService.call(meeting, user, meeting_option: { mode: "unlink" })

        expect(dflow_client).to have_received(:upload_minute) do |payload|
          expect(payload).to have_key(:meeting_id)
          expect(payload[:meeting_id]).to be_nil
        end
      end

      it "성공 시 dflow_meeting_* 3필드를 모두 nil 로 클리어한다" do
        meeting.update!(dflow_meeting_id: "existing-id", dflow_meeting_title: "기존 회의", dflow_project_name: "기존 프로젝트")
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u" })

        DflowUploadService.call(meeting, user, meeting_option: { mode: "unlink" })

        meeting.reload
        expect(meeting.dflow_meeting_id).to be_nil
        expect(meeting.dflow_meeting_title).to be_nil
        expect(meeting.dflow_project_name).to be_nil
      end
    end

    describe "create" do
      let(:valid_create_option) do
        { mode: "create", project_id: "proj-uuid-1", title: "킥오프 회의", date: "2026-08-06", category: "kickoff" }
      end

      it "payload 에 meeting: { project_id, title, date, category } 를 싣는다" do
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u", "meeting_id" => "new-mtg-1" })

        DflowUploadService.call(meeting, user, meeting_option: valid_create_option)

        expect(dflow_client).to have_received(:upload_minute).with(
          hash_including(meeting: { project_id: "proj-uuid-1", title: "킥오프 회의", date: "2026-08-06", category: "kickoff" })
        )
      end

      it "category 생략 시 general 을 기본값으로 채운다" do
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u", "meeting_id" => "new-mtg-1" })

        DflowUploadService.call(meeting, user, meeting_option: valid_create_option.except(:category))

        expect(dflow_client).to have_received(:upload_minute).with(hash_including(meeting: hash_including(category: "general")))
      end

      it "성공 시 dflow_meeting_id 를 응답 meeting_id 로, display 스냅샷을 저장한다" do
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u", "meeting_id" => "new-mtg-1", "meeting_created" => true })

        DflowUploadService.call(
          meeting, user,
          meeting_option: valid_create_option.merge(display: { meeting_title: "킥오프 회의", project_name: "물류 프로젝트" })
        )

        meeting.reload
        expect(meeting.dflow_meeting_id).to eq("new-mtg-1")
        expect(meeting.dflow_meeting_title).to eq("킥오프 회의")
        expect(meeting.dflow_project_name).to eq("물류 프로젝트")
      end

      it "제목이 비어있으면 MeetingValidationError(전송 안 함)" do
        expect(dflow_client).not_to receive(:upload_minute)
        expect { DflowUploadService.call(meeting, user, meeting_option: valid_create_option.merge(title: "  ")) }
          .to raise_error(DflowUploadService::MeetingValidationError)
      end

      it "제목이 200자를 초과하면 MeetingValidationError" do
        expect(dflow_client).not_to receive(:upload_minute)
        expect { DflowUploadService.call(meeting, user, meeting_option: valid_create_option.merge(title: "가" * 201)) }
          .to raise_error(DflowUploadService::MeetingValidationError, /200자/)
      end

      it "제목이 정확히 200자면 통과한다" do
        allow(dflow_client).to receive(:upload_minute).and_return({ "ok" => true, "url" => "u", "meeting_id" => "new-mtg-1" })
        expect { DflowUploadService.call(meeting, user, meeting_option: valid_create_option.merge(title: "가" * 200)) }
          .not_to raise_error
      end

      it "날짜 형식이 YYYY-MM-DD 가 아니면 MeetingValidationError" do
        expect(dflow_client).not_to receive(:upload_minute)
        expect { DflowUploadService.call(meeting, user, meeting_option: valid_create_option.merge(date: "2026/08/06")) }
          .to raise_error(DflowUploadService::MeetingValidationError)
      end

      it "category 가 6종에 속하지 않으면 MeetingValidationError" do
        expect(dflow_client).not_to receive(:upload_minute)
        expect { DflowUploadService.call(meeting, user, meeting_option: valid_create_option.merge(category: "unknown")) }
          .to raise_error(DflowUploadService::MeetingValidationError)
      end

      it "project_id 가 없으면 MeetingValidationError" do
        expect(dflow_client).not_to receive(:upload_minute)
        expect { DflowUploadService.call(meeting, user, meeting_option: valid_create_option.except(:project_id)) }
          .to raise_error(DflowUploadService::MeetingValidationError)
      end
    end
  end
end
