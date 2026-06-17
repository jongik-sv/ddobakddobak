Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check
  mount ActionCable.server => "/cable"

  # ── Authentication (Devise + JWT) ──
  devise_for :users, path: "auth",
    path_names: { sign_in: "login", sign_out: "logout" },
    skip: [ :registrations ],
    controllers: {
      sessions: "auth/sessions"
    },
    defaults: { format: :json }

  # Refresh Token endpoint (inside devise_scope for mapping)
  devise_scope :user do
    post "auth/refresh", to: "auth/sessions#refresh"
  end

  # ── Browser Login / Register (서버 렌더링 HTML) ──
  scope "auth" do
    get  "web_login", to: "auth/browser_sessions#new",    as: :browser_login
    post "web_login", to: "auth/browser_sessions#create",  as: :browser_login_submit
  end

  # ── API v1 ──
  namespace :api do
    namespace :v1 do
      get "health", to: "health#show"
      get "search", to: "search#index"

      # Trash (휴지통)
      get    "trash",                   to: "trash#index"
      post   "trash/:type/:id/restore", to: "trash#restore"
      delete "trash/:type/:id",         to: "trash#destroy"
      delete "trash",                   to: "trash#empty"

      # Meetings CRUD + start/stop + nested resources
      resources :meetings, only: %i[index create show update destroy] do
        collection do
          post :upload_audio
          post :move_to_folder
          post :move_to_project
          post :join, to: "meeting_shares#join"
        end
        member do
          post :start
          post :stop
          post :reopen
          post :pause
          post :resume
          post :reset_content
          post :summarize
          post :regenerate_stt
          post :re_diarize
          post :regenerate_notes
          post :feedback
          get  :glossary
          post :reapply_glossary
          post :apply_glossary_entry
          patch :update_notes
          post :audio, to: "meetings_audio#create"
          post :audio_chunk, to: "meetings_audio#chunk"
          post :audio_finalize, to: "meetings_audio#finalize"
          get  :audio, to: "meetings_audio#show"
          get  :peaks, to: "meetings_audio#peaks"
          get  :export
          get  :export_prompt
          get  :summary
          get  :transcripts
          post :share, to: "meeting_shares#create_share"
          delete :share, to: "meeting_shares#destroy_share"
          get :participants, to: "meeting_shares#participants"
          post :transfer_host, to: "meeting_shares#transfer_host"
          post :claim_host, to: "meeting_shares#claim_host"
          post :lock
          delete :lock, to: "meetings#unlock"
        end
        resources :action_items,
          only: %i[index create],
          controller: "meeting_action_items"
        resources :decisions,
          only: %i[index create],
          controller: "meeting_decisions"
        resources :transcripts, only: [] do
          member do
            patch :update_content
          end
          collection do
            delete :destroy_batch
            post :bulk, action: :bulk_create
          end
        end
        resources :blocks, only: %i[index create update destroy] do
          member do
            patch :reorder
          end
        end
        resources :bookmarks, only: %i[index create update destroy],
                  controller: "meeting_bookmarks"
        resources :attachments, only: %i[index create update destroy],
                  controller: "meeting_attachments" do
          member do
            get :download
            patch :reorder
          end
        end
        resources :contacts, only: %i[index update destroy],
                  controller: "meeting_contacts"
        resources :glossary_entries, only: %i[create], controller: "glossary_entries"
        resources :chat_messages, only: %i[index create]
      end

      # Folders
      resources :folders, only: %i[index create update destroy] do
        member do
          post :move_to_project
        end
        resources :glossary_entries, only: %i[index create], controller: "glossary_entries"
      end
      resources :glossary_entries, only: %i[update destroy]

      # Tags
      resources :tags, only: %i[index create update destroy]

      # Action Items (update, destroy)
      resources :action_items, only: %i[update destroy]

      # Decisions (timeline, update, destroy)
      resources :decisions, only: %i[index update destroy]

      # Speakers (화자 목록 조회 / 이름 변경 / 리셋)
      resources :speakers, only: %i[index update] do
        collection do
          delete :destroy_all
        end
      end

      # Meeting Templates
      resources :meeting_templates, only: %i[index create update destroy]

      # Prompt Templates
      resources :prompt_templates, only: %i[index create update destroy] do
        member do
          post :reset
        end
      end

      # Projects
      resources :projects, only: %i[index show create update destroy] do
        collection do
          post :import, to: "project_transfers#import"
        end
        member do
          get  :members
          post :members, action: :add_member
          patch  "members/:user_id", action: :update_member, as: :update_member
          delete "members/:user_id", action: :remove_member, as: :remove_member
          post :export, to: "project_transfers#export"
        end
        resources :invites, only: %i[index create destroy], controller: "project_invites"
      end

      # 공개 초대(인증 불필요 — 미리보기 / redeem(가입 가능))
      get  "invite/:code", to: "invites#show"
      post "invite/:code/redeem", to: "invites#redeem"

      # Admin
      namespace :admin do
        resources :users, only: %i[index create update destroy] do
          member do
            post :reset_password
          end
        end
      end

      # User-scoped settings
      namespace :user do
        resource :llm_settings, only: [ :show, :update ] do
          post :test, on: :collection
          patch :toggle, on: :collection
        end
        resource :language_settings, only: [ :show, :update ]
        resource :password, only: [ :update ]
      end

      # Settings
      get  "settings", to: "settings#show"
      post "settings/stt_engine", to: "settings#update_stt"
      get  "settings/stt_file_engine", to: "settings#stt_file"
      put  "settings/stt_file_engine", to: "settings#update_stt_file"
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
