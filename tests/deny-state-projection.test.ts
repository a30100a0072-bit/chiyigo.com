import { describe, it, expect } from 'vitest'
import { buildDomainEvent, type DomainEvent, type DomainEventType } from '../functions/utils/domain-events'
import { projectionDecision } from '../functions/utils/deny-state-projection'

function ev(eventType: DomainEventType, streamSeq: number, data: Record<string, unknown>, tenantId: number | null = 1): DomainEvent {
  return buildDomainEvent(eventType, { tenantId, actorSub: 's', data }, { eventId: 'e', streamSeq, occurredAt: '2026-06-02T00:00:00.000Z' })
}

describe('projectionDecision (contiguous apply, B1)', () => {
  it('seq <= prior -> noop (duplicate / stale re-delivery)', () => {
    expect(projectionDecision(ev('member.suspended', 3, { sub: '1', previousRole: 'member' }), 3, 1)).toEqual({ kind: 'noop' })
    expect(projectionDecision(ev('member.suspended', 2, { sub: '1', previousRole: 'member' }), 3, 1)).toEqual({ kind: 'noop' })
  })

  it('seq > prior+1 -> gap with expected = prior+1', () => {
    expect(projectionDecision(ev('member.suspended', 5, { sub: '1', previousRole: 'member' }), 3, 0)).toEqual({ kind: 'gap', expected: 4 })
  })

  it('contiguous deny -> apply denied=1 (incl. first event prior=0,seq=1)', () => {
    expect(projectionDecision(ev('member.suspended', 1, { sub: '1', previousRole: 'member' }), 0, 0)).toEqual({ kind: 'apply', denied: 1, denyEffect: 'deny' })
  })

  it('contiguous undeny -> apply denied=0', () => {
    expect(projectionDecision(ev('member.reactivated', 4, { sub: '1', platformRole: 'member' }), 3, 1)).toEqual({ kind: 'apply', denied: 0, denyEffect: 'undeny' })
  })

  it('contiguous soft (role_changed) -> apply keeps PRIOR denied', () => {
    const e = ev('member.role_changed', 4, { sub: '1', fromRole: 'member', toRole: 'tenant_admin' })
    expect(projectionDecision(e, 3, 1)).toEqual({ kind: 'apply', denied: 1, denyEffect: 'soft' })
    expect(projectionDecision(e, 3, 0)).toEqual({ kind: 'apply', denied: 0, denyEffect: 'soft' })
  })

  it('contiguous none (invited) -> apply keeps PRIOR denied', () => {
    expect(projectionDecision(ev('member.invited', 1, { invitationId: 5, email: 'a@b.io', platformRole: 'member' }), 0, 0)).toEqual({ kind: 'apply', denied: 0, denyEffect: 'none' })
  })

  it('account / product / session deny-effects map correctly', () => {
    expect(projectionDecision(ev('account.disabled', 1, { sub: '1' }, null), 0, 0)).toEqual({ kind: 'apply', denied: 1, denyEffect: 'deny' })
    expect(projectionDecision(ev('account.reenabled', 2, { sub: '1' }, null), 1, 1)).toEqual({ kind: 'apply', denied: 0, denyEffect: 'undeny' })
    expect(projectionDecision(ev('product_access.revoked', 1, { productId: 'erp' }), 0, 0)).toEqual({ kind: 'apply', denied: 1, denyEffect: 'deny' })
    expect(projectionDecision(ev('product_access.restored', 2, { productId: 'erp' }), 1, 1)).toEqual({ kind: 'apply', denied: 0, denyEffect: 'undeny' })
    expect(projectionDecision(ev('session.revoked', 1, { sub: '1', scope: 'device', ref: 'd1' }, null), 0, 0)).toEqual({ kind: 'apply', denied: 1, denyEffect: 'deny' })
  })
})
