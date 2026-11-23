require "rails_helper"

RSpec.describe SttTermLearning::ManualRegistration do
  let(:project) { create(:project) }
  let(:parent) { create(:folder, project: project) }
  let(:child) { create(:folder, project: project, parent: parent) }
  let(:meeting) { create(:meeting, project: project, folder: child) }
  let(:run) { create(:stt_term_learning_run, meeting: meeting, status: "done") }
  let(:level_auto) { ->(level) { SttTermLearning::AutoDomainFile.find_for(level) } }

  def human_file(content, owner)
    create(:domain_file, content: content).tap { |f| DomainFileLink.create!(owner: owner, domain_file: f) }
  end

  def skipped_item(verdict, wrong: "우판", correct: "후판", misrecognition: nil, **attrs)
    create(:stt_term_learning_item, run: run, wrong: wrong, correct: correct,
           wrong_key: DomainFile.normalize_key(wrong), correct_key: DomainFile.normalize_key(correct),
           verdict: verdict, reason: "원래 사유", misrecognition: misrecognition, **attrs)
  end

  describe ".call" do
    it "skipped_not_in_transcript 항목을 등록하면 registered + 도메인 줄 + 오인식 confirmed" do
      item = skipped_item("skipped_not_in_transcript", category: "설비", definition: "두꺼운 강판")

      result = described_class.call(item)

      expect(result).to eq(item)
      item.reload
      file = level_auto.(SttTermLearning::Level.for(child))
      expect(file.content).to eq("- **후판** [설비] (오인식: 우판): 두꺼운 강판")
      expect(item.verdict).to eq("registered")
      expect(item.domain_file_id).to eq(file.id)
      expect([ item.level_owner_type, item.level_owner_id ]).to eq([ "Folder", child.id ])
      expect(item.change_data["manual_at"]).to be_present
      expect(item.change_data.except("manual_at")).to eq("kind" => "add_line", "domain_file_id" => file.id, "term_key" => "후판",
                                     "line" => "- **후판** [설비] (오인식: 우판): 두꺼운 강판")
      mis = item.misrecognition
      expect([ mis.status, mis.hit_count, mis.project_id ]).to eq([ "confirmed", 1, project.id ])
      expect([ mis.wrong_key, mis.correct_key ]).to eq(%w[우판 후판])
    end

    it "수동 등록한 항목도 회의 단위 되돌리기로 지워지고 hit_count 가 돌아간다" do
      item = skipped_item("skipped_not_in_transcript")
      described_class.call(item)

      expect(SttTermLearning::Reverter.new(run).call).to eq(reverted: 1, skipped_item_ids: [])
      expect(level_auto.(SttTermLearning::Level.for(child)).content).to eq("")
      expect([ item.misrecognition.reload.hit_count, item.misrecognition.status ]).to eq([ 0, "undecided" ])
    end

    it "excluded 오인식이어도 수동 등록 시 confirmed 로, 이미 센 hit_count 는 그대로" do
      mis = create(:stt_misrecognition, project: project, wrong: "우판", correct: "후판", status: "excluded", hit_count: 3)
      item = skipped_item("skipped_excluded", misrecognition: mis)

      described_class.call(item)

      expect([ mis.reload.status, mis.hit_count ]).to eq([ "confirmed", 3 ])
      expect(item.reload.verdict).to eq("registered")
      expect(item.misrecognition_id).to eq(mis.id)
    end

    it "링크 없던 항목도 같은 쌍 기록이 있으면 그 기록을 confirmed 로 하고 이 항목 몫 1회를 센다" do
      mis = create(:stt_misrecognition, project: project, wrong: "우판", correct: "후판", status: "excluded", hit_count: 2)
      item = skipped_item("skipped_not_in_transcript")

      described_class.call(item)

      expect([ mis.reload.status, mis.hit_count ]).to eq([ "confirmed", 3 ])
      expect(item.reload.misrecognition_id).to eq(mis.id)
    end

    it "체인에 같은 용어가 있으면 그 줄에 병합(merged_existing), 사람 줄 보존" do
      human = human_file("- **후판** [소재] (발음: 후 판): 두꺼운 판", parent)
      mis = create(:stt_misrecognition, project: project, wrong: "우판", correct: "후판", status: "undecided", hit_count: 1)
      item = skipped_item("skipped_low_confidence", misrecognition: mis)

      described_class.call(item)

      expect(human.reload.content).to eq("- **후판** [소재] (오인식: 후 판, 우판): 두꺼운 판")
      expect(item.reload.verdict).to eq("merged_existing")
      expect(item.domain_file_id).to eq(human.id)
      expect([ item.level_owner_type, item.level_owner_id ]).to eq([ "Folder", parent.id ])
      expect(item.change_data["before"]).to eq("- **후판** [소재] (발음: 후 판): 두꺼운 판")
      expect([ mis.reload.status, mis.hit_count ]).to eq([ "confirmed", 1 ])
    end

    it "skipped_conflict 도 강제 등록 대상" do
      item = skipped_item("skipped_conflict")
      described_class.call(item)
      expect(item.reload.verdict).to eq("registered")
    end

    it "skipped_invalid 는 Error" do
      item = skipped_item("skipped_invalid")
      expect { described_class.call(item) }.to raise_error(SttTermLearning::ManualRegistration::Error)
      expect(item.reload.verdict).to eq("skipped_invalid")
    end

    it "skipped_no_level·적용된 항목(registered 등)은 Error" do
      %w[skipped_no_level registered merged_existing already_known].each_with_index do |verdict, i|
        item = skipped_item(verdict, wrong: "우판#{i}")
        expect { described_class.call(item) }.to raise_error(SttTermLearning::ManualRegistration::Error)
      end
    end

    it "run 이 reverted 면 Error" do
      run.update!(status: "reverted")
      item = skipped_item("skipped_not_in_transcript")
      expect { described_class.call(item) }.to raise_error(SttTermLearning::ManualRegistration::Error)
      expect(DomainFile.stt_auto.count).to eq(0)
    end

    it "run 이 done 이 아니면(queued·running·failed) Error" do
      item = skipped_item("skipped_not_in_transcript")
      %w[queued running failed].each do |status|
        run.update!(status: status)
        expect { described_class.call(item) }.to raise_error(SttTermLearning::ManualRegistration::Error, /#{status}/)
      end
      expect(item.reload.verdict).to eq("skipped_not_in_transcript")
      expect(DomainFile.stt_auto.count).to eq(0)
    end

    it "change 에 manual_at(iso8601 마이크로초)을 남긴다" do
      item = skipped_item("skipped_not_in_transcript")
      freeze_time do
        described_class.call(item)
        expect(item.reload.change_data["manual_at"]).to eq(Time.current.iso8601(6))
      end
    end

    it "Registrar 가 등록하지 못하면(file_full) Error, 항목·오인식 변경 없음" do
      file = SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.for(child), fallback_creator: meeting.creator)
      file.update!(content: "x" * DomainFile::MAX_CONTENT_CHARS)
      item = skipped_item("skipped_not_in_transcript")

      expect { described_class.call(item) }.to raise_error(SttTermLearning::ManualRegistration::Error, /file_full/)
      expect(item.reload.verdict).to eq("skipped_not_in_transcript")
      expect(SttMisrecognition.count).to eq(0)
      expect(file.reload.content).to eq("x" * DomainFile::MAX_CONTENT_CHARS)
    end
  end

  describe ".register_pair!" do
    let(:actor) { create(:user) }

    it "last_meeting 이 있으면 그 회의 레벨 체인으로 등록, excluded 도 confirmed, hit_count·item 은 그대로" do
      mis = create(:stt_misrecognition, project: project, wrong: "우판", correct: "후판", status: "excluded",
                   hit_count: 2, last_meeting: meeting)

      result = nil
      expect { result = described_class.register_pair!(mis, actor: actor) }.not_to change(SttTermLearningItem, :count)

      file = level_auto.(SttTermLearning::Level.for(child))
      expect(file.content).to eq("- **후판** [STT] (오인식: 우판): ")
      expect(result[:verdict]).to eq("registered")
      expect(result[:level]).to eq(SttTermLearning::Level.for(child))
      expect([ mis.reload.status, mis.hit_count ]).to eq([ "confirmed", 2 ])
    end

    it "last_meeting 이 없으면 프로젝트 자동 파일에 새 줄" do
      mis = create(:stt_misrecognition, project: project, wrong: "우판", correct: "후판", status: "undecided", hit_count: 1)

      result = described_class.register_pair!(mis, actor: actor)

      file = level_auto.(SttTermLearning::Level.for(project))
      expect(file.content).to eq("- **후판** [STT] (오인식: 우판): ")
      expect(project.reload.domain_files).to include(file)
      expect(result[:verdict]).to eq("registered")
      expect(result[:level]).to eq(SttTermLearning::Level.for(project))
      expect(mis.reload.status).to eq("confirmed")
      expect(level_auto.(SttTermLearning::Level.for(child))).to be_nil
    end

    it "last_meeting 이 없을 때 프로젝트·전역에 같은 용어가 있으면 가장 가까운 레벨에 병합" do
      global = SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.global, fallback_creator: actor)
      global.update!(content: "- **후판** [STT]: 전역")
      mis = create(:stt_misrecognition, project: project, wrong: "우판", correct: "후판")

      r1 = described_class.register_pair!(mis, actor: actor)
      expect(r1[:verdict]).to eq("merged_existing")
      expect(global.reload.content).to eq("- **후판** [STT] (오인식: 우판): 전역")

      proj = human_file("- **후판** [소재]: 프로젝트", project)
      mis2 = create(:stt_misrecognition, project: project, wrong: "후반", correct: "후판")
      r2 = described_class.register_pair!(mis2, actor: actor)
      expect(r2[:domain_file]).to eq(proj)
      expect(proj.reload.content).to eq("- **후판** [소재] (오인식: 후반): 프로젝트")
    end

    it "이미 그 줄에 있으면 already_known 이고 confirmed" do
      human_file("- **후판** [소재] (오인식: 우판): 프로젝트", project)
      mis = create(:stt_misrecognition, project: project, wrong: "우판", correct: "후판", status: "excluded")
      expect(described_class.register_pair!(mis, actor: actor)[:verdict]).to eq("already_known")
      expect(mis.reload.status).to eq("confirmed")
    end

    it "last_meeting 이 다른 프로젝트로 옮겨졌으면 오인식의 프로젝트 레벨로 등록" do
      other = create(:project)
      moved = create(:meeting, project: other)
      mis = create(:stt_misrecognition, project: project, wrong: "우판", correct: "후판", last_meeting: moved)

      result = described_class.register_pair!(mis, actor: actor)

      expect(result[:level]).to eq(SttTermLearning::Level.for(project))
      expect(level_auto.(SttTermLearning::Level.for(other))).to be_nil
    end

    it "등록하지 못하면(format_chars) Error, 상태 변경 없음" do
      mis = create(:stt_misrecognition, project: project, wrong: "우,판", correct: "후판", status: "undecided")
      expect { described_class.register_pair!(mis, actor: actor) }.to raise_error(SttTermLearning::ManualRegistration::Error)
      expect(mis.reload.status).to eq("undecided")
      expect(DomainFile.stt_auto.count).to eq(0)
    end
  end
end
