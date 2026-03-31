Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check
  mount ActionCable.server => "/cable"

  namespace :api do
    namespace :v1 do
      get "health", to: "health#show"

      # Meetings CRUD + start/stop + nested resources
      resources :meetings, only: %i[index create show update destroy] do
        collection do
          post :upload_audio
          post :move_to_folder
        end
        member do
          post :start
          post :stop
          post :reopen
          post :reset_content
          post :summarize
          post :regenerate_stt
          post :regenerate_notes
          post :feedback
          patch :update_notes
          post :audio, to: "meetings_audio#create"
          get  :audio, to: "meetings_audio#show"
          get  :peaks, to: "meetings_audio#peaks"
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
        resources :attachments, only: %i[index create update destroy],
                  controller: "meeting_attachments" do
          member do
            get :download
            patch :reorder
          end
        end
      end

      # Folders
      resources :folders, only: %i[index create update destroy]

      # Tags
      resources :tags, only: %i[index create update destroy]

      # Action Items (update, destroy)
      resources :action_items, only: %i[update destroy]

      # Speakers (화자 목록 조회 / 이름 변경 / 리셋)
      resources :speakers, only: %i[index update] do
        collection do
          delete :destroy_all
        end
      end

      # Prompt Templates
      resources :prompt_templates, only: %i[index create update destroy] do
        member do
          post :reset
        end
      end

      # Settings
      get  "settings", to: "settings#show"
      post "settings/stt_engine", to: "settings#update_stt"
      get  "settings/llm", to: "settings#llm"
      put  "settings/llm", to: "settings#update_llm"
      post "settings/llm/test", to: "settings#test_llm"
      get  "settings/hf", to: "settings#hf"
      put  "settings/hf", to: "settings#update_hf"
      get  "settings/app", to: "settings#app_settings"
      put  "settings/app", to: "settings#update_app_settings"

    end
  end
end
