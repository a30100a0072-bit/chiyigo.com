// ── Cross-script global ambient ───────────────────────
// dashboard.ts 是 classic <script>，多項 identifier 由其他 classic script 經
// lexical-scope / window-attachment 提供。本區段把這些 identifier 的型別補上，
// runtime 與原 dashboard.js 等價（per [[feedback_page_entry_apifetch_window_prefix]]
// + [[cross-script classic-global declare const pattern]] PR-5o 立樁）。
//
// dashboard.html 載入順序：api.js → auth-ui.js → form-enter.js (defer) → dashboard.js (defer)
// `defer` 保證 dashboard.js 執行時 api.js / auth-ui.js 已完成 top-level decl。
;
(function () {
    // ── block 1/3 ──
    // ── i18n ──────────────────────────────────────────────
    const LANGS_D = {"zh-TW":{"reverify_badge_needs":"需重新驗證","reverify_badge_high":"安全審查中","reverify_btn":"重新驗證","reverify_success":"✓ 已重新驗證，此登入方式已恢復使用","reverify_no_channel":"需先設定密碼或啟用 2FA 才能自助重新驗證，請先完成設定或聯絡客服","elev_reverify_required":"你的第三方身分需重新驗證後才能新增驗證因子，請先於「帳號綁定」完成重新驗證","factor_add_no_channel":"需先設定密碼或啟用兩步驟驗證，才能新增登入方式","factor_add_modal_title":"驗證身分以新增登入方式","factor_add_modal_hint":"為確認是你本人操作，請完成驗證後即可新增此登入方式。","factor_add_ph_totp":"兩步驟驗證碼或備用救援碼","factor_add_ph_pw":"目前登入密碼","factor_add_cancel":"取消","factor_add_confirm":"確認","bind_err_elevation_required":"驗證已失效，請重新綁定","bind_err_elevation_consumed":"驗證已逾時或已使用，請重新綁定","elev_reauth_modal_title":"驗證身分以新增登入方式","elev_reauth_modal_hint":"為確認是你本人，請用已綁定的帳號重新登入後，即可新增登入方式。","elev_reauth_provider_btn":"用 ${p} 重新驗證","elev_reauth_redirecting":"正在前往驗證…","elev_reauth_cancel":"取消","elev_reauth_no_candidate":"目前沒有可用於重新驗證的已綁定帳號，請先完成需重新驗證的項目或聯絡客服。","elev_reauth_storage_blocked":"瀏覽器封鎖了暫存資料，無法繼續。請改用一般視窗或解除隱私限制後再試。","elev_resume_lost":"驗證流程已中斷，請重新操作。","elev_exchange_failed":"驗證已失效或已使用，請重新操作。","elev_err_provider_mismatch":"重新驗證的帳號與原綁定不符，請改用正確的帳號。","elev_err_rate_limited":"嘗試次數過多，請稍後再試。","elev_err_invalid_state":"驗證階段已失效，請重新操作。","elev_err_generic":"重新驗證失敗，請重新操作。","back_home":"返回首頁","logout_header":"登出","loading_text":"載入中…","lbl_email":"電子信箱","lbl_verified":"Email 驗證","lbl_providers":"登入方式","lbl_created":"加入時間","tfa_title":"雙重驗證（2FA）","tfa_enable_btn":"啟用 2FA","tfa_disable_btn":"停用 2FA","tfa_setup_hint":"用 Google Authenticator 或任何 TOTP App 掃描 QR Code，然後輸入 6 位數驗證碼完成啟用。","tfa_manual_key":"或手動輸入金鑰：","tfa_otp_ph":"輸入 6 位數驗證碼","tfa_pw_ph":"輸入目前登入密碼","tfa_pw_required":"請輸入目前登入密碼","tfa_confirm_enable":"確認啟用","tfa_confirm_disable":"確認停用","tfa_disable_warn":"停用後需重新設定才能再次啟用。請輸入 Authenticator App 的驗證碼確認。","tfa_backup_warn_pre":"請立即抄下這 10 組備用碼，之後","tfa_backup_warn_em":"無法再次查看","tfa_backup_warn_post":"。每組只能使用一次。","tfa_backup_done":"我已抄寫完畢","email_unverified":"Email 尚未驗證","email_unverified_sub":"驗證後可使用完整帳號功能","resend_btn":"重發驗證信","logout_btn":"登出帳號","load_fail":"載入失敗","relogin_link":"← 重新登入","role_developer":"開發者","role_admin":"管理員","role_moderator":"版主","role_player":"玩家","provider_local":"密碼登入","status_active":"正常","verified_yes":"已驗證","verified_no":"尚未驗證","tfa_badge_on":"已啟用","tfa_badge_off":"未啟用","tfa_text_on":"帳號已受雙重驗證保護","tfa_text_off":"建議啟用以提升帳號安全性","err_profile":"無法載入帳號資訊，請重新整理或重新登入","btn_loading":"請稍候…","btn_sending":"送出中…","resend_sent":"驗證信已送出，請查收信箱（連結 1 小時內有效）。","resend_wait":"請稍候再試。","resend_fail":"發送失敗，請稍後再試。","net_err":"網路錯誤，請稍後再試。","totp_err6":"請輸入 6 位數驗證碼","setup_fail":"設定失敗","enable_fail":"啟用失敗","disable_fail":"停用失敗","disable_success":"✓ 已停用 2FA。為了安全，所有裝置已登出，請重新登入…","resend_timer_label":"重發（${s}s）","req_title":"我的需求單","req_subtitle":"近期提交的需求諮詢","req_new_btn":"提交新單 →","req_empty":"尚無需求單紀錄","req_revoke_note":"如需更改請撤銷需求重新填寫","btn_revoke_confirm":"確認撤銷？","status_pending":"待處理","status_processing":"處理中","status_completed":"已完成","status_revoked":"已撤銷","status_refund_pending":"退款審核中","btn_revoke":"撤銷","btn_processing":"處理中…","msg_revoke_success":"需求單 #${id} 已撤銷","msg_revoke_fail":"撤銷失敗，請重試","bind_title":"帳號綁定","bind_subtitle":"連結第三方帳號以增加登入選項","bind_btn":"綁定","unbind_btn":"解除綁定","bind_success":"${p} 綁定成功","unbind_success":"已解除 ${p} 綁定","bind_fail":"綁定失敗，請重試","unbind_fail":"解除失敗，請重試","unbind_last_method":"請先設定本地密碼或綁定其他帳號後，才能解除此綁定","bind_err_already":"此帳號已綁定","bind_err_taken":"此身分已被其他用戶使用","bind_err_state":"綁定請求已過期，請重試","bind_err_account":"帳號狀態異常，請重新登入","setpw_title":"設定登入密碼","setpw_subtitle":"你目前透過第三方帳號登入。設定密碼後，將擁有後備登入方式，並可執行刪帳等敏感操作。","setpw_btn":"寄送設定密碼信","setpw_sent":"✓ 設定密碼信已寄出，請至 <strong>${email}</strong> 點擊連結完成設定（連結有效 1 小時）。設定完成後請重新整理本頁。","setpw_fail":"寄送失敗，請稍後再試","danger_title":"危險區","danger_subtitle":"永久刪除帳號與所有相關資料，操作不可復原","del_open_btn":"我要刪除帳號","del_need_pw_local":"需先設定登入密碼","del_need_pw":"請先到上方「設定登入密碼」完成密碼設定，才能刪除帳號。","del_stage2_hint":"為防誤刪，請輸入登入密碼確認。送出後會寄送一封確認信到你的信箱，點擊信中連結後帳號才會真的被刪除（連結有效 15 分鐘）。","del_pw_ph":"登入密碼","del_cancel_btn":"取消","del_send_btn":"送出刪除確認信","del_pw_required":"請輸入密碼","del_sent":"✓ 確認信已寄出，請至信箱點擊連結完成刪除（15 分鐘內有效）。","del_err_pw":"密碼錯誤","del_err_account":"找不到帳號","del_err_rate":"請求次數過多，請稍後再試","del_err_cooldown":"請稍候再申請下一封確認信","del_err_send":"寄信失敗，請稍後再試","del_err_unauth":"登入狀態已失效，請重新登入","del_err_generic":"送出失敗（${status}），請稍後再試","del_err_banned":"您的帳號已被停用，無法執行此操作","del_err_session_revoked":"登入狀態已失效，請重新登入","del_err_stepup_revoked":"二次驗證未完成或已失效，請重新申請","del_err_stepup_mismatch":"驗證類型不符，請重新申請刪除帳號","del_err_stepup_used":"驗證碼已使用過，請重新取得 OTP","footer_tagline":"不是只做漂亮畫面，而是幫你把需求變成真正能用的系統。","footer_contact_title":"聯絡我們","nav_home":"首頁","nav_portfolio":"chiyigo作品","nav_tools":"Tools 工具","nav_fun":"Fun 娛樂","nav_about":"關於我們","nav_contact":"需求諮詢","nav_member_section":"會員功能","grp_account":"帳號","grp_security":"安全","grp_payments":"金流","grp_danger":"危險區","nav_overview":"帳號總覽","nav_2fa":"雙重驗證","nav_req":"我的需求單","nav_bind":"帳號綁定","nav_setpw":"設定密碼","nav_changepw":"修改密碼","nav_danger":"危險區","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","cta_btn_m":"開始諮詢 →","tfa_need_pw_local":"需先設定登入密碼","tfa_need_pw":"請先到上方「設定登入密碼」完成密碼設定，才能啟用 2FA。","changepw_title":"修改密碼","changepw_subtitle":"需要當下 2FA 驗證碼確認；修改後將登出所有裝置。","changepw_new_ph":"新密碼","changepw_confirm_ph":"再次輸入新密碼","changepw_otp_ph":"2FA 6 位數驗證碼","changepw_submit":"確認修改","changepw_need_2fa":"請先啟用 2FA 才能修改密碼。","changepw_mismatch":"兩次新密碼輸入不一致。","changepw_success":"✓ 密碼已修改。為了安全，所有裝置已登出，請重新登入…","nav_devices":"我的裝置","nav_passkeys":"Passkey","devices_title":"我的裝置","devices_subtitle":"這些裝置目前可以登入你的帳號。陌生的請立即登出。","devices_loading":"載入中…","devices_empty":"尚無裝置紀錄","device_label_web":"瀏覽器 Session","device_label_app":"App 裝置","device_active_label":"使用中","device_first_seen_label":"初次","device_last_seen_label":"最後活躍","device_logout_btn":"登出此裝置","device_logout_success":"✓ 已登出此裝置","device_logout_success_other":"✓ 已撤銷該裝置登入權限，最多 15 分鐘後完全失效","device_logout_already_revoked":"此裝置已無有效 session","passkeys_title":"Passkey / 安全金鑰","passkeys_subtitle":"綁定後可用裝置生物辨識（Face ID / 指紋 / Windows Hello）登入。","passkeys_loading":"載入中…","passkeys_empty":"尚未綁定任何 passkey","passkey_unsupported":"此瀏覽器不支援 Passkey（需要 HTTPS + 較新版本瀏覽器）。","passkey_add_btn":"＋ 新增","passkey_adding":"請依瀏覽器提示完成驗證…","passkey_add_success":"✓ 已綁定新 passkey","passkey_add_cancelled":"已取消","passkey_add_fail":"綁定失敗","passkey_default_nickname":"我的 passkey","passkey_last_used_label":"最後使用","passkey_never_used":"尚未使用","passkey_remove_btn":"移除","passkey_remove_hint":"需要 2FA 驗證碼確認移除","passkey_remove_otp_ph":"6 位 2FA 驗證碼","passkey_remove_confirm":"確認移除","passkey_remove_cancel":"取消","passkey_remove_success":"✓ 已移除","passkey_remove_fail":"移除失敗","passkey_remove_need_2fa":"請先啟用 2FA 才能移除 passkey","passkey_rename_btn":"改名","passkey_rename_ph":"為這支 passkey 取個名字","passkey_rename_save":"儲存","passkey_rename_cancel":"取消","passkey_rename_success":"✓ 已更新名稱","passkey_rename_fail":"改名失敗","passkey_rename_empty":"請輸入名稱","nav_wallets":"錢包","wallets_title":"錢包 / Web3","wallets_subtitle":"綁定 Ethereum 地址（非託管 — 我們不存私鑰）。未來金流 / NFT 場景使用。","wallets_loading":"載入中…","wallets_empty":"尚未綁定任何錢包","wallet_unsupported":"未偵測到瀏覽器錢包（請安裝 MetaMask / Rabby / Coinbase Wallet 等）。","wallet_add_btn":"＋ 連結錢包","wallet_connecting":"請在錢包中確認連線…","wallet_signing":"請在錢包中簽署訊息…","wallet_add_success":"✓ 已連結錢包","wallet_add_cancelled":"已取消","wallet_add_fail":"連結失敗","wallet_already_bound":"此地址已綁定過","wallet_chain_label":"鏈","wallet_signed_at_label":"綁定時間","wallet_remove_btn":"解綁","wallet_remove_hint":"需要 2FA 驗證碼確認解綁","wallet_remove_otp_ph":"6 位 2FA 驗證碼","wallet_remove_confirm":"確認解綁","wallet_remove_cancel":"取消","wallet_remove_success":"✓ 已解綁","wallet_remove_fail":"解綁失敗","wallet_remove_need_2fa":"請先啟用 2FA 才能解綁錢包","nav_payments":"付款","payments_title":"付款 / 充值","payments_subtitle":"綠界 ECPay：信用卡 / ATM / 超商代碼 / Apple/Google Pay。","payments_loading":"載入中…","payments_empty":"尚無付款紀錄","payment_add_btn":"＋ 充值","payment_amount_label":"金額（TWD，整數）","payment_amount_ph":"例如：500","payment_method_label":"付款方式","payment_method_all":"全部（綠界選擇）","payment_method_credit":"信用卡","payment_method_atm":"ATM 轉帳","payment_method_cvs":"超商代碼","payment_method_barcode":"超商條碼","payment_desc_label":"描述（顯示在綠界）","payment_desc_ph":"例如：chiyigo 服務充值","payment_requisition_label":"關聯接案編號（選填）","payment_requisition_ph":"例如：12（不填即為一般充值）","payment_cancel_btn":"取消","payment_submit_btn":"前往綠界結帳","payment_submitting":"建單中…","payment_redirecting":"導向綠界…","payment_kyc_hint":"需先完成身份驗證（KYC）；目前 sandbox 環境不會真扣款。","payment_amount_invalid":"金額必須是 1–200000 整數","payment_kyc_required":"需要先完成 KYC 身份驗證才能結帳","payment_create_fail":"建單失敗","payment_status_pending":"等待付款","payment_status_processing":"處理中","payment_status_succeeded":"已成功","payment_status_failed":"失敗","payment_status_canceled":"已取消","payment_status_refunded":"已退款","payment_kind_deposit":"充值","payment_kind_subscription":"訂閱","payment_kind_withdraw":"提款","payment_kind_refund":"退款","payment_for_requisition":"對應接案","payment_info_atm_bank":"銀行代號","payment_info_atm_account":"虛擬帳號","payment_info_cvs_no":"超商繳費代碼","payment_info_barcode":"超商條碼","payment_info_expire":"繳費期限","del_otp_ph":"2FA 6 位數驗證碼","del_otp_required":"刪除帳號需先啟用 2FA。請至上方「兩步驟驗證」啟用後再操作。"},"en":{"reverify_badge_needs":"Needs re-verification","reverify_badge_high":"Under review","reverify_btn":"Re-verify","reverify_success":"✓ Re-verified — this login method is active again","reverify_no_channel":"Self re-verification needs a password or 2FA. Please set one up or contact support.","elev_reverify_required":"Your linked account needs re-verification before you can add a new factor. Please re-verify it under Account Links first.","factor_add_no_channel":"Set a password or enable 2FA first to add a login method.","factor_add_modal_title":"Verify it's you to add a login method","factor_add_modal_hint":"To confirm it's really you, complete verification to add this login method.","factor_add_ph_totp":"2FA code or backup recovery code","factor_add_ph_pw":"Current password","factor_add_cancel":"Cancel","factor_add_confirm":"Confirm","bind_err_elevation_required":"Verification expired — please link again.","bind_err_elevation_consumed":"Verification timed out or was already used — please link again.","elev_reauth_modal_title":"Verify it's you to add a login method","elev_reauth_modal_hint":"To confirm it's you, sign in again with a linked account, then you can add a login method.","elev_reauth_provider_btn":"Re-verify with ${p}","elev_reauth_redirecting":"Redirecting to verify…","elev_reauth_cancel":"Cancel","elev_reauth_no_candidate":"No linked account is available for re-verification. Please resolve any items needing re-verification, or contact support.","elev_reauth_storage_blocked":"Your browser blocked temporary storage, so we can't continue. Use a normal window or disable private-mode restrictions and try again.","elev_resume_lost":"The verification flow was interrupted — please try again.","elev_exchange_failed":"Verification expired or was already used — please try again.","elev_err_provider_mismatch":"The re-verified account doesn't match the linked one — please use the correct account.","elev_err_rate_limited":"Too many attempts — please try again later.","elev_err_invalid_state":"The verification step has expired — please try again.","elev_err_generic":"Re-verification failed — please try again.","back_home":"Back to Home","logout_header":"Log Out","loading_text":"Loading…","lbl_email":"Email","lbl_verified":"Email Verification","lbl_providers":"Login Method","lbl_created":"Joined","tfa_title":"Two-Factor Authentication (2FA)","tfa_enable_btn":"Enable 2FA","tfa_disable_btn":"Disable 2FA","tfa_setup_hint":"Scan the QR Code with Google Authenticator or any TOTP app, then enter the 6-digit code to complete setup.","tfa_manual_key":"Or enter key manually:","tfa_otp_ph":"Enter 6-digit code","tfa_pw_ph":"Enter current login password","tfa_pw_required":"Please enter your current login password","tfa_confirm_enable":"Confirm Enable","tfa_confirm_disable":"Confirm Disable","tfa_disable_warn":"After disabling, you must set it up again to re-enable. Enter your authenticator code to confirm.","tfa_backup_warn_pre":"Please copy these 10 backup codes now. They ","tfa_backup_warn_em":"cannot be viewed again","tfa_backup_warn_post":". Each code can only be used once.","tfa_backup_done":"I have saved my codes","email_unverified":"Email Not Verified","email_unverified_sub":"Verify to unlock full account features","resend_btn":"Resend Verification","logout_btn":"Log Out","load_fail":"Failed to load","relogin_link":"← Back to Login","role_developer":"Developer","role_admin":"Admin","role_moderator":"Moderator","role_player":"Player","provider_local":"Password","status_active":"Active","verified_yes":"Verified","verified_no":"Not Verified","tfa_badge_on":"Enabled","tfa_badge_off":"Disabled","tfa_text_on":"Account is protected by 2FA","tfa_text_off":"We recommend enabling 2FA for better security","err_profile":"Unable to load account info. Please refresh or log in again.","btn_loading":"Please wait…","btn_sending":"Sending…","resend_sent":"Verification email sent. Check your inbox (valid for 1 hour).","resend_wait":"Please wait before trying again.","resend_fail":"Send failed, please try again later.","net_err":"Network error, please try again later.","totp_err6":"Please enter a 6-digit code","setup_fail":"Setup failed","enable_fail":"Enable failed","disable_fail":"Disable failed","disable_success":"✓ 2FA disabled. For safety, all devices have been logged out — please log in again…","resend_timer_label":"Resend (${s}s)","req_title":"My Requisitions","req_subtitle":"Recent project inquiries","req_new_btn":"New Requisition →","req_empty":"No requisitions yet","req_revoke_note":"To make changes, please revoke this requisition and submit a new one.","btn_revoke_confirm":"Confirm revoke?","status_pending":"Pending","status_processing":"Processing","status_completed":"Completed","status_revoked":"Revoked","status_refund_pending":"Refund Pending","btn_revoke":"Revoke","btn_processing":"Processing…","msg_revoke_success":"Requisition #${id} revoked","msg_revoke_fail":"Revoke failed, please try again","bind_title":"Account Linking","bind_subtitle":"Link third-party accounts for more login options","bind_btn":"Link","unbind_btn":"Unlink","bind_success":"${p} linked successfully","unbind_success":"${p} unlinked","bind_fail":"Linking failed, please try again","unbind_fail":"Unlinking failed, please try again","unbind_last_method":"Please set a local password or link another account before removing this one","bind_err_already":"Already linked","bind_err_taken":"This identity is already used by another account","bind_err_state":"Linking session expired, please try again","bind_err_account":"Account error, please log in again","setpw_title":"Set Login Password","setpw_subtitle":"You are currently signed in via a third-party account. Setting a password gives you a fallback login method and unlocks sensitive actions such as account deletion.","setpw_btn":"Send password setup email","setpw_sent":"✓ Setup email sent to <strong>${email}</strong>. Click the link to set your password (valid for 1 hour). Refresh this page after.","setpw_fail":"Failed to send, please try again later","danger_title":"Danger Zone","danger_subtitle":"Permanently delete your account and all related data — this cannot be undone.","del_open_btn":"Delete my account","del_need_pw_local":"Set a login password first","del_need_pw":"Please use “Set Login Password” above first before you can delete your account.","del_stage2_hint":"For safety, enter your login password to confirm. We will send a confirmation email; only after you click the link in that email will your account actually be deleted (link valid for 15 minutes).","del_pw_ph":"Login password","del_cancel_btn":"Cancel","del_send_btn":"Send confirmation email","del_pw_required":"Please enter your password","del_sent":"✓ Confirmation email sent. Click the link in your inbox to complete deletion (valid for 15 minutes).","del_err_pw":"Incorrect password","del_err_account":"Account not found","del_err_rate":"Too many requests. Please try again later.","del_err_cooldown":"Please wait before requesting another confirmation email","del_err_send":"Failed to send email, please try again later","del_err_unauth":"Session expired, please log in again","del_err_generic":"Submission failed (${status}), please try again later","del_err_banned":"Your account has been suspended; this operation is not allowed","del_err_session_revoked":"Session expired, please log in again","del_err_stepup_revoked":"Step-up verification is incomplete or expired; please retry","del_err_stepup_mismatch":"Verification type mismatch; please request account deletion again","del_err_stepup_used":"This verification code has been used; please request a new OTP","footer_tagline":"We don't just build pretty interfaces — we turn your requirements into systems that actually work.","footer_contact_title":"Contact Us","nav_home":"Home","nav_portfolio":"chiyigo Portfolio","nav_tools":"Tools","nav_fun":"Fun","nav_about":"About","nav_contact":"Inquiry","nav_member_section":"Member","grp_account":"Account","grp_security":"Security","grp_payments":"Billing","grp_danger":"Danger Zone","nav_overview":"Overview","nav_2fa":"Two-Factor Auth","nav_req":"My Requisitions","nav_bind":"Account Linking","nav_setpw":"Set Password","nav_changepw":"Change Password","nav_danger":"Danger Zone","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get in Touch","cta_btn_m":"Get in Touch →","tfa_need_pw_local":"Set a login password first","tfa_need_pw":"Please use \"Set Login Password\" above first before you can enable 2FA.","changepw_title":"Change Password","changepw_subtitle":"Requires a current 2FA code; you'll be logged out from all devices after the change.","changepw_new_ph":"New password","changepw_confirm_ph":"Confirm new password","changepw_otp_ph":"6-digit 2FA code","changepw_submit":"Change Password","changepw_need_2fa":"Enable 2FA first to change your password.","changepw_mismatch":"New password entries don't match.","changepw_success":"✓ Password changed. For safety, all devices have been logged out — please log in again…","nav_devices":"My Devices","nav_passkeys":"Passkeys","devices_title":"My Devices","devices_subtitle":"These devices can currently sign in to your account. Log out any you don’t recognize.","devices_loading":"Loading…","devices_empty":"No device records yet","device_label_web":"Browser Session","device_label_app":"App Device","device_active_label":"active","device_first_seen_label":"First seen","device_last_seen_label":"Last active","device_logout_btn":"Log out this device","device_logout_success":"✓ Logged out from this device","device_logout_success_other":"✓ Revoked session for that device; full logout takes up to 15 min","device_logout_already_revoked":"This device has no active session","passkeys_title":"Passkeys / Security Keys","passkeys_subtitle":"Once added, you can sign in with biometrics (Face ID / fingerprint / Windows Hello).","passkeys_loading":"Loading…","passkeys_empty":"No passkeys yet","passkey_unsupported":"This browser does not support Passkeys (requires HTTPS + a recent browser).","passkey_add_btn":"+ Add","passkey_adding":"Follow the browser prompt to complete…","passkey_add_success":"✓ Passkey added","passkey_add_cancelled":"Cancelled","passkey_add_fail":"Failed to add passkey","passkey_default_nickname":"My passkey","passkey_last_used_label":"Last used","passkey_never_used":"Not used yet","passkey_remove_btn":"Remove","passkey_remove_hint":"2FA code required to remove","passkey_remove_otp_ph":"6-digit 2FA code","passkey_remove_confirm":"Confirm","passkey_remove_cancel":"Cancel","passkey_remove_success":"✓ Removed","passkey_remove_fail":"Removal failed","passkey_remove_need_2fa":"Enable 2FA first to remove a passkey","passkey_rename_btn":"Rename","passkey_rename_ph":"Give this passkey a name","passkey_rename_save":"Save","passkey_rename_cancel":"Cancel","passkey_rename_success":"✓ Name updated","passkey_rename_fail":"Rename failed","passkey_rename_empty":"Please enter a name","nav_wallets":"Wallets","wallets_title":"Wallets / Web3","wallets_subtitle":"Bind your Ethereum address (non-custodial — we don't store private keys). Used for future payment / NFT features.","wallets_loading":"Loading…","wallets_empty":"No wallets bound yet","wallet_unsupported":"No browser wallet detected (install MetaMask / Rabby / Coinbase Wallet, etc).","wallet_add_btn":"+ Connect Wallet","wallet_connecting":"Confirm the connection in your wallet…","wallet_signing":"Sign the message in your wallet…","wallet_add_success":"✓ Wallet connected","wallet_add_cancelled":"Cancelled","wallet_add_fail":"Failed to connect wallet","wallet_already_bound":"This address is already bound","wallet_chain_label":"Chain","wallet_signed_at_label":"Bound at","wallet_remove_btn":"Unbind","wallet_remove_hint":"2FA code required to unbind","wallet_remove_otp_ph":"6-digit 2FA code","wallet_remove_confirm":"Confirm","wallet_remove_cancel":"Cancel","wallet_remove_success":"✓ Unbound","wallet_remove_fail":"Unbind failed","wallet_remove_need_2fa":"Enable 2FA first to unbind a wallet","nav_payments":"Payments","payments_title":"Payments / Top-up","payments_subtitle":"ECPay (Taiwan): Credit card / ATM / Convenience store / Apple/Google Pay.","payments_loading":"Loading…","payments_empty":"No payment records yet","payment_add_btn":"+ Top up","payment_amount_label":"Amount (TWD, integer)","payment_amount_ph":"e.g. 500","payment_method_label":"Payment method","payment_method_all":"All (choose on ECPay)","payment_method_credit":"Credit card","payment_method_atm":"ATM transfer","payment_method_cvs":"CVS code","payment_method_barcode":"CVS barcode","payment_desc_label":"Description (shown on ECPay)","payment_desc_ph":"e.g. chiyigo service top-up","payment_requisition_label":"Linked requisition # (optional)","payment_requisition_ph":"e.g. 12 (leave blank for general top-up)","payment_cancel_btn":"Cancel","payment_submit_btn":"Continue to ECPay","payment_submitting":"Creating order…","payment_redirecting":"Redirecting to ECPay…","payment_kyc_hint":"KYC verification required first. Sandbox: no real charges.","payment_amount_invalid":"Amount must be an integer between 1 and 200000","payment_kyc_required":"KYC verification required before checkout","payment_create_fail":"Failed to create order","payment_status_pending":"Pending","payment_status_processing":"Processing","payment_status_succeeded":"Succeeded","payment_status_failed":"Failed","payment_status_canceled":"Canceled","payment_status_refunded":"Refunded","payment_kind_deposit":"Deposit","payment_kind_subscription":"Subscription","payment_kind_withdraw":"Withdraw","payment_kind_refund":"Refund","payment_for_requisition":"For requisition","payment_info_atm_bank":"Bank code","payment_info_atm_account":"Virtual account","payment_info_cvs_no":"CVS payment code","payment_info_barcode":"CVS barcode","payment_info_expire":"Expires","del_otp_ph":"2FA 6-digit code","del_otp_required":"Account deletion requires 2FA. Enable it in the Two-Factor Authentication section first."},"ja":{"reverify_badge_needs":"再認証が必要","reverify_badge_high":"審査中","reverify_btn":"再認証","reverify_success":"✓ 再認証が完了し、このログイン方法が再び利用可能になりました","reverify_no_channel":"セルフ再認証にはパスワードまたは2FAが必要です。設定するかサポートにお問い合わせください","elev_reverify_required":"新しい認証要素を追加する前に、連携アカウントの再認証が必要です。先に「アカウント連携」で再認証してください","factor_add_no_channel":"ログイン方法を追加するには、先にパスワードを設定するか2FAを有効にしてください","factor_add_modal_title":"本人確認をしてログイン方法を追加","factor_add_modal_hint":"ご本人の操作であることを確認するため、認証を完了するとこのログイン方法を追加できます。","factor_add_ph_totp":"2FAコードまたはバックアップコード","factor_add_ph_pw":"現在のログインパスワード","factor_add_cancel":"キャンセル","factor_add_confirm":"確認","bind_err_elevation_required":"認証の有効期限が切れました。もう一度連携してください","bind_err_elevation_consumed":"認証がタイムアウトしたか、既に使用されました。もう一度連携してください","elev_reauth_modal_title":"本人確認をしてログイン方法を追加","elev_reauth_modal_hint":"ご本人確認のため、連携済みのアカウントで再度ログインすると、ログイン方法を追加できます。","elev_reauth_provider_btn":"${p} で再認証","elev_reauth_redirecting":"認証ページへ移動しています…","elev_reauth_cancel":"キャンセル","elev_reauth_no_candidate":"再認証に使用できる連携アカウントがありません。再認証が必要な項目を先に解決するか、サポートにお問い合わせください。","elev_reauth_storage_blocked":"ブラウザが一時データをブロックしたため続行できません。通常のウィンドウを使うか、プライベートモードの制限を解除して再度お試しください。","elev_resume_lost":"認証フローが中断されました。もう一度お試しください。","elev_exchange_failed":"認証の有効期限が切れたか、既に使用されました。もう一度お試しください。","elev_err_provider_mismatch":"再認証したアカウントが連携済みのものと一致しません。正しいアカウントをご使用ください。","elev_err_rate_limited":"試行回数が多すぎます。しばらくしてからお試しください。","elev_err_invalid_state":"認証ステップの有効期限が切れました。もう一度お試しください。","elev_err_generic":"再認証に失敗しました。もう一度お試しください。","back_home":"ホームに戻る","logout_header":"ログアウト","loading_text":"読み込み中…","lbl_email":"メールアドレス","lbl_verified":"Email 認証","lbl_providers":"ログイン方法","lbl_created":"登録日","tfa_title":"二段階認証（2FA）","tfa_enable_btn":"2FAを有効化","tfa_disable_btn":"2FAを無効化","tfa_setup_hint":"Google Authenticatorまたは任意のTOTPアプリでQRコードをスキャンし、6桁のコードを入力して完了してください。","tfa_manual_key":"または手動でキーを入力：","tfa_otp_ph":"6桁のコードを入力","tfa_pw_ph":"現在のログインパスワードを入力","tfa_pw_required":"現在のログインパスワードを入力してください","tfa_confirm_enable":"有効化を確認","tfa_confirm_disable":"無効化を確認","tfa_disable_warn":"無効化後は再設定が必要です。確認のためにAuthenticatorコードを入力してください。","tfa_backup_warn_pre":"今すぐこの10組のバックアップコードをメモしてください。","tfa_backup_warn_em":"再表示はできません","tfa_backup_warn_post":"。各コードは1回のみ使用可能です。","tfa_backup_done":"保存しました","email_unverified":"メール未認証","email_unverified_sub":"認証するとすべての機能が使えます","resend_btn":"認証メール再送","logout_btn":"ログアウト","load_fail":"読み込み失敗","relogin_link":"← ログインに戻る","role_developer":"開発者","role_admin":"管理者","role_moderator":"モデレーター","role_player":"プレイヤー","provider_local":"パスワードログイン","status_active":"正常","verified_yes":"認証済み","verified_no":"未認証","tfa_badge_on":"有効","tfa_badge_off":"無効","tfa_text_on":"2FAでアカウントが保護されています","tfa_text_off":"セキュリティ向上のため2FAの有効化を推奨します","err_profile":"アカウント情報を読み込めませんでした。リロードまたは再ログインしてください。","btn_loading":"お待ちください…","btn_sending":"送信中…","resend_sent":"認証メールを送信しました。受信トレイをご確認ください（有効期限1時間）。","resend_wait":"しばらく後でお試しください。","resend_fail":"送信に失敗しました。後でお試しください。","net_err":"ネットワークエラーが発生しました。後でお試しください。","totp_err6":"6桁のコードを入力してください","setup_fail":"設定に失敗しました","enable_fail":"有効化に失敗しました","disable_fail":"無効化に失敗しました","disable_success":"✓ 2FAを無効化しました。安全のため全デバイスがログアウトされました。再度ログインしてください…","resend_timer_label":"再送（${s}s）","req_title":"依頼一覧","req_subtitle":"最近のプロジェクト相談","req_new_btn":"新規依頼 →","req_empty":"依頼の記録はまだありません","req_revoke_note":"内容を変更したい場合は、依頼を取り消して再度ご記入ください。","btn_revoke_confirm":"取り消しますか？","status_pending":"保留中","status_processing":"処理中","status_completed":"完了","status_revoked":"取り消し済み","status_refund_pending":"返金審査中","btn_revoke":"取り消し","btn_processing":"処理中…","msg_revoke_success":"依頼 #${id} を取り消しました","msg_revoke_fail":"取り消しに失敗しました。再試行してください","bind_title":"アカウント連携","bind_subtitle":"外部アカウントを連携してログイン方法を増やす","bind_btn":"連携","unbind_btn":"連携解除","bind_success":"${p}の連携が完了しました","unbind_success":"${p}の連携を解除しました","bind_fail":"連携に失敗しました。再試行してください","unbind_fail":"連携解除に失敗しました。再試行してください","unbind_last_method":"ローカルパスワードを設定するか他のアカウントを連携してから解除してください","bind_err_already":"すでに連携済みです","bind_err_taken":"このアカウントは別のユーザーが使用しています","bind_err_state":"連携セッションが期限切れです。再試行してください","bind_err_account":"アカウント状態に問題があります。再ログインしてください","setpw_title":"ログインパスワードの設定","setpw_subtitle":"現在は外部アカウントでログイン中です。パスワードを設定すると、バックアップのログイン方法が得られ、アカウント削除などの操作が可能になります。","setpw_btn":"パスワード設定メールを送信","setpw_sent":"✓ 設定メールを <strong>${email}</strong> に送信しました。リンクをクリックして設定を完了してください（1時間有効）。完了後、このページを再読み込みしてください。","setpw_fail":"送信に失敗しました。後でお試しください","danger_title":"危険な操作","danger_subtitle":"アカウントとすべての関連データを完全に削除します（取り消し不可）","del_open_btn":"アカウントを削除する","del_need_pw_local":"先にログインパスワードを設定してください","del_need_pw":"削除するには、上の「ログインパスワードの設定」を先に完了してください。","del_stage2_hint":"誤削除防止のため、ログインパスワードを入力してください。送信後に確認メールが届きます。メール内のリンクをクリックすると実際に削除されます（リンクは15分間有効）。","del_pw_ph":"ログインパスワード","del_cancel_btn":"キャンセル","del_send_btn":"削除確認メールを送信","del_pw_required":"パスワードを入力してください","del_sent":"✓ 確認メールを送信しました。受信トレイのリンクをクリックして削除を完了してください（15分間有効）。","del_err_pw":"パスワードが正しくありません","del_err_account":"アカウントが見つかりません","del_err_rate":"リクエストが多すぎます。後でお試しください。","del_err_cooldown":"次の確認メールを送るまで少しお待ちください","del_err_send":"メール送信に失敗しました。後でお試しください","del_err_unauth":"セッションが切れました。再ログインしてください","del_err_generic":"送信に失敗しました（${status}）。後でお試しください","del_err_banned":"アカウントが停止されています。この操作はできません","del_err_session_revoked":"セッションが切れました。再ログインしてください","del_err_stepup_revoked":"二段階認証が未完了または期限切れです。再度お試しください","del_err_stepup_mismatch":"認証種別が一致しません。アカウント削除を再度リクエストしてください","del_err_stepup_used":"認証コードは使用済みです。再度OTPを取得してください","footer_tagline":"見た目だけのサイトではなく、本当に使えるシステムを形にします。","footer_contact_title":"お問い合わせ","nav_home":"ホーム","nav_portfolio":"chiyigoの実績","nav_tools":"ツール","nav_fun":"エンタメ","nav_about":"私たちについて","nav_contact":"お問い合わせ","nav_member_section":"マイページ","grp_account":"アカウント","grp_security":"セキュリティ","grp_payments":"支払い","grp_danger":"危険な操作","nav_overview":"アカウント概要","nav_2fa":"二段階認証","nav_req":"依頼一覧","nav_bind":"アカウント連携","nav_setpw":"パスワード設定","nav_changepw":"パスワード変更","nav_danger":"危険な操作","cta_desc":"最適なデジタルソリューションを一緒に作りましょう！","cta_btn":"相談する","cta_btn_m":"相談する →","tfa_need_pw_local":"先にログインパスワードを設定してください","tfa_need_pw":"2FAを有効化するには、上の「ログインパスワードの設定」を先に完了してください。","changepw_title":"パスワード変更","changepw_subtitle":"現在の2FAコードが必要です。変更後はすべてのデバイスからログアウトされます。","changepw_new_ph":"新しいパスワード","changepw_confirm_ph":"新しいパスワード（確認）","changepw_otp_ph":"2FA 6桁コード","changepw_submit":"変更を確定","changepw_need_2fa":"パスワードを変更するには先に2FAを有効化してください。","changepw_mismatch":"新しいパスワードが一致しません。","changepw_success":"✓ パスワードを変更しました。安全のため全デバイスがログアウトされました。再度ログインしてください…","nav_devices":"マイデバイス","nav_passkeys":"パスキー","devices_title":"マイデバイス","devices_subtitle":"これらのデバイスは現在ログイン可能です。心当たりのないものはすぐログアウトしてください。","devices_loading":"読み込み中…","devices_empty":"デバイス記録はまだありません","device_label_web":"ブラウザセッション","device_label_app":"アプリ端末","device_active_label":"有効","device_first_seen_label":"初回","device_last_seen_label":"最終アクティブ","device_logout_btn":"このデバイスをログアウト","device_logout_success":"✓ このデバイスからログアウトしました","device_logout_success_other":"✓ 該当デバイスのセッションを取り消しました。完全なログアウトまで最大 15 分かかります","device_logout_already_revoked":"このデバイスには有効なセッションがありません","passkeys_title":"パスキー / セキュリティキー","passkeys_subtitle":"登録後はFace ID / 指紋 / Windows Helloなどでログインできます。","passkeys_loading":"読み込み中…","passkeys_empty":"パスキーはまだ登録されていません","passkey_unsupported":"このブラウザはパスキーに対応していません（HTTPS + 最新版ブラウザが必要）。","passkey_add_btn":"＋ 追加","passkey_adding":"ブラウザの指示に従って認証してください…","passkey_add_success":"✓ パスキーを追加しました","passkey_add_cancelled":"キャンセルしました","passkey_add_fail":"追加に失敗しました","passkey_default_nickname":"私のパスキー","passkey_last_used_label":"最終使用","passkey_never_used":"未使用","passkey_remove_btn":"削除","passkey_remove_hint":"削除には2FAコードが必要です","passkey_remove_otp_ph":"2FA 6桁コード","passkey_remove_confirm":"確認","passkey_remove_cancel":"キャンセル","passkey_remove_success":"✓ 削除しました","passkey_remove_fail":"削除に失敗しました","passkey_remove_need_2fa":"パスキーを削除するには先に2FAを有効化してください","passkey_rename_btn":"名前変更","passkey_rename_ph":"このパスキーに名前を付ける","passkey_rename_save":"保存","passkey_rename_cancel":"キャンセル","passkey_rename_success":"✓ 名前を更新しました","passkey_rename_fail":"名前変更に失敗しました","passkey_rename_empty":"名前を入力してください","nav_wallets":"ウォレット","wallets_title":"ウォレット / Web3","wallets_subtitle":"Ethereumアドレスを連携（ノンカストディアル — 秘密鍵は保管しません）。今後の決済 / NFT 機能で使用。","wallets_loading":"読み込み中…","wallets_empty":"ウォレットはまだ連携されていません","wallet_unsupported":"ブラウザウォレットが検出されません（MetaMask / Rabby / Coinbase Wallet などをインストールしてください）。","wallet_add_btn":"＋ ウォレットを連携","wallet_connecting":"ウォレットで接続を承認してください…","wallet_signing":"ウォレットでメッセージに署名してください…","wallet_add_success":"✓ ウォレットを連携しました","wallet_add_cancelled":"キャンセルしました","wallet_add_fail":"連携に失敗しました","wallet_already_bound":"このアドレスは既に連携済みです","wallet_chain_label":"チェーン","wallet_signed_at_label":"連携日時","wallet_remove_btn":"解除","wallet_remove_hint":"解除には2FAコードが必要です","wallet_remove_otp_ph":"2FA 6桁コード","wallet_remove_confirm":"確認","wallet_remove_cancel":"キャンセル","wallet_remove_success":"✓ 解除しました","wallet_remove_fail":"解除に失敗しました","wallet_remove_need_2fa":"ウォレットを解除するには先に2FAを有効化してください","nav_payments":"支払い","payments_title":"支払い / チャージ","payments_subtitle":"ECPay（台湾）：クレジットカード / ATM / コンビニ / Apple/Google Pay。","payments_loading":"読み込み中…","payments_empty":"支払い履歴はまだありません","payment_add_btn":"＋ チャージ","payment_amount_label":"金額（TWD、整数）","payment_amount_ph":"例：500","payment_method_label":"支払方法","payment_method_all":"すべて（ECPay で選択）","payment_method_credit":"クレジットカード","payment_method_atm":"ATM 振込","payment_method_cvs":"コンビニコード","payment_method_barcode":"コンビニバーコード","payment_desc_label":"説明（ECPay に表示）","payment_desc_ph":"例：chiyigo サービスチャージ","payment_requisition_label":"案件番号（任意）","payment_requisition_ph":"例：12（空欄で一般チャージ）","payment_cancel_btn":"キャンセル","payment_submit_btn":"ECPay へ進む","payment_submitting":"注文作成中…","payment_redirecting":"ECPay へリダイレクト中…","payment_kyc_hint":"本人確認（KYC）が必要です。サンドボックスでは課金されません。","payment_amount_invalid":"金額は 1～200000 の整数で入力してください","payment_kyc_required":"決済前に KYC 認証が必要です","payment_create_fail":"注文作成に失敗しました","payment_status_pending":"支払い待ち","payment_status_processing":"処理中","payment_status_succeeded":"成功","payment_status_failed":"失敗","payment_status_canceled":"キャンセル","payment_status_refunded":"返金済み","payment_kind_deposit":"チャージ","payment_kind_subscription":"サブスク","payment_kind_withdraw":"出金","payment_kind_refund":"返金","payment_for_requisition":"対応案件","payment_info_atm_bank":"銀行コード","payment_info_atm_account":"仮想口座","payment_info_cvs_no":"コンビニ支払コード","payment_info_barcode":"コンビニバーコード","payment_info_expire":"支払期限","del_otp_ph":"2FA 6桁コード","del_otp_required":"アカウント削除には2FAが必要です。先に「二段階認証」を有効化してください。"},"ko":{"reverify_badge_needs":"재인증 필요","reverify_badge_high":"심사 중","reverify_btn":"재인증","reverify_success":"✓ 재인증되었습니다. 이 로그인 방법을 다시 사용할 수 있습니다","reverify_no_channel":"셀프 재인증에는 비밀번호 또는 2FA가 필요합니다. 먼저 설정하거나 고객센터에 문의해 주세요","elev_reverify_required":"새 인증 요소를 추가하려면 먼저 연결된 계정을 재인증해야 합니다. '계정 연결'에서 먼저 재인증해 주세요","factor_add_no_channel":"로그인 방법을 추가하려면 먼저 비밀번호를 설정하거나 2FA를 활성화해 주세요","factor_add_modal_title":"본인 확인 후 로그인 방법 추가","factor_add_modal_hint":"본인 조작임을 확인하기 위해 인증을 완료하면 이 로그인 방법을 추가할 수 있습니다.","factor_add_ph_totp":"2FA 코드 또는 백업 복구 코드","factor_add_ph_pw":"현재 로그인 비밀번호","factor_add_cancel":"취소","factor_add_confirm":"확인","bind_err_elevation_required":"인증이 만료되었습니다. 다시 연결해 주세요","bind_err_elevation_consumed":"인증이 시간 초과되었거나 이미 사용되었습니다. 다시 연결해 주세요","elev_reauth_modal_title":"본인 확인 후 로그인 방법 추가","elev_reauth_modal_hint":"본인 확인을 위해 연결된 계정으로 다시 로그인하면 로그인 방법을 추가할 수 있습니다.","elev_reauth_provider_btn":"${p}(으)로 재인증","elev_reauth_redirecting":"인증 페이지로 이동 중…","elev_reauth_cancel":"취소","elev_reauth_no_candidate":"재인증에 사용할 수 있는 연결된 계정이 없습니다. 재인증이 필요한 항목을 먼저 해결하거나 고객지원에 문의해 주세요.","elev_reauth_storage_blocked":"브라우저가 임시 데이터를 차단하여 계속할 수 없습니다. 일반 창을 사용하거나 비공개 모드 제한을 해제한 후 다시 시도해 주세요.","elev_resume_lost":"인증 과정이 중단되었습니다. 다시 시도해 주세요.","elev_exchange_failed":"인증이 만료되었거나 이미 사용되었습니다. 다시 시도해 주세요.","elev_err_provider_mismatch":"재인증한 계정이 연결된 계정과 일치하지 않습니다. 올바른 계정을 사용해 주세요.","elev_err_rate_limited":"시도 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.","elev_err_invalid_state":"인증 단계가 만료되었습니다. 다시 시도해 주세요.","elev_err_generic":"재인증에 실패했습니다. 다시 시도해 주세요.","back_home":"홈으로 돌아가기","logout_header":"로그아웃","loading_text":"로딩 중…","lbl_email":"이메일","lbl_verified":"이메일 인증","lbl_providers":"로그인 방법","lbl_created":"가입일","tfa_title":"이중 인증（2FA）","tfa_enable_btn":"2FA 활성화","tfa_disable_btn":"2FA 비활성화","tfa_setup_hint":"Google Authenticator 또는 TOTP 앱으로 QR 코드를 스캔한 후, 6자리 코드를 입력하여 설정을 완료하세요.","tfa_manual_key":"또는 키를 직접 입력:","tfa_otp_ph":"6자리 코드 입력","tfa_pw_ph":"현재 로그인 비밀번호 입력","tfa_pw_required":"현재 로그인 비밀번호를 입력하세요","tfa_confirm_enable":"활성화 확인","tfa_confirm_disable":"비활성화 확인","tfa_disable_warn":"비활성화 후 다시 설정해야 재활성화할 수 있습니다. 인증 코드를 입력하여 확인하세요.","tfa_backup_warn_pre":"지금 바로 이 10개의 백업 코드를 기록해 두세요. ","tfa_backup_warn_em":"다시 볼 수 없습니다","tfa_backup_warn_post":". 각 코드는 한 번만 사용 가능합니다.","tfa_backup_done":"저장 완료","email_unverified":"이메일 미인증","email_unverified_sub":"인증 후 모든 기능을 사용할 수 있습니다","resend_btn":"인증 메일 재발송","logout_btn":"로그아웃","load_fail":"로드 실패","relogin_link":"← 다시 로그인","role_developer":"개발자","role_admin":"관리자","role_moderator":"모더레이터","role_player":"플레이어","provider_local":"비밀번호 로그인","status_active":"정상","verified_yes":"인증됨","verified_no":"미인증","tfa_badge_on":"활성화됨","tfa_badge_off":"비활성화됨","tfa_text_on":"계정이 2FA로 보호되고 있습니다","tfa_text_off":"보안 강화를 위해 2FA 활성화를 권장합니다","err_profile":"계정 정보를 불러올 수 없습니다. 새로고침하거나 다시 로그인해 주세요.","btn_loading":"잠시만요…","btn_sending":"전송 중…","resend_sent":"인증 메일이 전송되었습니다. 받은 편지함을 확인하세요（1시간 유효）。","resend_wait":"잠시 후 다시 시도해 주세요.","resend_fail":"전송 실패. 나중에 다시 시도해 주세요.","net_err":"네트워크 오류. 나중에 다시 시도해 주세요.","totp_err6":"6자리 코드를 입력해 주세요","setup_fail":"설정 실패","enable_fail":"활성화 실패","disable_fail":"비활성화 실패","disable_success":"✓ 2FA가 비활성화되었습니다. 보안을 위해 모든 기기에서 로그아웃되었습니다. 다시 로그인해 주세요…","resend_timer_label":"재발송（${s}s）","req_title":"내 요청서","req_subtitle":"최근 프로젝트 문의","req_new_btn":"새 요청서 →","req_empty":"요청서 기록이 없습니다","req_revoke_note":"내용을 수정하려면 요청을 취소하고 다시 작성해 주세요.","btn_revoke_confirm":"취소하시겠습니까?","status_pending":"대기 중","status_processing":"처리 중","status_completed":"완료","status_revoked":"취소됨","status_refund_pending":"환불 검토 중","btn_revoke":"취소","btn_processing":"처리 중…","msg_revoke_success":"요청서 #${id} 취소됨","msg_revoke_fail":"취소 실패. 다시 시도해 주세요","bind_title":"계정 연동","bind_subtitle":"서드파티 계정을 연동하여 로그인 옵션을 추가하세요","bind_btn":"연동","unbind_btn":"연동 해제","bind_success":"${p} 연동 완료","unbind_success":"${p} 연동이 해제되었습니다","bind_fail":"연동 실패. 다시 시도해 주세요","unbind_fail":"연동 해제 실패. 다시 시도해 주세요","unbind_last_method":"로컬 비밀번호를 설정하거나 다른 계정을 연동한 후 해제하세요","bind_err_already":"이미 연동되어 있습니다","bind_err_taken":"이 계정은 이미 다른 사용자가 사용 중입니다","bind_err_state":"연동 세션이 만료되었습니다. 다시 시도해 주세요","bind_err_account":"계정 오류. 다시 로그인하세요","setpw_title":"로그인 비밀번호 설정","setpw_subtitle":"현재 서드파티 계정으로 로그인 중입니다. 비밀번호를 설정하면 대체 로그인 수단이 생기고, 계정 삭제 등 민감한 작업을 수행할 수 있습니다.","setpw_btn":"비밀번호 설정 메일 발송","setpw_sent":"✓ 설정 메일을 <strong>${email}</strong>(으)로 발송했습니다. 링크를 클릭해 설정을 완료하세요（1시간 유효）. 완료 후 페이지를 새로고침하세요.","setpw_fail":"발송 실패. 나중에 다시 시도해 주세요","danger_title":"위험 영역","danger_subtitle":"계정과 모든 관련 데이터를 영구 삭제합니다（되돌릴 수 없음）","del_open_btn":"계정 삭제","del_need_pw_local":"먼저 로그인 비밀번호를 설정하세요","del_need_pw":"삭제하려면 위의 \"로그인 비밀번호 설정\"을 먼저 완료하세요.","del_stage2_hint":"오삭제 방지를 위해 로그인 비밀번호를 입력하세요. 제출 후 확인 메일이 발송됩니다. 메일의 링크를 클릭해야 실제로 삭제됩니다（링크 15분 유효）.","del_pw_ph":"로그인 비밀번호","del_cancel_btn":"취소","del_send_btn":"삭제 확인 메일 발송","del_pw_required":"비밀번호를 입력해 주세요","del_sent":"✓ 확인 메일이 발송되었습니다. 받은 편지함에서 링크를 클릭해 삭제를 완료하세요（15분 유효）.","del_err_pw":"비밀번호가 올바르지 않습니다","del_err_account":"계정을 찾을 수 없습니다","del_err_rate":"요청이 너무 많습니다. 나중에 다시 시도해 주세요.","del_err_cooldown":"다음 확인 메일 요청까지 잠시 기다려 주세요","del_err_send":"메일 발송 실패. 나중에 다시 시도해 주세요","del_err_unauth":"세션이 만료되었습니다. 다시 로그인해 주세요","del_err_generic":"전송 실패（${status}）. 나중에 다시 시도해 주세요","del_err_banned":"계정이 정지되었습니다. 이 작업을 수행할 수 없습니다","del_err_session_revoked":"세션이 만료되었습니다. 다시 로그인해 주세요","del_err_stepup_revoked":"2단계 인증이 완료되지 않았거나 만료되었습니다. 다시 시도해 주세요","del_err_stepup_mismatch":"인증 유형이 일치하지 않습니다. 계정 삭제를 다시 요청해 주세요","del_err_stepup_used":"인증 코드가 이미 사용되었습니다. OTP를 다시 받아 주세요","footer_tagline":"예쁜 화면만 만드는 게 아니라, 실제로 동작하는 시스템을 구현합니다.","footer_contact_title":"문의하기","nav_home":"홈","nav_portfolio":"chiyigo 포트폴리오","nav_tools":"도구","nav_fun":"재미","nav_about":"소개","nav_contact":"문의하기","nav_member_section":"마이페이지","grp_account":"계정","grp_security":"보안","grp_payments":"결제","grp_danger":"위험 영역","nav_overview":"계정 개요","nav_2fa":"이중 인증","nav_req":"내 요청서","nav_bind":"계정 연동","nav_setpw":"비밀번호 설정","nav_changepw":"비밀번호 변경","nav_danger":"위험 영역","cta_desc":"최적의 디지털 솔루션을 함께 만들어보세요!","cta_btn":"상담 시작","cta_btn_m":"상담 시작 →","tfa_need_pw_local":"먼저 로그인 비밀번호를 설정하세요","tfa_need_pw":"2FA를 활성화하려면 위의 \"로그인 비밀번호 설정\"을 먼저 완료하세요.","changepw_title":"비밀번호 변경","changepw_subtitle":"현재 2FA 코드가 필요합니다. 변경 후 모든 기기에서 로그아웃됩니다.","changepw_new_ph":"새 비밀번호","changepw_confirm_ph":"새 비밀번호 확인","changepw_otp_ph":"2FA 6자리 코드","changepw_submit":"변경 확정","changepw_need_2fa":"비밀번호를 변경하려면 먼저 2FA를 활성화하세요.","changepw_mismatch":"새 비밀번호가 일치하지 않습니다.","changepw_success":"✓ 비밀번호가 변경되었습니다. 보안을 위해 모든 기기에서 로그아웃되었습니다. 다시 로그인해 주세요…","nav_devices":"내 기기","nav_passkeys":"Passkey","devices_title":"내 기기","devices_subtitle":"이 기기들은 현재 계정에 로그인할 수 있습니다. 모르는 기기는 즉시 로그아웃하세요.","devices_loading":"로딩 중…","devices_empty":"기기 기록이 없습니다","device_label_web":"브라우저 세션","device_label_app":"앱 기기","device_active_label":"활성","device_first_seen_label":"최초","device_last_seen_label":"마지막 활동","device_logout_btn":"이 기기 로그아웃","device_logout_success":"✓ 이 기기에서 로그아웃되었습니다","device_logout_success_other":"✓ 해당 기기의 세션을 취소했습니다. 완전 로그아웃까지 최대 15분 소요","device_logout_already_revoked":"이 기기에는 활성 세션이 없습니다","passkeys_title":"Passkey / 보안 키","passkeys_subtitle":"등록하면 Face ID / 지문 / Windows Hello로 로그인할 수 있습니다.","passkeys_loading":"로딩 중…","passkeys_empty":"등록된 passkey가 없습니다","passkey_unsupported":"이 브라우저는 Passkey를 지원하지 않습니다 (HTTPS + 최신 브라우저 필요).","passkey_add_btn":"＋ 추가","passkey_adding":"브라우저 안내에 따라 인증을 완료하세요…","passkey_add_success":"✓ Passkey가 추가되었습니다","passkey_add_cancelled":"취소되었습니다","passkey_add_fail":"추가 실패","passkey_default_nickname":"내 passkey","passkey_last_used_label":"마지막 사용","passkey_never_used":"아직 사용 안 함","passkey_remove_btn":"제거","passkey_remove_hint":"제거하려면 2FA 코드가 필요합니다","passkey_remove_otp_ph":"2FA 6자리 코드","passkey_remove_confirm":"확인","passkey_remove_cancel":"취소","passkey_remove_success":"✓ 제거됨","passkey_remove_fail":"제거 실패","passkey_remove_need_2fa":"Passkey를 제거하려면 먼저 2FA를 활성화하세요","passkey_rename_btn":"이름 변경","passkey_rename_ph":"이 passkey의 이름을 입력하세요","passkey_rename_save":"저장","passkey_rename_cancel":"취소","passkey_rename_success":"✓ 이름이 변경되었습니다","passkey_rename_fail":"이름 변경 실패","passkey_rename_empty":"이름을 입력해주세요","nav_wallets":"지갑","wallets_title":"지갑 / Web3","wallets_subtitle":"Ethereum 주소 연결 (비수탁 — 개인키는 저장하지 않습니다). 향후 결제 / NFT 기능에 사용.","wallets_loading":"로딩 중…","wallets_empty":"연결된 지갑이 없습니다","wallet_unsupported":"브라우저 지갑이 감지되지 않습니다 (MetaMask / Rabby / Coinbase Wallet 등을 설치하세요).","wallet_add_btn":"＋ 지갑 연결","wallet_connecting":"지갑에서 연결을 승인하세요…","wallet_signing":"지갑에서 메시지에 서명하세요…","wallet_add_success":"✓ 지갑이 연결되었습니다","wallet_add_cancelled":"취소되었습니다","wallet_add_fail":"연결 실패","wallet_already_bound":"이 주소는 이미 연결되어 있습니다","wallet_chain_label":"체인","wallet_signed_at_label":"연결 시각","wallet_remove_btn":"연결 해제","wallet_remove_hint":"해제하려면 2FA 코드가 필요합니다","wallet_remove_otp_ph":"2FA 6자리 코드","wallet_remove_confirm":"확인","wallet_remove_cancel":"취소","wallet_remove_success":"✓ 해제됨","wallet_remove_fail":"해제 실패","wallet_remove_need_2fa":"지갑을 해제하려면 먼저 2FA를 활성화하세요","nav_payments":"결제","payments_title":"결제 / 충전","payments_subtitle":"ECPay（대만）: 신용카드 / ATM / 편의점 / Apple/Google Pay.","payments_loading":"로드 중…","payments_empty":"결제 내역이 없습니다","payment_add_btn":"＋ 충전","payment_amount_label":"금액（TWD, 정수）","payment_amount_ph":"예: 500","payment_method_label":"결제 수단","payment_method_all":"전체（ECPay에서 선택）","payment_method_credit":"신용카드","payment_method_atm":"ATM 이체","payment_method_cvs":"편의점 코드","payment_method_barcode":"편의점 바코드","payment_desc_label":"설명（ECPay 표시용）","payment_desc_ph":"예: chiyigo 서비스 충전","payment_requisition_label":"연관 의뢰 번호（선택）","payment_requisition_ph":"예: 12（비우면 일반 충전）","payment_cancel_btn":"취소","payment_submit_btn":"ECPay 결제 진행","payment_submitting":"주문 생성 중…","payment_redirecting":"ECPay 로 이동 중…","payment_kyc_hint":"결제 전 KYC 인증이 필요합니다. 샌드박스는 실제 청구되지 않습니다.","payment_amount_invalid":"금액은 1~200000 의 정수여야 합니다","payment_kyc_required":"결제 전 KYC 인증이 필요합니다","payment_create_fail":"주문 생성 실패","payment_status_pending":"결제 대기","payment_status_processing":"처리 중","payment_status_succeeded":"성공","payment_status_failed":"실패","payment_status_canceled":"취소됨","payment_status_refunded":"환불됨","payment_kind_deposit":"충전","payment_kind_subscription":"구독","payment_kind_withdraw":"출금","payment_kind_refund":"환불","payment_for_requisition":"대응 의뢰","payment_info_atm_bank":"은행 코드","payment_info_atm_account":"가상 계좌","payment_info_cvs_no":"편의점 결제 코드","payment_info_barcode":"편의점 바코드","payment_info_expire":"납부 기한","del_otp_ph":"2FA 6자리 코드","del_otp_required":"계정 삭제는 2FA가 필요합니다. 위의 \"2단계 인증\"에서 먼저 활성화하세요."}};
    let curLangD = localStorage.getItem('lang') || 'zh-TW';
    function T(key) { return (LANGS_D[curLangD] || LANGS_D['zh-TW'])[key] ?? (LANGS_D['zh-TW'][key] ?? key); }
    function applyLangD(lang) {
        curLangD = lang;
        localStorage.setItem('lang', lang);
        const t = LANGS_D[lang] || LANGS_D['zh-TW'];
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const k = el.dataset.i18n;
            if (t[k] !== undefined)
                el.textContent = t[k];
        });
        document.querySelectorAll('[data-i18n-ph]').forEach(el => {
            const k = el.dataset.i18nPh;
            if (t[k] !== undefined)
                el.placeholder = t[k];
        });
        document.querySelectorAll('.db-lang-opt').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === lang);
        });
        // re-render any already-rendered dynamic UI
        const tfaBadge = document.getElementById('tfa-badge');
        const tfaText = document.getElementById('tfa-status-text');
        if (tfaBadge && tfaBadge.dataset.tfaState) {
            const on = tfaBadge.dataset.tfaState === 'on';
            tfaBadge.textContent = on ? T('tfa_badge_on') : T('tfa_badge_off');
            if (tfaText)
                tfaText.textContent = on ? T('tfa_text_on') : T('tfa_text_off');
        }
        // 加入時間：依當前語系重新格式化
        const createdEl = document.getElementById('info-created');
        if (createdEl?.dataset.raw)
            createdEl.textContent = formatDate(createdEl.dataset.raw);
        // 需求單列表：以最後一次 fetch 結果重畫（變數宣告在後段，用 window 規避 TDZ）
        if (window._lastRequisitions)
            renderRequisitions(window._lastRequisitions);
        // Phase D-3 動態 row 切語系跟著重畫
        if (window._lastDevices)
            renderDevices(window._lastDevices);
        if (window._lastPasskeys)
            renderPasskeys(window._lastPasskeys);
        // Phase F-3 wallet
        if (window._lastWallets)
            renderWallets(window._lastWallets);
        if (window._lastPayments)
            renderPayments(window._lastPayments);
        // 刪帳按鈕 / 2FA enable label 隨 hasPassword 動態切換，需在 i18n 套用後重畫
        if (typeof window.__hasPassword !== 'undefined') {
            if (typeof renderDeleteSection === 'function')
                renderDeleteSection(window.__hasPassword);
            // 重畫 2FA 區塊以同步「需先設密碼」label 的語系
            const tfaBadgeForRedraw = document.getElementById('tfa-badge');
            if (tfaBadgeForRedraw && tfaBadgeForRedraw.dataset.tfaState !== undefined) {
                render2FASection(tfaBadgeForRedraw.dataset.tfaState === 'on', window.__hasPassword);
            }
        }
    }
    // lang switcher — globe dropdown
    const dbGlobeBtn = document.getElementById('db-globe-btn');
    const dbLangDrop = document.getElementById('db-lang-drop');
    dbGlobeBtn?.addEventListener('click', e => {
        e.stopPropagation();
        dbLangDrop?.classList.toggle('open');
    });
    dbLangDrop?.addEventListener('click', e => {
        const opt = e.target?.closest('.db-lang-opt');
        if (!opt)
            return;
        applyLangD(opt.dataset.lang);
        dbLangDrop.classList.remove('open');
    });
    document.addEventListener('click', () => dbLangDrop?.classList.remove('open'));
    applyLangD(curLangD);
    const ROLE_STYLE = {
        developer: 'bg-purple-500/15 text-purple-300 border border-purple-500/20',
        admin: 'bg-red-500/15 text-red-300 border border-red-500/20',
        moderator: 'bg-amber-500/15 text-amber-300 border border-amber-500/20',
        player: 'bg-brand-500/15 text-brand-300 border border-brand-500/20',
    };
    function dateLocale() {
        // 對應 Intl.DateTimeFormat 可接受的 locale；'zh-TW' 直接用，其餘 BCP-47 通用
        return curLangD === 'zh-TW' ? 'zh-TW' : curLangD;
    }
    function formatDate(str) {
        if (!str)
            return '—';
        const d = new Date(str.replace(' ', 'T') + 'Z');
        return d.toLocaleDateString(dateLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
    }
    function formatDateShort(str) {
        if (!str)
            return '—';
        const d = new Date(str.replace(' ', 'T') + 'Z');
        return d.toLocaleDateString(dateLocale(), { month: 'numeric', day: 'numeric' });
    }
    async function loadProfile() {
        const token = sessionStorage.getItem('access_token');
        if (!token) {
            window.location.href = '/login.html';
            return;
        }
        try {
            let res = await fetch('/api/auth/me', {
                headers: { 'Authorization': 'Bearer ' + token },
            });
            // access_token 過期 → 嘗試靜默刷新一次，成功後重試
            if (res.status === 401) {
                console.warn('[loadProfile] 401 first hit, traceId=', res.headers.get('X-Request-Id'));
                const ok = await refreshAccessToken();
                console.warn('[loadProfile] refresh result=', ok);
                if (!ok) {
                    sessionStorage.removeItem('access_token');
                    window.location.href = '/login.html';
                    return;
                }
                res = await fetch('/api/auth/me', {
                    headers: { 'Authorization': 'Bearer ' + sessionStorage.getItem('access_token') },
                });
                if (res.status === 401) {
                    console.warn('[loadProfile] 401 after refresh, traceId=', res.headers.get('X-Request-Id'));
                    const body = await res.json().catch(() => ({}));
                    console.warn('[loadProfile] 401 body=', body);
                    sessionStorage.removeItem('access_token');
                    window.location.href = '/login.html';
                    return;
                }
            }
            // P0-13：403 不當登出（403 ≠ 過期）。/api/auth/me 在被 ban / role 降級時會回 403，
            // 這時 throw 出去顯示 error-card，留 user 在頁上自己處理；登出走自家 logout 流程。
            if (res.status === 403) {
                const body = await res.json().catch(() => ({}));
                console.warn('[loadProfile] 403', body, 'traceId=', res.headers.get('X-Request-Id'));
                throw new Error(body.error || 'Forbidden');
            }
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                console.warn('[loadProfile] non-ok', res.status, body, 'traceId=', res.headers.get('X-Request-Id'));
                throw new Error(body.error || ('HTTP ' + res.status));
            }
            const data = await res.json();
            document.getElementById('user-email').textContent = data.email;
            document.getElementById('info-email').textContent = data.email;
            const createdEl = document.getElementById('info-created');
            createdEl.dataset.raw = data.created_at ?? '';
            createdEl.textContent = formatDate(data.created_at);
            const roleBadge = document.getElementById('role-badge');
            roleBadge.textContent = T('role_' + data.role) || data.role;
            roleBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold ' + (ROLE_STYLE[data.role] ?? ROLE_STYLE.player);
            const statusBadge = document.getElementById('status-badge');
            statusBadge.textContent = data.status === 'active' ? T('status_active') : data.status;
            statusBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold ' +
                (data.status === 'active'
                    ? 'bg-green-500/15 text-green-300 border border-green-500/20'
                    : 'bg-red-500/15 text-red-300 border border-red-500/20');
            const verifiedEl = document.getElementById('info-verified');
            verifiedEl.textContent = data.email_verified ? T('verified_yes') : T('verified_no');
            verifiedEl.className = 'text-sm font-medium ' + (data.email_verified ? 'text-green-400' : 'text-amber-400');
            document.getElementById('email-banner').classList.toggle('hidden', !!data.email_verified);
            // P2-9：用 createElement + textContent 取代 innerHTML 拼接（基線：DOM 一律不 string concat）
            const providersEl = document.getElementById('info-providers');
            providersEl.replaceChildren();
            const buildProviderChip = (p) => {
                const span = document.createElement('span');
                if (p === 'discord') {
                    span.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[#5865F2]/15 text-[#5865F2] border border-[#5865F2]/20';
                    span.textContent = 'Discord';
                }
                else if (p === 'local') {
                    span.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gray-500/15 text-[var(--text)] border border-gray-500/20';
                    span.textContent = T('provider_local');
                }
                else {
                    span.className = 'text-xs text-[var(--text-muted)]';
                    span.textContent = p;
                }
                return span;
            };
            const list = (data.identities ?? []);
            if (list.length === 0)
                providersEl.appendChild(buildProviderChip('local'));
            else
                for (const i of list)
                    providersEl.appendChild(buildProviderChip(i.provider));
            // 2FA 區塊
            render2FASection(data.totp_enabled ?? false, !!data.has_password);
            // 帳號綁定區塊
            renderBindingSection(data.identities ?? []);
            // 設密碼 / 刪帳號：依是否設過密碼決定 UI
            window.__hasPassword = !!data.has_password;
            window.__userEmail = data.email;
            renderSetPasswordSection(window.__hasPassword);
            renderChangePasswordSection(window.__hasPassword, !!data.totp_enabled);
            renderDeleteSection(window.__hasPassword);
            // 需求單區塊
            // P2-10：原本 6 個 fire-and-forget 並發 fetch（loadRequisitions/Devices/Passkeys/
            // Wallets/Payments/Deals）+ silent refresh 同時跑會給 401 race。改成 async sequential
            // 鏈，每個 await 完再下一個；watchdog 取消上一個 race。視覺體驗仍即時（每段都獨立 render）。
            window.__totpEnabled = !!data.totp_enabled;
            // SEC-FACTOR-ADD Stage 2：OAuth-reauth elevation 候選＝有「非-flagged identity」的既綁 provider，
            // 交集 BIND_PROVIDERS 已知集合（A1：server-sourced provider 不裸進候選/path）。在 await 之後執行＝BIND_PROVIDERS 已初始化（無 TDZ）。
            const _knownReauth = new Set(BIND_PROVIDERS.map(b => b.id));
            const _identities = (data.identities ?? []);
            window.__reauthProviders = [...new Set(_identities
                    .filter(i => !i.requires_reverification)
                    .map(i => i.provider)
                    .filter((p) => typeof p === 'string' && _knownReauth.has(p)))];
            (async () => {
                try {
                    await loadRequisitions();
                    await loadDevices();
                    await loadPasskeys();
                    await loadWallets();
                    await loadPayments();
                    await loadDeals();
                }
                catch (e) {
                    console.warn('[loadProfile] sequential subload aborted:', e);
                }
            })();
            // 從綠界分頁付款完切回來 → 自動重抓 intent list（不用 user 手動 F5）
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) {
                    loadPayments();
                    loadDeals();
                }
            });
            // requisition.html 帶 ?req=N 跳來時，自動開充值表單 + 預填編號
            const reqParam = new URL(window.location.href).searchParams.get('req');
            if (reqParam && /^\d+$/.test(reqParam)) {
                setTimeout(() => {
                    openPaymentForm();
                    const reqInput = document.getElementById('payment-requisition');
                    if (reqInput)
                        reqInput.value = reqParam;
                    document.getElementById('payments-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 200);
            }
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('user-card').classList.remove('hidden');
        }
        catch (e) {
            console.warn('[loadProfile] catch', e);
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('error-card').classList.remove('hidden');
            const detail = e?.message ? `${T('err_profile')}（${e.message}）` : T('err_profile');
            document.getElementById('error-msg').textContent = detail;
        }
    }
    loadProfile();
    // P0-12：跨 tab 登出同步 — 別的分頁登出 → dashboard 私密頁立刻跳 login，
    // 不要等下次 fetch 撞 401（避免連鎖 401 + sidebar-auth 只清 UI 不踢人）
    ;
    (function () {
        if (!('BroadcastChannel' in window))
            return;
        try {
            const ch = new BroadcastChannel('chiyigo-auth');
            ch.addEventListener('message', e => {
                if (!e?.data || e.data.type !== 'logout')
                    return;
                try {
                    sessionStorage.removeItem('access_token');
                }
                catch (_) { }
                location.replace('/login.html?logout=other_tab');
            });
        }
        catch (_) { }
    })();
    // ── HTML 轉義 helper（防 XSS）────────────────────────────────
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // tApiError 由 api.js 統一提供（window.tApiError，code-based + 4 lang 翻譯）
    // 本檔的 window.tApiError(...) 呼叫透過 global 解析到 window.tApiError，不需另存區域 alias
    // ── 需求單 ───────────────────────────────────────────────────
    const REQ_STATUS_CLS = {
        pending: 'bg-amber-500/15 text-amber-300 border border-amber-500/20',
        revoked: 'bg-gray-500/15 text-[var(--text-muted)] border border-gray-500/20',
        processing: 'bg-blue-500/15 text-blue-300 border border-blue-500/20',
        completed: 'bg-green-500/15 text-green-300 border border-green-500/20',
        refund_pending: 'bg-orange-500/15 text-orange-300 border border-orange-500/20',
    };
    function reqStatus(key) {
        return { text: T('status_' + key), cls: REQ_STATUS_CLS[key] ?? REQ_STATUS_CLS.pending };
    }
    window._lastRequisitions = null;
    async function loadRequisitions() {
        if (!sessionStorage.getItem('access_token'))
            return;
        try {
            const { requisitions } = await window.apiFetch('/api/requisition/me');
            renderRequisitions(requisitions);
        }
        catch { /* 非必要區塊，靜默失敗 */ }
    }
    function renderRequisitions(list) {
        window._lastRequisitions = list;
        const section = document.getElementById('req-section');
        const listEl = document.getElementById('req-list');
        const emptyEl = document.getElementById('req-empty');
        const noteEl = document.getElementById('req-revoke-note');
        if (!list || list.length === 0) {
            emptyEl.classList.remove('hidden');
            listEl.innerHTML = '';
            if (noteEl)
                noteEl.classList.add('hidden');
            section.classList.remove('hidden');
            return;
        }
        emptyEl.classList.add('hidden');
        const hasPending = list.some(r => r.status === 'pending');
        if (noteEl)
            noteEl.classList.toggle('hidden', !hasPending);
        listEl.innerHTML = list.map(r => {
            const s = reqStatus(r.status);
            const date = formatDateShort(r.created_at);
            return `
      <div data-req-open-id="${r.id}" class="flex items-center justify-between px-5 py-3.5 gap-3 cursor-pointer hover:bg-white/[0.02] transition-colors">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-xs text-[var(--text-dim)] shrink-0">#${r.id}</span>
          <span class="text-sm text-[var(--text)] truncate">${esc(r.service_type)}</span>
          <span class="text-xs text-[var(--text-muted)] shrink-0">${date}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${s.cls}">${s.text}</span>
          ${r.status === 'pending'
                ? `<button id="revoke-btn-${r.id}" data-armed="0" data-revoke-id="${r.id}"
                 class="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all">
                 ${T('btn_revoke')}
               </button>`
                : ''}
          ${r.status === 'revoked'
                ? `<button id="reqdel-btn-${r.id}" data-armed="0" data-req-del-id="${r.id}"
                 class="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all">
                 永久刪除
               </button>`
                : ''}
        </div>
      </div>`;
        }).join('');
        section.classList.remove('hidden');
    }
    // 兩步撤銷：第一次點擊變成「確認撤銷」，再點才真正執行；4 秒未確認自動還原
    let _revokeArmTimer = null;
    function disarmRevoke(id) {
        const btn = document.getElementById(`revoke-btn-${id}`);
        if (!btn)
            return;
        btn.dataset.armed = '0';
        btn.textContent = T('btn_revoke');
        btn.className = 'px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all';
        if (_revokeArmTimer) {
            clearTimeout(_revokeArmTimer);
            _revokeArmTimer = null;
        }
    }
    function armRevoke(id) {
        const btn = document.getElementById(`revoke-btn-${id}`);
        if (!btn)
            return;
        if (btn.dataset.armed === '1') {
            revokeRequisition(id);
            return;
        }
        // 先還原其他可能已 arm 的按鈕
        document.querySelectorAll('[id^="revoke-btn-"]').forEach(b => {
            if (b !== btn && b.dataset.armed === '1') {
                const otherId = b.id.replace('revoke-btn-', '');
                disarmRevoke(otherId);
            }
        });
        btn.dataset.armed = '1';
        btn.textContent = T('btn_revoke_confirm');
        btn.className = 'px-2.5 py-1 rounded-lg bg-red-500/30 hover:bg-red-500/40 border border-red-500/50 text-red-200 text-xs font-semibold transition-all';
        if (_revokeArmTimer)
            clearTimeout(_revokeArmTimer);
        _revokeArmTimer = setTimeout(() => disarmRevoke(id), 4000);
    }
    async function revokeRequisition(id, reason) {
        const btn = document.getElementById(`revoke-btn-${id}`);
        if (_revokeArmTimer) {
            clearTimeout(_revokeArmTimer);
            _revokeArmTimer = null;
        }
        if (btn) {
            btn.disabled = true;
            btn.textContent = T('btn_processing');
        }
        try {
            const r = await window.apiFetch('/api/requisition/revoke', {
                method: 'POST',
                body: JSON.stringify({ requisition_id: id, reason }),
            });
            if (r?.code === 'REFUND_REQUESTED') {
                showBindToast('退款申請已送出，等候 admin 審核', 'ok');
            }
            else {
                showBindToast(T('msg_revoke_success').replace('${id}', id), 'ok');
            }
            loadRequisitions();
        }
        catch (e) {
            // 已付款 → 後端要求填退款原因；prompt 後重試
            if (e?.code === 'REASON_REQUIRED') {
                const amt = e.body?.amount_subunit, cur = e.body?.currency || 'TWD';
                const tip = amt != null ? `（已付款 ${amt} ${cur}，需走退款審核）` : '（已付款，需走退款審核）';
                const input = window.prompt('請填寫退款原因' + tip, '');
                if (input && input.trim()) {
                    return revokeRequisition(id, input.trim());
                }
                // user 取消 → 還原按鈕
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = T('btn_revoke');
                }
                return;
            }
            if (e?.code === 'REFUND_ALREADY_PENDING') {
                showBindToast('此單已申請退款，等候 admin 審核', 'err');
                loadRequisitions();
                return;
            }
            showBindToast(window.tApiError(e, T('net_err')), 'err');
            if (btn) {
                btn.disabled = false;
                btn.textContent = T('btn_revoke');
            }
        }
    }
    // ── Requisition detail modal + 永久刪除（status='revoked' 才顯示）──
    async function openRequisitionDetail(id) {
        let row;
        try {
            row = await window.apiFetch(`/api/requisition/${id}`);
        }
        catch (e) {
            showBindToast(window.tApiError(e, T('net_err')), 'err');
            return;
        }
        // 移除舊 modal
        document.getElementById('req-detail-modal')?.remove();
        const date = row.created_at ? formatDateShort(row.created_at) : '—';
        const s = reqStatus(row.status);
        const fields = [
            ['服務類型', row.service_type],
            ['預算', row.budget],
            ['時程', row.timeline],
            ['姓名', row.name],
            ['聯絡', row.contact],
            ['公司', row.company || '—'],
        ];
        const rowsHtml = fields.map(([k, v]) => `<div class="flex gap-3 text-sm"><span class="w-16 text-[var(--text-muted)] shrink-0">${k}</span><span class="text-[var(--text)] break-all">${esc(v ?? '—')}</span></div>`).join('');
        const msgHtml = row.message
            ? `<div class="mt-2"><p class="text-xs text-[var(--text-muted)] mb-1">需求說明</p><p class="text-sm text-[var(--text)] whitespace-pre-wrap break-words bg-[var(--bg-elevated)] border border-[var(--border-bright)] rounded-lg px-3 py-2">${esc(row.message)}</p></div>`
            : '';
        // 串付款狀態
        const payments = row.linked_payments ?? [];
        const payHtml = payments.length === 0
            ? `<div class="mt-3"><p class="text-xs text-[var(--text-muted)] mb-1">付款紀錄</p><p class="text-xs text-[var(--text-dim)]">尚無付款</p></div>`
            : `<div class="mt-3"><p class="text-xs text-[var(--text-muted)] mb-1">付款紀錄</p>
         <div class="space-y-1.5">${payments.map(p => {
                const cls = PAY_STATUS_COLOR[p.status] || PAY_STATUS_COLOR.pending;
                const lbl = T('payment_status_' + p.status) || p.status;
                const amt = p.amount_subunit != null ? `${p.amount_subunit.toLocaleString()} ${esc(p.currency || 'TWD')}` : '—';
                const when = p.created_at ? formatRelative(p.created_at) : '';
                return `<div class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-bright)] text-xs">
             <span class="text-[var(--text-muted)]">#${p.id} · ${esc(p.vendor)}</span>
             <span class="text-[var(--text)] font-mono">${amt}</span>
             <span class="px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}">${esc(lbl)}</span>
           </div>`;
            }).join('')}</div></div>`;
        const delBtn = row.status === 'revoked'
            ? `<button id="req-perm-del-btn" data-armed="0" data-req-id="${row.id}"
         class="px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 text-xs font-semibold transition-all">永久刪除</button>`
            : '';
        const modal = document.createElement('div');
        modal.id = 'req-detail-modal';
        modal.className = 'fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4';
        modal.innerHTML = `
    <div class="relative w-full max-w-md rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-bright)] p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-base font-semibold text-[var(--text)]">需求單 #${row.id}</h3>
        <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${s.cls}">${s.text}</span>
      </div>
      <div class="space-y-2">${rowsHtml}</div>
      ${msgHtml}
      ${payHtml}
      <p class="text-xs text-[var(--text-muted)] mt-3">建立時間 ${date}</p>
      <div class="flex justify-end gap-2 mt-4">
        ${delBtn}
        <button data-action="req-detail-close"
          class="px-3 py-1.5 rounded-lg bg-[#1a1a22] hover:bg-[#23232c] border border-[var(--border-bright)] text-[var(--text)] text-xs transition-all">關閉</button>
      </div>
    </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal)
            closeRequisitionDetail(); });
    }
    function closeRequisitionDetail() {
        document.getElementById('req-detail-modal')?.remove();
    }
    let _reqPermDelTimer = null;
    async function armOrConfirmReqPermDelete(id) {
        const btn = document.getElementById('req-perm-del-btn');
        if (!btn)
            return;
        if (btn.dataset.armed === '1') {
            if (_reqPermDelTimer) {
                clearTimeout(_reqPermDelTimer);
                _reqPermDelTimer = null;
            }
            btn.disabled = true;
            btn.textContent = '刪除中…';
            try {
                await window.apiFetch(`/api/requisition/${id}`, { method: 'DELETE' });
                closeRequisitionDetail();
                showBindToast(`需求單 #${id} 已永久刪除`, 'ok');
                loadRequisitions();
            }
            catch (e) {
                showBindToast(window.tApiError(e, T('net_err')), 'err');
                btn.disabled = false;
                btn.textContent = '永久刪除';
                btn.dataset.armed = '0';
            }
            return;
        }
        btn.dataset.armed = '1';
        btn.textContent = '確認永久刪除';
        btn.className = 'px-3 py-1.5 rounded-lg bg-red-500/40 hover:bg-red-500/50 border border-red-500/60 text-red-100 text-xs font-semibold transition-all';
        _reqPermDelTimer = setTimeout(() => {
            if (!btn.isConnected)
                return;
            btn.dataset.armed = '0';
            btn.textContent = '永久刪除';
            btn.className = 'px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 text-xs font-semibold transition-all';
        }, 4000);
    }
    // ── List 上直接刪 revoked 需求單（兩段式）──
    let _reqListDelTimer = null;
    async function armOrConfirmReqListDelete(id) {
        const btn = document.getElementById(`reqdel-btn-${id}`);
        if (!btn)
            return;
        if (btn.dataset.armed === '1') {
            if (_reqListDelTimer) {
                clearTimeout(_reqListDelTimer);
                _reqListDelTimer = null;
            }
            btn.disabled = true;
            btn.textContent = '刪除中…';
            try {
                await window.apiFetch(`/api/requisition/${id}`, { method: 'DELETE' });
                showBindToast(`需求單 #${id} 已永久刪除`, 'ok');
                loadRequisitions();
            }
            catch (e) {
                showBindToast(window.tApiError(e, T('net_err')), 'err');
                btn.disabled = false;
                btn.textContent = '永久刪除';
                btn.dataset.armed = '0';
            }
            return;
        }
        document.querySelectorAll('[data-req-del-id]').forEach(b => {
            if (b !== btn && b.dataset.armed === '1') {
                b.dataset.armed = '0';
                b.textContent = '永久刪除';
                b.className = 'px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all';
            }
        });
        btn.dataset.armed = '1';
        btn.textContent = '確認刪除';
        btn.className = 'px-2.5 py-1 rounded-lg bg-red-500/30 hover:bg-red-500/40 border border-red-500/50 text-red-200 text-xs font-semibold transition-all';
        if (_reqListDelTimer)
            clearTimeout(_reqListDelTimer);
        _reqListDelTimer = setTimeout(() => {
            if (!btn.isConnected)
                return;
            btn.dataset.armed = '0';
            btn.textContent = '永久刪除';
            btn.className = 'px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all';
        }, 4000);
    }
    // ── Payment intent 申請退款（succeeded → admin 審核退款流程，wave 7/8）──
    let _refundReasonIntentId = null;
    function setRefundReasonMsg(text, type) {
        const el = document.getElementById('refund-reason-msg');
        if (!el)
            return;
        if (!text) {
            el.classList.add('hidden');
            el.textContent = '';
            return;
        }
        el.classList.remove('hidden');
        el.textContent = text;
        el.className = 'text-xs mt-2 ' + (type === 'err' ? 'text-red-400' : type === 'ok' ? 'text-emerald-400' : 'text-[var(--text-muted)]');
    }
    function openRefundReasonModal(intentId) {
        const p = (window._lastPayments || []).find(x => x.id === intentId);
        if (!p)
            return;
        _refundReasonIntentId = intentId;
        const amt = p.amount_subunit != null
            ? `${p.amount_subunit.toLocaleString()} ${esc(p.currency || 'TWD')}`
            : (p.amount_raw ? `${esc(p.amount_raw)} ${esc(p.currency || '')}` : '—');
        document.getElementById('refund-reason-summary').textContent =
            `對充值 #${p.id}（${amt}）申請退款。Admin 審核通過後會原路退款，動作不可逆。`;
        document.getElementById('refund-reason-input').value = '';
        setRefundReasonMsg('', '');
        document.getElementById('refund-reason-submit').disabled = false;
        document.getElementById('refund-reason-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('refund-reason-input')?.focus(), 50);
    }
    function closeRefundReasonModal() {
        document.getElementById('refund-reason-modal').classList.add('hidden');
        _refundReasonIntentId = null;
    }
    async function requestPaymentRefund(intentId) {
        openRefundReasonModal(intentId);
    }
    document.getElementById('refund-reason-close')?.addEventListener('click', closeRefundReasonModal);
    document.getElementById('refund-reason-cancel')?.addEventListener('click', closeRefundReasonModal);
    document.getElementById('refund-reason-modal')?.addEventListener('click', e => {
        if (e.target === e.currentTarget)
            closeRefundReasonModal();
    });
    document.getElementById('refund-reason-submit')?.addEventListener('click', async () => {
        const id = _refundReasonIntentId;
        if (!id)
            return;
        const reason = document.getElementById('refund-reason-input').value.trim();
        if (!reason) {
            setRefundReasonMsg('請填寫退款原因', 'err');
            return;
        }
        const btn = document.getElementById('refund-reason-submit');
        btn.disabled = true;
        setRefundReasonMsg('送出中…', '');
        try {
            const r = await window.apiFetch(`/api/payments/intents/${id}/refund-request`, {
                method: 'POST',
                body: JSON.stringify({ reason }),
            });
            setRefundReasonMsg('✓ 已送出，等候 admin 審核', 'ok');
            setTimeout(() => {
                closeRefundReasonModal();
                showBindToast(r?.requisition_id
                    ? '退款申請已送出（已關聯需求單）'
                    : '退款申請已送出，等候 admin 審核', 'ok');
                loadPayments();
                if (r?.requisition_id)
                    loadRequisitions();
            }, 700);
        }
        catch (e) {
            btn.disabled = false;
            if (e?.code === 'REFUND_ALREADY_PENDING') {
                setRefundReasonMsg('此筆充值已申請退款，請等候 admin 審核', 'err');
                setTimeout(() => { closeRefundReasonModal(); loadPayments(); }, 1200);
                return;
            }
            setRefundReasonMsg(window.tApiError(e, T('net_err')), 'err');
        }
    });
    // ── Payment intent 兩段式刪除 ──
    let _payDelTimer = null;
    async function armOrConfirmPayDelete(id) {
        const btn = document.querySelector(`[data-pay-del-id="${id}"]`);
        if (!btn)
            return;
        if (btn.dataset.armed === '1') {
            if (_payDelTimer) {
                clearTimeout(_payDelTimer);
                _payDelTimer = null;
            }
            btn.disabled = true;
            btn.textContent = '刪除中…';
            try {
                await window.apiFetch(`/api/auth/payments/intents/${id}`, { method: 'DELETE' });
                showBindToast(`充值 #${id} 已刪除`, 'ok');
                loadPayments();
            }
            catch (e) {
                showBindToast(window.tApiError(e, T('net_err')), 'err');
                btn.disabled = false;
                btn.textContent = '刪除';
                btn.dataset.armed = '0';
            }
            return;
        }
        // disarm 其他 pay-del 按鈕
        document.querySelectorAll('[data-pay-del-id]').forEach(b => {
            if (b !== btn && b.dataset.armed === '1') {
                b.dataset.armed = '0';
                b.textContent = '刪除';
                b.className = 'shrink-0 px-2 py-1 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs transition-all';
            }
        });
        btn.dataset.armed = '1';
        btn.textContent = '確認刪除';
        btn.className = 'shrink-0 px-2 py-1 rounded-md bg-red-500/30 hover:bg-red-500/40 border border-red-500/50 text-red-200 text-xs font-semibold transition-all';
        if (_payDelTimer)
            clearTimeout(_payDelTimer);
        _payDelTimer = setTimeout(() => {
            if (!btn.isConnected)
                return;
            btn.dataset.armed = '0';
            btn.textContent = '刪除';
            btn.className = 'shrink-0 px-2 py-1 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs transition-all';
        }, 4000);
    }
    // ── SEC-FACTOR-ADD Stage 2：OAuth-reauth elevation 的 pending-action 跨 redirect 持久化 ───
    // 只存「要 resume 的 action（+ bind_identity 的 target provider）」這類**非敏感路由 context**；
    // grant_token / exchange code 永不入 storage。寫入時機＝init 成功、導頁前；讀取＝resume / elev_error 即清。
    const REAUTH_PENDING_KEY = 'factor_add_reauth_pending';
    const REAUTH_PENDING_TTL_MS = 10 * 60 * 1000; // > grant 5min + 容裕；陳舊防禦（非 load-bearing，後端 exchange 2min one-time CAS 為 SoT）
    function persistReauthPending(ctx) {
        // 回 boolean（A2）：storage blocked → false，caller 不導頁（避免 roundtrip 後 silent resume-lost）。
        try {
            sessionStorage.setItem(REAUTH_PENDING_KEY, JSON.stringify(ctx));
            return true;
        }
        catch {
            return false;
        }
    }
    function readAndClearReauthPending() {
        let raw = null;
        try {
            raw = sessionStorage.getItem(REAUTH_PENDING_KEY);
            sessionStorage.removeItem(REAUTH_PENDING_KEY);
        }
        catch {
            return null;
        }
        if (!raw)
            return null;
        try {
            const ctx = JSON.parse(raw);
            if (!ctx || typeof ctx.ts !== 'number' || Date.now() - ctx.ts > REAUTH_PENDING_TTL_MS)
                return null; // 陳舊 → 視同無
            return ctx;
        }
        catch {
            return null;
        }
    }
    // 前端本地 runtime guard：擋 sessionStorage 被竄改的 action（後端 grant action-bound CAS 為最終 fail-closed 防線）。
    // 定義於此（早於 checkElevExchange IIFE）：resume 同步前綴會用到，避免 load-time TDZ。
    const FACTOR_ADD_ACTIONS_CLIENT = ['add_passkey', 'bind_wallet', 'bind_identity'];
    function isFactorAddActionClient(a) {
        return typeof a === 'string' && FACTOR_ADD_ACTIONS_CLIENT.includes(a);
    }
    // ── 綁定結果 URL 參數處理（OAuth callback 跳回後顯示 Toast）───
    ;
    (function checkBindResult() {
        const sp = new URLSearchParams(location.search);
        const bindOk = sp.get('bind');
        const bindError = sp.get('bind_error');
        const provider = sp.get('provider') ?? '';
        // SEC-FACTOR-ADD Stage 2：elevation callback 失敗回 dashboard 帶 ?elev_error=<code>（全集）。
        // 後端 callback 名（elev_error param）→ 前端 i18n key 的顯式 map，鏡射 bind_error→bind_err_* 慣例（非字串拼接）。
        const elevError = sp.get('elev_error');
        if (elevError) {
            history.replaceState(null, '', '/dashboard.html');
            readAndClearReauthPending(); // redirect 出去但 callback 回 error → resume 不會觸發，主動清陳舊 pending
            const ELEV_ERR_KEY = {
                provider_mismatch: 'elev_err_provider_mismatch',
                rate_limited: 'elev_err_rate_limited',
                invalid_state: 'elev_err_invalid_state',
                reverification_required: 'elev_reverify_required', // 重用 Stage 1 既有 key（不另造）
            };
            setTimeout(() => showBindToast(T(ELEV_ERR_KEY[elevError] ?? 'elev_err_generic'), 'warn'), 600);
            return;
        }
        if (!bindOk && !bindError)
            return;
        history.replaceState(null, '', '/dashboard.html');
        const ERR_KEY = {
            already_linked: 'bind_err_already',
            identity_taken: 'bind_err_taken',
            invalid_state: 'bind_err_state',
            account_invalid: 'bind_err_account',
            elevation_required: 'bind_err_elevation_required', // callback: factor_add_binding state 缺 / grant 不符
            elevation_consumed: 'bind_err_elevation_consumed', // callback: grant 在 provider 同意期間逾 TTL / 已用
        };
        setTimeout(() => {
            if (bindOk === 'success') {
                showBindToast(T('bind_success').replace('${p}', provider || ''), 'ok');
            }
            else {
                showBindToast(T(ERR_KEY[bindError] ?? 'bind_fail'), 'err');
            }
        }, 600);
    })();
    // ── SEC-FACTOR-ADD Stage 2：OAuth-reauth elevation 回跳的 #elev_exchange fragment handler ───
    // callback 5a 成功 → 302 dashboard.html#elev_exchange=<code>（fragment：瀏覽器不送 server、不入 referer）。
    // 讀 code → 立即剝除 fragment → 讀並清 pending context → 換 grant → resume 原 ceremony（preset grant，§3.4）。
    ;
    (function checkElevExchange() {
        const m = (location.hash || '').match(/[#&]elev_exchange=([^&]+)/);
        if (!m)
            return;
        let code = '';
        try {
            code = decodeURIComponent(m[1]);
        }
        catch {
            code = m[1];
        }
        history.replaceState(null, '', '/dashboard.html'); // 立即剝除 fragment（防 reload 重觸 / 殘留）
        const ctx = readAndClearReauthPending(); // 同步讀並清（捕捉 load-time 狀態）
        // defer 到 module 完全初始化後再 resume：resume 同步前綴會用到本檔稍後宣告的 helper（showBindToast 等）；
        // 在 IIFE 內直接呼叫會撞 load-time TDZ。code/ctx 已同步擷取進閉包，延後不影響正確性。
        setTimeout(() => { void resumeFactorAddFromExchange(code, ctx); }, 0);
    })();
    // ── 帳號綁定 ─────────────────────────────────────────────────
    const BIND_PROVIDERS = [
        { id: 'google', label: 'Google', color: '#ea4335' },
        { id: 'discord', label: 'Discord', color: '#5865F2' },
        { id: 'line', label: 'LINE', color: '#06c755' },
        { id: 'facebook', label: 'Facebook', color: '#1877f2' },
    ];
    function renderBindingSection(identities) {
        const linkedSet = new Set((identities ?? []).map(i => i.provider));
        const list = document.getElementById('bind-list');
        list.innerHTML = BIND_PROVIDERS.map(({ id, label, color }) => {
            const linked = linkedSet.has(id);
            const identity = (identities ?? []).find(i => i.provider === id);
            const displayName = identity?.display_name ?? '';
            const dot = `<span class="inline-block w-2 h-2 rounded-full mr-2 bind-dot" data-provider="${id}"></span>`;
            // OD-3：flagged identity → tier-aware。disposition_reason 'needs_review'（unknown_context）可自助 reverify；
            // 'security_review'（high:）只能解綁 / 聯絡客服（與後端 isSelfReverifyAllowed fail-closed whitelist 對齊）。
            const flagged = linked && !!identity?.requires_reverification;
            const selfReverifiable = flagged && identity?.disposition_reason === 'needs_review';
            const badge = flagged
                ? `<span class="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${selfReverifiable
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                    : 'bg-red-500/15 text-red-400 border border-red-500/25'}">${selfReverifiable ? T('reverify_badge_needs') : T('reverify_badge_high')}</span>`
                : '';
            const reverifyBtn = selfReverifiable
                ? `<button data-reverify="${id}" data-rid="${identity?.id ?? ''}"
           class="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 text-amber-400 text-xs font-semibold transition-all">
           ${T('reverify_btn')}</button>`
                : '';
            const sideBtn = linked
                ? `<button id="unbind-btn-${id}" data-unbind="${id}" data-i18n="unbind_btn"
           class="shrink-0 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all">
           ${T('unbind_btn')}</button>`
                : `<button id="bind-btn-${id}" data-bind="${id}" data-i18n="bind_btn"
           class="shrink-0 px-3 py-1.5 rounded-lg bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 text-brand-400 text-xs font-semibold transition-all">
           ${T('bind_btn')}</button>`;
            return `
      <div class="flex items-center justify-between px-5 py-3.5">
        <div class="flex items-center gap-2 min-w-0">
          ${dot}
          <span class="text-sm font-medium text-[var(--text)]">${label}</span>
          ${linked && displayName
                ? `<span class="text-xs text-[var(--text-muted)] truncate max-w-[120px]">${esc(displayName)}</span>`
                : ''}
          ${badge}
        </div>
        <div class="flex items-center gap-2 shrink-0">${reverifyBtn}${sideBtn}</div>
      </div>`;
        }).join('');
        document.getElementById('bind-section').classList.remove('hidden');
    }
    async function bindProvider(provider, presetGrant) {
        const btn = document.getElementById(`bind-btn-${provider}`);
        if (btn) {
            btn.disabled = true;
            btn.textContent = T('btn_loading');
        }
        // SEC-FACTOR-ADD Stage 1：綁新 OAuth identity = factor-add，先取 elevation grant，再以 header 出示給 init。
        // grant 掛在 apiFetch（可帶 custom header）；init 回的 redirect_url 才由 window.location.href 導頁（導頁不帶 header）。
        // Stage 2：resume 路徑帶 presetGrant（OAuth-reauth exchange 換來的 grant，target=本 provider）→ 跳過 reauth；OAuth-only 初次則由 obtainFactorAddGrant 走 reauth（帶 targetProvider）。
        const grant = presetGrant ?? await obtainFactorAddGrant('bind_identity', { targetProvider: provider });
        if (!grant) {
            if (btn) {
                btn.disabled = false;
                btn.textContent = T('bind_btn');
            }
            return;
        }
        try {
            const data = await window.apiFetch(`/api/auth/oauth/${provider}/init?is_binding=true`, {
                headers: { 'X-Factor-Add-Grant': grant.grant_token },
            });
            if (!data?.redirect_url) {
                showBindToast(T('bind_fail'), 'err');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = T('bind_btn');
                }
                return;
            }
            window.location.href = data.redirect_url;
        }
        catch (e) {
            showBindToast(window.tApiError(e, T('net_err')), 'err');
            if (btn) {
                btn.disabled = false;
                btn.textContent = T('bind_btn');
            }
        }
    }
    async function unbindProvider(provider) {
        const btn = document.getElementById(`unbind-btn-${provider}`);
        if (btn) {
            btn.disabled = true;
            btn.textContent = T('btn_loading');
        }
        try {
            await window.apiFetch('/api/auth/identity/unbind', {
                method: 'POST',
                body: JSON.stringify({ provider }),
            });
            showBindToast(T('unbind_success').replace('${p}', provider), 'ok');
            loadProfile();
        }
        catch (e) {
            if (e instanceof ApiError && e.status === 400) {
                const msg = e.traceId ? `${T('unbind_last_method')}（#${e.traceId}）` : T('unbind_last_method');
                showBindToast(msg, 'warn');
            }
            else {
                showBindToast(window.tApiError(e, T('net_err')), 'err');
            }
            if (btn) {
                btn.disabled = false;
                btn.textContent = T('unbind_btn');
            }
        }
    }
    // ── OD-3：flagged identity 自助重新驗證（owner-vouch）──────────────
    // 透過「獨立持有的因子」（TOTP/備用碼，或無 2FA 時用密碼）證明本人，後端清除 requires_reverification。
    // 不是重新跑 OAuth（植入的 identity 由攻擊者掌握，自證無意義）。channel 由帳號狀態決定，非由使用者選。
    async function reverifyIdentity(provider, credentialId) {
        if (!credentialId)
            return;
        const hasTotp = !!window.__totpEnabled;
        const hasPw = !!window.__hasPassword;
        // OAuth-only（無 TOTP 也無密碼）→ 無可信管道，引導設密碼 / 聯絡客服（與後端 NO_TRUSTED_CHANNEL 對齊）。
        if (!hasTotp && !hasPw) {
            showBindToast(T('reverify_no_channel'), 'warn');
            return;
        }
        openReverifyModal(provider, credentialId, hasTotp);
    }
    function openReverifyModal(provider, credentialId, useTotp) {
        document.getElementById('reverify-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'reverify-modal';
        modal.className = 'fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4';
        const inputType = useTotp ? 'text' : 'password';
        const placeholder = useTotp ? '兩步驟驗證碼或備用救援碼' : '目前登入密碼';
        modal.innerHTML = `
    <div class="relative w-full max-w-md rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-bright)] p-5">
      <h3 class="text-base font-semibold text-[var(--text)] mb-1">重新驗證身分</h3>
      <p class="text-xs text-[var(--text-muted)] mb-4">為確認是你本人操作，請完成驗證後即可恢復「${esc(provider)}」登入。</p>
      <input id="reverify-input" type="${inputType}" autocomplete="${useTotp ? 'one-time-code' : 'current-password'}"
        ${useTotp ? 'inputmode="numeric"' : ''} placeholder="${placeholder}"
        class="w-full px-3 py-2 rounded-lg bg-[#1a1a22] border border-[var(--border-bright)] text-[var(--text)] text-sm mb-2 outline-none focus:border-brand-400" />
      <p id="reverify-err" class="text-xs text-red-400 mb-3 hidden"></p>
      <div class="flex justify-end gap-2">
        <button id="reverify-cancel" class="px-3 py-1.5 rounded-lg bg-[#1a1a22] hover:bg-[#23232c] border border-[var(--border-bright)] text-[var(--text)] text-xs transition-all">取消</button>
        <button id="reverify-submit" class="px-3 py-1.5 rounded-lg bg-brand-500/15 hover:bg-brand-500/20 border border-brand-500/30 text-brand-300 text-xs font-semibold transition-all">確認</button>
      </div>
    </div>`;
        document.body.appendChild(modal);
        const input = document.getElementById('reverify-input');
        const errEl = document.getElementById('reverify-err');
        input?.focus();
        const close = () => modal.remove();
        modal.addEventListener('click', e => { if (e.target === modal)
            close(); });
        document.getElementById('reverify-cancel')?.addEventListener('click', close);
        const submit = async () => {
            const v = (input?.value ?? '').trim();
            if (!v) {
                input?.focus();
                return;
            }
            const btn = document.getElementById('reverify-submit');
            if (btn) {
                btn.disabled = true;
                btn.textContent = T('btn_loading');
            }
            if (errEl)
                errEl.classList.add('hidden');
            try {
                // 後端 verifySecondFactor 同時驗 TOTP 與備用碼；6 位純數字當 otp_code，其餘當 backup_code（欄位語意對齊）。
                const proof = useTotp
                    ? (/^\d{6}$/.test(v) ? { otp_code: v } : { backup_code: v })
                    : { password: v };
                await window.apiFetch('/api/auth/credential/reverify', {
                    method: 'POST',
                    body: JSON.stringify({ type: 'identity', credential_id: credentialId, ...proof }),
                });
                close();
                showBindToast(T('reverify_success'), 'ok');
                loadProfile();
            }
            catch (e) {
                if (errEl) {
                    errEl.textContent = window.tApiError(e, T('net_err'));
                    errEl.classList.remove('hidden');
                }
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '確認';
                }
            }
        };
        document.getElementById('reverify-submit')?.addEventListener('click', submit);
        input?.addEventListener('keydown', e => { if (e.key === 'Enter')
            submit(); });
    }
    async function obtainFactorAddGrant(action, opts) {
        const hasTotp = !!window.__totpEnabled;
        const hasPw = !!window.__hasPassword;
        // __totpEnabled / __hasPassword 僅 UX hint（決定問哪種因子）；最終授權由後端 elevation 端點 fail-closed 判定。
        if (hasTotp || hasPw)
            return openElevationModal(action, hasTotp);
        // OAuth-only（無 TOTP 無密碼）：Stage 2 — 用既綁 provider OAuth-reauth 鑄 grant（Stage 1 此分支原只彈引導文案）。
        return startOAuthReauthElevation(action, opts?.targetProvider);
    }
    function openElevationModal(action, useTotp) {
        return new Promise(resolve => {
            document.getElementById('elevation-modal')?.remove();
            const modal = document.createElement('div');
            modal.id = 'elevation-modal';
            modal.className = 'fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4';
            const inputType = useTotp ? 'text' : 'password';
            modal.innerHTML = `
      <div class="relative w-full max-w-md rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-bright)] p-5">
        <h3 class="text-base font-semibold text-[var(--text)] mb-1">${T('factor_add_modal_title')}</h3>
        <p class="text-xs text-[var(--text-muted)] mb-4">${T('factor_add_modal_hint')}</p>
        <input id="elevation-input" type="${inputType}" autocomplete="${useTotp ? 'one-time-code' : 'current-password'}"
          ${useTotp ? 'inputmode="numeric"' : ''} placeholder="${useTotp ? T('factor_add_ph_totp') : T('factor_add_ph_pw')}"
          class="w-full px-3 py-2 rounded-lg bg-[#1a1a22] border border-[var(--border-bright)] text-[var(--text)] text-sm mb-2 outline-none focus:border-brand-400" />
        <p id="elevation-err" class="text-xs text-red-400 mb-3 hidden"></p>
        <div class="flex justify-end gap-2">
          <button id="elevation-cancel" class="px-3 py-1.5 rounded-lg bg-[#1a1a22] hover:bg-[#23232c] border border-[var(--border-bright)] text-[var(--text)] text-xs transition-all">${T('factor_add_cancel')}</button>
          <button id="elevation-submit" class="px-3 py-1.5 rounded-lg bg-brand-500/15 hover:bg-brand-500/20 border border-brand-500/30 text-brand-300 text-xs font-semibold transition-all">${T('factor_add_confirm')}</button>
        </div>
      </div>`;
            document.body.appendChild(modal);
            const input = document.getElementById('elevation-input');
            const errEl = document.getElementById('elevation-err');
            input?.focus();
            let settled = false;
            let submitting = false; // in-flight guard: Enter-key submit bypasses button.disabled (code-review SR #3/#6)
            const finish = (v) => { if (settled)
                return; settled = true; modal.remove(); resolve(v); };
            modal.addEventListener('click', e => { if (e.target === modal)
                finish(null); });
            document.getElementById('elevation-cancel')?.addEventListener('click', () => finish(null));
            const submit = async () => {
                if (submitting)
                    return; // ignore re-entry (double click / repeated Enter) while a mint is in flight
                const v = (input?.value ?? '').trim();
                if (!v) {
                    input?.focus();
                    return;
                }
                submitting = true;
                const sBtn = document.getElementById('elevation-submit');
                if (sBtn) {
                    sBtn.disabled = true;
                    sBtn.textContent = T('btn_loading');
                }
                if (errEl)
                    errEl.classList.add('hidden');
                const showErr = (text) => {
                    submitting = false; // allow retry after a failed mint
                    if (errEl) {
                        errEl.textContent = text;
                        errEl.classList.remove('hidden');
                    }
                    if (sBtn) {
                        sBtn.disabled = false;
                        sBtn.textContent = T('factor_add_confirm');
                    }
                };
                try {
                    const endpoint = useTotp ? '/api/auth/elevation/totp' : '/api/auth/elevation/password';
                    const body = useTotp ? { action, otp_code: v } : { action, current_password: v };
                    const data = await window.apiFetch(endpoint, {
                        method: 'POST',
                        body: JSON.stringify(body),
                    });
                    // 回應形狀守衛：grant_token 必為非空字串，否則 fail-closed（不拿空 grant 續 ceremony）。
                    if (typeof data?.grant_token !== 'string' || !data.grant_token) {
                        showErr(T('net_err'));
                        return;
                    }
                    finish({ grant_token: data.grant_token });
                }
                catch (e) {
                    showErr(window.tApiError(e, T('net_err')));
                }
            };
            document.getElementById('elevation-submit')?.addEventListener('click', submit);
            input?.addEventListener('keydown', e => { if (e.key === 'Enter')
                submit(); });
        });
    }
    // ── SEC-FACTOR-ADD Stage 2：OAuth-only 帳號的 OAuth-reauth elevation ───────────────
    // OAuth-only（無 TOTP 無密碼）唯一可信 elevation 管道＝用既綁 provider 重新 OAuth 授權證明本人：
    // 選 reauth provider → init?purpose=elevation → 整頁導去 provider → callback 5a → #elev_exchange →
    // /elevation/exchange 換 grant → resume 原 ceremony（add_passkey / bind_wallet / bind_identity）。
    // 註：isFactorAddActionClient / FACTOR_ADD_ACTIONS_CLIENT 定義在上方 pending-context 區
    //     （checkElevExchange 在 load 時同步呼叫 resumeFactorAddFromExchange，其同步前綴會用到 → 須早於該 IIFE 初始化）。
    // OAuth-only 入口：選候選 provider 做 reauth。targetProvider＝bind_identity 要綁的「新」provider（排除，不能拿它自己 reauth）。
    async function startOAuthReauthElevation(action, targetProvider) {
        const candidates = (window.__reauthProviders ?? []).filter(p => p !== targetProvider);
        if (!candidates.length) {
            showBindToast(T('elev_reauth_no_candidate'), 'warn');
            return null;
        }
        return openReauthElevationModal(action, candidates, targetProvider);
    }
    // dedicated reauth modal（OD-3-frontend）：列候選 provider 按鈕。選一個 → init → 整頁導頁（成功時 promise 不 resolve）。
    // 取消 / 遮罩 / init 失敗 → resolve(null)（caller 還原按鈕）。
    function openReauthElevationModal(action, candidates, targetProvider) {
        return new Promise(resolve => {
            document.getElementById('reauth-elev-modal')?.remove();
            const labelOf = (p) => BIND_PROVIDERS.find(b => b.id === p)?.label ?? p;
            const modal = document.createElement('div');
            modal.id = 'reauth-elev-modal';
            modal.className = 'fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4';
            // p ∈ candidates ⊆ BIND_PROVIDERS（已 whitelist），用於 id / data-attr 安全；label 仍 esc 防禦。
            const btns = candidates.map(p => `<button id="reauth-elev-btn-${p}" data-reauth-provider="${p}"
         class="w-full px-3 py-2 rounded-lg bg-brand-500/15 hover:bg-brand-500/20 border border-brand-500/30 text-brand-300 text-sm font-semibold transition-all">
         ${T('elev_reauth_provider_btn').replace('${p}', esc(labelOf(p)))}</button>`).join('');
            modal.innerHTML = `
      <div class="relative w-full max-w-md rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-bright)] p-5">
        <h3 class="text-base font-semibold text-[var(--text)] mb-1">${T('elev_reauth_modal_title')}</h3>
        <p id="reauth-elev-hint" class="text-xs text-[var(--text-muted)] mb-4">${T('elev_reauth_modal_hint')}</p>
        <div class="flex flex-col gap-2">${btns}</div>
        <p id="reauth-elev-err" class="text-xs text-red-400 mt-3 hidden"></p>
        <div class="flex justify-end mt-3">
          <button id="reauth-elev-cancel" class="px-3 py-1.5 rounded-lg bg-[#1a1a22] hover:bg-[#23232c] border border-[var(--border-bright)] text-[var(--text)] text-xs transition-all">${T('elev_reauth_cancel')}</button>
        </div>
      </div>`;
            document.body.appendChild(modal);
            const errEl = document.getElementById('reauth-elev-err');
            let settled = false;
            let submitting = false; // in-flight guard：擋重複點擊在 init 往返期間 double-fire
            const finish = (v) => { if (settled)
                return; settled = true; modal.remove(); resolve(v); };
            const setBtnsDisabled = (d) => candidates.forEach(p => {
                const b = document.getElementById('reauth-elev-btn-' + p);
                if (b)
                    b.disabled = d;
            });
            const showErr = (text) => {
                submitting = false;
                setBtnsDisabled(false); // 失敗 → 重新可點
                if (errEl) {
                    errEl.textContent = text;
                    errEl.classList.remove('hidden');
                }
            };
            modal.addEventListener('click', e => { if (e.target === modal)
                finish(null); });
            document.getElementById('reauth-elev-cancel')?.addEventListener('click', () => finish(null));
            candidates.forEach(p => {
                document.getElementById('reauth-elev-btn-' + p)?.addEventListener('click', async () => {
                    if (submitting)
                        return;
                    submitting = true;
                    if (errEl)
                        errEl.classList.add('hidden');
                    setBtnsDisabled(true);
                    try {
                        // same-origin apiFetch（自動帶 Authorization）；A1：encodeURIComponent provider path segment（縱深）。
                        const data = await window.apiFetch(`/api/auth/oauth/${encodeURIComponent(p)}/init?purpose=elevation&action=${action}`);
                        // RACE-3：init 往返期間使用者可能已取消/點遮罩（finish(null) 設 settled）→ 不可再 persist/導頁（違反取消意圖）。
                        // 此時 modal 已移除；init 建的 oauth_state 未消費、10min 後自然過期。直接 return（不導頁）。
                        if (settled)
                            return;
                        if (!data?.redirect_url) {
                            showErr(T('net_err'));
                            return;
                        }
                        // A2：成功才 persist；storage blocked → 不導頁（避免 roundtrip 後 silent resume-lost）。
                        if (!persistReauthPending({ action, targetProvider, ts: Date.now() })) {
                            showErr(T('elev_reauth_storage_blocked'));
                            return;
                        }
                        const hint = document.getElementById('reauth-elev-hint');
                        if (hint)
                            hint.textContent = T('elev_reauth_redirecting');
                        // 整頁導去 provider；promise 不 resolve（導航即將拆掉執行環境，await 永不完成是預期，非 leak）。
                        window.location.href = data.redirect_url;
                    }
                    catch (e) {
                        showErr(window.tApiError(e, T('net_err')));
                    }
                });
            });
        });
    }
    // #elev_exchange resume：換 grant → 以 preset grant 續原 ceremony（不再彈 modal）。
    async function resumeFactorAddFromExchange(code, ctx) {
        if (!code)
            return;
        if (!ctx || !isFactorAddActionClient(ctx.action)) {
            showBindToast(T('elev_resume_lost'), 'warn');
            return;
        }
        try {
            // skipRefresh（HR-F3）：exchange code 是 one-time。預設 401→silent-refresh→retry 會 retry 死 code、
            // 第二次仍 401 → apiFetch 誤判 SESSION_EXPIRED 把使用者登出。skipRefresh 下 SESSION_REVOKED 仍硬登出（api.ts 內），
            // 其餘 401（如 EXCHANGE_CODE_INVALID）直接以 code 拋出 → 友善錯誤、不登出。
            const data = await window.apiFetch('/api/auth/elevation/exchange', {
                method: 'POST', body: JSON.stringify({ code }), skipRefresh: true,
            });
            if (typeof data?.grant_token !== 'string' || !data.grant_token) {
                showBindToast(T('elev_exchange_failed'), 'err');
                return;
            }
            const grant = { grant_token: data.grant_token };
            if (ctx.action === 'add_passkey')
                await addPasskey(grant);
            else if (ctx.action === 'bind_wallet')
                await addWallet(grant);
            else if (ctx.action === 'bind_identity' && BIND_PROVIDERS.some(b => b.id === ctx.targetProvider))
                await bindProvider(ctx.targetProvider, grant);
            else
                showBindToast(T('elev_resume_lost'), 'warn'); // targetProvider 不在白名單（竄改）→ 不 dispatch
        }
        catch (e) {
            showBindToast(window.tApiError(e, T('net_err')), 'err');
        }
    }
    let _toastTimer;
    function showBindToast(msg, type) {
        const el = document.getElementById('bind-toast');
        el.textContent = msg;
        el.className = [
            'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl whitespace-nowrap pointer-events-none',
            type === 'ok' ? 'bg-green-500/20 text-green-300 border border-green-500/30' :
                type === 'warn' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                    'bg-red-500/20 text-red-300 border border-red-500/30',
        ].join(' ');
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => { el.className += ' opacity-0'; }, 3200);
    }
    // ── 2FA 管理 ─────────────────────────────────────────────────
    function render2FASection(enabled, hasPw) {
        document.getElementById('tfa-section').classList.remove('hidden');
        const badge = document.getElementById('tfa-badge');
        const text = document.getElementById('tfa-status-text');
        const enableBtn = document.getElementById('tfa-enable-btn');
        const enableLbl = document.getElementById('tfa-enable-label');
        const disableBtn = document.getElementById('tfa-disable-btn');
        const needPw = document.getElementById('tfa-need-pw');
        badge.dataset.tfaState = enabled ? 'on' : 'off';
        if (enabled) {
            badge.textContent = T('tfa_badge_on');
            badge.className = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-green-500/15 text-green-300 border border-green-500/20';
            text.textContent = T('tfa_text_on');
            enableBtn.classList.add('hidden');
            disableBtn.classList.remove('hidden');
            needPw.classList.add('hidden');
        }
        else {
            badge.textContent = T('tfa_badge_off');
            badge.className = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-500/15 text-[var(--text-muted)] border border-gray-500/20';
            text.textContent = T('tfa_text_off');
            enableBtn.classList.remove('hidden');
            disableBtn.classList.add('hidden');
            if (hasPw) {
                enableBtn.disabled = false;
                enableLbl.textContent = T('tfa_enable_btn');
                needPw.classList.add('hidden');
            }
            else {
                enableBtn.disabled = true;
                enableLbl.textContent = T('tfa_need_pw_local');
                needPw.classList.remove('hidden');
            }
        }
        document.getElementById('tfa-setup-panel').classList.add('hidden');
        document.getElementById('tfa-disable-panel').classList.add('hidden');
        document.getElementById('tfa-backup-panel').classList.add('hidden');
    }
    async function startSetup2FA() {
        const btn = document.getElementById('tfa-enable-btn');
        btn.disabled = true;
        btn.querySelector('[data-i18n]').textContent = T('btn_loading');
        try {
            const data = await window.apiFetch('/api/auth/2fa/setup', { method: 'POST', body: '{}' });
            document.getElementById('tfa-secret').textContent = data.secret;
            await window.QRCode.toCanvas(document.getElementById('tfa-qr'), data.otpauth_uri, { width: 180, margin: 1 });
            document.getElementById('tfa-setup-panel').classList.remove('hidden');
            document.getElementById('tfa-otp-input').value = '';
            const pwEl = document.getElementById('tfa-password-input');
            if (pwEl)
                pwEl.value = '';
            document.getElementById('tfa-setup-msg').classList.add('hidden');
        }
        catch (e) {
            window.notify.error(window.tApiError(e, T('net_err')));
        }
        btn.disabled = false;
        btn.querySelector('[data-i18n]').textContent = T('tfa_enable_btn');
    }
    async function confirmEnable2FA() {
        // P1-21：disable button 防雙擊
        const btn = document.querySelector('#tfa-setup-panel button[data-action="confirm-enable-2fa"]');
        if (btn?.disabled)
            return;
        if (btn)
            btn.disabled = true;
        const otp = document.getElementById('tfa-otp-input').value.trim();
        const pw = (document.getElementById('tfa-password-input')?.value ?? '');
        const msg = document.getElementById('tfa-setup-msg');
        if (!/^\d{6}$/.test(otp)) {
            showTfaMsg(msg, T('totp_err6'), 'err');
            if (btn)
                btn.disabled = false;
            return;
        }
        if (!pw) {
            showTfaMsg(msg, T('tfa_pw_required') || '請輸入目前登入密碼', 'err');
            if (btn)
                btn.disabled = false;
            return;
        }
        try {
            const data = await window.apiFetch('/api/auth/2fa/activate', {
                method: 'POST',
                body: JSON.stringify({ otp_code: otp, current_password: pw }),
            });
            const codesEl = document.getElementById('tfa-backup-codes');
            codesEl.innerHTML = data.backup_codes.map(c => `<code class="block text-center text-xs font-mono bg-[var(--bg)] border border-[var(--border-bright)] rounded-lg px-2 py-1.5 text-[var(--text)] select-all">${c}</code>`).join('');
            render2FASection(true);
            window.__totpEnabled = true;
            document.getElementById('tfa-setup-panel').classList.add('hidden');
            document.getElementById('tfa-backup-panel').classList.remove('hidden');
        }
        catch (e) {
            showTfaMsg(msg, window.tApiError(e, T('net_err')), 'err');
        }
        finally {
            if (btn)
                btn.disabled = false;
        }
    }
    function closeTfaBackup() {
        document.getElementById('tfa-backup-panel').classList.add('hidden');
    }
    function showDisablePanel() {
        document.getElementById('tfa-setup-panel').classList.add('hidden');
        document.getElementById('tfa-disable-panel').classList.toggle('hidden');
        document.getElementById('tfa-disable-input').value = '';
        document.getElementById('tfa-disable-msg').classList.add('hidden');
    }
    async function confirmDisable2FA() {
        // P1-21：button 防雙擊
        const btn = document.querySelector('#tfa-disable-panel button[data-action="confirm-disable-2fa"]');
        if (btn?.disabled)
            return;
        if (btn)
            btn.disabled = true;
        const otp = document.getElementById('tfa-disable-input').value.trim();
        const msg = document.getElementById('tfa-disable-msg');
        if (!/^\d{6}$/.test(otp)) {
            showTfaMsg(msg, T('totp_err6'), 'err');
            if (btn)
                btn.disabled = false;
            return;
        }
        try {
            await window.apiFetch('/api/auth/2fa/disable', {
                method: 'POST',
                body: JSON.stringify({ otp_code: otp }),
            });
            // disable.js 後端會 bumpTokenVersion 撤所有 token；後續 API 必 401。
            // 顯示 success 訊息 + 清 sessionStorage + broadcast logout（同步其他分頁），
            // 再跳 login.html，由 login.js 接 ?tfa_disabled=1 顯示提示。
            showTfaMsg(msg, T('disable_success'), 'ok');
            try {
                sessionStorage.removeItem('access_token');
            }
            catch (_) { }
            try {
                if ('BroadcastChannel' in window) {
                    new BroadcastChannel('chiyigo-auth').postMessage({ type: 'logout' });
                }
            }
            catch (_) { }
            setTimeout(() => { location.replace('/login.html?tfa_disabled=1'); }, 1500);
            // 不解鎖 — 即將跳頁
        }
        catch (e) {
            showTfaMsg(msg, window.tApiError(e, T('net_err')), 'err');
            if (btn)
                btn.disabled = false;
        }
    }
    function showTfaMsg(el, text, type) {
        el.textContent = text;
        el.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
    }
    async function sendVerification() {
        const btn = document.getElementById('resend-btn');
        if (!sessionStorage.getItem('access_token')) {
            window.location.href = '/login.html';
            return;
        }
        btn.disabled = true;
        btn.querySelector('[data-i18n]').textContent = T('btn_sending');
        document.getElementById('resend-msg').className = 'hidden text-xs mt-2';
        try {
            await window.apiFetch('/api/auth/email/send-verification', { method: 'POST', body: '{}' });
            showResendMsg(T('resend_sent'), 'ok');
            startResendCooldown(60);
        }
        catch (e) {
            if (e instanceof ApiError && e.status === 400) {
                // email 已驗證，重新載入資料更新 UI
                loadProfile();
                return;
            }
            if (e instanceof ApiError && e.status === 429) {
                const wait = e.body?.retry_after ?? 60;
                showResendMsg(T('resend_wait'), 'warn');
                startResendCooldown(wait);
                return;
            }
            showResendMsg(window.tApiError(e, T('net_err')), 'err');
            btn.disabled = false;
            btn.querySelector('[data-i18n]').textContent = T('resend_btn');
        }
    }
    function showResendMsg(text, type) {
        const msg = document.getElementById('resend-msg');
        msg.textContent = text;
        msg.className = 'text-xs mt-2 ' + (type === 'ok' ? 'text-green-400' : type === 'warn' ? 'text-amber-400' : 'text-red-400');
    }
    function startResendCooldown(seconds) {
        const btn = document.getElementById('resend-btn');
        const span = btn.querySelector('[data-i18n]');
        let remaining = seconds;
        btn.disabled = true;
        span.textContent = T('resend_timer_label').replace('${s}', remaining);
        const iv = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(iv);
                btn.disabled = false;
                span.textContent = T('resend_btn');
            }
            else {
                span.textContent = T('resend_timer_label').replace('${s}', remaining);
            }
        }, 1000);
    }
    // pagehide：頁面進入 bfcache 前重置 UI，確保還原時顯示 spinner 而非舊資料。
    window.addEventListener('pagehide', () => {
        document.getElementById('loading').classList.remove('hidden');
        document.getElementById('user-card').classList.add('hidden');
        document.getElementById('error-card').classList.add('hidden');
    });
    // pageshow：bfcache 還原後重新驗證；pagehide 已重置 UI 所以無閃爍。
    window.addEventListener('pageshow', (event) => {
        if (!event.persisted)
            return;
        if (!sessionStorage.getItem('access_token')) {
            window.location.replace('/login.html');
        }
        else {
            loadProfile();
        }
    });
    // ── 主題切換（與 login.html 對齊：localStorage key='theme', value='dark'|'light'）
    (function initTheme() {
        const root = document.documentElement;
        function apply(isDark) {
            root.classList.toggle('theme-dark', isDark);
            root.classList.toggle('theme-light', !isDark);
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        }
        const btn = document.getElementById('db-theme-btn');
        if (btn)
            btn.addEventListener('click', () => {
                apply(!root.classList.contains('theme-dark'));
            });
    })();
    // ── 設定登入密碼（OAuth-only）────────────────────────────
    function renderSetPasswordSection(hasPw) {
        const sec = document.getElementById('setpw-section');
        if (!sec)
            return;
        sec.classList.toggle('hidden', !!hasPw);
    }
    async function sendSetPasswordEmail() {
        const btn = document.getElementById('setpw-btn');
        const msg = document.getElementById('setpw-msg');
        msg.classList.add('hidden');
        msg.textContent = '';
        btn.disabled = true;
        try {
            await window.apiFetch('/api/auth/local/forgot-password', {
                method: 'POST',
                body: JSON.stringify({ email: window.__userEmail }),
            });
            msg.innerHTML = T('setpw_sent').replace('${email}', esc(window.__userEmail));
            msg.className = 'text-xs text-emerald-400';
            msg.classList.remove('hidden');
            // 60 秒冷卻保護
            setTimeout(() => { btn.disabled = false; }, 60000);
        }
        catch (e) {
            msg.textContent = window.tApiError(e, T('net_err'));
            msg.className = 'text-xs text-red-400';
            msg.classList.remove('hidden');
            btn.disabled = false;
        }
    }
    // ── 修改密碼（in-session，走 step-up flow）──────────────
    function renderChangePasswordSection(hasPw, totpEnabled) {
        const sec = document.getElementById('changepw-section');
        if (!sec)
            return;
        sec.classList.toggle('hidden', !hasPw);
        // OAuth-only（無密碼）使用者點「修改密碼」nav → 動態改 data-scroll 指向 setpw-section
        // 引導他們先「設定密碼」。一般有密碼帳號則照常指向 changepw-section。
        const navTarget = hasPw ? 'changepw-section' : 'setpw-section';
        const sbBtn = document.getElementById('sb-nav-changepw');
        const mBtn = document.getElementById('m-ov-changepw');
        if (sbBtn)
            sbBtn.dataset.scroll = navTarget;
        if (mBtn)
            mBtn.dataset.scroll = navTarget;
        const need2faHint = document.getElementById('changepw-need-2fa');
        const form = document.getElementById('changepw-form');
        if (!need2faHint || !form)
            return;
        // 沒 2FA → 顯示提示，隱藏表單（step-up 必走 OTP）
        need2faHint.classList.toggle('hidden', !!totpEnabled);
        form.classList.toggle('hidden', !totpEnabled);
    }
    async function submitChangePassword() {
        const newEl = document.getElementById('changepw-new');
        const confirmEl = document.getElementById('changepw-confirm');
        const otpEl = document.getElementById('changepw-otp');
        const msg = document.getElementById('changepw-msg');
        const btn = document.getElementById('changepw-submit');
        const newPw = newEl.value;
        const confirm = confirmEl.value;
        const otp = otpEl.value.trim();
        function showMsg(text, type) {
            msg.textContent = text;
            msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
            msg.classList.remove('hidden');
        }
        if (!newPw || !confirm) {
            showMsg(T('net_err'), 'err');
            return;
        }
        if (newPw !== confirm) {
            showMsg(T('changepw_mismatch'), 'err');
            return;
        }
        if (!/^\d{6}$/.test(otp)) {
            showMsg(T('totp_err6'), 'err');
            return;
        }
        btn.disabled = true;
        msg.classList.add('hidden');
        try {
            // 1) step-up：拿 5min 短效 step_up_token
            const stepRes = await window.apiFetch('/api/auth/step-up', {
                method: 'POST',
                body: JSON.stringify({
                    scope: 'elevated:account',
                    for_action: 'change_password',
                    otp_code: otp,
                }),
            });
            const stepUpToken = stepRes?.step_up_token;
            if (!stepUpToken) {
                showMsg(T('net_err'), 'err');
                btn.disabled = false;
                return;
            }
            // 2) change-password：用 step_up_token 換密碼
            await window.apiFetch('/api/auth/account/change-password', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + stepUpToken },
                body: JSON.stringify({ new_password: newPw }),
            });
            // 成功 → 同 2FA disable UX：顯示成功訊息 → 清 token + 廣播 → 跳 login
            showMsg(T('changepw_success'), 'ok');
            try {
                sessionStorage.removeItem('access_token');
            }
            catch (_) { }
            try {
                if ('BroadcastChannel' in window) {
                    new BroadcastChannel('chiyigo-auth').postMessage({ type: 'logout' });
                }
            }
            catch (_) { }
            setTimeout(() => { location.replace('/login.html?password_reset=1'); }, 1500);
        }
        catch (e) {
            btn.disabled = false;
            showMsg(window.tApiError(e, T('net_err')), 'err');
        }
    }
    // ── 刪除帳號 ─────────────────────────────────────────────
    function renderDeleteSection(hasPw) {
        const btn = document.getElementById('del-open-btn');
        const label = document.getElementById('del-open-label');
        const hint = document.getElementById('del-need-pw');
        if (!btn)
            return;
        if (hasPw) {
            btn.disabled = false;
            label.textContent = T('del_open_btn');
            hint.classList.add('hidden');
        }
        else {
            btn.disabled = true;
            label.textContent = T('del_need_pw_local');
            hint.classList.remove('hidden');
        }
    }
    function showDeleteForm() {
        if (!window.__hasPassword)
            return;
        document.getElementById('del-stage1').classList.add('hidden');
        document.getElementById('del-stage2').classList.remove('hidden');
        document.getElementById('del-password').focus();
    }
    function hideDeleteForm() {
        document.getElementById('del-stage2').classList.add('hidden');
        document.getElementById('del-stage1').classList.remove('hidden');
        document.getElementById('del-password').value = '';
        const msg = document.getElementById('del-msg');
        msg.classList.add('hidden');
        msg.textContent = '';
    }
    // 後端錯誤訊息（英文）→ i18n key
    const DEL_ERR_MAP = {
        'Incorrect password': 'del_err_pw',
        'Account not found': 'del_err_account',
        'Too many requests. Please try again later.': 'del_err_rate',
        'Please wait before requesting another confirmation email': 'del_err_cooldown',
        'Failed to send confirmation email, please try again later': 'del_err_send',
        'password is required': 'del_pw_required',
        'Unauthorized': 'del_err_unauth',
    };
    // requireAuth / requireStepUp middleware error code → i18n key。
    // code 是 stable contract（error 字串隨 i18n 化會改）；優先比 code，找不到再 fallback 到 DEL_ERR_MAP。
    const DEL_ERR_CODE_MAP = {
        ACCOUNT_BANNED: 'del_err_banned',
        TOKEN_REVOKED: 'del_err_session_revoked',
        STEP_UP_ROLE_DRIFT: 'del_err_session_revoked',
        STEP_UP_USER_GONE: 'del_err_account',
        STEP_UP_REVOKED: 'del_err_stepup_revoked',
        STEP_UP_REQUIRED: 'del_err_stepup_revoked',
        STEP_UP_ACTION_MISMATCH: 'del_err_stepup_mismatch',
        STEP_UP_TOKEN_CONSUMED: 'del_err_stepup_used',
        // step-up endpoint 也吐 RATE_LIMITED（OTP brute-force 防護），共用 del_err_rate 既有文案
        RATE_LIMITED: 'del_err_rate',
    };
    async function submitDeleteAccount() {
        const pw = document.getElementById('del-password').value;
        const otp = (document.getElementById('del-otp')?.value ?? '').trim();
        const msg = document.getElementById('del-msg');
        const btn = document.getElementById('del-submit-btn');
        msg.classList.add('hidden');
        msg.textContent = '';
        if (!pw) {
            msg.textContent = T('del_pw_required');
            msg.className = 'text-xs text-red-400';
            msg.classList.remove('hidden');
            return;
        }
        // P1-3：刪帳號要 step-up（elevated:account）→ 必填 6 位 OTP
        if (!/^\d{6}$/.test(otp)) {
            msg.textContent = T('totp_err6');
            msg.className = 'text-xs text-red-400';
            msg.classList.remove('hidden');
            return;
        }
        btn.disabled = true;
        try {
            // 1) 換 step-up token（5min 短效）
            const stepRes = await window.apiFetch('/api/auth/step-up', {
                method: 'POST',
                body: JSON.stringify({
                    scope: 'elevated:account',
                    for_action: 'delete_account',
                    otp_code: otp,
                }),
            });
            const stepUpToken = stepRes?.step_up_token;
            if (!stepUpToken)
                throw new Error('no step_up_token');
            // 2) 帶 step-up token + password 兩重憑證 POST 刪帳號（送 confirmation email）
            await window.apiFetch('/api/auth/delete', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + stepUpToken },
                body: JSON.stringify({ password: pw }),
            });
            msg.innerHTML = T('del_sent');
            msg.className = 'text-xs text-emerald-400';
            msg.classList.remove('hidden');
            document.getElementById('del-password').value = '';
            const delOtp = document.getElementById('del-otp');
            if (delOtp)
                delOtp.value = '';
        }
        catch (e) {
            if (e instanceof ApiError && e.status > 0) {
                const body = e.body;
                const errKey = body?.error ?? '';
                const errCode = body?.code ?? '';
                // 優先 code（middleware 統一吐 stable code），找不到才比 error 字串
                const k = DEL_ERR_CODE_MAP[errCode] ?? DEL_ERR_MAP[errKey];
                let base = k ? T(k) : T('del_err_generic').replace('${status}', e.status);
                // STEP_UP_REQUIRES_2FA 是 step-up endpoint 自己（非 middleware）噴的特例：
                // user 沒啟用 2FA 就請求 step-up → 走「請先啟用 2FA」訊息而非通用錯誤。
                if (body?.code === 'STEP_UP_REQUIRES_2FA')
                    base = T('del_otp_required');
                msg.textContent = e.traceId ? `${base}（#${e.traceId}）` : base;
                console.warn('[delete-account]', e.status, e.body, 'traceId=', e.traceId);
            }
            else {
                msg.textContent = T('net_err');
            }
            msg.className = 'text-xs text-red-400';
            msg.classList.remove('hidden');
            btn.disabled = false;
        }
    }
    // ── block 2/3 ──
    // Sidebar / mobile-overlay nav: scroll to section + active state
    (function () {
        const sbItems = document.querySelectorAll('.sb-item[data-scroll], .m-ov-item[data-scroll]');
        sbItems.forEach(btn => btn.addEventListener('click', () => {
            const id = btn.dataset.scroll;
            const target = document.getElementById(id);
            if (!target)
                return;
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            document.querySelectorAll('.sb-item[data-scroll]').forEach(b => b.classList.toggle('active', b.dataset.scroll === id));
            document.querySelectorAll('.m-ov-item[data-scroll]').forEach(b => b.classList.toggle('active', b.dataset.scroll === id));
        }));
    })();
    // Mobile overlay open/close
    (function () {
        const ham = document.getElementById('m-ham-btn');
        const ov = document.getElementById('m-overlay');
        const open = () => { ham?.classList.add('is-open'); ham?.setAttribute('aria-expanded', 'true'); ov?.classList.add('is-open'); ov?.removeAttribute('aria-hidden'); document.body.classList.add('body-lock'); };
        const close = () => { ham?.classList.remove('is-open'); ham?.setAttribute('aria-expanded', 'false'); ov?.classList.remove('is-open'); ov?.setAttribute('aria-hidden', 'true'); document.body.classList.remove('body-lock'); };
        ham?.addEventListener('click', () => ov?.classList.contains('is-open') ? close() : open());
        ov?.addEventListener('click', e => { if (e.target === ov)
            close(); });
        ov?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(close, 120)));
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov?.classList.contains('is-open'))
            close(); });
    })();
    // Mobile theme button → proxy to db-theme-btn; mobile lang button → toggle m-top-lang-drop
    (function () {
        const mTheme = document.getElementById('m-theme-btn');
        const mLang = document.getElementById('m-lang-btn');
        const mDrop = document.getElementById('m-top-lang-drop');
        const dbTheme = document.getElementById('db-theme-btn');
        mTheme?.addEventListener('click', () => dbTheme?.click());
        mLang?.addEventListener('click', e => { e.stopPropagation(); mDrop?.classList.toggle('open'); });
        mDrop?.addEventListener('click', e => {
            const opt = e.target?.closest('.db-lang-opt');
            if (!opt)
                return;
            if (typeof applyLangD === 'function')
                applyLangD(opt.dataset.lang);
            mDrop.classList.remove('open');
        });
        document.addEventListener('click', () => mDrop?.classList.remove('open'));
        // Sync mobile theme icon with theme class
        function syncMTheme() {
            const dark = document.documentElement.classList.contains('theme-dark');
            const sun = mTheme?.querySelector('.icon-sun');
            const moon = mTheme?.querySelector('.icon-moon');
            if (sun)
                sun.hidden = dark;
            if (moon)
                moon.hidden = !dark;
        }
        syncMTheme();
        new MutationObserver(syncMTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        // Mobile overlay lang options
        document.getElementById('m-overlay')?.addEventListener('click', e => {
            const opt = e.target?.closest('.m-ov-lang-opt');
            if (!opt)
                return;
            if (typeof applyLangD === 'function')
                applyLangD(opt.dataset.lang);
        });
    })();
    // Sync setpw nav item visibility with section visibility
    (function () {
        const sec = document.getElementById('setpw-section');
        const sbBtn = document.getElementById('sb-nav-setpw');
        const mBtn = document.getElementById('m-ov-setpw');
        if (!sec)
            return;
        function sync() {
            const hidden = sec.classList.contains('hidden');
            if (sbBtn)
                sbBtn.hidden = hidden;
            if (mBtn)
                mBtn.hidden = hidden;
        }
        sync();
        new MutationObserver(sync).observe(sec, { attributes: true, attributeFilter: ['class'] });
    })();
    // changepw nav 永遠顯示（即使 changepw-section 隱藏）—
    // 對 OAuth-only user 而言「修改密碼」仍是有意義的入口；
    // renderChangePasswordSection 會把 nav 的 data-scroll 動態指向 setpw-section。
    // 因此這裡不像 setpw nav 那樣綁定 hidden 狀態。
    (function () {
        const sbBtn = document.getElementById('sb-nav-changepw');
        const mBtn = document.getElementById('m-ov-changepw');
        if (sbBtn)
            sbBtn.hidden = false;
        if (mBtn)
            mBtn.hidden = false;
    })();
    // ── block 3/3 ──
    (function () {
        const canvas = document.getElementById('neural-canvas');
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        let W = 0, H = 0, nodes = [];
        const DIST = 155;
        function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
        function initNodes() { const n = W < 768 ? 40 : 90; nodes = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .28, vy: (Math.random() - .5) * .28, r: Math.random() * 1.1 + .4, pulse: Math.random() * Math.PI * 2 })); }
        const mouse = { x: -9999, y: -9999 };
        document.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
        let cfg = { r: '108', g: '110', b: '229', no: .22, lo: .09 };
        function syncCfg() { const s = getComputedStyle(document.documentElement); cfg = { r: s.getPropertyValue('--neural-r').trim() || '108', g: s.getPropertyValue('--neural-g').trim() || '110', b: s.getPropertyValue('--neural-b').trim() || '229', no: parseFloat(s.getPropertyValue('--neural-node-opacity').trim() || '.22'), lo: parseFloat(s.getPropertyValue('--neural-line-opacity').trim() || '.09') }; }
        syncCfg();
        new MutationObserver(syncCfg).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        function draw() {
            ctx.clearRect(0, 0, W, H);
            const { r, g, b, no, lo } = cfg;
            for (const n of nodes) {
                const dx = n.x - mouse.x, dy = n.y - mouse.y, d2 = dx * dx + dy * dy;
                if (d2 < 16900) {
                    const d = Math.sqrt(d2);
                    n.vx += dx / d * .055;
                    n.vy += dy / d * .055;
                }
                n.vx *= .982;
                n.vy *= .982;
                n.x += n.vx;
                n.y += n.vy;
                if (n.x < -12)
                    n.x = W + 12;
                else if (n.x > W + 12)
                    n.x = -12;
                if (n.y < -12)
                    n.y = H + 12;
                else if (n.y > H + 12)
                    n.y = -12;
                n.pulse += .011;
                const p = Math.sin(n.pulse) * .25 + .75;
                ctx.beginPath();
                ctx.arc(n.x, n.y, n.r * p, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${r},${g},${b},${no * p})`;
                ctx.fill();
            }
            for (let i = 0; i < nodes.length; i++)
                for (let j = i + 1; j < nodes.length; j++) {
                    const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d2 = dx * dx + dy * dy;
                    if (d2 < DIST * DIST) {
                        const a = (1 - Math.sqrt(d2) / DIST) * lo;
                        ctx.beginPath();
                        ctx.moveTo(nodes[i].x, nodes[i].y);
                        ctx.lineTo(nodes[j].x, nodes[j].y);
                        ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
                        ctx.lineWidth = .5;
                        ctx.stroke();
                    }
                }
            requestAnimationFrame(draw);
        }
        resize();
        initNodes();
        draw();
        window.addEventListener('resize', () => { resize(); initNodes(); });
    })();
    // ── Phase D-3：裝置 + Passkey 區塊 ──────────────────────────
    // base64url <-> ArrayBuffer（瀏覽器 WebAuthn ceremony 用，不引入 lib）
    function b64urlToBuf(s) {
        const pad = '='.repeat((4 - s.length % 4) % 4);
        const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++)
            out[i] = bin.charCodeAt(i);
        return out.buffer;
    }
    function bufToB64url(buf) {
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++)
            bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function formatRelative(iso) {
        if (!iso)
            return '—';
        const t = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
        if (Number.isNaN(t.getTime()))
            return iso;
        const diffMs = Date.now() - t.getTime();
        const min = Math.round(diffMs / 60000);
        if (min < 1)
            return curLangD === 'zh-TW' ? '剛剛' : curLangD === 'ja' ? 'たった今' : curLangD === 'ko' ? '방금' : 'just now';
        if (min < 60)
            return curLangD === 'zh-TW' ? `${min} 分鐘前` : curLangD === 'ja' ? `${min}分前` : curLangD === 'ko' ? `${min}분 전` : `${min}m ago`;
        const hr = Math.round(min / 60);
        if (hr < 24)
            return curLangD === 'zh-TW' ? `${hr} 小時前` : curLangD === 'ja' ? `${hr}時間前` : curLangD === 'ko' ? `${hr}시간 전` : `${hr}h ago`;
        const day = Math.round(hr / 24);
        if (day < 30)
            return curLangD === 'zh-TW' ? `${day} 天前` : curLangD === 'ja' ? `${day}日前` : curLangD === 'ko' ? `${day}일 전` : `${day}d ago`;
        return formatDate(iso);
    }
    async function loadDevices() {
        const sec = document.getElementById('devices-section');
        const list = document.getElementById('devices-list');
        if (!sec || !list)
            return;
        sec.classList.remove('hidden');
        try {
            const { devices } = await window.apiFetch('/api/auth/devices');
            window._lastDevices = devices ?? [];
            renderDevices(window._lastDevices);
        }
        catch (e) {
            list.innerHTML = `<p class="text-xs text-red-400">${esc(window.tApiError(e, T('net_err')))}</p>`;
        }
    }
    function renderDevices(devices) {
        const list = document.getElementById('devices-list');
        if (!list)
            return;
        if (!devices.length) {
            list.innerHTML = `<p class="text-xs text-[var(--text-muted)]">${T('devices_empty')}</p>`;
            return;
        }
        list.innerHTML = devices.map(d => {
            const dev = d.device_uuid;
            const isNull = dev === null || dev === undefined;
            const isBrowser = isNull || (typeof dev === 'string' && dev.startsWith('web-'));
            const label = isBrowser
                ? (isNull ? T('device_label_web') : `${T('device_label_web')} · ${esc(dev.slice(4, 12))}`)
                : `${T('device_label_app')} · ${esc(String(dev).slice(0, 8))}`;
            const last = formatRelative(d.last_seen);
            const dataAttr = isNull ? 'data-device-uuid=""' : `data-device-uuid="${esc(dev)}"`;
            return `
      <div class="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-bright)] px-4 py-3 flex items-center justify-between gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-[var(--text)] truncate">${label}</p>
          <p class="text-xs text-[var(--text-muted)] mt-0.5">${T('device_last_seen_label')}：${esc(last)} · ${d.active_count} ${T('device_active_label')}</p>
        </div>
        <button type="button" data-action="logout-device" ${dataAttr}
          class="shrink-0 px-3 py-1.5 rounded-lg border border-red-500/25 bg-red-500/5 hover:bg-red-500/10 text-red-300 text-xs font-semibold transition-all">
          ${T('device_logout_btn')}
        </button>
      </div>`;
        }).join('');
    }
    async function logoutDevice(deviceUuidAttr) {
        const isNullGroup = deviceUuidAttr === '';
        const device_uuid = isNullGroup ? null : deviceUuidAttr;
        // 判斷是不是「自己這台」— 對 NULL group / 自己 device_uuid 都算自己，要清 token + 跳 login
        let myUuid = null;
        try {
            myUuid = localStorage.getItem('chiyigo.device_uuid');
        }
        catch (_) { }
        const isMyOwnRow = isNullGroup || (myUuid && deviceUuidAttr === myUuid);
        try {
            const r = await window.apiFetch('/api/auth/devices/logout', {
                method: 'POST',
                body: JSON.stringify({ device_uuid }),
            });
            // race：另一個 tab 剛剛已撤完，這裡 revoked=0 → 不算成功，刷新就好
            if (!r || r.revoked === 0) {
                showBindToast(T('device_logout_already_revoked') || '此裝置已無有效 session', 'ok');
                loadDevices();
                return;
            }
            if (isMyOwnRow) {
                showBindToast(T('device_logout_success'), 'ok');
                // 撤的就是當下 session → 自己也清掉
                try {
                    sessionStorage.removeItem('access_token');
                }
                catch (_) { }
                try {
                    if ('BroadcastChannel' in window)
                        new BroadcastChannel('chiyigo-auth').postMessage({ type: 'logout' });
                }
                catch (_) { }
                setTimeout(() => { location.replace('/login.html?logout=device'); }, 800);
                return;
            }
            // 對端裝置：refresh_token 已撤，但其 access_token 還有最多 15 min TTL
            showBindToast(T('device_logout_success_other'), 'ok');
            loadDevices();
        }
        catch (e) {
            showBindToast(window.tApiError(e, T('net_err')), 'err');
        }
    }
    function passkeySupported() {
        return typeof window.PublicKeyCredential === 'function' && location.protocol === 'https:';
    }
    async function loadPasskeys() {
        const sec = document.getElementById('passkeys-section');
        const list = document.getElementById('passkeys-list');
        const unsup = document.getElementById('passkey-unsupported');
        const addBtn = document.getElementById('passkey-add-btn');
        if (!sec || !list)
            return;
        sec.classList.remove('hidden');
        if (!passkeySupported()) {
            if (unsup)
                unsup.classList.remove('hidden');
            if (addBtn)
                addBtn.disabled = true;
        }
        try {
            const { credentials } = await window.apiFetch('/api/auth/webauthn/credentials');
            window._lastPasskeys = credentials ?? [];
            renderPasskeys(window._lastPasskeys);
        }
        catch (e) {
            list.innerHTML = `<p class="text-xs text-red-400">${esc(window.tApiError(e, T('net_err')))}</p>`;
        }
    }
    function renderPasskeys(creds) {
        const list = document.getElementById('passkeys-list');
        if (!list)
            return;
        if (!creds.length) {
            list.innerHTML = `<p class="text-xs text-[var(--text-muted)]">${T('passkeys_empty')}</p>`;
            return;
        }
        list.innerHTML = creds.map(c => {
            const nickname = c.nickname || T('passkey_default_nickname');
            const lastUsed = c.last_used_at ? formatRelative(c.last_used_at) : T('passkey_never_used');
            const transports = (c.transports ?? []).join(', ') || '—';
            return `
      <div id="pk-row-${c.id}" class="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-bright)] px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-[var(--text)] truncate" id="pk-nickname-${c.id}">${esc(nickname)}</p>
            <p class="text-xs text-[var(--text-muted)] mt-0.5">${T('passkey_last_used_label')}：${esc(lastUsed)} · ${esc(transports)}</p>
          </div>
          <div class="shrink-0 flex gap-2">
            <button type="button" data-action="passkey-rename-open" data-passkey-id="${c.id}"
              class="px-3 py-1.5 rounded-lg border border-[var(--border-bright)] hover:bg-[#1f1f28] text-[var(--text)] text-xs font-semibold transition-all">
              ${T('passkey_rename_btn')}
            </button>
            <button type="button" data-action="passkey-remove-open" data-passkey-id="${c.id}"
              class="px-3 py-1.5 rounded-lg border border-red-500/25 bg-red-500/5 hover:bg-red-500/10 text-red-300 text-xs font-semibold transition-all">
              ${T('passkey_remove_btn')}
            </button>
          </div>
        </div>
        <div id="pk-rename-${c.id}" class="hidden mt-3 space-y-2">
          <input id="pk-name-${c.id}" type="text" maxlength="64" value="${esc(nickname)}"
            placeholder="${T('passkey_rename_ph')}"
            data-enter-click='[data-action="passkey-rename-save"][data-passkey-id="${c.id}"]'
            class="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border-bright)] text-[var(--text)] text-sm placeholder:text-[var(--text-dim)] focus:outline-none focus:border-violet-500/40" />
          <p id="pk-rename-msg-${c.id}" class="hidden text-xs"></p>
          <div class="flex gap-2">
            <button type="button" data-action="passkey-rename-cancel" data-passkey-id="${c.id}"
              class="flex-1 py-2 rounded-lg border border-[var(--border-bright)] hover:bg-[#1f1f28] text-[var(--text-muted)] text-xs font-semibold transition-all">
              ${T('passkey_rename_cancel')}
            </button>
            <button type="button" data-action="passkey-rename-save" data-passkey-id="${c.id}"
              class="flex-1 py-2 rounded-lg border border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              ${T('passkey_rename_save')}
            </button>
          </div>
        </div>
        <div id="pk-remove-${c.id}" class="hidden mt-3 space-y-2">
          <p class="text-xs text-amber-300">${T('passkey_remove_hint')}</p>
          <input id="pk-otp-${c.id}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"
            placeholder="${T('passkey_remove_otp_ph')}"
            data-enter-click='[data-action="passkey-remove-confirm"][data-passkey-id="${c.id}"]'
            class="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border-bright)] text-[var(--text)] text-sm placeholder:text-[var(--text-dim)] focus:outline-none focus:border-red-500/40" />
          <p id="pk-msg-${c.id}" class="hidden text-xs"></p>
          <div class="flex gap-2">
            <button type="button" data-action="passkey-remove-cancel" data-passkey-id="${c.id}"
              class="flex-1 py-2 rounded-lg border border-[var(--border-bright)] hover:bg-[#1f1f28] text-[var(--text-muted)] text-xs font-semibold transition-all">
              ${T('passkey_remove_cancel')}
            </button>
            <button type="button" data-action="passkey-remove-confirm" data-passkey-id="${c.id}"
              class="flex-1 py-2 rounded-lg border border-red-500/40 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              ${T('passkey_remove_confirm')}
            </button>
          </div>
        </div>
      </div>`;
        }).join('');
    }
    function openPasskeyRename(id) {
        document.getElementById(`pk-remove-${id}`)?.classList.add('hidden');
        document.getElementById(`pk-rename-${id}`)?.classList.remove('hidden');
        const inp = document.getElementById(`pk-name-${id}`);
        if (inp) {
            inp.focus();
            inp.select();
        }
    }
    function cancelPasskeyRename(id) {
        document.getElementById(`pk-rename-${id}`)?.classList.add('hidden');
        document.getElementById(`pk-rename-msg-${id}`)?.classList.add('hidden');
    }
    async function savePasskeyRename(id) {
        const inp = document.getElementById(`pk-name-${id}`);
        const msg = document.getElementById(`pk-rename-msg-${id}`);
        const btns = document.querySelectorAll(`[data-passkey-id="${id}"]`);
        const showMsg = (text, type) => {
            if (!msg)
                return;
            msg.textContent = text;
            msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
            msg.classList.remove('hidden');
        };
        const nickname = (inp?.value ?? '').trim();
        if (!nickname) {
            showMsg(T('passkey_rename_empty'), 'err');
            return;
        }
        btns.forEach(b => { if (b.tagName === 'BUTTON')
            b.disabled = true; });
        try {
            await window.apiFetch(`/api/auth/webauthn/credentials/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ nickname }),
            });
            if (Array.isArray(window._lastPasskeys)) {
                const idx = window._lastPasskeys.findIndex(c => String(c.id) === String(id));
                if (idx >= 0)
                    window._lastPasskeys[idx] = { ...window._lastPasskeys[idx], nickname };
                renderPasskeys(window._lastPasskeys);
            }
            showBindToast(T('passkey_rename_success'), 'ok');
        }
        catch (e) {
            btns.forEach(b => { if (b.tagName === 'BUTTON')
                b.disabled = false; });
            showMsg(window.tApiError(e, T('passkey_rename_fail')), 'err');
        }
    }
    function openPasskeyRemove(id) {
        if (!window.__totpEnabled) {
            showBindToast(T('passkey_remove_need_2fa'), 'err');
            const tfa = document.getElementById('tfa-section');
            if (tfa)
                tfa.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        document.getElementById(`pk-rename-${id}`)?.classList.add('hidden');
        const panel = document.getElementById(`pk-remove-${id}`);
        panel?.classList.remove('hidden');
        document.getElementById(`pk-otp-${id}`)?.focus();
    }
    function cancelPasskeyRemove(id) {
        document.getElementById(`pk-remove-${id}`)?.classList.add('hidden');
        const otp = document.getElementById(`pk-otp-${id}`);
        if (otp)
            otp.value = '';
        document.getElementById(`pk-msg-${id}`)?.classList.add('hidden');
    }
    async function confirmPasskeyRemove(id) {
        const otpEl = document.getElementById(`pk-otp-${id}`);
        const msg = document.getElementById(`pk-msg-${id}`);
        const btns = document.querySelectorAll(`[data-passkey-id="${id}"]`);
        const otp = (otpEl?.value || '').trim();
        const showMsg = (text, type) => {
            if (!msg)
                return;
            msg.textContent = text;
            msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
            msg.classList.remove('hidden');
        };
        if (!/^\d{6}$/.test(otp)) {
            showMsg(T('totp_err6'), 'err');
            return;
        }
        btns.forEach(b => { if (b.tagName === 'BUTTON')
            b.disabled = true; });
        try {
            const stepRes = await window.apiFetch('/api/auth/step-up', {
                method: 'POST',
                body: JSON.stringify({ scope: 'elevated:account', for_action: 'remove_passkey', otp_code: otp }),
            });
            const stepUpToken = stepRes?.step_up_token;
            if (!stepUpToken) {
                showMsg(T('net_err'), 'err');
                btns.forEach(b => { if (b.tagName === 'BUTTON')
                    b.disabled = false; });
                return;
            }
            await window.apiFetch(`/api/auth/webauthn/credentials/${id}`, {
                method: 'DELETE',
                headers: { Authorization: 'Bearer ' + stepUpToken },
            });
            showBindToast(T('passkey_remove_success'), 'ok');
            loadPasskeys();
        }
        catch (e) {
            btns.forEach(b => { if (b.tagName === 'BUTTON')
                b.disabled = false; });
            showMsg(window.tApiError(e, T('passkey_remove_fail')), 'err');
        }
    }
    async function addPasskey(presetGrant) {
        if (!passkeySupported())
            return;
        const btn = document.getElementById('passkey-add-btn');
        const msg = document.getElementById('passkey-add-msg');
        const showMsg = (text, type) => {
            if (!msg)
                return;
            msg.textContent = text;
            msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
            msg.classList.remove('hidden');
        };
        if (btn)
            btn.disabled = true;
        // SEC-FACTOR-ADD Stage 1：新增 passkey = factor-add，先取 elevation grant（避免無法 elevate 卻先叫出 authenticator）。
        // Stage 2：resume 路徑帶 presetGrant（OAuth-reauth exchange 換來的 grant）→ 跳過 modal/reauth。
        const grant = presetGrant ?? await obtainFactorAddGrant('add_passkey');
        if (!grant) {
            if (btn)
                btn.disabled = false;
            return;
        }
        showMsg(T('passkey_adding'), 'ok');
        try {
            const opts = await window.apiFetch('/api/auth/webauthn/register-options', { method: 'POST', body: '{}' });
            const publicKey = {
                ...opts,
                challenge: b64urlToBuf(opts.challenge),
                user: { ...opts.user, id: b64urlToBuf(opts.user.id) },
                excludeCredentials: (opts.excludeCredentials ?? []).map(c => ({ ...c, id: b64urlToBuf(c.id) })),
            };
            let cred;
            try {
                cred = await navigator.credentials.create({ publicKey: publicKey });
            }
            catch (e) {
                if (e?.name === 'NotAllowedError' || e?.name === 'AbortError')
                    showMsg(T('passkey_add_cancelled'), 'err');
                else
                    showMsg(`${T('passkey_add_fail')}：${e?.message ?? e}`, 'err');
                if (btn)
                    btn.disabled = false;
                return;
            }
            const r = cred.response;
            const responseJson = {
                id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type,
                response: {
                    clientDataJSON: bufToB64url(r.clientDataJSON),
                    attestationObject: bufToB64url(r.attestationObject),
                    transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
                },
                clientExtensionResults: typeof cred.getClientExtensionResults === 'function' ? cred.getClientExtensionResults() : {},
                authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
            };
            await window.apiFetch('/api/auth/webauthn/register-verify', {
                method: 'POST',
                headers: { 'X-Factor-Add-Grant': grant.grant_token },
                body: JSON.stringify({ response: responseJson, nickname: T('passkey_default_nickname') }),
            });
            showMsg(T('passkey_add_success'), 'ok');
            loadPasskeys();
        }
        catch (e) {
            showMsg(window.tApiError(e, T('passkey_add_fail')), 'err');
        }
        finally {
            if (btn)
                btn.disabled = false;
        }
    }
    // ── Phase F-3：錢包綁定（SIWE）──────────────────────────────
    function shortAddr(addr) {
        if (!addr || addr.length < 10)
            return addr ?? '—';
        return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    }
    function chainLabel(id) {
        const map = { 1: 'Ethereum', 10: 'Optimism', 137: 'Polygon', 8453: 'Base', 42161: 'Arbitrum' };
        return map[id] ?? `Chain ${id}`;
    }
    function walletProvider() {
        // 偵測 EIP-1193 provider；MetaMask / Rabby / Coinbase Wallet 等都注入到 window.ethereum
        return typeof window !== 'undefined' && window.ethereum ? window.ethereum : null;
    }
    async function loadWallets() {
        const sec = document.getElementById('wallets-section');
        const list = document.getElementById('wallets-list');
        const unsup = document.getElementById('wallet-unsupported');
        const addBtn = document.getElementById('wallet-add-btn');
        if (!sec || !list)
            return;
        sec.classList.remove('hidden');
        if (!walletProvider()) {
            if (unsup)
                unsup.classList.remove('hidden');
            if (addBtn)
                addBtn.disabled = true;
        }
        try {
            const { wallets } = await window.apiFetch('/api/auth/wallet');
            window._lastWallets = wallets ?? [];
            renderWallets(window._lastWallets);
        }
        catch (e) {
            list.innerHTML = `<p class="text-xs text-red-400">${esc(window.tApiError(e, T('net_err')))}</p>`;
        }
    }
    function renderWallets(wallets) {
        const list = document.getElementById('wallets-list');
        if (!list)
            return;
        if (!wallets.length) {
            list.innerHTML = `<p class="text-xs text-[var(--text-muted)]">${T('wallets_empty')}</p>`;
            return;
        }
        list.innerHTML = wallets.map(w => {
            const display = w.nickname ? `${esc(w.nickname)} · ${esc(shortAddr(w.address))}` : esc(w.address);
            const signedAt = w.signed_at ? formatRelative(w.signed_at) : '—';
            return `
      <div id="wl-row-${w.id}" class="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-bright)] px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-[var(--text)] truncate font-mono">${display}</p>
            <p class="text-xs text-[var(--text-muted)] mt-0.5">${esc(chainLabel(w.chain_id))} · ${T('wallet_signed_at_label')}：${esc(signedAt)}</p>
          </div>
          <button type="button" data-action="wallet-remove-open" data-wallet-id="${w.id}"
            class="shrink-0 px-3 py-1.5 rounded-lg border border-red-500/25 bg-red-500/5 hover:bg-red-500/10 text-red-300 text-xs font-semibold transition-all">
            ${T('wallet_remove_btn')}
          </button>
        </div>
        <div id="wl-remove-${w.id}" class="hidden mt-3 space-y-2">
          <p class="text-xs text-amber-300">${T('wallet_remove_hint')}</p>
          <input id="wl-otp-${w.id}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"
            placeholder="${T('wallet_remove_otp_ph')}"
            data-enter-click='[data-action="wallet-remove-confirm"][data-wallet-id="${w.id}"]'
            class="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border-bright)] text-[var(--text)] text-sm placeholder:text-[var(--text-dim)] focus:outline-none focus:border-red-500/40" />
          <p id="wl-msg-${w.id}" class="hidden text-xs"></p>
          <div class="flex gap-2">
            <button type="button" data-action="wallet-remove-cancel" data-wallet-id="${w.id}"
              class="flex-1 py-2 rounded-lg border border-[var(--border-bright)] hover:bg-[#1f1f28] text-[var(--text-muted)] text-xs font-semibold transition-all">
              ${T('wallet_remove_cancel')}
            </button>
            <button type="button" data-action="wallet-remove-confirm" data-wallet-id="${w.id}"
              class="flex-1 py-2 rounded-lg border border-red-500/40 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              ${T('wallet_remove_confirm')}
            </button>
          </div>
        </div>
      </div>`;
        }).join('');
    }
    function openWalletRemove(id) {
        if (!window.__totpEnabled) {
            showBindToast(T('wallet_remove_need_2fa'), 'err');
            const tfa = document.getElementById('tfa-section');
            if (tfa)
                tfa.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        document.getElementById(`wl-remove-${id}`)?.classList.remove('hidden');
        document.getElementById(`wl-otp-${id}`)?.focus();
    }
    function cancelWalletRemove(id) {
        document.getElementById(`wl-remove-${id}`)?.classList.add('hidden');
        const otp = document.getElementById(`wl-otp-${id}`);
        if (otp)
            otp.value = '';
        document.getElementById(`wl-msg-${id}`)?.classList.add('hidden');
    }
    async function confirmWalletRemove(id) {
        const otpEl = document.getElementById(`wl-otp-${id}`);
        const msg = document.getElementById(`wl-msg-${id}`);
        const btns = document.querySelectorAll(`[data-wallet-id="${id}"]`);
        const otp = (otpEl?.value || '').trim();
        const showMsg = (text, type) => {
            if (!msg)
                return;
            msg.textContent = text;
            msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
            msg.classList.remove('hidden');
        };
        if (!/^\d{6}$/.test(otp)) {
            showMsg(T('totp_err6'), 'err');
            return;
        }
        btns.forEach(b => { if (b.tagName === 'BUTTON')
            b.disabled = true; });
        try {
            const stepRes = await window.apiFetch('/api/auth/step-up', {
                method: 'POST',
                body: JSON.stringify({ scope: 'elevated:account', for_action: 'unbind_wallet', otp_code: otp }),
            });
            const stepUpToken = stepRes?.step_up_token;
            if (!stepUpToken) {
                showMsg(T('net_err'), 'err');
                btns.forEach(b => { if (b.tagName === 'BUTTON')
                    b.disabled = false; });
                return;
            }
            await window.apiFetch(`/api/auth/wallet/${id}`, {
                method: 'DELETE',
                headers: { Authorization: 'Bearer ' + stepUpToken },
            });
            showBindToast(T('wallet_remove_success'), 'ok');
            loadWallets();
        }
        catch (e) {
            btns.forEach(b => { if (b.tagName === 'BUTTON')
                b.disabled = false; });
            showMsg(window.tApiError(e, T('wallet_remove_fail')), 'err');
        }
    }
    // 用 server 回的欄位拼 SIWE message（spec EIP-4361 嚴格格式）
    function buildSiweMessageClient({ domain, address, uri, chainId, nonce, expiresAt }) {
        const issuedAt = new Date().toISOString();
        // server 給的 expires_at 是 'YYYY-MM-DD HH:MM:SS' UTC，轉 ISO
        const expirationTime = expiresAt
            ? new Date(expiresAt.replace(' ', 'T') + 'Z').toISOString()
            : new Date(Date.now() + 5 * 60_000).toISOString();
        return [
            `${domain} wants you to sign in with your Ethereum account:`,
            address,
            '',
            'Sign in with Ethereum to chiyigo.',
            '',
            `URI: ${uri}`,
            `Version: 1`,
            `Chain ID: ${chainId}`,
            `Nonce: ${nonce}`,
            `Issued At: ${issuedAt}`,
            `Expiration Time: ${expirationTime}`,
        ].join('\n');
    }
    async function addWallet(presetGrant) {
        const provider = walletProvider();
        if (!provider)
            return;
        const btn = document.getElementById('wallet-add-btn');
        const msg = document.getElementById('wallet-add-msg');
        const showMsg = (text, type) => {
            if (!msg)
                return;
            msg.textContent = text;
            msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
            msg.classList.remove('hidden');
        };
        if (btn)
            btn.disabled = true;
        // SEC-FACTOR-ADD Stage 1：綁 wallet = factor-add，先取 elevation grant，再以 header 出示給 wallet/verify。
        // Stage 2：resume 路徑帶 presetGrant（OAuth-reauth exchange 換來的 grant）→ 跳過 modal/reauth。
        const grant = presetGrant ?? await obtainFactorAddGrant('bind_wallet');
        if (!grant) {
            if (btn)
                btn.disabled = false;
            return;
        }
        showMsg(T('wallet_connecting'), 'ok');
        try {
            // 1) 連線 wallet 拿 address
            let accounts;
            try {
                accounts = await provider.request({ method: 'eth_requestAccounts' });
            }
            catch (e) {
                // user reject → 4001
                if (e?.code === 4001 || e?.name === 'AbortError') {
                    showMsg(T('wallet_add_cancelled'), 'err');
                }
                else {
                    showMsg(`${T('wallet_add_fail')}：${e?.message ?? e}`, 'err');
                }
                if (btn)
                    btn.disabled = false;
                return;
            }
            const address = accounts?.[0];
            if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
                showMsg(T('wallet_add_fail'), 'err');
                if (btn)
                    btn.disabled = false;
                return;
            }
            // 2) 拿 nonce + server domain/uri/chain_id
            let nonceRes;
            try {
                nonceRes = await window.apiFetch('/api/auth/wallet/nonce', {
                    method: 'POST',
                    body: JSON.stringify({ address }),
                });
            }
            catch (e) {
                if (e?.code === 'ALREADY_BOUND')
                    showMsg(T('wallet_already_bound'), 'err');
                else
                    showMsg(window.tApiError(e, T('wallet_add_fail')), 'err');
                if (btn)
                    btn.disabled = false;
                return;
            }
            // 3) 組 SIWE message + 請 wallet 簽
            const messageRaw = buildSiweMessageClient({
                domain: nonceRes.domain,
                address,
                uri: nonceRes.uri,
                chainId: nonceRes.chain_id,
                nonce: nonceRes.nonce,
                expiresAt: nonceRes.expires_at,
            });
            showMsg(T('wallet_signing'), 'ok');
            let signature;
            try {
                signature = await provider.request({
                    method: 'personal_sign',
                    params: [messageRaw, address],
                });
            }
            catch (e) {
                if (e?.code === 4001 || e?.name === 'AbortError') {
                    showMsg(T('wallet_add_cancelled'), 'err');
                }
                else {
                    showMsg(`${T('wallet_add_fail')}：${e?.message ?? e}`, 'err');
                }
                if (btn)
                    btn.disabled = false;
                return;
            }
            // 4) verify + bind
            await window.apiFetch('/api/auth/wallet/verify', {
                method: 'POST',
                headers: { 'X-Factor-Add-Grant': grant.grant_token },
                body: JSON.stringify({ message: messageRaw, signature }),
            });
            showMsg(T('wallet_add_success'), 'ok');
            loadWallets();
        }
        catch (e) {
            showMsg(window.tApiError(e, T('wallet_add_fail')), 'err');
        }
        finally {
            if (btn)
                btn.disabled = false;
        }
    }
    // ── Phase F-2 wave 3：付款 / 充值 ──
    const PAY_STATUS_COLOR = {
        pending: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
        processing: 'bg-sky-500/15 border-sky-500/30 text-sky-300',
        succeeded: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
        failed: 'bg-red-500/15 border-red-500/30 text-red-300',
        canceled: 'bg-gray-500/15 border-gray-500/30 text-[var(--text-muted)]',
        refunded: 'bg-gray-500/15 border-gray-500/30 text-[var(--text-muted)]',
    };
    // ── 我的成交紀錄（P1-6，2026-05-06）──
    async function loadDeals() {
        const sec = document.getElementById('deals-section');
        const list = document.getElementById('deals-list');
        if (!sec || !list)
            return;
        try {
            const data = await window.apiFetch('/api/auth/deals?limit=50');
            const rows = data?.rows ?? [];
            if (!rows.length) {
                sec.classList.add('hidden');
                return;
            }
            sec.classList.remove('hidden');
            renderDeals(rows);
        }
        catch (e) {
            sec.classList.remove('hidden');
            list.innerHTML = `<p class="text-xs text-red-400">${esc(window.tApiError(e, T('net_err')))}</p>`;
        }
    }
    function renderDeals(rows) {
        const list = document.getElementById('deals-list');
        if (!list)
            return;
        list.innerHTML = rows.map(d => {
            const total = d.total_amount_subunit != null ? Number(d.total_amount_subunit).toLocaleString() : '—';
            const refunded = d.refunded_amount_subunit && Number(d.refunded_amount_subunit) > 0
                ? Number(d.refunded_amount_subunit).toLocaleString()
                : null;
            const cur = esc(d.currency || 'TWD');
            const dt = d.saved_at
                ? new Date(d.saved_at.replace(' ', 'T') + 'Z').toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '—';
            const reqLine = d.source_requisition_id
                ? `<span class="mono text-[.68rem] text-[var(--text-muted)]">原單 #${d.source_requisition_id}</span>`
                : `<span class="mono text-[.68rem] text-[var(--text-dim)]">原單已歸檔</span>`;
            return `
      <div class="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-bright)] px-4 py-3">
        <div class="flex items-center justify-between gap-3 mb-1.5">
          <span class="text-sm font-semibold text-[var(--text)]">#${d.id} · ${esc(d.service_type || '接案')}</span>
          <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-emerald-500/15 text-emerald-300 border-emerald-500/40">✓ 已成交</span>
        </div>
        <div class="text-xs text-[var(--text-muted)] space-y-0.5">
          <div>客戶：${esc(d.customer_name)}${d.customer_company ? ' · ' + esc(d.customer_company) : ''}</div>
          <div>已收：<span class="mono text-emerald-300">${total} ${cur}</span>${refunded ? ` · 已退：<span class="mono text-orange-300">${refunded} ${cur}</span>` : ''}</div>
          <div class="flex items-center justify-between gap-2 pt-0.5">
            ${reqLine}
            <span class="mono text-[.68rem] text-[var(--text-muted)]">${esc(dt)}</span>
          </div>
        </div>
      </div>
    `;
        }).join('');
    }
    async function loadPayments() {
        const sec = document.getElementById('payments-section');
        const list = document.getElementById('payments-list');
        if (!sec || !list)
            return;
        sec.classList.remove('hidden');
        try {
            const data = await window.apiFetch('/api/auth/payments/intents?limit=50');
            window._lastPayments = data?.items ?? [];
            renderPayments(window._lastPayments);
        }
        catch (e) {
            list.innerHTML = `<p class="text-xs text-red-400">${esc(window.tApiError(e, T('net_err')))}</p>`;
        }
    }
    function renderPayments(items) {
        const list = document.getElementById('payments-list');
        if (!list)
            return;
        if (!items.length) {
            list.innerHTML = `<p class="text-xs text-[var(--text-muted)]">${T('payments_empty')}</p>`;
            return;
        }
        list.innerHTML = items.map(p => {
            const statusClass = PAY_STATUS_COLOR[p.status] || PAY_STATUS_COLOR.pending;
            const statusLabel = T('payment_status_' + p.status) || p.status;
            const kindLabel = T('payment_kind_' + p.kind) || p.kind;
            const amount = p.amount_subunit != null
                ? `${p.amount_subunit.toLocaleString()} ${esc(p.currency || 'TWD')}`
                : (p.amount_raw ? `${esc(p.amount_raw)} ${esc(p.currency || '')}` : '—');
            let metaParsed = null;
            if (p.metadata) {
                try {
                    metaParsed = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
                }
                catch { /* keep null */ }
            }
            const reqId = metaParsed?.requisition_id;
            const reqLine = reqId
                ? `<p class="text-xs text-[var(--text-muted)] mt-0.5">${T('payment_for_requisition')} #${esc(reqId)}</p>`
                : '';
            const when = p.created_at ? formatRelative(p.created_at) : '—';
            // ATM/CVS/條碼 取號資訊（status=processing 才會有）
            let infoBlock = '';
            const info = metaParsed?.payment_info;
            if (info && p.status === 'processing') {
                let lines = '';
                if (info.method === 'atm' && info.bank_code && info.v_account) {
                    lines = `<p>${T('payment_info_atm_bank')}：<span class="font-mono text-amber-300">${esc(info.bank_code)}</span></p>`
                        + `<p>${T('payment_info_atm_account')}：<span class="font-mono text-amber-300 select-all">${esc(info.v_account)}</span></p>`;
                }
                else if (info.method === 'cvs' && info.payment_no) {
                    lines = `<p>${T('payment_info_cvs_no')}：<span class="font-mono text-amber-300 select-all">${esc(info.payment_no)}</span></p>`;
                }
                else if (info.method === 'barcode') {
                    lines = `<p>${T('payment_info_barcode')}：</p>`
                        + `<p class="font-mono text-amber-300 select-all break-all">${esc(info.barcode_1 || '')}</p>`
                        + `<p class="font-mono text-amber-300 select-all break-all">${esc(info.barcode_2 || '')}</p>`
                        + `<p class="font-mono text-amber-300 select-all break-all">${esc(info.barcode_3 || '')}</p>`;
                }
                if (lines) {
                    const expire = info.expire_date ? `<p class="text-[var(--text-muted)]">${T('payment_info_expire')}：${esc(info.expire_date)}</p>` : '';
                    infoBlock = `<div class="mt-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs space-y-1">${lines}${expire}</div>`;
                }
            }
            // 動作按鈕：
            //  - pending / failed / canceled / refunded → 刪除（帳務已結清或從未進帳，可清掉 row）
            //  - succeeded（無 pending refund）→ 退款（綁需求單會連帶把 req 翻 refund_pending；沒綁直接申請）
            //  - succeeded（有 pending refund_request） → 不顯示 button，只顯示「待審核退款」狀態
            const isRefundPending = p.refund_request_status === 'pending';
            // 與後端 USER_DELETABLE 對齊（functions/api/auth/payments/intents/[id].js）
            // refunded 是金流憑證最終態，不允許 user 刪除（admin 也不行，L1.1 原則）
            const canDelete = ['pending', 'failed', 'canceled'].includes(p.status);
            let actionBtn = '';
            if (canDelete) {
                actionBtn = `<button data-pay-del-id="${p.id}" data-armed="0"
           class="shrink-0 px-2 py-1 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs transition-all">刪除</button>`;
            }
            else if (p.status === 'succeeded' && !isRefundPending) {
                actionBtn = `<button data-pay-refund-intent="${p.id}"
           class="shrink-0 px-2 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs transition-all">退款</button>`;
            }
            const delBtn = actionBtn;
            // 退款申請中 → 蓋掉 succeeded 的 status pill；title 顯示申請時間（hover / mobile long-press）
            const refundReqAt = p.refund_request_created_at
                ? new Date(p.refund_request_created_at.replace(' ', 'T') + 'Z').toLocaleString(dateLocale(), { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : null;
            const overrideStatusPill = isRefundPending
                ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-orange-500/15 text-orange-300 border-orange-500/30 cursor-help" title="申請時間：${esc(refundReqAt || '—')}（等候 admin 審核）">退款申請中</span>`
                : null;
            return `
      <div class="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-bright)] px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-[var(--text)]">${esc(kindLabel)} · ${amount}</p>
            <p class="text-xs text-[var(--text-muted)] mt-0.5">${esc(p.vendor)} · ${esc(when)}</p>
            ${reqLine}
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${overrideStatusPill || `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusClass}">${esc(statusLabel)}</span>`}
            ${delBtn}
          </div>
        </div>
        ${infoBlock}
      </div>`;
        }).join('');
    }
    function openPaymentForm() {
        document.getElementById('payment-form')?.classList.remove('hidden');
        document.getElementById('payment-amount')?.focus();
    }
    function cancelPaymentForm() {
        document.getElementById('payment-form')?.classList.add('hidden');
        ['payment-amount', 'payment-desc', 'payment-requisition'].forEach(id => {
            const el = document.getElementById(id);
            if (el)
                el.value = '';
        });
        const methodEl = document.getElementById('payment-method');
        if (methodEl)
            methodEl.value = 'ALL';
        const msg = document.getElementById('payment-form-msg');
        if (msg) {
            msg.classList.add('hidden');
            msg.textContent = '';
        }
    }
    async function submitPaymentCheckout() {
        const amountEl = document.getElementById('payment-amount');
        const methodEl = document.getElementById('payment-method');
        const descEl = document.getElementById('payment-desc');
        const reqEl = document.getElementById('payment-requisition');
        const msg = document.getElementById('payment-form-msg');
        const btn = document.getElementById('payment-submit-btn');
        const label = document.getElementById('payment-submit-label');
        const showMsg = (text, type) => {
            if (!msg)
                return;
            msg.textContent = text;
            msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-emerald-400');
            msg.classList.remove('hidden');
        };
        const amount = Number(amountEl?.value);
        if (!Number.isFinite(amount) || amount < 1 || amount > 200000 || amount !== Math.floor(amount)) {
            showMsg(T('payment_amount_invalid'), 'err');
            return;
        }
        const metadata = {};
        const reqId = Number(reqEl?.value);
        if (Number.isFinite(reqId) && reqId > 0)
            metadata.requisition_id = reqId;
        if (btn)
            btn.disabled = true;
        if (label)
            label.textContent = T('payment_submitting');
        try {
            const resp = await window.apiFetch('/api/auth/payments/checkout/ecpay', {
                method: 'POST',
                body: JSON.stringify({
                    amount,
                    choose_payment: methodEl?.value || 'ALL',
                    trade_desc: (descEl?.value || '').trim() || undefined,
                    item_name: (descEl?.value || '').trim() || undefined,
                    metadata: Object.keys(metadata).length ? metadata : undefined,
                }),
            });
            if (!resp?.checkout_url || !resp?.fields) {
                showMsg(T('payment_create_fail'), 'err');
                if (btn)
                    btn.disabled = false;
                if (label)
                    label.textContent = T('payment_submit_btn');
                return;
            }
            if (label)
                label.textContent = T('payment_redirecting');
            redirectToEcpay(resp.checkout_url, resp.fields);
        }
        catch (e) {
            const fallback = e?.code === 'KYC_REQUIRED'
                ? T('payment_kyc_required')
                : T('payment_create_fail');
            showMsg(window.tApiError(e, fallback), 'err');
            if (btn)
                btn.disabled = false;
            if (label)
                label.textContent = T('payment_submit_btn');
        }
    }
    // 動態建 form 並 submit。CSP 不允許 inline script，所以用 DOM API 不用 innerHTML+eval。
    function redirectToEcpay(url, fields) {
        const form = document.createElement('form');
        form.action = url;
        form.method = 'POST';
        form.acceptCharset = 'UTF-8';
        // 同分頁跳轉：先前嘗試 target="_blank" 開新分頁，但 ECPay 沙箱對 popup
        // 的 3D-Secure 流程會在「交易成功」後直接 window.close()，造成
        // ClientBackURL 沒跳轉、server-to-server ReturnURL 也不發送，整個鏈路斷。
        // 改回同分頁讓 ECPay 完整 redirect → payment-result.html → 自動回 dashboard。
        form.style.display = 'none';
        for (const [k, v] of Object.entries(fields)) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = k;
            input.value = String(v);
            form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
    }
    // 阻擋只為 password manager a11y 而存在的 wrapper form 預設提交（避免 Enter 觸發 reload）
    document.addEventListener('submit', e => {
        if (e.target instanceof HTMLFormElement && e.target.matches('form[data-noop-submit]')) {
            e.preventDefault();
        }
    });
    // ── Phase C-3 unified click delegation ──
    // 用 document-level delegation 統一處理；id 與 data-* 都在這裡分派。
    // 比個別 getElementById().addEventListener 穩：button 即使是動態 render 或 hidden 都 work。
    document.addEventListener('click', e => {
        // 密碼眼睛切換（最先處理；togglePassword/hidePassword 由 auth-ui.js 提供全域函式，不要重複宣告 _pwdTimers）
        const eyeBtn = e.target?.closest('[data-toggle-pwd]');
        if (eyeBtn) {
            togglePassword(eyeBtn.dataset.togglePwd, eyeBtn.dataset.toggleEye);
            return;
        }
        const t = e.target?.closest('button, a, tr, [data-action], [data-revoke-id], [data-req-del-id], [data-unbind], [data-bind], [data-open-modal], [data-load-page], [data-pay-del-id], [data-pay-refund-intent], [data-req-open-id], [data-reverify]');
        if (!t)
            return;
        // List 上的 revoked 永久刪除按鈕（要在 reqOpenId 之前，因為按鈕在 row 內）
        if (t.dataset.reqDelId)
            return armOrConfirmReqListDelete(Number(t.dataset.reqDelId));
        // 點需求單 row 跳明細（點到撤銷/刪除按鈕例外，已被前面 closest 抓到 button）
        if (t.dataset.reqOpenId) {
            return openRequisitionDetail(Number(t.dataset.reqOpenId));
        }
        if (t.dataset.payDelId)
            return armOrConfirmPayDelete(Number(t.dataset.payDelId));
        // succeeded 充值 row 上的「退款」→ 不論有無綁需求單都建 refund_request
        if (t.dataset.payRefundIntent)
            return requestPaymentRefund(Number(t.dataset.payRefundIntent));
        // 靜態按鈕 by id
        if (t.id === 'tfa-enable-btn')
            return startSetup2FA();
        if (t.id === 'tfa-disable-btn')
            return showDisablePanel();
        if (t.id === 'setpw-btn')
            return sendSetPasswordEmail();
        if (t.id === 'resend-btn')
            return sendVerification();
        if (t.id === 'del-open-btn')
            return showDeleteForm();
        if (t.id === 'del-submit-btn')
            return submitDeleteAccount();
        if (t.id === 'passkey-add-btn')
            return addPasskey();
        if (t.id === 'wallet-add-btn')
            return addWallet();
        if (t.id === 'payment-add-btn')
            return openPaymentForm();
        if (t.id === 'payment-submit-btn')
            return submitPaymentCheckout();
        // data-action
        const a = t.dataset.action;
        if (a === 'logout')
            return logout();
        if (a === 'confirm-enable-2fa')
            return confirmEnable2FA();
        if (a === 'confirm-disable-2fa')
            return confirmDisable2FA();
        if (a === 'close-tfa-backup')
            return closeTfaBackup();
        if (a === 'hide-delete-form')
            return hideDeleteForm();
        if (a === 'submit-change-password')
            return submitChangePassword();
        // Phase D-3
        if (a === 'logout-device')
            return logoutDevice(t.dataset.deviceUuid ?? '');
        if (a === 'passkey-remove-open')
            return openPasskeyRemove(t.dataset.passkeyId);
        if (a === 'passkey-remove-cancel')
            return cancelPasskeyRemove(t.dataset.passkeyId);
        if (a === 'passkey-remove-confirm')
            return confirmPasskeyRemove(t.dataset.passkeyId);
        if (a === 'passkey-rename-open')
            return openPasskeyRename(t.dataset.passkeyId);
        if (a === 'passkey-rename-cancel')
            return cancelPasskeyRename(t.dataset.passkeyId);
        if (a === 'passkey-rename-save')
            return savePasskeyRename(t.dataset.passkeyId);
        if (a === 'wallet-remove-open')
            return openWalletRemove(t.dataset.walletId);
        if (a === 'wallet-remove-cancel')
            return cancelWalletRemove(t.dataset.walletId);
        if (a === 'wallet-remove-confirm')
            return confirmWalletRemove(t.dataset.walletId);
        if (a === 'payment-form-cancel')
            return cancelPaymentForm();
        if (a === 'req-detail-close')
            return closeRequisitionDetail();
        if (t.id === 'req-perm-del-btn')
            return armOrConfirmReqPermDelete(Number(t.dataset.reqId));
        // dynamic content
        if (t.dataset.revokeId)
            return armRevoke(Number(t.dataset.revokeId));
        if (t.dataset.unbind)
            return unbindProvider(t.dataset.unbind);
        if (t.dataset.bind)
            return bindProvider(t.dataset.bind);
        if (t.dataset.reverify)
            return reverifyIdentity(t.dataset.reverify, Number(t.dataset.rid));
    });
})();
