import { env } from 'cloudflare:test'
import setupSql from './_setup.sql?raw'
import {
  generateSalt,
  generateSecureToken,
  hashPassword,
  hashToken,
} from '../../functions/utils/crypto.js'

let _schemaReady = false

/** Apply schema once per worker; truncate tables every call. */
export async function resetDb() {
  if (!_schemaReady) {
    const stmts = setupSql.split(';').map(s => s.trim()).filter(Boolean)
    for (const s of stmts) {
      await env.chiyigo_db.prepare(s).run()
    }
    _schemaReady = true
  }
  // FK ON DELETE CASCADE handles dependants when we wipe users last.
  await env.chiyigo_db.batch([
    env.chiyigo_db.prepare('DELETE FROM refresh_tokens'),
    env.chiyigo_db.prepare('DELETE FROM email_verifications'),
    env.chiyigo_db.prepare('DELETE FROM backup_codes'),
    env.chiyigo_db.prepare('DELETE FROM local_accounts'),
    env.chiyigo_db.prepare('DELETE FROM users'),
  ])
}

/**
 * Insert a user + local_accounts row (password set).
 * Returns { id, email, password, salt, hash }.
 */
export async function seedUser({
  email = 'user@example.com',
  password = 'OldPass#1234',
  emailVerified = 1,
  deletedAt = null,
} = {}) {
  const salt = generateSalt()
  const hash = await hashPassword(password, salt)
  const r = await env.chiyigo_db
    .prepare('INSERT INTO users (email, email_verified, deleted_at) VALUES (?, ?, ?)')
    .bind(email, emailVerified, deletedAt)
    .run()
  const id = r.meta.last_row_id
  await env.chiyigo_db
    .prepare('INSERT INTO local_accounts (user_id, password_hash, password_salt) VALUES (?, ?, ?)')
    .bind(id, hash, salt)
    .run()
  return { id, email, password, salt, hash }
}

/**
 * Insert a reset-password token row.
 * Returns the plaintext token (the DB only stores hashToken(token)).
 */
export async function seedResetToken(userId, {
  ttlMinutes = 30,
  used = false,
  tokenType = 'reset_password',
} = {}) {
  const token = generateSecureToken()
  const tokenHash = await hashToken(token)
  const exp = new Date(Date.now() + ttlMinutes * 60_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  const usedAt = used
    ? new Date().toISOString().replace('T', ' ').slice(0, 19)
    : null
  await env.chiyigo_db
    .prepare(
      `INSERT INTO email_verifications
         (user_id, token_hash, token_type, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(userId, tokenHash, tokenType, exp, usedAt)
    .run()
  return token
}

/** Call a Pages Function handler with a fake context. */
export async function callFunction(handler, request) {
  return handler({
    request,
    env,
    waitUntil: () => {},
    params: {},
    next: async () => new Response('next'),
    data: {},
  })
}

/** Build a JSON POST Request to a fake URL. */
export function jsonPost(url, body, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}
