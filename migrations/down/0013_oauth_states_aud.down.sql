-- Down 0013: 移除 oauth_states.aud
-- ⚠️ Rollback 後跨子網域 OAuth 入口（talo / mbti）的 aud 會回退到 'chiyigo'，
--   talo-worker / mbti-worker 端會 reject 該 token
ALTER TABLE oauth_states DROP COLUMN aud;
