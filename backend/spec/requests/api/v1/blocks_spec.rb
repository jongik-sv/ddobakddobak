require "rails_helper"

RSpec.describe "Api::V1::Blocks", type: :request do
  let(:user)       { create(:user) }
  let(:other_user) { create(:user) }
  let(:team)       { create(:team, creator: user) }
  let!(:membership) { create(:team_membership, user: user, team: team, role: "admin") }
  let(:meeting)    { create(:meeting, team: team, creator: user) }

  before { login_as(user) }

  # ─────────────────────────────────────────────────────────
  # GET /api/v1/meetings/:meeting_id/blocks
  # ─────────────────────────────────────────────────────────
  describe "GET /api/v1/meetings/:meeting_id/blocks" do
    let!(:block1) { create(:block, meeting: meeting, position: 1000.0) }
    let!(:block2) { create(:block, meeting: meeting, position: 2000.0) }

    context "정상 케이스" do
      it "200 OK, position 순으로 블록 목록 반환" do
        get "/api/v1/meetings/#{meeting.id}/blocks"
        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json.length).to eq(2)
        expect(json.first["id"]).to eq(block1.id)
        expect(json.second["id"]).to eq(block2.id)
      end

      it "블록이 없으면 빈 배열 반환" do
        other_meeting = create(:meeting, team: team, creator: user)
        get "/api/v1/meetings/#{other_meeting.id}/blocks"
        expect(response).to have_http_status(:ok)
        expect(response.parsed_body).to eq([])
      end

      it "응답에 필요한 필드 포함" do
        get "/api/v1/meetings/#{meeting.id}/blocks"
        block_json = response.parsed_body.first
        expect(block_json.keys).to include("id", "meeting_id", "block_type", "content",
                                           "position", "parent_block_id", "created_at", "updated_at")
      end
    end

    context "존재하지 않는 meeting" do
      it "404 Not Found 반환" do
        get "/api/v1/meetings/999999/blocks"
        expect(response).to have_http_status(:not_found)
      end
    end
  end

  # ─────────────────────────────────────────────────────────
  # POST /api/v1/meetings/:meeting_id/blocks
  # ─────────────────────────────────────────────────────────
  describe "POST /api/v1/meetings/:meeting_id/blocks" do
    let(:valid_params) { { block: { block_type: "text", content: "Hello" } } }

    context "정상 케이스" do
      it "201 Created, 블록 생성 반환" do
        post "/api/v1/meetings/#{meeting.id}/blocks",
             params: valid_params, as: :json
        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["block_type"]).to eq("text")
        expect(json["content"]).to eq("Hello")
        expect(json["meeting_id"]).to eq(meeting.id)
      end

      it "첫 번째 블록 position은 1000.0" do
        post "/api/v1/meetings/#{meeting.id}/blocks",
             params: valid_params, as: :json
        expect(response.parsed_body["position"]).to eq(1000.0)
      end

      it "두 번째 블록 position은 2000.0" do
        create(:block, meeting: meeting, position: 1000.0)
        post "/api/v1/meetings/#{meeting.id}/blocks",
             params: valid_params, as: :json
        expect(response.parsed_body["position"]).to eq(2000.0)
      end

      it "parent_block_id를 포함해서 생성 가능" do
        parent = create(:block, meeting: meeting, position: 1000.0)
        post "/api/v1/meetings/#{meeting.id}/blocks",
             params: { block: { block_type: "text", content: "child", parent_block_id: parent.id } },
             as: :json
        expect(response).to have_http_status(:created)
        expect(response.parsed_body["parent_block_id"]).to eq(parent.id)
      end

      it "heading1 block_type 생성 가능" do
        post "/api/v1/meetings/#{meeting.id}/blocks",
             params: { block: { block_type: "heading1", content: "Title" } },
             as: :json
        expect(response).to have_http_status(:created)
        expect(response.parsed_body["block_type"]).to eq("heading1")
      end
    end

    context "존재하지 않는 meeting" do
      it "404 Not Found" do
        post "/api/v1/meetings/999999/blocks",
             params: valid_params, as: :json
        expect(response).to have_http_status(:not_found)
      end
    end

    context "유효하지 않은 block_type" do
      it "422 Unprocessable Entity" do
        post "/api/v1/meetings/#{meeting.id}/blocks",
             params: { block: { block_type: "invalid_type", content: "Hello" } },
             as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end
  end

  # ─────────────────────────────────────────────────────────
  # PATCH /api/v1/meetings/:meeting_id/blocks/:id
  # ─────────────────────────────────────────────────────────
  describe "PATCH /api/v1/meetings/:meeting_id/blocks/:id" do
    let!(:block) { create(:block, meeting: meeting, position: 1000.0, block_type: "text", content: "original") }

    context "정상 케이스" do
      it "200 OK, 블록 내용 수정" do
        patch "/api/v1/meetings/#{meeting.id}/blocks/#{block.id}",
              params: { block: { content: "updated" } },
              as: :json
        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["content"]).to eq("updated")
      end

      it "block_type 수정 가능" do
        patch "/api/v1/meetings/#{meeting.id}/blocks/#{block.id}",
              params: { block: { block_type: "heading1" } },
              as: :json
        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["block_type"]).to eq("heading1")
      end
    end

    context "존재하지 않는 meeting" do
      it "404 Not Found" do
        patch "/api/v1/meetings/999999/blocks/#{block.id}",
              params: { block: { content: "updated" } },
              as: :json
        expect(response).to have_http_status(:not_found)
      end
    end

    context "존재하지 않는 block" do
      it "404 Not Found" do
        patch "/api/v1/meetings/#{meeting.id}/blocks/999999",
              params: { block: { content: "updated" } },
              as: :json
        expect(response).to have_http_status(:not_found)
      end
    end

    context "유효하지 않은 block_type" do
      it "422 Unprocessable Entity" do
        patch "/api/v1/meetings/#{meeting.id}/blocks/#{block.id}",
              params: { block: { block_type: "invalid" } },
              as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end
  end

  # ─────────────────────────────────────────────────────────
  # DELETE /api/v1/meetings/:meeting_id/blocks/:id
  # ─────────────────────────────────────────────────────────
  describe "DELETE /api/v1/meetings/:meeting_id/blocks/:id" do
    let!(:block) { create(:block, meeting: meeting, position: 1000.0) }

    context "정상 케이스" do
      it "204 No Content 반환 및 DB에서 삭제" do
        delete "/api/v1/meetings/#{meeting.id}/blocks/#{block.id}"
        expect(response).to have_http_status(:no_content)
        expect(Block.find_by(id: block.id)).to be_nil
      end
    end

    context "존재하지 않는 meeting" do
      it "404 Not Found" do
        delete "/api/v1/meetings/999999/blocks/#{block.id}"
        expect(response).to have_http_status(:not_found)
      end
    end

    context "존재하지 않는 block" do
      it "404 Not Found" do
        delete "/api/v1/meetings/#{meeting.id}/blocks/999999"
        expect(response).to have_http_status(:not_found)
      end
    end
  end

  # ─────────────────────────────────────────────────────────
  # PATCH /api/v1/meetings/:meeting_id/blocks/:id/reorder
  # ─────────────────────────────────────────────────────────
  describe "PATCH /api/v1/meetings/:meeting_id/blocks/:id/reorder" do
    let!(:block_a) { create(:block, meeting: meeting, position: 1000.0) }
    let!(:block_b) { create(:block, meeting: meeting, position: 2000.0) }
    let!(:block_c) { create(:block, meeting: meeting, position: 3000.0) }

    context "정상 케이스" do
      it "200 OK, 두 블록 사이로 이동" do
        patch "/api/v1/meetings/#{meeting.id}/blocks/#{block_c.id}/reorder",
              params: { prev_block_id: block_a.id, next_block_id: block_b.id },
              as: :json
        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["block"]["position"]).to be_between(1000.0, 2000.0)
      end

      it "맨 앞으로 이동 (prev_block_id: null)" do
        patch "/api/v1/meetings/#{meeting.id}/blocks/#{block_c.id}/reorder",
              params: { prev_block_id: nil, next_block_id: block_a.id },
              as: :json
        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["block"]["position"]).to be < 1000.0
      end

      it "맨 뒤로 이동 (next_block_id: null)" do
        patch "/api/v1/meetings/#{meeting.id}/blocks/#{block_a.id}/reorder",
              params: { prev_block_id: block_c.id, next_block_id: nil },
              as: :json
        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["block"]["position"]).to be > 3000.0
      end

      it "rebalance 발생 시 rebalanced: true 및 blocks 배열 포함" do
        # position 차이가 0.001 미만인 경우 rebalance 발생
        block_x = create(:block, meeting: meeting, position: 1000.0005)
        patch "/api/v1/meetings/#{meeting.id}/blocks/#{block_c.id}/reorder",
              params: { prev_block_id: block_a.id, next_block_id: block_x.id },
              as: :json
        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["rebalanced"]).to be true
        expect(json["blocks"]).to be_an(Array)
      end
    end

    context "존재하지 않는 meeting" do
      it "404 Not Found" do
        patch "/api/v1/meetings/999999/blocks/#{block_a.id}/reorder",
              params: { prev_block_id: nil, next_block_id: block_b.id },
              as: :json
        expect(response).to have_http_status(:not_found)
      end
    end

    context "존재하지 않는 block" do
      it "404 Not Found" do
        patch "/api/v1/meetings/#{meeting.id}/blocks/999999/reorder",
              params: { prev_block_id: nil, next_block_id: block_a.id },
              as: :json
        expect(response).to have_http_status(:not_found)
      end
    end
  end
end
