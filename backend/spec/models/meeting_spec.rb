require "rails_helper"

RSpec.describe Meeting, type: :model do
  describe "#locked?" do
    it "is false when locked_at is nil" do
      meeting = build(:meeting, locked_at: nil)
      expect(meeting.locked?).to be false
    end

    it "is true when locked_at is present" do
      meeting = build(:meeting, locked_at: Time.current)
      expect(meeting.locked?).to be true
    end
  end

  describe "importance inheritance from folder (before_create)" do
    # 팩토리 기본은 important_explicitly_set=true(요청/목록 레이어 편의)라 상속 콜백을 건너뛴다.
    # 콜백 자체를 검증하는 아래 케이스들은 명시 플래그를 끄고(=false) 순수 상속 경로를 태운다.
    it "inherits important=true from a folder with important=true" do
      folder = create(:folder, important: true)
      meeting = create(:meeting, folder: folder, important_explicitly_set: false)
      expect(meeting.important).to be true
    end

    it "inherits important=false from a folder with important=false" do
      folder = create(:folder, important: false)
      meeting = create(:meeting, folder: folder, important_explicitly_set: false)
      expect(meeting.important).to be false
    end

    it "is false when the meeting has no folder" do
      meeting = create(:meeting, folder: nil, important_explicitly_set: false)
      expect(meeting.important).to be false
    end

    it "does not inherit and preserves the given value when important_explicitly_set is true" do
      folder = create(:folder, important: true)
      meeting = build(:meeting, folder: folder, important: false)
      meeting.important_explicitly_set = true
      meeting.save!
      expect(meeting.important).to be false
    end
  end

  describe "예약(scheduling) 검증·스코프" do
    describe "auto_start_mode inclusion" do
      it "auto 를 허용한다" do
        expect(build(:meeting, auto_start_mode: "auto")).to be_valid
      end

      it "manual 을 허용한다" do
        expect(build(:meeting, auto_start_mode: "manual")).to be_valid
      end

      it "nil 을 허용한다(예약 미지정)" do
        expect(build(:meeting, auto_start_mode: nil)).to be_valid
      end

      it "그 외 값은 거부한다" do
        meeting = build(:meeting, auto_start_mode: "weekly")
        expect(meeting).not_to be_valid
        expect(meeting.errors[:auto_start_mode]).to be_present
      end
    end

    describe ".scheduled" do
      it "scheduled_start_time 이 있는 회의만 포함한다" do
        scheduled = create(:meeting, scheduled_start_time: 1.hour.from_now)
        plain     = create(:meeting, scheduled_start_time: nil)

        ids = Meeting.scheduled.pluck(:id)
        expect(ids).to include(scheduled.id)
        expect(ids).not_to include(plain.id)
      end
    end

    describe ".upcoming_scheduled" do
      it "기본 1시간 창 안의 pending·미dismiss 예약을 포함하고, 먼 미래는 제외한다" do
        freeze_time do
          soon = create(:meeting, scheduled_start_time: 30.minutes.from_now, status: "pending")
          far  = create(:meeting, scheduled_start_time: 2.hours.from_now, status: "pending")

          ids = Meeting.upcoming_scheduled.pluck(:id)
          expect(ids).to include(soon.id)
          expect(ids).not_to include(far.id)
        end
      end

      it "지난(놓친) 예약도 포함한다(놓침 판정은 뷰)" do
        freeze_time do
          past = create(:meeting, scheduled_start_time: 10.minutes.ago, status: "pending")
          expect(Meeting.upcoming_scheduled.pluck(:id)).to include(past.id)
        end
      end

      it "within 인자로 창을 넓힐 수 있다" do
        freeze_time do
          far = create(:meeting, scheduled_start_time: 2.hours.from_now, status: "pending")
          expect(Meeting.upcoming_scheduled(within: 3.hours).pluck(:id)).to include(far.id)
        end
      end

      it "dismiss·시작된(pending 아님) 예약은 제외한다" do
        freeze_time do
          dismissed = create(:meeting, scheduled_start_time: 10.minutes.from_now, status: "pending", schedule_dismissed_at: Time.current)
          started   = create(:meeting, scheduled_start_time: 10.minutes.from_now, status: "recording")

          ids = Meeting.upcoming_scheduled.pluck(:id)
          expect(ids).not_to include(dismissed.id, started.id)
        end
      end
    end

    describe ".missed_scheduled" do
      it "트리거 유예(60s)가 지난 pending·미dismiss 예약만 포함한다(유예 안은 제외)" do
        freeze_time do
          missed     = create(:meeting, scheduled_start_time: 90.seconds.ago, status: "pending")
          in_grace   = create(:meeting, scheduled_start_time: 30.seconds.ago, status: "pending") # 아직 트리거 유예 안
          future     = create(:meeting, scheduled_start_time: 1.minute.from_now, status: "pending")
          dismissed  = create(:meeting, scheduled_start_time: 90.seconds.ago, status: "pending", schedule_dismissed_at: Time.current)
          started    = create(:meeting, scheduled_start_time: 90.seconds.ago, status: "recording")

          ids = Meeting.missed_scheduled.pluck(:id)
          expect(ids).to include(missed.id)
          expect(ids).not_to include(in_grace.id, future.id, dismissed.id, started.id)
        end
      end
    end

    describe "#recurring?" do
      it "recurrence_rule 이 있으면 true" do
        expect(build(:meeting, recurrence_rule: '{"freq":"weekly"}').recurring?).to be true
      end

      it "recurrence_rule 이 없으면 false" do
        expect(build(:meeting, recurrence_rule: nil).recurring?).to be false
      end
    end

    describe "#materialize_next_occurrence!" do
      let(:user)    { create(:user) }
      let(:project) { create(:project, creator: user) }
      let(:rule)    { '{"freq":"weekly","days":[1],"time":"10:00","tz":"Asia/Seoul"}' }
      let(:source) do
        create(:meeting, project: project, creator: user, title: "주간 회의",
               meeting_type: "standup", auto_start_mode: "auto", recurrence_rule: rule,
               summary_verbosity: "detailed", summary_restructure: false,
               scheduled_start_time: 1.day.ago)
      end

      it "다음 미래 occurrence 의 pending 회의를 생성하고 체이닝(previous_meeting)한다" do
        successor = source.materialize_next_occurrence!

        expect(successor).to be_persisted
        expect(successor.status).to eq("pending")
        expect(successor.title).to eq("주간 회의")
        expect(successor.meeting_type).to eq("standup")
        expect(successor.auto_start_mode).to eq("auto")
        expect(successor.recurrence_rule).to eq(rule)
        expect(successor.summary_verbosity).to eq("detailed")
        expect(successor.summary_restructure).to eq(false)
        expect(successor.previous_meeting_id).to eq(source.id)
        expect(successor.scheduled_start_time).to be > Time.current
        # 규칙대로 다음 월요일 10:00 KST 인지 확인.
        kst = successor.scheduled_start_time.in_time_zone("Asia/Seoul")
        expect(kst.wday).to eq(1)
        expect([ kst.hour, kst.min ]).to eq([ 10, 0 ])
      end

      it "started_at/ended_at/locked_at/오디오/dismiss 등 상태 필드는 승계하지 않는다" do
        successor = source.materialize_next_occurrence!
        expect(successor.started_at).to be_nil
        expect(successor.ended_at).to be_nil
        expect(successor.locked_at).to be_nil
        expect(successor.audio_file_path).to be_nil
        expect(successor.schedule_dismissed_at).to be_nil
      end

      it "이미 미래 형제(예약 successor)가 있으면 no-op(중복 방지)" do
        source.materialize_next_occurrence!
        expect { source.materialize_next_occurrence! }.not_to change { Meeting.where(previous_meeting_id: source.id).count }
      end

      it "비반복 회의면 아무것도 만들지 않는다" do
        plain = create(:meeting, project: project, creator: user, recurrence_rule: nil)
        expect { plain.materialize_next_occurrence! }.not_to change(Meeting, :count)
        expect(plain.materialize_next_occurrence!).to be_nil
      end

      it "중요(important) 플래그를 승계한다 — 폴더가 중요하지 않아도 successor 가 important=true" do
        # 폴더는 중요하지 않게 두어 seed_importance_from_folder 가 false 로 덮을 여지를 만든다.
        folder = create(:folder, project: project, important: false)
        important_source = create(:meeting, project: project, creator: user, folder: folder,
                                  important: true, recurrence_rule: rule, scheduled_start_time: 1.day.ago)

        successor = important_source.materialize_next_occurrence!
        expect(successor.important).to be true
      end
    end
  end

  describe "#reconcile_embeddings!" do
    include ActiveJob::TestHelper

    it "EmbedBackfillJob을 meeting_id로 enqueue한다" do
      m = create(:meeting)
      expect {
        m.reconcile_embeddings!
      }.to have_enqueued_job(EmbedBackfillJob).with(meeting_id: m.id)
    end
  end

  describe "#heal_stale_recording! 임베딩 reconcile" do
    include ActiveJob::TestHelper

    it "전사가 있으면 백필을 enqueue한다" do
      m = create(:meeting, status: "recording", recorder_heartbeat_at: 5.minutes.ago)
      create(:transcript, meeting: m, content: "내용")
      expect {
        m.heal_stale_recording!
      }.to have_enqueued_job(EmbedBackfillJob).with(meeting_id: m.id)
    end
  end

  describe ".accessible_by 프로젝트 격리" do
    let(:user)  { create(:user) }
    let(:p1)    { create(:project) }
    let(:p2)    { create(:project) }

    before { create(:project_membership, user: user, project: p1, role: "member") }

    it "멤버인 프로젝트의 공유 회의만 보인다" do
      mine = create(:meeting, project: p1, creator: user)
      other_shared = create(:meeting, project: p1, creator: create(:user), shared: true)
      foreign = create(:meeting, project: p2, creator: create(:user), shared: true)

      ids = Meeting.accessible_by(user).pluck(:id)
      expect(ids).to include(mine.id, other_shared.id)
      expect(ids).not_to include(foreign.id)   # 비멤버 프로젝트 → 안 보임
    end

    it "전역 admin은 프로젝트 무관 전부 본다" do
      admin = create(:user, :admin)
      foreign = create(:meeting, project: p2, creator: create(:user))
      expect(Meeting.accessible_by(admin).pluck(:id)).to include(foreign.id)
    end
  end
end
