module Api
  module V1
    class MeetingBookmarksController < ApplicationController
      include MeetingLookup

      before_action :authenticate_user!
      before_action :set_meeting
      # 북마크는 회의 단위 공유 메타데이터(user_id 컬럼 없음)다. 공유(shared) 회의에서
      # 비소유자가 소유자의 북마크를 추가/삭제하지 못하도록 쓰기는 제어 티어(소유/admin/host)로
      # 제한한다. 열람(index)은 read-tier 유지 — 공유 회의 열람자도 북마크를 볼 수 있다.
      before_action :authorize_meeting_control!, only: %i[create update destroy]

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

      # PATCH /api/v1/meetings/:meeting_id/bookmarks/:id
      # 라벨만 수정한다(시점 timestamp_ms 는 불변).
      def update
        bookmark = @meeting.meeting_bookmarks.find(params[:id])
        if bookmark.update(label_params)
          render json: bookmark_json(bookmark)
        else
          render json: { errors: bookmark.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Bookmark not found" }, status: :not_found
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

      def label_params
        params.permit(:label)
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
