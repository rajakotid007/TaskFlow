import { describe, expect, it } from 'vitest';
import { canTransition, assertTransition, InvalidTransitionError } from '../src/domain/stateMachine.js';

describe('task state machine', () => {
  it.each([
    ['submit_for_routing', 'draft', 'routing_pending'],
    ['submit_for_routing', 'declined', 'routing_pending'],
    ['submit_for_routing', 'assignment_failed', 'routing_pending'],
    ['routing_returned', 'routing_pending', 'awaiting_acceptance'],
    ['routing_no_match', 'routing_pending', 'needs_intervention'],
    ['manual_assign', 'routing_pending', 'awaiting_acceptance'],
    ['accept', 'awaiting_acceptance', 'assigned'],
    ['decline', 'awaiting_acceptance', 'declined'],
    ['start', 'assigned', 'in_progress'],
    ['complete', 'in_progress', 'completed'],
    ['cancel', 'draft', 'cancelled'],
  ] as const)('allows %s from %s to %s', (action, from, to) => {
    expect(canTransition(action, from)).toBe(to);
  });

  it.each([
    ['accept', 'declined'],
    ['accept', 'routing_pending'],
    ['complete', 'assigned'],
    ['decline', 'assigned'],
    ['recover', 'completed'],
  ] as const)('rejects %s from %s', (action, from) => {
    expect(canTransition(action as never, from)).toBeNull();
  });

  it('treats completed and cancelled as terminal', () => {
    expect(canTransition('cancel', 'completed')).toBeNull();
    expect(canTransition('cancel', 'cancelled')).toBeNull();
  });

  it('throws InvalidTransitionError with a 409 status for illegal moves', () => {
    expect(() => assertTransition('accept', 'declined')).toThrow(InvalidTransitionError);
    try {
      assertTransition('accept', 'declined');
    } catch (e) {
      expect((e as InvalidTransitionError).status).toBe(409);
      expect((e as InvalidTransitionError).code).toBe('invalid_transition');
    }
  });
});
