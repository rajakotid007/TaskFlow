Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    namespace :v1 do
      resources :tasks, only: %i[index show create update] do
        member do
          post :route
          post :intervene
          post :recover
          post :start
          post :complete
          post :cancel
          get :history
          get :eligible_contributors
        end
      end

      resources :contributors, only: %i[index show create update]
      resources :expertise_areas, only: %i[index create]

      resources :assignments, only: [] do
        member do
          post :accept
          post :decline
        end
      end

      resources :routing_attempts, path: "routing-attempts", only: %i[index show]
      resources :events, only: :index
      get "dashboard/summary", to: "dashboard#summary"

      scope :simulation, controller: :simulation do
        get "/", action: :status
        get "routing-attempts", action: :attempts
        post "routing-attempts/:id/deliver", action: :deliver
      end
    end
  end
end
