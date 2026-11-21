class TaskCreationService < ApplicationService
  def initialize(attributes:, submit: false, simulation: nil)
    @attributes = attributes
    @submit = submit
    @simulation = simulation
  end

  # Returns the task. Raises ActiveRecord::RecordInvalid on validation errors.
  # Creation and submission share one transaction: if routing cannot be
  # dispatched the task is not created either, so there is no half-submitted
  # task to explain.
  def call
    Task.transaction do
      task = Task.create!(@attributes.merge(status: "draft"))
      audit(task, event_type: "task_created", new_state: "draft",
        message: "Task created (#{task.priority} priority, requires #{task.required_expertise.name})")
      next task unless @submit

      RoutingRequestService.call(task_id: task.id, mode: :submit, simulation: @simulation).task
    end
  end
end
