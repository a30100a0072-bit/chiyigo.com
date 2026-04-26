/**
 * 密碼強度驗證
 *
 * 規則（任一達標即可通過）：
 *   A. 長度 ≥ 12
 *   B. 長度 ≥ 8 且至少含 3 類：大寫 / 小寫 / 數字 / 符號
 *
 * @param {unknown} pw
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validatePassword(pw) {
  if (typeof pw !== 'string') return { ok: false, error: 'Password must be a string' }
  if (pw.length < 8)          return { ok: false, error: 'Password must be at least 8 characters' }
  if (pw.length >= 12)        return { ok: true }

  const classes =
    Number(/[A-Z]/.test(pw)) +
    Number(/[a-z]/.test(pw)) +
    Number(/\d/.test(pw)) +
    Number(/[^A-Za-z0-9]/.test(pw))

  if (classes < 3) {
    return {
      ok: false,
      error: 'Password must be ≥12 chars, or ≥8 chars with 3 of: uppercase / lowercase / digit / symbol',
    }
  }
  return { ok: true }
}
