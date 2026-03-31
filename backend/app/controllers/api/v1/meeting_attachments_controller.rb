module Api
  module V1
    class MeetingAttachmentsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_meeting
      before_action :set_attachment, only: %i[update destroy download reorder]

      def index
        attachments = @meeting.meeting_attachments.for_category(params[:category]).ordered
        render json: { attachments: attachments.map { |a| attachment_json(a) } }
      end

      def create
        if params[:file].present?
          create_file_attachment
        else
          create_link_attachment
        end
      end

      def update
        attrs = {}
        attrs[:display_name] = params[:display_name] if params.key?(:display_name)

        if params.key?(:category) && params[:category] != @attachment.category
          attrs[:category] = params[:category]
          attrs[:position] = next_position_for(params[:category])
        end

        if @attachment.update(attrs)
          render json: { attachment: attachment_json(@attachment) }
        else
          render json: { errors: @attachment.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @attachment.destroy
        head :no_content
      end

      def download
        unless @attachment.file? && @attachment.file_path.present? && File.exist?(@attachment.file_path)
          return render json: { error: "File not found" }, status: :not_found
        end

        send_file @attachment.file_path,
                  type: @attachment.content_type || "application/octet-stream",
                  disposition: "attachment",
                  filename: @attachment.original_filename
      end

      def reorder
        prev_attachment = find_adjacent(params[:prev_attachment_id])
        next_attachment = find_adjacent(params[:next_attachment_id])

        rebalanced = rebalance_if_needed!(prev_attachment, next_attachment)

        new_position = calculate_position(prev_attachment, next_attachment)
        @attachment.update_column(:position, new_position)
        @attachment.reload

        render json: reorder_response(rebalanced)
      end

      private

      def set_meeting
        @meeting = Meeting.find(params[:meeting_id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Meeting not found" }, status: :not_found
      end

      def set_attachment
        @attachment = @meeting.meeting_attachments.find_by(id: params[:id])
        render json: { error: "Attachment not found" }, status: :not_found unless @attachment
      end

      def create_file_attachment
        file = params[:file]
        category = params[:category] || "reference"

        content_type = file.content_type.to_s.split(";").first.strip
        unless MeetingAttachment::ALLOWED_CONTENT_TYPES.include?(content_type)
          return render json: { error: "File type not allowed" }, status: :unprocessable_entity
        end

        if file.size > MeetingAttachment::MAX_FILE_SIZE
          return render json: { error: "File too large (max 50MB)" }, status: :unprocessable_entity
        end

        # 먼저 파일을 디스크에 저장 (UUID 기반 이름)
        dest_path = save_file(file)

        attachment = @meeting.meeting_attachments.build(
          kind: "file",
          category: category,
          display_name: params[:display_name].presence || file.original_filename,
          original_filename: file.original_filename,
          content_type: content_type,
          file_size: file.size,
          file_path: dest_path,
          uploaded_by_id: current_user.id,
          position: next_position_for(category)
        )

        if attachment.save
          render json: { attachment: attachment_json(attachment) }, status: :created
        else
          File.delete(dest_path) if File.exist?(dest_path)
          render json: { errors: attachment.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def create_link_attachment
        category = params[:category] || "reference"

        attachment = @meeting.meeting_attachments.build(
          kind: "link",
          category: category,
          display_name: params[:display_name].presence || params[:url],
          url: params[:url],
          uploaded_by_id: current_user.id,
          position: next_position_for(category)
        )

        if attachment.save
          render json: { attachment: attachment_json(attachment) }, status: :created
        else
          render json: { errors: attachment.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def save_file(file)
        dir = attachments_dir
        FileUtils.mkdir_p(dir)

        sanitized = file.original_filename.gsub(/[^\w.\-]/, "_").slice(0, 200)
        filename = "#{@meeting.id}_#{SecureRandom.hex(8)}_#{sanitized}"
        dest_path = File.join(dir, filename)

        File.open(dest_path, "wb") { |f| f.write(file.read) }
        dest_path
      end

      def attachments_dir
        ENV.fetch("ATTACHMENTS_DIR") { Rails.root.join("storage", "attachments").to_s }
      end

      def next_position_for(category)
        last = @meeting.meeting_attachments.where(category: category).order(:position).last
        last ? last.position + FractionalIndexing::DEFAULT_GAP : FractionalIndexing::DEFAULT_START
      end

      def find_adjacent(attachment_id)
        return nil unless attachment_id.present?
        @meeting.meeting_attachments.find_by(id: attachment_id)
      end

      def calculate_position(prev_attachment, next_attachment)
        if prev_attachment.nil? && next_attachment.nil?
          last = @meeting.meeting_attachments.where(category: @attachment.category).order(:position).last
          last ? FractionalIndexing.after(last.position) : FractionalIndexing::DEFAULT_START
        elsif prev_attachment.nil?
          FractionalIndexing.before(next_attachment.position)
        elsif next_attachment.nil?
          FractionalIndexing.after(prev_attachment.position)
        else
          FractionalIndexing.between(prev_attachment.position, next_attachment.position)
        end
      end

      def rebalance_if_needed!(prev_attachment, next_attachment)
        return false unless prev_attachment && next_attachment
        return false unless FractionalIndexing.needs_rebalance?(prev_attachment.position, next_attachment.position)

        rebalance_category!(@attachment.category)
        prev_attachment.reload
        next_attachment.reload
        true
      end

      def rebalance_category!(category)
        attachments = @meeting.meeting_attachments.where(category: category).order(:position)
        attachments.each_with_index do |att, index|
          att.update_column(:position, (index + 1) * FractionalIndexing::DEFAULT_GAP)
        end
      end

      def reorder_response(rebalanced)
        response = { attachment: attachment_json(@attachment) }
        if rebalanced
          response[:rebalanced] = true
          response[:attachments] = @meeting.meeting_attachments
                                           .where(category: @attachment.category)
                                           .order(:position)
                                           .map { |a| attachment_json(a) }
        end
        response
      end

      def attachment_json(attachment)
        {
          id: attachment.id,
          meeting_id: attachment.meeting_id,
          kind: attachment.kind,
          category: attachment.category,
          display_name: attachment.display_name,
          original_filename: attachment.original_filename,
          content_type: attachment.content_type,
          file_size: attachment.file_size,
          url: attachment.url,
          position: attachment.position,
          uploaded_by: { id: attachment.uploaded_by_id, name: attachment.uploader&.name },
          created_at: attachment.created_at,
          updated_at: attachment.updated_at
        }
      end
    end
  end
end
