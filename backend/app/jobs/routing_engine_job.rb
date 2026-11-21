# Plays the external routing engine. It is scheduled with the attempt's
# simulated delay, computes a match without holding any locks (as a remote
# service would), then calls back into RoutingResultHandler, which decides
# whether the result still applies.
class RoutingEngineJob < ApplicationJob
  queue_as :routing

  # Dispatch happens inside the request transaction; never defer it past commit
  # (a failed enqueue must roll the request back).
  self.enqueue_after_transaction_commit = false

  # The job can only outrun the request's commit when a forced delay is tiny.
  retry_on ActiveRecord::RecordNotFound, wait: 1.second, attempts: 5

  # force: deliver even a never_return attempt. Used only by the development
  # simulation controls to demonstrate a late response.
  def perform(request_token, force: false)
    attempt = RoutingAttempt.includes(task: :required_expertise).find_by!(request_token: request_token)
    return if attempt.simulated_behavior == "never_return" && !force

    match = ExpertiseMatchingService.call(task: attempt.task)
    RoutingResultHandler.call(request_token: request_token, contributor_id: match.contributor&.id, reason: match.reason)
  end
end
