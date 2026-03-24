Rails.application.routes.draw do
  devise_for :users, skip: :all

  get "up" => "rails/health#show", as: :rails_health_check
  mount ActionCable.server => "/cable"

  namespace :api do
    namespace :v1 do
      get "health", to: "health#show"

      # Auth
      devise_scope :user do
        post "signup",  to: "registrations#create"
        post "login",   to: "sessions#create"
        delete "logout", to: "sessions#destroy"
      end

      # Meetings CRUD + start/stop + nested resources
      resources :meetings, only: %i[index create show update destroy] do
        collection do
          post :upload_audio
        end
        member do
          post :start
          post :stop
          post :reopen
          post :reset_content
          post :summarize
          post :feedback
          patch :update_notes
          post :audio, to: "meetings_audio#create"
          get  :audio, to: "meetings_audio#show"
          get  :export
          get  :summary
          get  :transcripts
        end
        resources :action_items,
          only: %i[index create],
          controller: "meeting_action_items"
        resources :transcripts, only: [] do
          collection do
            delete :destroy_batch
          end
        end
        resources :blocks, only: %i[index create update destroy] do
          member do
            patch :reorder
          end
        end
      end

      # Action Items (update, destroy)
      resources :action_items, only: %i[update destroy]

      # Speakers (화자 목록 조회 / 이름 변경 / 리셋)
      resources :speakers, only: %i[index update] do
        collection do
          delete :destroy_all
        end
      end

      # Settings
      get  "settings", to: "settings#show"
      post "settings/stt_engine", to: "settings#update_stt"
      get  "settings/llm", to: "settings#llm"
      put  "settings/llm", to: "settings#update_llm"
      get  "settings/hf", to: "settings#hf"
      put  "settings/hf", to: "settings#update_hf"

      # Teams
      resources :teams, only: %i[index create] do
        member do
          post "invite"
          delete "members/:user_id", to: "teams#remove_member", as: :remove_member
        end
      end
    end
  end
end
