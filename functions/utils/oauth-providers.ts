/**
 * OAuth Provider 設定檔
 *
 * getProvider(name, env) → provider config，或 null（不支援）
 *
 * trustEmail：
 *   true  → 信箱已由第三方平台驗證，若與 DB 既有帳號碰撞則靜默綁定
 *   false → 信箱不可信任，碰撞時阻擋並要求用戶以密碼登入後手動綁定
 */

interface NormalizedProfile {
  provider_id: string
  email: string | null
  name: string | null
  avatar: string | null
  email_verified: boolean
}

interface RawDiscordProfile { id: string | number; email?: string | null; username?: string | null; avatar?: string | null; verified?: boolean }
interface RawGoogleProfile { sub: string | number; email?: string | null; name?: string | null; picture?: string | null; email_verified?: boolean }
interface RawLineProfile { userId: string | number; email?: string | null; displayName?: string | null; pictureUrl?: string | null }
interface RawFacebookProfile { id: string | number; email?: string | null; name?: string | null; picture?: { data?: { url?: string | null } } }
interface RawAppleProfile { sub: string | number; email?: string | null; name?: string | null; email_verified?: boolean | string }

interface ProviderConfig {
  authUrl: string
  tokenUrl: string
  userInfoUrl: string | null
  scope: string
  trustEmail: boolean
  normalizeProfile(raw: unknown): NormalizedProfile
}

const PROVIDERS: Record<string, ProviderConfig> = {
  discord: {
    authUrl:     'https://discord.com/api/oauth2/authorize',
    tokenUrl:    'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scope:       'identify email',
    trustEmail:  true,
    // profile 正規化：統一輸出 { provider_id, email, name, avatar, email_verified }
    normalizeProfile(raw) {
      return {
        provider_id:    String((raw as RawDiscordProfile).id),
        email:          (raw as RawDiscordProfile).email ?? null,
        name:           (raw as RawDiscordProfile).username ?? null,
        avatar:         (raw as RawDiscordProfile).avatar
          ? `https://cdn.discordapp.com/avatars/${(raw as RawDiscordProfile).id}/${(raw as RawDiscordProfile).avatar}.png`
          : null,
        email_verified: (raw as RawDiscordProfile).verified === true,
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
        provider_id:    String((raw as RawGoogleProfile).sub),
        email:          (raw as RawGoogleProfile).email ?? null,
        name:           (raw as RawGoogleProfile).name ?? null,
        avatar:         (raw as RawGoogleProfile).picture ?? null,
        email_verified: (raw as RawGoogleProfile).email_verified === true,
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
        provider_id:    String((raw as RawLineProfile).userId),
        email:          (raw as RawLineProfile).email ?? null,       // LINE 不一定回傳 email
        name:           (raw as RawLineProfile).displayName ?? null,
        avatar:         (raw as RawLineProfile).pictureUrl ?? null,
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
        provider_id:    String((raw as RawFacebookProfile).id),
        email:          (raw as RawFacebookProfile).email ?? null,       // FB 用戶可拒絕授權 email
        name:           (raw as RawFacebookProfile).name ?? null,
        avatar:         (raw as RawFacebookProfile).picture?.data?.url ?? null,
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
        provider_id:    String((raw as RawAppleProfile).sub),
        email:          (raw as RawAppleProfile).email ?? null,
        name:           (raw as RawAppleProfile).name ?? null,
        avatar:         null,
        email_verified: (raw as RawAppleProfile).email_verified === true || (raw as RawAppleProfile).email_verified === 'true',
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
interface ProviderSecretsEnv {
  DISCORD_CLIENT_ID?: string; DISCORD_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string
  LINE_CLIENT_ID?: string; LINE_CLIENT_SECRET?: string
  FACEBOOK_CLIENT_ID?: string; FACEBOOK_CLIENT_SECRET?: string
  APPLE_CLIENT_ID?: string; APPLE_CLIENT_SECRET?: string
}

export function getProvider(name: string, env: ProviderSecretsEnv) {
  const cfg = PROVIDERS[name?.toLowerCase()]
  if (!cfg) return null

  const upper = name.toUpperCase()
  return {
    ...cfg,
    clientId:     env[`${upper}_CLIENT_ID` as keyof ProviderSecretsEnv]     ?? null,
    clientSecret: env[`${upper}_CLIENT_SECRET` as keyof ProviderSecretsEnv] ?? null,
  }
}

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDERS)
