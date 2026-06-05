module Api
  module V1
    class MeetingContactsController < ApplicationController
      include MeetingLookup

      before_action :authenticate_user!
      before_action :set_meeting
      before_action :authorize_meeting_control!, only: %i[update destroy]
      before_action :set_contact, only: %i[update destroy]

      def index
        contacts = @meeting.meeting_contacts.order(:created_at)
        render json: { contacts: contacts.map { |c| contact_json(c) } }
      end

      def update
        if @contact.update(contact_params)
          render json: { contact: contact_json(@contact) }
        else
          render json: { errors: @contact.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @contact.destroy
        head :no_content
      end

      private

      def set_contact
        @contact = @meeting.meeting_contacts.find_by(id: params[:id])
        render json: { error: "Contact not found" }, status: :not_found unless @contact
      end

      def contact_params
        params.permit(:name, :company, :department, :title,
                      :mobile, :phone, :fax, :email, :website, :address)
      end

      def contact_json(c)
        {
          id: c.id,
          meeting_id: c.meeting_id,
          name: c.name,
          company: c.company,
          department: c.department,
          title: c.title,
          mobile: c.mobile,
          phone: c.phone,
          fax: c.fax,
          email: c.email,
          website: c.website,
          address: c.address,
          extra: c.extra || {},
          raw_text: c.raw_text,
          source_attachment_id: c.source_attachment_id,
          created_at: c.created_at,
          updated_at: c.updated_at
        }
      end
    end
  end
end
