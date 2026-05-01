/**
 * Requisition POST 驗證測試（2026-05-01 加入後端 enum 白名單後）
 *
 * 涵蓋：
 *   - 必填欄位缺失 → 422
 *   - service_type / budget / timeline enum 白名單
 *   - 長度上限：name / contact / company / message
 *   - contact 格式（email / phone / line）
 *   - 合法 payload 成功 INSERT
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, callFunction, jsonPost } from './_helpers.js'
import { onRequestPost as requisitionPost } from '../../functions/api/requisition.js'

beforeAll(async () => { await resetDb() })
beforeEach(async () => { await resetDb() })

const VALID_BODY = Object.freeze({
  name: '王小明',
  contact: 'a@b.com',
  service_type: 'web',
  message: '想做一個小網站',
})

async function post(body, headers = {}) {
  return callFunction(requisitionPost, jsonPost('http://x/api/requisition', body, headers))
}

describe('POST /api/requisition validation', () => {
  it('合法 payload → 201', async () => {
    const r = await post({ ...VALID_BODY })
    expect(r.status).toBe(201)
    const data = await r.json()
    expect(data.success).toBe(true)
    expect(typeof data.id).toBe('number')
  })

  it.each([
    ['name'], ['contact'], ['service_type'], ['message'],
  ])('缺少必填 %s → 422', async (key) => {
    const body = { ...VALID_BODY }
    delete body[key]
    const r = await post(body)
    expect(r.status).toBe(422)
  })

  it('contact 格式不合法 → 422', async () => {
    const r = await post({ ...VALID_BODY, contact: 'abc' })
    expect(r.status).toBe(422)
  })

  it.each([
    ['system'], ['web'], ['game'], ['integration'],
    ['interactive'], ['branding'], ['marketing'], ['other'],
  ])('service_type=%s 在白名單 → 201', async (svc) => {
    const r = await post({ ...VALID_BODY, service_type: svc })
    expect(r.status).toBe(201)
  })

  it('service_type 不在白名單 → 422', async () => {
    const r = await post({ ...VALID_BODY, service_type: 'malicious' })
    expect(r.status).toBe(422)
    const data = await r.json()
    expect(data.error).toMatch(/service_type/i)
  })

  it('budget 不在白名單 → 422', async () => {
    const r = await post({ ...VALID_BODY, budget: 'unlimited' })
    expect(r.status).toBe(422)
  })

  it('timeline 不在白名單 → 422', async () => {
    const r = await post({ ...VALID_BODY, timeline: 'tomorrow' })
    expect(r.status).toBe(422)
  })

  it.each([
    ['under30k'], ['30k-80k'], ['80k-200k'], ['200k-1m'], ['flexible'],
  ])('budget=%s 在白名單 → 201', async (b) => {
    const r = await post({ ...VALID_BODY, budget: b })
    expect(r.status).toBe(201)
  })

  it.each([
    ['asap'], ['1-3m'], ['3-6m'], ['flexible'],
  ])('timeline=%s 在白名單 → 201', async (t) => {
    const r = await post({ ...VALID_BODY, timeline: t })
    expect(r.status).toBe(201)
  })

  it('message > 2000 字 → 422', async () => {
    const r = await post({ ...VALID_BODY, message: 'a'.repeat(2001) })
    expect(r.status).toBe(422)
  })

  it('name > 50 字 → 422', async () => {
    const r = await post({ ...VALID_BODY, name: 'a'.repeat(51) })
    expect(r.status).toBe(422)
  })

  it('contact > 100 字 → 422', async () => {
    const r = await post({ ...VALID_BODY, contact: 'a'.repeat(95) + '@b.com' })
    expect(r.status).toBe(422)
  })

  it('company > 100 字 → 422', async () => {
    const r = await post({ ...VALID_BODY, company: 'a'.repeat(101) })
    expect(r.status).toBe(422)
  })

  it('invalid JSON → 400', async () => {
    const req = new Request('http://x/api/requisition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const r = await callFunction(requisitionPost, req)
    expect(r.status).toBe(400)
  })
})
