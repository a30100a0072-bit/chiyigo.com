/**
 * Deny-state projection rule -- PR5 5b (plan section 6 / master 5.2). PURE: NO I/O. The consumer reads the
 * current projection row, calls projectionDecision(), then executes the DB writes (apply upsert + mark-done /
 * mark-done noop / gap -> DLQ). Keeping the rule out of the cron handler makes it unit-testable in isolation and
 * keeps the gap -> DLQ side effect on the consumer, not on this module.
 *
 * CONTIGUOUS apply (B1): apply iff streamSeq == last_applied_seq + 1; <= is a duplicate/stale no-op; > is a GAP
 * (invariant violation -- the consumer DLQs it with reason='gap_detected', NEVER a silent skip). soft/none events
 * advance the cursor only IN ORDER and leave `denied` unchanged. The materialized `denied` bit is the future RP
 * pull source of truth. An absent projection row is treated as last_applied_seq=0, denied=0.
 */
import { DENY_EFFECT, type DomainEvent } from './domain-events'

export type DenyBit = 0 | 1

export type ProjectionDecision =
  | { kind: 'apply'; denied: DenyBit; denyEffect: 'deny' | 'undeny' | 'soft' | 'none' }
  | { kind: 'noop' }
  | { kind: 'gap'; expected: number }

/**
 * Decide how a delivered event applies to its per-streamKey projection row.
 * @param event       the (already-validated) delivered domain event.
 * @param priorSeq    the projection row's last_applied_seq for this streamKey, or 0 if no row yet.
 * @param priorDenied the projection row's current denied bit, or 0 if no row yet.
 */
export function projectionDecision(event: DomainEvent, priorSeq: number, priorDenied: DenyBit): ProjectionDecision {
  const seq = event.streamSeq
  if (seq <= priorSeq) return { kind: 'noop' }            // duplicate / stale re-delivery
  if (seq > priorSeq + 1) return { kind: 'gap', expected: priorSeq + 1 } // invariant violation -> consumer DLQs
  // seq === priorSeq + 1 : contiguous apply
  const effect = DENY_EFFECT[event.eventType]
  const denied: DenyBit = effect === 'deny' ? 1 : effect === 'undeny' ? 0 : priorDenied // soft/none keep prior
  return { kind: 'apply', denied, denyEffect: effect }
}
