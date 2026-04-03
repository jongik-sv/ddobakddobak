module Api
  module V1
    class SearchController < ApplicationController
      before_action :authenticate_user!

      def index
        result = SearchService.new(
          user: current_user,
          query: params[:q],
          filters: search_filters,
          page: params[:page],
          per_page: params[:per_page]
        ).call

        render json: {
          results: result.results,
          total: result.total,
          page: result.page,
          per_page: result.per_page
        }
      end

      private

      def search_filters
        params.permit(:speaker, :date_from, :date_to, :folder_id, :status).to_h
      end
    end
  end
end
