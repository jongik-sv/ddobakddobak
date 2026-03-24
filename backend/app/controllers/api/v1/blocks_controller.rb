module Api
  module V1
    class BlocksController < ApplicationController
      before_action :authenticate_user!
      before_action :set_meeting
      before_action :authorize_meeting_member!
      before_action :set_block, only: %i[update destroy reorder]

      def index
        blocks = @meeting.blocks.order(:position)
        render json: blocks.map { |b| block_json(b) }
      end

      def create
        position = FractionalIndexing.position_for(nil, nil, @meeting)

        block = @meeting.blocks.build(
          block_type: block_params[:block_type] || "text",
          content: block_params[:content],
          parent_block_id: block_params[:parent_block_id],
          position: position
        )

        if block.save
          render json: block_json(block), status: :created
        else
          render json: { errors: block.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        if @block.update(update_params)
          render json: block_json(@block)
        else
          render json: { errors: @block.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @block.destroy
        head :no_content
      end

      def reorder
        prev_block = find_adjacent_block(params[:prev_block_id])
        next_block = find_adjacent_block(params[:next_block_id])

        rebalanced = rebalance_if_needed!(prev_block, next_block)

        new_position = FractionalIndexing.position_for(prev_block, next_block, @meeting)
        @block.update_column(:position, new_position)
        @block.reload

        render json: reorder_response(rebalanced)
      end

      private

      def set_meeting
        @meeting = Meeting.find(params[:meeting_id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Meeting not found" }, status: :not_found
      end

      def authorize_meeting_member!
        unless @meeting.team.team_memberships.exists?(user: current_user)
          render json: { error: "Forbidden" }, status: :forbidden
        end
      end

      def set_block
        @block = @meeting.blocks.find_by(id: params[:id])
        render json: { error: "Block not found" }, status: :not_found unless @block
      end

      def block_params
        params.require(:block).permit(:block_type, :content, :parent_block_id)
      end
      alias update_params block_params

      def find_adjacent_block(block_id)
        return nil unless block_id.present?

        @meeting.blocks.find_by(id: block_id)
      end

      def rebalance_if_needed!(prev_block, next_block)
        return false unless prev_block && next_block
        return false unless FractionalIndexing.needs_rebalance?(prev_block.position, next_block.position)

        FractionalIndexing.rebalance!(@meeting)
        prev_block.reload
        next_block.reload
        true
      end

      def reorder_response(rebalanced)
        response = { block: block_json(@block) }
        if rebalanced
          response[:rebalanced] = true
          response[:blocks] = @meeting.blocks.order(:position).map { |b| block_json(b) }
        end
        response
      end

      def block_json(block)
        {
          id: block.id,
          meeting_id: block.meeting_id,
          block_type: block.block_type,
          content: block.content,
          position: block.position,
          parent_block_id: block.parent_block_id,
          created_at: block.created_at,
          updated_at: block.updated_at
        }
      end
    end
  end
end
