module MeetingLookup
  extend ActiveSupport::Concern

  private

  def set_meeting
    @meeting = Meeting.find(params[:meeting_id] || params[:id])
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Meeting not found" }, status: :not_found
  end
end
