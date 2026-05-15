import { describe, it, expect, vi } from 'vitest'
import { pickOrMakeDeviceUuid } from '../functions/utils/device-id'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

function makeAdapter(initial) {
  const store = { val: initial ?? null }
  return {
    read:  () => store.val,
    write: (v) => { store.val = v },
    _store: store,
  }
}

describe('pickOrMakeDeviceUuid', () => {
  it('localStorage 已存合法值 → 直接回傳，不重新產', () => {
    const a = makeAdapter('web-' + VALID_UUID)
    const makeUuid = vi.fn(() => 'should-not-call')
    const out = pickOrMakeDeviceUuid({ read: a.read, write: a.write, makeUuid })
    expect(out).toBe('web-' + VALID_UUID)
    expect(makeUuid).not.toHaveBeenCalled()
    expect(a._store.val).toBe('web-' + VALID_UUID)
  })

  it('localStorage 空 → 產新值並寫入', () => {
    const a = makeAdapter(null)
    const out = pickOrMakeDeviceUuid({
      read: a.read, write: a.write, makeUuid: () => VALID_UUID,
    })
    expect(out).toBe('web-' + VALID_UUID)
    expect(a._store.val).toBe('web-' + VALID_UUID)
  })

  it('localStorage 內格式錯（非 web-uuid）→ 視為空、重新產', () => {
    const a = makeAdapter('garbage-not-a-uuid')
    const out = pickOrMakeDeviceUuid({
      read: a.read, write: a.write, makeUuid: () => VALID_UUID,
    })
    expect(out).toBe('web-' + VALID_UUID)
    expect(a._store.val).toBe('web-' + VALID_UUID)  // 覆寫掉 garbage
  })

  it('localStorage 不可用（read throw）→ 仍能產出新值', () => {
    const out = pickOrMakeDeviceUuid({
      read:  () => { throw new Error('SecurityError: localStorage') },
      write: () => { throw new Error('SecurityError: localStorage') },
      makeUuid: () => VALID_UUID,
    })
    expect(out).toBe('web-' + VALID_UUID)
  })

  it('crypto.randomUUID 不可用（makeUuid 回 null）→ 回 null，不阻塞', () => {
    const a = makeAdapter(null)
    const out = pickOrMakeDeviceUuid({
      read: a.read, write: a.write, makeUuid: () => null,
    })
    expect(out).toBeNull()
    expect(a._store.val).toBeNull()
  })

  it('makeUuid throw → 回 null，不丟異常', () => {
    const a = makeAdapter(null)
    const out = pickOrMakeDeviceUuid({
      read: a.read, write: a.write,
      makeUuid: () => { throw new Error('crypto unavailable') },
    })
    expect(out).toBeNull()
  })

  it('write throw（quota / private mode）→ 仍回傳新 uuid', () => {
    const out = pickOrMakeDeviceUuid({
      read:  () => null,
      write: () => { throw new Error('QuotaExceededError') },
      makeUuid: () => VALID_UUID,
    })
    expect(out).toBe('web-' + VALID_UUID)
  })
})
