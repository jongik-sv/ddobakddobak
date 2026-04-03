module Api
  module V1
    class MeetingBookmarksController < ApplicationController
      include MeetingLookup

      before_action :authenticate_user!
      before_action :set_meeting

      # GET /api/v1/meetings/:meeting_id/bookmarks
      def index
        bookmarks = @meeting.meeting_bookmarks.order(:timestamp_ms)
        render json: bookmarks.map { |b| bookmark_json(b) }
      end

      # POST /api/v1/meetings/:meeting_id/bookmarks
      def create
        bookmark = @meeting.meeting_bookmarks.build(bookmark_params)
        if bookmark.save
          render json: bookmark_json(bookmark), status: :created
        else
          render json: { errors: bookmark.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/meetings/:meeting_id/bookmarks/:id
      def destroy
        bookmark = @meeting.meeting_bookmarks.find(params[:id])
        bookmark.destroy
        head :no_content
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Bookmark not found" }, status: :not_found
      end

      private

      def bookmark_params
        params.permit(:timestamp_ms, :label)
      end

      def bookmark_json(bookmark)
        {
          id: bookmark.id,
          meeting_id: bookmark.meeting_id,
          timestamp_ms: bookmark.timestamp_ms,
          label: bookmark.label,
          created_at: bookmark.created_at
        }
      end
    end
  end
end
