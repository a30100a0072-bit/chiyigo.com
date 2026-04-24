/**
 * OAuth Provider 設定檔
 *
 * getProvider(name, env) → provider config，或 null（不支援）
 *
 * trustEmail：
 *   true  → 信箱已由第三方平台驗證，若與 DB 既有帳號碰撞則靜默綁定
 *   false → 信箱不可信任，碰撞時阻擋並要求用戶以密碼登入後手動綁定
 */

const PROVIDERS = {
  discord: {
    authUrl:     'https://discord.com/api/oauth2/authorize',
    tokenUrl:    'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scope:       'identify email',
    trustEmail:  true,
    // profile 正規化：統一輸出 { provider_id, email, name, avatar, email_verified }
    normalizeProfile(raw) {
      return {
        provider_id:    String(raw.id),
        email:          raw.email ?? null,
        name:           raw.username ?? null,
        avatar:         raw.avatar
          ? `https://cdn.discordapp.com/avatars/${raw.id}/${raw.avatar}.png`
          : null,
        email_verified: raw.verified === true,
      }
    },
  },

  google: {
    authUrl:     'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl:    'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope:       'openid email profile',
    trustEmail:  true,
    normalizeProfile(raw) {
      return {
        provider_id:    String(raw.sub),
        email:          raw.email ?? null,
        name:           raw.name ?? null,
        avatar:         raw.picture ?? null,
        email_verified: raw.email_verified === true,
      }
    },
  },

  line: {
    authUrl:     'https://access.line.me/oauth2/v2.1/authorize',
    tokenUrl:    'https://api.line.me/oauth2/v2.1/token',
    userInfoUrl: 'https://api.line.me/v2/profile',
    scope:       'profile openid email',
    trustEmail:  false,
    normalizeProfile(raw) {
      return {
        provider_id:    String(raw.userId),
        email:          raw.email ?? null,       // LINE 不一定回傳 email
        name:           raw.displayName ?? null,
        avatar:         raw.pictureUrl ?? null,
        email_verified: false,                   // LINE 不提供 email_verified
      }
    },
  },

  facebook: {
    authUrl:     'https://www.facebook.com/v20.0/dialog/oauth',
    tokenUrl:    'https://graph.facebook.com/v20.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/me?fields=id,name,email,picture',
    scope:       'email,public_profile',
    trustEmail:  false,
    normalizeProfile(raw) {
      return {
        provider_id:    String(raw.id),
        email:          raw.email ?? null,       // FB 用戶可拒絕授權 email
        name:           raw.name ?? null,
        avatar:         raw.picture?.data?.url ?? null,
        email_verified: false,                   // FB 不提供 email_verified
      }
    },
  },

  apple: {
    // TODO: 需要 Apple Developer 帳號（$99/yr）
    // Apple 的 callback 使用 form_post，[provider]/callback.js 需同時 export
    // onRequestGet 與 onRequestPost 才能接收。
    authUrl:     'https://appleid.apple.com/auth/authorize',
    tokenUrl:    'https://appleid.apple.com/auth/token',
    userInfoUrl: null,   // Apple 不提供 userInfo 端點，user info 在 id_token JWT 內
    scope:       'name email',
    trustEmail:  true,
    normalizeProfile(raw) {
      // raw 來自 id_token JWT payload（需在 callback 解碼）
      return {
        provider_id:    String(raw.sub),
        email:          raw.email ?? null,
        name:           raw.name ?? null,
        avatar:         null,
        email_verified: raw.email_verified === true || raw.email_verified === 'true',
      }
    },
  },
}

/**
 * 取得 provider 設定，並注入 clientId / clientSecret（從 env 讀取）。
 * @param {string} name  provider 名稱（小寫）
 * @param {object} env   Cloudflare Pages Functions env binding
 * @returns {object|null} provider config，不支援的 provider 回傳 null
 */
export function getProvider(name, env) {
  const cfg = PROVIDERS[name?.toLowerCase()]
  if (!cfg) return null

  const upper = name.toUpperCase()
  return {
    ...cfg,
    clientId:     env[`${upper}_CLIENT_ID`]     ?? null,
    clientSecret: env[`${upper}_CLIENT_SECRET`] ?? null,
  }
}

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDERS)
