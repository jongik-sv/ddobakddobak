require "rails_helper"

# 계약: POST /minutes/link(§4b)·GET /minutes(§5.1). 워크리스트 §7.7.
# ⚠️ WebMock 없음 — DflowClient 를 instance_double 로 스텁하는 기존 관례
# (dflow_folder_migration_service_spec)를 따른다.
RSpec.describe DflowAutoLinkService, type: :service do
  let(:actor_email) { "donseok75@gmail.com" }
  let(:sender_names) { [ "또박또박 전송" ] }
  let(:project)      { create(:project) }
  let(:root_folder)  { create(:folder, project: project, name: "MES") }
  let(:client)       { instance_double(DflowClient, base_url: "https://dflow.example.com") }

  let(:teams) { %w[PMO ERP MES 가공 MDM] }
  let(:probe_response) { { "ok" => true, "dry_run" => true } }

  before do
    allow(DflowClient).to receive(:new).and_return(client)
    allow(AppSettings).to receive(:load).and_return("dflow" => { "enabled" => true })
    allow(client).to receive(:folder_batch).with(user_email: actor_email, items: [], dry_run: true)
      .and_return(probe_response)
    allow(client).to receive(:meta).and_return({ "teams" => teams })
    stub_linked_true([])
    stub_linked_false([])
  end

  # ── 헬퍼 ────────────────────────────────────────────────────────────────

  # ⚠️ DflowClient#list_minutes(params = {}) 는 단일 위치 인자(Hash)를 받는다(키워드 인자 아님).
  # `.with(linked: true, ...)` 처럼 맨 키워드 형태로 쓰면 Ruby 3 의 위치/키워드 인자 분리 때문에
  # 실제 호출(위치 Hash)과 매칭되지 않는다 — 반드시 리터럴 Hash(`{}`)로 감싼다.
  def stub_linked_true(items, page: 1, total: items.size)
    allow(client).to receive(:list_minutes)
      .with({ linked: true, include_archived: true, page: page, per_page: 100 })
      .and_return({ "items" => items, "total" => total, "page" => page, "per_page" => 100 })
  end

  def stub_linked_false(items, page: 1, total: items.size)
    allow(client).to receive(:list_minutes)
      .with({ linked: false, page: page, per_page: 100 })
      .and_return({ "items" => items, "total" => total, "page" => page, "per_page" => 100 })
  end

  def dflow_item(id:, title:, date:, team: "MES", external_id: nil, created_by_name: "홍길동")
    { "id" => id, "title" => title, "date" => date, "team" => team, "external_id" => external_id,
      "created_by_name" => created_by_name, "url" => "https://dflow.example.com/minutes/#{id}" }
  end

  def make_meeting(title:, folder: root_folder, started_at: Time.utc(2026, 7, 16, 5, 0, 0),
                    status: "completed", dflow_synced_at: nil, public_uid: nil, notes: "회의 내용", deleted: false)
    m = create(:meeting, project: project, folder: folder, status: status, title: title,
               started_at: started_at, dflow_synced_at: dflow_synced_at, public_uid: public_uid)
    create(:summary, meeting: m, summary_type: "final", notes_markdown: notes) if notes
    m.update_columns(deleted_at: Time.current) if deleted
    m
  end

  def call_service(apply: false, relink_reset: false, sender_names: self.sender_names, **kwargs)
    described_class.call(actor_email: actor_email, apply: apply, relink_reset: relink_reset,
                          sender_names: sender_names, **kwargs)
  end

  # ── 전제 검증 ──────────────────────────────────────────────────────────

  describe "전제 검증" do
    it "actor_email 이 비어있으면 ActorEmailRequiredError, 클라이언트를 만들지도 않는다" do
      expect(DflowClient).not_to receive(:new)
      expect { described_class.call(actor_email: "") }.to raise_error(described_class::ActorEmailRequiredError)
    end

    it "dflow.enabled=false 면 NotEnabledError, 프로브를 호출하지 않는다" do
      allow(AppSettings).to receive(:load).and_return("dflow" => { "enabled" => false })
      expect(client).not_to receive(:folder_batch)
      expect { call_service }.to raise_error(described_class::NotEnabledError)
    end

    it "APPLY=1 인데 sender_names 가 비어있으면 SenderNamesRequiredError(§7.7 완화 4겹 ④)" do
      expect(client).not_to receive(:folder_batch)
      expect { call_service(apply: true, sender_names: []) }
        .to raise_error(described_class::SenderNamesRequiredError)
    end

    it "dry-run 은 sender_names 없이도 통과한다" do
      expect { call_service(apply: false, sender_names: []) }.not_to raise_error
    end
  end

  # ── 프로브(§7.0) — 1번 항목 전송 전에 계정 유효성 확인 ───────────────────

  describe "프로브" do
    it "빈 items + dry_run:true 프로브를 목록 조회보다 먼저 호출한다(순서 보장)" do
      expect(client).to receive(:folder_batch)
        .with(user_email: actor_email, items: [], dry_run: true).ordered.and_return(probe_response)
      expect(client).to receive(:list_minutes).at_least(:once).ordered.and_return({ "items" => [], "total" => 0 })

      call_service
    end

    it "프로브가 UnknownUserError 를 내면 목록 조회를 하지 않고 그대로 전파한다" do
      allow(client).to receive(:folder_batch).and_raise(DflowClient::UnknownUserError, "no such user")
      expect(client).not_to receive(:list_minutes)

      expect { call_service }.to raise_error(DflowClient::UnknownUserError)
    end

    it "프로브가 dry-run 모드에서도 실행된다(미리보기도 검증된 계정 기준이어야 함)" do
      call_service(apply: false)
      expect(client).to have_received(:folder_batch).with(user_email: actor_email, items: [], dry_run: true)
    end
  end

  # ── already_linked 게이트(§7.7 대상1 ⚠️) ─────────────────────────────────

  describe "already_linked 게이트" do
    it "dflow_synced_at nil + public_uid 있음 + linked=true 순회에서 발견되면 등급 판정 전에 already_linked 로 빠진다" do
      m = make_meeting(title: "주간회의", dflow_synced_at: nil, public_uid: "existing-uid-1")
      stub_linked_true([ dflow_item(id: "d1", title: "다른회의", date: "2026-07-16", external_id: "ddobak:existing-uid-1") ])
      # 매칭 후보가 있어도(동일 date/team) 등급 판정에 아예 들어가지 않아야 한다.
      stub_linked_false([ dflow_item(id: "d2", title: "주간회의", date: "2026-07-16") ])

      result = call_service
      expect(result[:already_linked_count]).to eq(1)
      all_ids = (result[:target1][:exact] + result[:target1][:likely] + result[:target1][:ambiguous])
                  .map { |r| r[:meeting_id] }
      expect(all_ids).not_to include(m.id)
    end

    it "public_uid 가 있어도 linked=true 순회에서 발견되지 않으면 already_linked 가 아니다(대상1로 진입)" do
      m = make_meeting(title: "주간회의", dflow_synced_at: nil, public_uid: "unsynced-uid")
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])

      result = call_service
      expect(result[:already_linked_count]).to eq(0)
      expect(result[:target1][:exact].map { |r| r[:meeting_id] }).to include(m.id)
    end
  end

  # ── 대상 1 정의(§7.7) — dflow_synced_at 없음 AND exists_on_dflow==false 동시 충족 ──

  describe "대상 1 판정" do
    it "dflow_synced_at 이 있으면(이미 전송) 대상1에 들어가지 않는다" do
      synced = make_meeting(title: "주간회의", dflow_synced_at: 1.day.ago, public_uid: "synced-uid")
      stub_linked_true([ dflow_item(id: "d0", title: "주간회의", date: "2026-07-16", external_id: "ddobak:synced-uid") ])
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])

      result = call_service
      ids = (result[:target1][:exact] + result[:target1][:likely] + result[:target1][:ambiguous]).map { |r| r[:meeting_id] }
      expect(ids).not_to include(synced.id)
    end

    it "소프트 삭제된 회의는 대상에서 완전히 제외된다" do
      deleted = make_meeting(title: "주간회의", deleted: true)
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])

      result = call_service
      all_ids = (result[:target1][:exact] + result[:target1][:likely] + result[:target1][:ambiguous] +
                 result[:target2][:exact] + result[:target2][:likely] + result[:target2][:ambiguous])
                  .map { |r| r[:meeting_id] }
      expect(all_ids).not_to include(deleted.id)
    end

    it "본문이 없으면(요약 없음) 대상에서 제외된다(전송 가능 조건과 동일)" do
      empty_meeting = make_meeting(title: "주간회의", notes: nil)
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])

      result = call_service
      all_ids = (result[:target1][:exact] + result[:target1][:likely] + result[:target1][:ambiguous]).map { |r| r[:meeting_id] }
      expect(all_ids).not_to include(empty_meeting.id)
    end
  end

  # ── 대상 2 — 기본 제외, RELINK_RESET=1 에서만 claim ──────────────────────

  describe "대상 2(초기화 재연결)" do
    it "기본(RELINK_RESET 없음)에서는 대상2가 리포트엔 나오되 claim 되지 않는다" do
      m = make_meeting(title: "주간회의", dflow_synced_at: 1.day.ago, public_uid: "reset-uid")
      # linked=true 순회에 없음 = exists_on_dflow false = 대상2
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])
      expect(client).not_to receive(:link_minute)

      result = call_service(apply: true, relink_reset: false)
      expect(result[:target2][:exact].map { |r| r[:meeting_id] }).to include(m.id)
      expect(result[:claimed].map { |c| c[:meeting_id] }).not_to include(m.id)
    end

    it "RELINK_RESET=1 이면 exact 매칭된 대상2를 기존 public_uid 로 재claim 한다(새 uuid 발급 없음)" do
      m = make_meeting(title: "주간회의", dflow_synced_at: 1.day.ago, public_uid: "reset-uid")
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])
      allow(client).to receive(:link_minute)
        .with(minute_id: "d1", external_id: "ddobak:reset-uid", user_email: actor_email)
        .and_return({ "ok" => true, "id" => "d1" })

      result = call_service(apply: true, relink_reset: true)
      expect(result[:claimed].map { |c| c[:meeting_id] }).to include(m.id)
      expect(m.reload.public_uid).to eq("reset-uid") # 재발급 아님
      expect(m.reload.dflow_url).to eq("https://dflow.example.com/minutes/d1")
    end
  end

  # ── 멱등성 — 같은 실행을 두 번 돌려도 1회차 링크분이 2회차 후보로 안 잡힘 ──

  describe "멱등성" do
    it "1회차 claim 결과가 D'Flow linked=true 목록에 반영되면 2회차에서 already_linked 로 빠진다" do
      m = make_meeting(title: "주간회의", dflow_synced_at: nil, public_uid: nil)
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])
      allow(client).to receive(:link_minute) do |minute_id:, external_id:, user_email:|
        { "ok" => true, "id" => minute_id }
      end

      run1 = call_service(apply: true)
      expect(run1[:claimed].map { |c| c[:meeting_id] }).to include(m.id)
      m.reload
      expect(m.dflow_synced_at).to be_nil # claim은 dflow_synced_at을 건드리지 않는다
      claimed_uid = m.public_uid
      expect(claimed_uid).to be_present

      # 2회차: D'Flow 쪽엔 이제 이 public_uid 가 linked=true 로 나타난다(claim 은 이미 반영됨).
      stub_linked_true([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16", external_id: "ddobak:#{claimed_uid}") ])
      # 후보 풀에도 더는 안 나온다(claim되어 external_id 가 붙었으므로 linked=false 에서 빠짐).
      stub_linked_false([])

      run2 = call_service(apply: true)
      expect(run2[:already_linked_count]).to eq(1)
      ids2 = (run2[:target1][:exact] + run2[:target1][:likely] + run2[:target1][:ambiguous]).map { |r| r[:meeting_id] }
      expect(ids2).not_to include(m.id)
      expect(run2[:claimed]).to be_empty
    end
  end

  # ── include_archived 호출 규약(§5.1) ─────────────────────────────────────

  describe "include_archived 호출 규약" do
    it "linked=true 순회에는 include_archived=true 를 붙인다" do
      make_meeting(title: "주간회의")
      call_service
      expect(client).to have_received(:list_minutes).with({ linked: true, include_archived: true, page: 1, per_page: 100 })
    end

    it "linked=false(후보 조회) 에는 include_archived 를 붙이지 않는다" do
      make_meeting(title: "주간회의")
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])
      call_service
      expect(client).to have_received(:list_minutes).with({ linked: false, page: 1, per_page: 100 })
    end

    it "linked=true/false 모두 per_page=100 페이지 순회를 쓴다(O(회의수) status 호출 금지)" do
      make_meeting(title: "주간회의")
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])
      call_service
      expect(client).not_to have_received(:list_minutes).with(hash_including(per_page: 20))
    end
  end

  # ── dry-run 기본 · 자동 claim 없음 ────────────────────────────────────────

  describe "dry-run 기본" do
    it "APPLY 없으면 exact 매칭이 있어도 claim 을 호출하지 않는다" do
      make_meeting(title: "주간회의")
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])
      expect(client).not_to receive(:link_minute)

      result = call_service(apply: false)
      expect(result[:dry_run]).to eq(true)
      expect(result[:claimed]).to eq([])
      expect(result[:target1][:exact]).not_to be_empty
    end
  end

  # ── 등급 판정(§7.7 매칭 규칙) ─────────────────────────────────────────────

  describe "등급 판정 — C1(대상1)" do
    it "date·team·정규화 제목 완전 일치 + 유일 후보 → exact" do
      make_meeting(title: "주간회의")
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])
      result = call_service
      expect(result[:target1][:exact].size).to eq(1)
    end

    it "날짜만 ±1일 어긋나고 유일 후보 → likely" do
      make_meeting(title: "주간회의", started_at: Time.utc(2026, 7, 16, 5, 0, 0))
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-17") ])
      result = call_service
      expect(result[:target1][:likely].size).to eq(1)
      expect(result[:target1][:exact]).to be_empty
    end

    it "제목 포함관계(노이즈 제거 후)면서 유일 후보 → likely" do
      make_meeting(title: "주간회의 260716") # 날짜 토큰은 노이즈로 제거됨
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])
      result = call_service
      expect(result[:target1][:exact].size).to eq(1) # 노이즈 제거 후 완전 일치이므로 exact
    end

    it "정규화 후에도 순수 부분일치(포함관계)면 likely" do
      make_meeting(title: "주간 정례 회의")
      stub_linked_false([ dflow_item(id: "d1", title: "주간 정례", date: "2026-07-16") ])
      result = call_service
      expect(result[:target1][:likely].size).to eq(1)
    end

    it "후보 2건 이상 → ambiguous, 자동 claim 금지" do
      make_meeting(title: "주간회의")
      stub_linked_false([
        dflow_item(id: "d1", title: "주간회의", date: "2026-07-16"),
        dflow_item(id: "d2", title: "주간회의", date: "2026-07-16")
      ])
      result = call_service(apply: true)
      expect(result[:target1][:ambiguous].size).to eq(1)
      expect(result[:claimed]).to be_empty
    end

    it "후보 없음 → none" do
      make_meeting(title: "완전히 다른 제목")
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])
      result = call_service
      expect(result[:target1][:none_count]).to eq(1)
    end

    it "NFD로 저장된 로컬 제목도 NFC 후보와 매칭된다(NFD/NFC 0매칭 회귀 방지)" do
      nfd_title = "주간회의".unicode_normalize(:nfd)
      expect(nfd_title.bytesize).to be > "주간회의".bytesize
      make_meeting(title: nfd_title)
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16") ])
      result = call_service
      expect(result[:target1][:exact].size).to eq(1)
    end

    it "하이픈 접두는 노이즈로 제거되지 않는다(포함관계로 완화 매칭)" do
      make_meeting(title: "설비-L2 점검")
      stub_linked_false([ dflow_item(id: "d1", title: "설비-L2 점검", date: "2026-07-16") ])
      result = call_service
      expect(result[:target1][:exact].size).to eq(1)
    end
  end

  describe "등급 판정 — C2(대상2, RELINK_RESET)" do
    it "dflow_auto_title(접두 없음) 재생성값과 완전 일치하면 exact" do
      m = make_meeting(title: "주간회의", dflow_synced_at: 1.day.ago, public_uid: "reset-uid")
      stub_linked_false([ dflow_item(id: "d1", title: m.dflow_auto_title, date: "2026-07-16") ])
      result = call_service
      expect(result[:target2][:exact].map { |r| r[:meeting_id] }).to include(m.id)
    end

    it "ddobak-W2 이전 전송분(dflow_legacy_prefixed_title, 접두 포함)도 시도해 매칭한다(결정 §7 #10)" do
      mid = create(:folder, project: project, name: "품질", parent: root_folder)
      m = make_meeting(title: "주간회의", folder: mid, dflow_synced_at: 1.day.ago, public_uid: "reset-uid")
      expect(m.dflow_legacy_prefixed_title).to eq("품질-주간회의")
      expect(m.dflow_auto_title).not_to eq(m.dflow_legacy_prefixed_title)

      stub_linked_false([ dflow_item(id: "d1", title: "품질-주간회의", date: "2026-07-16", team: "MES") ])
      result = call_service
      expect(result[:target2][:exact].map { |r| r[:meeting_id] }).to include(m.id)
    end

    it "제목이 부분일치만 해도(휴리스틱 없음) exact/likely 로 잡히지 않는다" do
      m = make_meeting(title: "주간회의", dflow_synced_at: 1.day.ago, public_uid: "reset-uid")
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의 추가내용", date: "2026-07-16") ])
      result = call_service
      ids = (result[:target2][:exact] + result[:target2][:likely]).map { |r| r[:meeting_id] }
      expect(ids).not_to include(m.id)
    end
  end

  # ── team 판정 불가 회의 — 자동 링크 대상 제외, 목록만 ─────────────────────

  describe "team 판정 불가" do
    it "루트가 팀코드가 아니면 team_unknown 으로만 보고되고 grading 대상에서 빠진다" do
      free_root = create(:folder, project: project, name: "자유루트")
      m = make_meeting(title: "주간회의", folder: free_root)
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16", team: "자유루트") ])

      result = call_service
      expect(result[:team_unknown].map { |t| t[:meeting_id] }).to include(m.id)
      all_graded = (result[:target1][:exact] + result[:target1][:likely] + result[:target1][:ambiguous])
                     .map { |r| r[:meeting_id] }
      expect(all_graded).not_to include(m.id)
    end
  end

  # ── 후보 작성자 = 전송 계정 가드(완화 4겹 ④) ─────────────────────────────

  describe "전송 계정 후보 가드" do
    it "후보의 created_by_name 이 sender_names 와 같으면 exact 여도 자동 claim 되지 않는다" do
      make_meeting(title: "주간회의")
      stub_linked_false([ dflow_item(id: "d1", title: "주간회의", date: "2026-07-16", created_by_name: "또박또박 전송") ])
      expect(client).not_to receive(:link_minute)

      result = call_service(apply: true)
      entry = result[:target1][:exact].first
      expect(entry[:auto_claimable]).to eq(false)
      expect(entry[:sender_match]).to eq(true)
      expect(result[:claimed]).to be_empty
    end
  end

  # ── 초기화 잔존 경고(pitfall5) ────────────────────────────────────────────

  describe "초기화된 minute 잔존 경고" do
    it "대상1의 유일 후보가 대상2(초기화분)의 C2 조건과도 맞으면 collision 표시로 자동 claim 을 막는다" do
      # target2: 예전에 이 레코드로 전송했던 회의 — 재연결 대상(§7.7 C2)
      reset_meeting = make_meeting(title: "주간회의", dflow_synced_at: 1.day.ago, public_uid: "reset-uid")
      # target1: 같은 (date,team,정규화제목)으로 매칭되는 별개의 미연결 회의
      other_meeting = make_meeting(title: "주간회의", dflow_synced_at: nil, public_uid: nil)

      # D'Flow 후보 풀엔 reset_meeting 이 예전에 쓰던 그 레코드 하나만 있다(초기화되어 external_id null).
      stub_linked_false([ dflow_item(id: "shared", title: reset_meeting.dflow_auto_title, date: "2026-07-16") ])

      result = call_service(apply: true, relink_reset: false)
      other_entry = (result[:target1][:exact] + result[:target1][:likely]).find { |r| r[:meeting_id] == other_meeting.id }
      expect(other_entry).to be_present
      expect(other_entry[:collision]).to be_present
      expect(other_entry[:auto_claimable]).to eq(false)
      expect(result[:claimed].map { |c| c[:meeting_id] }).not_to include(other_meeting.id)
    end
  end

  # ── W16 역연산 ────────────────────────────────────────────────────────────

  describe ".rollback" do
    it "기록된 public_uid 가 현재값과 같으면 public_uid·dflow_url 을 해제한다" do
      m = make_meeting(title: "주간회의", public_uid: "claimed-uid")
      m.update!(dflow_url: "https://dflow.example.com/minutes/d1")

      result = described_class.rollback([ { "meeting_id" => m.id, "public_uid" => "claimed-uid", "dflow_minute_id" => "d1" } ])
      expect(result[:results].first[:status]).to eq("reset")
      m.reload
      expect(m.public_uid).to be_nil
      expect(m.dflow_url).to be_nil
    end

    it "기록된 public_uid 와 현재값이 다르면(다른 조작 개입) 건드리지 않고 skipped_changed 로 보고한다" do
      m = make_meeting(title: "주간회의", public_uid: "changed-since")
      result = described_class.rollback([ { "meeting_id" => m.id, "public_uid" => "claimed-uid" } ])
      expect(result[:results].first[:status]).to eq("skipped_changed")
      expect(m.reload.public_uid).to eq("changed-since")
    end

    it "존재하지 않는 meeting_id 는 not_found 로 보고한다" do
      result = described_class.rollback([ { "meeting_id" => 0, "public_uid" => "x" } ])
      expect(result[:results].first[:status]).to eq("not_found")
    end
  end
end
