// ── block 1/3 ──
// ── i18n ──────────────────────────────────────────────
const LANGS_D = {"zh-TW":{"back_home":"返回首頁","logout_header":"登出","loading_text":"載入中…","lbl_email":"電子信箱","lbl_verified":"Email 驗證","lbl_providers":"登入方式","lbl_created":"加入時間","tfa_title":"雙重驗證（2FA）","tfa_enable_btn":"啟用 2FA","tfa_disable_btn":"停用 2FA","tfa_setup_hint":"用 Google Authenticator 或任何 TOTP App 掃描 QR Code，然後輸入 6 位數驗證碼完成啟用。","tfa_manual_key":"或手動輸入金鑰：","tfa_otp_ph":"輸入 6 位數驗證碼","tfa_confirm_enable":"確認啟用","tfa_confirm_disable":"確認停用","tfa_disable_warn":"停用後需重新設定才能再次啟用。請輸入 Authenticator App 的驗證碼確認。","tfa_backup_warn_pre":"請立即抄下這 10 組備用碼，之後","tfa_backup_warn_em":"無法再次查看","tfa_backup_warn_post":"。每組只能使用一次。","tfa_backup_done":"我已抄寫完畢","email_unverified":"Email 尚未驗證","email_unverified_sub":"驗證後可使用完整帳號功能","resend_btn":"重發驗證信","logout_btn":"登出帳號","load_fail":"載入失敗","relogin_link":"← 重新登入","role_developer":"開發者","role_admin":"管理員","role_moderator":"版主","role_player":"玩家","provider_local":"密碼登入","status_active":"正常","verified_yes":"已驗證","verified_no":"尚未驗證","tfa_badge_on":"已啟用","tfa_badge_off":"未啟用","tfa_text_on":"帳號已受雙重驗證保護","tfa_text_off":"建議啟用以提升帳號安全性","err_profile":"無法載入帳號資訊，請重新整理或重新登入","btn_loading":"請稍候…","btn_sending":"送出中…","resend_sent":"驗證信已送出，請查收信箱（連結 1 小時內有效）。","resend_wait":"請稍候再試。","resend_fail":"發送失敗，請稍後再試。","net_err":"網路錯誤，請稍後再試。","totp_err6":"請輸入 6 位數驗證碼","setup_fail":"設定失敗","enable_fail":"啟用失敗","disable_fail":"停用失敗","err_invalid_otp":"驗證碼錯誤","err_token_revoked":"登入狀態已失效，請重新登入","err_unauthorized":"未授權，請重新登入","err_too_many":"請求次數過多，請稍後再試","err_account_banned":"帳號已停用","err_invalid_password":"密碼錯誤","err_user_not_found":"找不到帳號","resend_timer_label":"重發（${s}s）","req_title":"我的需求單","req_subtitle":"近期提交的接案諮詢","req_new_btn":"提交新單 →","req_empty":"尚無需求單紀錄","req_revoke_note":"如需更改請撤銷需求重新填寫","btn_revoke_confirm":"確認撤銷？","status_pending":"待處理","status_processing":"處理中","status_completed":"已完成","status_revoked":"已撤銷","btn_revoke":"撤銷","btn_processing":"處理中…","msg_revoke_success":"需求單 #${id} 已撤銷","msg_revoke_fail":"撤銷失敗，請重試","bind_title":"帳號綁定","bind_subtitle":"連結第三方帳號以增加登入選項","bind_btn":"綁定","unbind_btn":"解除綁定","bind_success":"${p} 綁定成功","unbind_success":"已解除 ${p} 綁定","bind_fail":"綁定失敗，請重試","unbind_fail":"解除失敗，請重試","unbind_last_method":"請先設定本地密碼或綁定其他帳號後，才能解除此綁定","bind_err_already":"此帳號已綁定","bind_err_taken":"此身分已被其他用戶使用","bind_err_state":"綁定請求已過期，請重試","bind_err_account":"帳號狀態異常，請重新登入","setpw_title":"設定登入密碼","setpw_subtitle":"你目前透過第三方帳號登入。設定密碼後，將擁有後備登入方式，並可執行刪帳等敏感操作。","setpw_btn":"寄送設定密碼信","setpw_sent":"✓ 設定密碼信已寄出，請至 <strong>${email}</strong> 點擊連結完成設定（連結有效 1 小時）。設定完成後請重新整理本頁。","setpw_fail":"寄送失敗，請稍後再試","danger_title":"危險區","danger_subtitle":"永久刪除帳號與所有相關資料，操作不可復原","del_open_btn":"我要刪除帳號","del_need_pw_local":"需先設定登入密碼","del_need_pw":"請先到上方「設定登入密碼」完成密碼設定，才能刪除帳號。","del_stage2_hint":"為防誤刪，請輸入登入密碼確認。送出後會寄送一封確認信到你的信箱，點擊信中連結後帳號才會真的被刪除（連結有效 15 分鐘）。","del_pw_ph":"登入密碼","del_cancel_btn":"取消","del_send_btn":"送出刪除確認信","del_pw_required":"請輸入密碼","del_sent":"✓ 確認信已寄出，請至信箱點擊連結完成刪除（15 分鐘內有效）。","del_err_pw":"密碼錯誤","del_err_account":"找不到帳號","del_err_rate":"請求次數過多，請稍後再試","del_err_cooldown":"請稍候再申請下一封確認信","del_err_send":"寄信失敗，請稍後再試","del_err_unauth":"登入狀態已失效，請重新登入","del_err_generic":"送出失敗（${status}），請稍後再試","footer_tagline":"不是只做漂亮畫面，而是幫你把需求變成真正能用的系統。","footer_contact_title":"聯絡我們","nav_home":"首頁","nav_portfolio":"案例作品","nav_about":"關於我們","nav_contact":"接案諮詢","nav_member_section":"會員功能","nav_overview":"帳號總覽","nav_2fa":"雙重驗證","nav_req":"我的需求單","nav_bind":"帳號綁定","nav_setpw":"設定密碼","nav_danger":"危險區","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","cta_btn_m":"開始諮詢 →","tfa_need_pw_local":"需先設定登入密碼","tfa_need_pw":"請先到上方「設定登入密碼」完成密碼設定，才能啟用 2FA。"},"en":{"back_home":"Back to Home","logout_header":"Log Out","loading_text":"Loading…","lbl_email":"Email","lbl_verified":"Email Verification","lbl_providers":"Login Method","lbl_created":"Joined","tfa_title":"Two-Factor Authentication (2FA)","tfa_enable_btn":"Enable 2FA","tfa_disable_btn":"Disable 2FA","tfa_setup_hint":"Scan the QR Code with Google Authenticator or any TOTP app, then enter the 6-digit code to complete setup.","tfa_manual_key":"Or enter key manually:","tfa_otp_ph":"Enter 6-digit code","tfa_confirm_enable":"Confirm Enable","tfa_confirm_disable":"Confirm Disable","tfa_disable_warn":"After disabling, you must set it up again to re-enable. Enter your authenticator code to confirm.","tfa_backup_warn_pre":"Please copy these 10 backup codes now. They ","tfa_backup_warn_em":"cannot be viewed again","tfa_backup_warn_post":". Each code can only be used once.","tfa_backup_done":"I have saved my codes","email_unverified":"Email Not Verified","email_unverified_sub":"Verify to unlock full account features","resend_btn":"Resend Verification","logout_btn":"Log Out","load_fail":"Failed to load","relogin_link":"← Back to Login","role_developer":"Developer","role_admin":"Admin","role_moderator":"Moderator","role_player":"Player","provider_local":"Password","status_active":"Active","verified_yes":"Verified","verified_no":"Not Verified","tfa_badge_on":"Enabled","tfa_badge_off":"Disabled","tfa_text_on":"Account is protected by 2FA","tfa_text_off":"We recommend enabling 2FA for better security","err_profile":"Unable to load account info. Please refresh or log in again.","btn_loading":"Please wait…","btn_sending":"Sending…","resend_sent":"Verification email sent. Check your inbox (valid for 1 hour).","resend_wait":"Please wait before trying again.","resend_fail":"Send failed, please try again later.","net_err":"Network error, please try again later.","totp_err6":"Please enter a 6-digit code","setup_fail":"Setup failed","enable_fail":"Enable failed","disable_fail":"Disable failed","err_invalid_otp":"Invalid OTP code","err_token_revoked":"Session expired, please log in again","err_unauthorized":"Unauthorized, please log in again","err_too_many":"Too many requests, please try again later","err_account_banned":"Account is banned","err_invalid_password":"Incorrect password","err_user_not_found":"Account not found","resend_timer_label":"Resend (${s}s)","req_title":"My Requisitions","req_subtitle":"Recent project inquiries","req_new_btn":"New Requisition →","req_empty":"No requisitions yet","req_revoke_note":"To make changes, please revoke this requisition and submit a new one.","btn_revoke_confirm":"Confirm revoke?","status_pending":"Pending","status_processing":"Processing","status_completed":"Completed","status_revoked":"Revoked","btn_revoke":"Revoke","btn_processing":"Processing…","msg_revoke_success":"Requisition #${id} revoked","msg_revoke_fail":"Revoke failed, please try again","bind_title":"Account Linking","bind_subtitle":"Link third-party accounts for more login options","bind_btn":"Link","unbind_btn":"Unlink","bind_success":"${p} linked successfully","unbind_success":"${p} unlinked","bind_fail":"Linking failed, please try again","unbind_fail":"Unlinking failed, please try again","unbind_last_method":"Please set a local password or link another account before removing this one","bind_err_already":"Already linked","bind_err_taken":"This identity is already used by another account","bind_err_state":"Linking session expired, please try again","bind_err_account":"Account error, please log in again","setpw_title":"Set Login Password","setpw_subtitle":"You are currently signed in via a third-party account. Setting a password gives you a fallback login method and unlocks sensitive actions such as account deletion.","setpw_btn":"Send password setup email","setpw_sent":"✓ Setup email sent to <strong>${email}</strong>. Click the link to set your password (valid for 1 hour). Refresh this page after.","setpw_fail":"Failed to send, please try again later","danger_title":"Danger Zone","danger_subtitle":"Permanently delete your account and all related data — this cannot be undone.","del_open_btn":"Delete my account","del_need_pw_local":"Set a login password first","del_need_pw":"Please use “Set Login Password” above first before you can delete your account.","del_stage2_hint":"For safety, enter your login password to confirm. We will send a confirmation email; only after you click the link in that email will your account actually be deleted (link valid for 15 minutes).","del_pw_ph":"Login password","del_cancel_btn":"Cancel","del_send_btn":"Send confirmation email","del_pw_required":"Please enter your password","del_sent":"✓ Confirmation email sent. Click the link in your inbox to complete deletion (valid for 15 minutes).","del_err_pw":"Incorrect password","del_err_account":"Account not found","del_err_rate":"Too many requests. Please try again later.","del_err_cooldown":"Please wait before requesting another confirmation email","del_err_send":"Failed to send email, please try again later","del_err_unauth":"Session expired, please log in again","del_err_generic":"Submission failed (${status}), please try again later","footer_tagline":"We don't just build pretty interfaces — we turn your requirements into systems that actually work.","footer_contact_title":"Contact Us","nav_home":"Home","nav_portfolio":"Portfolio","nav_about":"About","nav_contact":"Get a Quote","nav_member_section":"Member","nav_overview":"Overview","nav_2fa":"Two-Factor Auth","nav_req":"My Requisitions","nav_bind":"Account Linking","nav_setpw":"Set Password","nav_danger":"Danger Zone","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get in Touch","cta_btn_m":"Get in Touch →","tfa_need_pw_local":"Set a login password first","tfa_need_pw":"Please use \"Set Login Password\" above first before you can enable 2FA."},"ja":{"back_home":"ホームに戻る","logout_header":"ログアウト","loading_text":"読み込み中…","lbl_email":"メールアドレス","lbl_verified":"Email 認証","lbl_providers":"ログイン方法","lbl_created":"登録日","tfa_title":"二段階認証（2FA）","tfa_enable_btn":"2FAを有効化","tfa_disable_btn":"2FAを無効化","tfa_setup_hint":"Google Authenticatorまたは任意のTOTPアプリでQRコードをスキャンし、6桁のコードを入力して完了してください。","tfa_manual_key":"または手動でキーを入力：","tfa_otp_ph":"6桁のコードを入力","tfa_confirm_enable":"有効化を確認","tfa_confirm_disable":"無効化を確認","tfa_disable_warn":"無効化後は再設定が必要です。確認のためにAuthenticatorコードを入力してください。","tfa_backup_warn_pre":"今すぐこの10組のバックアップコードをメモしてください。","tfa_backup_warn_em":"再表示はできません","tfa_backup_warn_post":"。各コードは1回のみ使用可能です。","tfa_backup_done":"保存しました","email_unverified":"メール未認証","email_unverified_sub":"認証するとすべての機能が使えます","resend_btn":"認証メール再送","logout_btn":"ログアウト","load_fail":"読み込み失敗","relogin_link":"← ログインに戻る","role_developer":"開発者","role_admin":"管理者","role_moderator":"モデレーター","role_player":"プレイヤー","provider_local":"パスワードログイン","status_active":"正常","verified_yes":"認証済み","verified_no":"未認証","tfa_badge_on":"有効","tfa_badge_off":"無効","tfa_text_on":"2FAでアカウントが保護されています","tfa_text_off":"セキュリティ向上のため2FAの有効化を推奨します","err_profile":"アカウント情報を読み込めませんでした。リロードまたは再ログインしてください。","btn_loading":"お待ちください…","btn_sending":"送信中…","resend_sent":"認証メールを送信しました。受信トレイをご確認ください（有効期限1時間）。","resend_wait":"しばらく後でお試しください。","resend_fail":"送信に失敗しました。後でお試しください。","net_err":"ネットワークエラーが発生しました。後でお試しください。","totp_err6":"6桁のコードを入力してください","setup_fail":"設定に失敗しました","enable_fail":"有効化に失敗しました","disable_fail":"無効化に失敗しました","err_invalid_otp":"認証コードが正しくありません","err_token_revoked":"ログインセッションが無効になりました。再度ログインしてください","err_unauthorized":"認証されていません。再度ログインしてください","err_too_many":"リクエストが多すぎます。しばらくしてからお試しください","err_account_banned":"アカウントは停止されています","err_invalid_password":"パスワードが正しくありません","err_user_not_found":"アカウントが見つかりません","resend_timer_label":"再送（${s}s）","req_title":"依頼一覧","req_subtitle":"最近のプロジェクト相談","req_new_btn":"新規依頼 →","req_empty":"依頼の記録はまだありません","req_revoke_note":"内容を変更したい場合は、依頼を取り消して再度ご記入ください。","btn_revoke_confirm":"取り消しますか？","status_pending":"保留中","status_processing":"処理中","status_completed":"完了","status_revoked":"取り消し済み","btn_revoke":"取り消し","btn_processing":"処理中…","msg_revoke_success":"依頼 #${id} を取り消しました","msg_revoke_fail":"取り消しに失敗しました。再試行してください","bind_title":"アカウント連携","bind_subtitle":"外部アカウントを連携してログイン方法を増やす","bind_btn":"連携","unbind_btn":"連携解除","bind_success":"${p}の連携が完了しました","unbind_success":"${p}の連携を解除しました","bind_fail":"連携に失敗しました。再試行してください","unbind_fail":"連携解除に失敗しました。再試行してください","unbind_last_method":"ローカルパスワードを設定するか他のアカウントを連携してから解除してください","bind_err_already":"すでに連携済みです","bind_err_taken":"このアカウントは別のユーザーが使用しています","bind_err_state":"連携セッションが期限切れです。再試行してください","bind_err_account":"アカウント状態に問題があります。再ログインしてください","setpw_title":"ログインパスワードの設定","setpw_subtitle":"現在は外部アカウントでログイン中です。パスワードを設定すると、バックアップのログイン方法が得られ、アカウント削除などの操作が可能になります。","setpw_btn":"パスワード設定メールを送信","setpw_sent":"✓ 設定メールを <strong>${email}</strong> に送信しました。リンクをクリックして設定を完了してください（1時間有効）。完了後、このページを再読み込みしてください。","setpw_fail":"送信に失敗しました。後でお試しください","danger_title":"危険な操作","danger_subtitle":"アカウントとすべての関連データを完全に削除します（取り消し不可）","del_open_btn":"アカウントを削除する","del_need_pw_local":"先にログインパスワードを設定してください","del_need_pw":"削除するには、上の「ログインパスワードの設定」を先に完了してください。","del_stage2_hint":"誤削除防止のため、ログインパスワードを入力してください。送信後に確認メールが届きます。メール内のリンクをクリックすると実際に削除されます（リンクは15分間有効）。","del_pw_ph":"ログインパスワード","del_cancel_btn":"キャンセル","del_send_btn":"削除確認メールを送信","del_pw_required":"パスワードを入力してください","del_sent":"✓ 確認メールを送信しました。受信トレイのリンクをクリックして削除を完了してください（15分間有効）。","del_err_pw":"パスワードが正しくありません","del_err_account":"アカウントが見つかりません","del_err_rate":"リクエストが多すぎます。後でお試しください。","del_err_cooldown":"次の確認メールを送るまで少しお待ちください","del_err_send":"メール送信に失敗しました。後でお試しください","del_err_unauth":"セッションが切れました。再ログインしてください","del_err_generic":"送信に失敗しました（${status}）。後でお試しください","footer_tagline":"見た目だけのサイトではなく、本当に使えるシステムを形にします。","footer_contact_title":"お問い合わせ","nav_home":"ホーム","nav_portfolio":"実績","nav_about":"私たちについて","nav_contact":"お見積り","nav_member_section":"マイページ","nav_overview":"アカウント概要","nav_2fa":"二段階認証","nav_req":"依頼一覧","nav_bind":"アカウント連携","nav_setpw":"パスワード設定","nav_danger":"危険な操作","cta_desc":"最適なデジタルソリューションを一緒に作りましょう！","cta_btn":"相談する","cta_btn_m":"相談する →","tfa_need_pw_local":"先にログインパスワードを設定してください","tfa_need_pw":"2FAを有効化するには、上の「ログインパスワードの設定」を先に完了してください。"},"ko":{"back_home":"홈으로 돌아가기","logout_header":"로그아웃","loading_text":"로딩 중…","lbl_email":"이메일","lbl_verified":"이메일 인증","lbl_providers":"로그인 방법","lbl_created":"가입일","tfa_title":"이중 인증（2FA）","tfa_enable_btn":"2FA 활성화","tfa_disable_btn":"2FA 비활성화","tfa_setup_hint":"Google Authenticator 또는 TOTP 앱으로 QR 코드를 스캔한 후, 6자리 코드를 입력하여 설정을 완료하세요.","tfa_manual_key":"또는 키를 직접 입력:","tfa_otp_ph":"6자리 코드 입력","tfa_confirm_enable":"활성화 확인","tfa_confirm_disable":"비활성화 확인","tfa_disable_warn":"비활성화 후 다시 설정해야 재활성화할 수 있습니다. 인증 코드를 입력하여 확인하세요.","tfa_backup_warn_pre":"지금 바로 이 10개의 백업 코드를 기록해 두세요. ","tfa_backup_warn_em":"다시 볼 수 없습니다","tfa_backup_warn_post":". 각 코드는 한 번만 사용 가능합니다.","tfa_backup_done":"저장 완료","email_unverified":"이메일 미인증","email_unverified_sub":"인증 후 모든 기능을 사용할 수 있습니다","resend_btn":"인증 메일 재발송","logout_btn":"로그아웃","load_fail":"로드 실패","relogin_link":"← 다시 로그인","role_developer":"개발자","role_admin":"관리자","role_moderator":"모더레이터","role_player":"플레이어","provider_local":"비밀번호 로그인","status_active":"정상","verified_yes":"인증됨","verified_no":"미인증","tfa_badge_on":"활성화됨","tfa_badge_off":"비활성화됨","tfa_text_on":"계정이 2FA로 보호되고 있습니다","tfa_text_off":"보안 강화를 위해 2FA 활성화를 권장합니다","err_profile":"계정 정보를 불러올 수 없습니다. 새로고침하거나 다시 로그인해 주세요.","btn_loading":"잠시만요…","btn_sending":"전송 중…","resend_sent":"인증 메일이 전송되었습니다. 받은 편지함을 확인하세요（1시간 유효）。","resend_wait":"잠시 후 다시 시도해 주세요.","resend_fail":"전송 실패. 나중에 다시 시도해 주세요.","net_err":"네트워크 오류. 나중에 다시 시도해 주세요.","totp_err6":"6자리 코드를 입력해 주세요","setup_fail":"설정 실패","enable_fail":"활성화 실패","disable_fail":"비활성화 실패","err_invalid_otp":"인증 코드가 올바르지 않습니다","err_token_revoked":"로그인 세션이 만료되었습니다. 다시 로그인해 주세요","err_unauthorized":"인증되지 않았습니다. 다시 로그인해 주세요","err_too_many":"요청이 너무 많습니다. 잠시 후 다시 시도해 주세요","err_account_banned":"계정이 정지되었습니다","err_invalid_password":"비밀번호가 올바르지 않습니다","err_user_not_found":"계정을 찾을 수 없습니다","resend_timer_label":"재발송（${s}s）","req_title":"내 요청서","req_subtitle":"최근 프로젝트 문의","req_new_btn":"새 요청서 →","req_empty":"요청서 기록이 없습니다","req_revoke_note":"내용을 수정하려면 요청을 취소하고 다시 작성해 주세요.","btn_revoke_confirm":"취소하시겠습니까?","status_pending":"대기 중","status_processing":"처리 중","status_completed":"완료","status_revoked":"취소됨","btn_revoke":"취소","btn_processing":"처리 중…","msg_revoke_success":"요청서 #${id} 취소됨","msg_revoke_fail":"취소 실패. 다시 시도해 주세요","bind_title":"계정 연동","bind_subtitle":"서드파티 계정을 연동하여 로그인 옵션을 추가하세요","bind_btn":"연동","unbind_btn":"연동 해제","bind_success":"${p} 연동 완료","unbind_success":"${p} 연동이 해제되었습니다","bind_fail":"연동 실패. 다시 시도해 주세요","unbind_fail":"연동 해제 실패. 다시 시도해 주세요","unbind_last_method":"로컬 비밀번호를 설정하거나 다른 계정을 연동한 후 해제하세요","bind_err_already":"이미 연동되어 있습니다","bind_err_taken":"이 계정은 이미 다른 사용자가 사용 중입니다","bind_err_state":"연동 세션이 만료되었습니다. 다시 시도해 주세요","bind_err_account":"계정 오류. 다시 로그인하세요","setpw_title":"로그인 비밀번호 설정","setpw_subtitle":"현재 서드파티 계정으로 로그인 중입니다. 비밀번호를 설정하면 대체 로그인 수단이 생기고, 계정 삭제 등 민감한 작업을 수행할 수 있습니다.","setpw_btn":"비밀번호 설정 메일 발송","setpw_sent":"✓ 설정 메일을 <strong>${email}</strong>(으)로 발송했습니다. 링크를 클릭해 설정을 완료하세요（1시간 유효）. 완료 후 페이지를 새로고침하세요.","setpw_fail":"발송 실패. 나중에 다시 시도해 주세요","danger_title":"위험 영역","danger_subtitle":"계정과 모든 관련 데이터를 영구 삭제합니다（되돌릴 수 없음）","del_open_btn":"계정 삭제","del_need_pw_local":"먼저 로그인 비밀번호를 설정하세요","del_need_pw":"삭제하려면 위의 \"로그인 비밀번호 설정\"을 먼저 완료하세요.","del_stage2_hint":"오삭제 방지를 위해 로그인 비밀번호를 입력하세요. 제출 후 확인 메일이 발송됩니다. 메일의 링크를 클릭해야 실제로 삭제됩니다（링크 15분 유효）.","del_pw_ph":"로그인 비밀번호","del_cancel_btn":"취소","del_send_btn":"삭제 확인 메일 발송","del_pw_required":"비밀번호를 입력해 주세요","del_sent":"✓ 확인 메일이 발송되었습니다. 받은 편지함에서 링크를 클릭해 삭제를 완료하세요（15분 유효）.","del_err_pw":"비밀번호가 올바르지 않습니다","del_err_account":"계정을 찾을 수 없습니다","del_err_rate":"요청이 너무 많습니다. 나중에 다시 시도해 주세요.","del_err_cooldown":"다음 확인 메일 요청까지 잠시 기다려 주세요","del_err_send":"메일 발송 실패. 나중에 다시 시도해 주세요","del_err_unauth":"세션이 만료되었습니다. 다시 로그인해 주세요","del_err_generic":"전송 실패（${status}）. 나중에 다시 시도해 주세요","footer_tagline":"예쁜 화면만 만드는 게 아니라, 실제로 동작하는 시스템을 구현합니다.","footer_contact_title":"문의하기","nav_home":"홈","nav_portfolio":"포트폴리오","nav_about":"소개","nav_contact":"문의/견적","nav_member_section":"마이페이지","nav_overview":"계정 개요","nav_2fa":"이중 인증","nav_req":"내 요청서","nav_bind":"계정 연동","nav_setpw":"비밀번호 설정","nav_danger":"위험 영역","cta_desc":"최적의 디지털 솔루션을 함께 만들어보세요!","cta_btn":"상담 시작","cta_btn_m":"상담 시작 →","tfa_need_pw_local":"먼저 로그인 비밀번호를 설정하세요","tfa_need_pw":"2FA를 활성화하려면 위의 \"로그인 비밀번호 설정\"을 먼저 완료하세요."}};

let curLangD = localStorage.getItem('lang') || 'zh-TW';
function T(key) { return (LANGS_D[curLangD] || LANGS_D['zh-TW'])[key] ?? (LANGS_D['zh-TW'][key] ?? key); }

function applyLangD(lang) {
  curLangD = lang;
  localStorage.setItem('lang', lang);
  const t = LANGS_D[lang] || LANGS_D['zh-TW'];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n; if (t[k] !== undefined) el.textContent = t[k];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const k = el.dataset.i18nPh; if (t[k] !== undefined) el.placeholder = t[k];
  });
  document.querySelectorAll('.db-lang-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  // re-render any already-rendered dynamic UI
  const tfaBadge = document.getElementById('tfa-badge');
  const tfaText  = document.getElementById('tfa-status-text');
  if (tfaBadge && tfaBadge.dataset.tfaState) {
    const on = tfaBadge.dataset.tfaState === 'on';
    tfaBadge.textContent = on ? T('tfa_badge_on') : T('tfa_badge_off');
    if (tfaText) tfaText.textContent = on ? T('tfa_text_on') : T('tfa_text_off');
  }
  // 加入時間：依當前語系重新格式化
  const createdEl = document.getElementById('info-created');
  if (createdEl?.dataset.raw) createdEl.textContent = formatDate(createdEl.dataset.raw);
  // 需求單列表：以最後一次 fetch 結果重畫（變數宣告在後段，用 window 規避 TDZ）
  if (window._lastRequisitions) renderRequisitions(window._lastRequisitions);
  // 刪帳按鈕 / 2FA enable label 隨 hasPassword 動態切換，需在 i18n 套用後重畫
  if (typeof window.__hasPassword !== 'undefined') {
    if (typeof renderDeleteSection === 'function') renderDeleteSection(window.__hasPassword);
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
  const opt = e.target.closest('.db-lang-opt'); if (!opt) return;
  applyLangD(opt.dataset.lang);
  dbLangDrop.classList.remove('open');
});
document.addEventListener('click', () => dbLangDrop?.classList.remove('open'));
applyLangD(curLangD);

const ROLE_STYLE = {
  developer: 'bg-purple-500/15 text-purple-300 border border-purple-500/20',
  admin:     'bg-red-500/15 text-red-300 border border-red-500/20',
  moderator: 'bg-amber-500/15 text-amber-300 border border-amber-500/20',
  player:    'bg-brand-500/15 text-brand-300 border border-brand-500/20',
};

function dateLocale() {
  // 對應 Intl.DateTimeFormat 可接受的 locale；'zh-TW' 直接用，其餘 BCP-47 通用
  return curLangD === 'zh-TW' ? 'zh-TW' : curLangD;
}
function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(dateLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
}
function formatDateShort(str) {
  if (!str) return '—';
  const d = new Date(str.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(dateLocale(), { month: 'numeric', day: 'numeric' });
}

async function loadProfile() {
  const token = sessionStorage.getItem('access_token');
  if (!token) { window.location.href = '/login.html'; return; }

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

    if (res.status === 403) {
      sessionStorage.removeItem('access_token');
      window.location.href = '/login.html';
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('[loadProfile] non-ok', res.status, body, 'traceId=', res.headers.get('X-Request-Id'));
      throw new Error(body.error || ('HTTP ' + res.status));
    }

    const data = await res.json();

    document.getElementById('user-email').textContent   = data.email;
    document.getElementById('info-email').textContent   = data.email;
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
    verifiedEl.className   = 'text-sm font-medium ' + (data.email_verified ? 'text-green-400' : 'text-amber-400');

    document.getElementById('email-banner').classList.toggle('hidden', !!data.email_verified);

    const providersEl = document.getElementById('info-providers');
    const PROVIDER_ICON_FN = (p) => p === 'discord'
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[#5865F2]/15 text-[#5865F2] border border-[#5865F2]/20">Discord</span>`
      : p === 'local'
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gray-500/15 text-gray-300 border border-gray-500/20">${T('provider_local')}</span>`
      : `<span class="text-xs text-gray-500">${p}</span>`;
    const icons = (data.identities ?? []).map(i => PROVIDER_ICON_FN(i.provider));
    if (icons.length === 0) icons.push(PROVIDER_ICON_FN('local'));
    providersEl.innerHTML = icons.join('');

    // 2FA 區塊
    render2FASection(data.totp_enabled ?? false, !!data.has_password);

    // 帳號綁定區塊
    renderBindingSection(data.identities ?? []);

    // 設密碼 / 刪帳號：依是否設過密碼決定 UI
    window.__hasPassword = !!data.has_password;
    window.__userEmail   = data.email;
    renderSetPasswordSection(window.__hasPassword);
    renderDeleteSection(window.__hasPassword);

    // 需求單區塊
    loadRequisitions();

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('user-card').classList.remove('hidden');

  } catch (e) {
    console.warn('[loadProfile] catch', e);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-card').classList.remove('hidden');
    const detail = e?.message ? `${T('err_profile')}（${e.message}）` : T('err_profile');
    document.getElementById('error-msg').textContent = detail;
  }
}

loadProfile();

// ── HTML 轉義 helper（防 XSS）────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

// ── 後端英文錯誤訊息 → i18n key（dashboard 共用映射）──────────
const BACKEND_ERR_MAP = {
  'Invalid OTP code':            'err_invalid_otp',
  'Invalid OTP or backup code':  'err_invalid_otp',
  'Token revoked':               'err_token_revoked',
  'Unauthorized':                'err_unauthorized',
  'Too many requests':           'err_too_many',
  'Too many requests. Please try again later.': 'err_too_many',
  'Account is banned':           'err_account_banned',
  'Incorrect password':          'err_invalid_password',
  'Account not found':           'err_user_not_found',
}
// 把 ApiError 翻成本地化 + traceId 字串；非 ApiError 退回 fallback
function tApiError(e, fallback) {
  if (!(e instanceof ApiError) || e.status === 0) return fallback
  const k    = BACKEND_ERR_MAP[e.body?.error]
  const base = k ? T(k) : (e.message ?? fallback)
  return e.traceId ? `${base}（#${e.traceId}）` : base
}

// ── 需求單 ───────────────────────────────────────────────────

const REQ_STATUS_CLS = {
  pending:    'bg-amber-500/15 text-amber-300 border border-amber-500/20',
  revoked:    'bg-gray-500/15 text-gray-500 border border-gray-500/20',
  processing: 'bg-blue-500/15 text-blue-300 border border-blue-500/20',
  completed:  'bg-green-500/15 text-green-300 border border-green-500/20',
}
function reqStatus(key) {
  return { text: T('status_' + key), cls: REQ_STATUS_CLS[key] ?? REQ_STATUS_CLS.pending }
}
window._lastRequisitions = null;

async function loadRequisitions() {
  if (!sessionStorage.getItem('access_token')) return
  try {
    const { requisitions } = await apiFetch('/api/requisition/me')
    renderRequisitions(requisitions)
  } catch { /* 非必要區塊，靜默失敗 */ }
}

function renderRequisitions(list) {
  window._lastRequisitions = list
  const section  = document.getElementById('req-section')
  const listEl   = document.getElementById('req-list')
  const emptyEl  = document.getElementById('req-empty')
  const noteEl   = document.getElementById('req-revoke-note')
  if (!list || list.length === 0) {
    emptyEl.classList.remove('hidden')
    listEl.innerHTML = ''
    if (noteEl) noteEl.classList.add('hidden')
    section.classList.remove('hidden')
    return
  }
  emptyEl.classList.add('hidden')
  const hasPending = list.some(r => r.status === 'pending')
  if (noteEl) noteEl.classList.toggle('hidden', !hasPending)
  listEl.innerHTML = list.map(r => {
    const s    = reqStatus(r.status)
    const date = formatDateShort(r.created_at)
    return `
      <div class="flex items-center justify-between px-5 py-3.5 gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-xs text-gray-600 shrink-0">#${r.id}</span>
          <span class="text-sm text-white truncate">${esc(r.service_type)}</span>
          <span class="text-xs text-gray-500 shrink-0">${date}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${s.cls}">${s.text}</span>
          ${r.status === 'pending'
            ? `<button id="revoke-btn-${r.id}" data-armed="0" data-revoke-id="${r.id}"
                 class="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all">
                 ${T('btn_revoke')}
               </button>`
            : ''}
        </div>
      </div>`
  }).join('')
  section.classList.remove('hidden')
}

// 兩步撤銷：第一次點擊變成「確認撤銷」，再點才真正執行；4 秒未確認自動還原
let _revokeArmTimer = null
function disarmRevoke(id) {
  const btn = document.getElementById(`revoke-btn-${id}`)
  if (!btn) return
  btn.dataset.armed = '0'
  btn.textContent = T('btn_revoke')
  btn.className = 'px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all'
  if (_revokeArmTimer) { clearTimeout(_revokeArmTimer); _revokeArmTimer = null }
}
function armRevoke(id) {
  const btn = document.getElementById(`revoke-btn-${id}`)
  if (!btn) return
  if (btn.dataset.armed === '1') {
    revokeRequisition(id)
    return
  }
  // 先還原其他可能已 arm 的按鈕
  document.querySelectorAll('[id^="revoke-btn-"]').forEach(b => {
    if (b !== btn && b.dataset.armed === '1') {
      const otherId = b.id.replace('revoke-btn-', '')
      disarmRevoke(otherId)
    }
  })
  btn.dataset.armed = '1'
  btn.textContent = T('btn_revoke_confirm')
  btn.className = 'px-2.5 py-1 rounded-lg bg-red-500/30 hover:bg-red-500/40 border border-red-500/50 text-red-200 text-xs font-semibold transition-all'
  if (_revokeArmTimer) clearTimeout(_revokeArmTimer)
  _revokeArmTimer = setTimeout(() => disarmRevoke(id), 4000)
}

async function revokeRequisition(id) {
  const btn = document.getElementById(`revoke-btn-${id}`)
  if (_revokeArmTimer) { clearTimeout(_revokeArmTimer); _revokeArmTimer = null }
  if (btn) { btn.disabled = true; btn.textContent = T('btn_processing') }
  try {
    await apiFetch('/api/requisition/revoke', {
      method: 'POST',
      body:   JSON.stringify({ requisition_id: id }),
    })
    showBindToast(T('msg_revoke_success').replace('${id}', id), 'ok')
    loadRequisitions()
  } catch (e) {
    showBindToast(tApiError(e, T('net_err')), 'err')
    if (btn) { btn.disabled = false; btn.textContent = T('btn_revoke') }
  }
}

// ── 綁定結果 URL 參數處理（OAuth callback 跳回後顯示 Toast）───
;(function checkBindResult() {
  const sp = new URLSearchParams(location.search);
  const bindOk    = sp.get('bind');
  const bindError = sp.get('bind_error');
  const provider  = sp.get('provider') ?? '';
  if (!bindOk && !bindError) return;
  history.replaceState(null, '', '/dashboard.html');
  const ERR_KEY = {
    already_linked:  'bind_err_already',
    identity_taken:  'bind_err_taken',
    invalid_state:   'bind_err_state',
    account_invalid: 'bind_err_account',
  };
  setTimeout(() => {
    if (bindOk === 'success') {
      showBindToast(T('bind_success').replace('${p}', provider || ''), 'ok');
    } else {
      showBindToast(T(ERR_KEY[bindError] ?? 'bind_fail'), 'err');
    }
  }, 600);
})();

// ── 帳號綁定 ─────────────────────────────────────────────────

const BIND_PROVIDERS = [
  { id: 'google',   label: 'Google',   color: '#ea4335' },
  { id: 'discord',  label: 'Discord',  color: '#5865F2' },
  { id: 'line',     label: 'LINE',     color: '#06c755' },
  { id: 'facebook', label: 'Facebook', color: '#1877f2' },
];

function renderBindingSection(identities) {
  const linkedSet = new Set((identities ?? []).map(i => i.provider));
  const list = document.getElementById('bind-list');
  list.innerHTML = BIND_PROVIDERS.map(({ id, label, color }) => {
    const linked      = linkedSet.has(id);
    const identity    = (identities ?? []).find(i => i.provider === id);
    const displayName = identity?.display_name ?? '';
    const dot         = `<span class="inline-block w-2 h-2 rounded-full mr-2 bind-dot" data-provider="${id}"></span>`;
    return `
      <div class="flex items-center justify-between px-5 py-3.5">
        <div class="flex items-center gap-2 min-w-0">
          ${dot}
          <span class="text-sm font-medium text-white">${label}</span>
          ${linked && displayName
            ? `<span class="text-xs text-gray-500 truncate max-w-[120px]">${esc(displayName)}</span>`
            : ''}
        </div>
        ${linked
          ? `<button id="unbind-btn-${id}" data-unbind="${id}" data-i18n="unbind_btn"
               class="shrink-0 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all">
               ${T('unbind_btn')}
             </button>`
          : `<button id="bind-btn-${id}" data-bind="${id}" data-i18n="bind_btn"
               class="shrink-0 px-3 py-1.5 rounded-lg bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 text-brand-400 text-xs font-semibold transition-all">
               ${T('bind_btn')}
             </button>`
        }
      </div>`;
  }).join('');
  document.getElementById('bind-section').classList.remove('hidden');
}

async function bindProvider(provider) {
  const btn = document.getElementById(`bind-btn-${provider}`);
  if (btn) { btn.disabled = true; btn.textContent = T('btn_loading'); }
  try {
    const data = await apiFetch(`/api/auth/oauth/${provider}/init?is_binding=true`);
    if (!data?.redirect_url) {
      showBindToast(T('bind_fail'), 'err');
      if (btn) { btn.disabled = false; btn.textContent = T('bind_btn'); }
      return;
    }
    window.location.href = data.redirect_url;
  } catch (e) {
    showBindToast(tApiError(e, T('net_err')), 'err');
    if (btn) { btn.disabled = false; btn.textContent = T('bind_btn'); }
  }
}

async function unbindProvider(provider) {
  const btn = document.getElementById(`unbind-btn-${provider}`);
  if (btn) { btn.disabled = true; btn.textContent = T('btn_loading'); }
  try {
    await apiFetch('/api/auth/identity/unbind', {
      method: 'POST',
      body:   JSON.stringify({ provider }),
    });
    showBindToast(T('unbind_success').replace('${p}', provider), 'ok');
    loadProfile();
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      const msg = e.traceId ? `${T('unbind_last_method')}（#${e.traceId}）` : T('unbind_last_method');
      showBindToast(msg, 'warn');
    } else {
      showBindToast(tApiError(e, T('net_err')), 'err');
    }
    if (btn) { btn.disabled = false; btn.textContent = T('unbind_btn'); }
  }
}

let _toastTimer;
function showBindToast(msg, type) {
  const el = document.getElementById('bind-toast');
  el.textContent = msg;
  el.className = [
    'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl whitespace-nowrap pointer-events-none',
    type === 'ok'   ? 'bg-green-500/20 text-green-300 border border-green-500/30' :
    type === 'warn' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                      'bg-red-500/20 text-red-300 border border-red-500/30',
  ].join(' ');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className += ' opacity-0'; }, 3200);
}

// ── 2FA 管理 ─────────────────────────────────────────────────

function render2FASection(enabled, hasPw) {
  document.getElementById('tfa-section').classList.remove('hidden');
  const badge      = document.getElementById('tfa-badge');
  const text       = document.getElementById('tfa-status-text');
  const enableBtn  = document.getElementById('tfa-enable-btn');
  const enableLbl  = document.getElementById('tfa-enable-label');
  const disableBtn = document.getElementById('tfa-disable-btn');
  const needPw     = document.getElementById('tfa-need-pw');
  badge.dataset.tfaState = enabled ? 'on' : 'off';
  if (enabled) {
    badge.textContent  = T('tfa_badge_on');
    badge.className    = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-green-500/15 text-green-300 border border-green-500/20';
    text.textContent   = T('tfa_text_on');
    enableBtn.classList.add('hidden');
    disableBtn.classList.remove('hidden');
    needPw.classList.add('hidden');
  } else {
    badge.textContent  = T('tfa_badge_off');
    badge.className    = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-500/15 text-gray-400 border border-gray-500/20';
    text.textContent   = T('tfa_text_off');
    enableBtn.classList.remove('hidden');
    disableBtn.classList.add('hidden');
    if (hasPw) {
      enableBtn.disabled    = false;
      enableLbl.textContent = T('tfa_enable_btn');
      needPw.classList.add('hidden');
    } else {
      enableBtn.disabled    = true;
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
  btn.disabled = true; btn.querySelector('[data-i18n]').textContent = T('btn_loading');
  try {
    const data = await apiFetch('/api/auth/2fa/setup', { method: 'POST', body: '{}' });
    document.getElementById('tfa-secret').textContent = data.secret;
    await QRCode.toCanvas(document.getElementById('tfa-qr'), data.otpauth_uri, { width: 180, margin: 1 });
    document.getElementById('tfa-setup-panel').classList.remove('hidden');
    document.getElementById('tfa-otp-input').value = '';
    document.getElementById('tfa-setup-msg').classList.add('hidden');
  } catch (e) {
    alert(tApiError(e, T('net_err')));
  }
  btn.disabled = false; btn.querySelector('[data-i18n]').textContent = T('tfa_enable_btn');
}

async function confirmEnable2FA() {
  const otp = document.getElementById('tfa-otp-input').value.trim();
  const msg = document.getElementById('tfa-setup-msg');
  if (!/^\d{6}$/.test(otp)) { showTfaMsg(msg, T('totp_err6'), 'err'); return; }
  try {
    const data = await apiFetch('/api/auth/2fa/activate', {
      method: 'POST',
      body:   JSON.stringify({ otp_code: otp }),
    });
    const codesEl = document.getElementById('tfa-backup-codes');
    codesEl.innerHTML = data.backup_codes.map(c =>
      `<code class="block text-center text-xs font-mono bg-[#0e0e12] border border-[#2a2a35] rounded-lg px-2 py-1.5 text-gray-300 select-all">${c}</code>`
    ).join('');
    render2FASection(true);
    document.getElementById('tfa-setup-panel').classList.add('hidden');
    document.getElementById('tfa-backup-panel').classList.remove('hidden');
  } catch (e) {
    showTfaMsg(msg, tApiError(e, T('net_err')), 'err');
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
  const otp = document.getElementById('tfa-disable-input').value.trim();
  const msg = document.getElementById('tfa-disable-msg');
  if (!/^\d{6}$/.test(otp)) { showTfaMsg(msg, T('totp_err6'), 'err'); return; }
  try {
    await apiFetch('/api/auth/2fa/disable', {
      method: 'POST',
      body:   JSON.stringify({ otp_code: otp }),
    });
    render2FASection(false);
  } catch (e) {
    showTfaMsg(msg, tApiError(e, T('net_err')), 'err');
  }
}

function showTfaMsg(el, text, type) {
  el.textContent = text;
  el.className   = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
}

async function sendVerification() {
  const btn = document.getElementById('resend-btn');
  if (!sessionStorage.getItem('access_token')) { window.location.href = '/login.html'; return; }

  btn.disabled = true;
  btn.querySelector('[data-i18n]').textContent = T('btn_sending');
  document.getElementById('resend-msg').className = 'hidden text-xs mt-2';

  try {
    await apiFetch('/api/auth/email/send-verification', { method: 'POST', body: '{}' });
    showResendMsg(T('resend_sent'), 'ok');
    startResendCooldown(60);
  } catch (e) {
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
    showResendMsg(tApiError(e, T('net_err')), 'err');
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
    } else {
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
  if (!event.persisted) return;
  if (!sessionStorage.getItem('access_token')) {
    window.location.replace('/login.html');
  } else {
    loadProfile();
  }
});

// ── 主題切換（與 login.html 對齊：localStorage key='theme', value='dark'|'light'）
(function initTheme() {
  const root = document.documentElement;
  function apply(isDark) {
    root.classList.toggle('theme-dark',  isDark);
    root.classList.toggle('theme-light', !isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }
  const btn = document.getElementById('db-theme-btn');
  if (btn) btn.addEventListener('click', () => {
    apply(!root.classList.contains('theme-dark'));
  });
})();

// ── 設定登入密碼（OAuth-only）────────────────────────────
function renderSetPasswordSection(hasPw) {
  const sec = document.getElementById('setpw-section');
  if (!sec) return;
  sec.classList.toggle('hidden', !!hasPw);
}
async function sendSetPasswordEmail() {
  const btn = document.getElementById('setpw-btn');
  const msg = document.getElementById('setpw-msg');
  msg.classList.add('hidden');
  msg.textContent = '';
  btn.disabled = true;
  try {
    await apiFetch('/api/auth/local/forgot-password', {
      method: 'POST',
      body:   JSON.stringify({ email: window.__userEmail }),
    });
    msg.innerHTML = T('setpw_sent').replace('${email}', esc(window.__userEmail));
    msg.className = 'text-xs text-emerald-400';
    msg.classList.remove('hidden');
    // 60 秒冷卻保護
    setTimeout(() => { btn.disabled = false; }, 60000);
  } catch (e) {
    msg.textContent = tApiError(e, T('net_err'));
    msg.className = 'text-xs text-red-400';
    msg.classList.remove('hidden');
    btn.disabled = false;
  }
}

// ── 刪除帳號 ─────────────────────────────────────────────
function renderDeleteSection(hasPw) {
  const btn   = document.getElementById('del-open-btn');
  const label = document.getElementById('del-open-label');
  const hint  = document.getElementById('del-need-pw');
  if (!btn) return;
  if (hasPw) {
    btn.disabled = false;
    label.textContent = T('del_open_btn');
    hint.classList.add('hidden');
  } else {
    btn.disabled = true;
    label.textContent = T('del_need_pw_local');
    hint.classList.remove('hidden');
  }
}
function showDeleteForm() {
  if (!window.__hasPassword) return;
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
  'Incorrect password':                                                 'del_err_pw',
  'Account not found':                                                  'del_err_account',
  'Too many requests. Please try again later.':                         'del_err_rate',
  'Please wait before requesting another confirmation email':           'del_err_cooldown',
  'Failed to send confirmation email, please try again later':          'del_err_send',
  'password is required':                                               'del_pw_required',
  'Unauthorized':                                                       'del_err_unauth',
};
async function submitDeleteAccount() {
  const pw   = document.getElementById('del-password').value;
  const msg  = document.getElementById('del-msg');
  const btn  = document.getElementById('del-submit-btn');
  msg.classList.add('hidden');
  msg.textContent = '';
  if (!pw) {
    msg.textContent = T('del_pw_required');
    msg.className = 'text-xs text-red-400';
    msg.classList.remove('hidden');
    return;
  }
  btn.disabled = true;
  try {
    await apiFetch('/api/auth/delete', {
      method: 'POST',
      body:   JSON.stringify({ password: pw }),
    });
    msg.innerHTML = T('del_sent');
    msg.className = 'text-xs text-emerald-400';
    msg.classList.remove('hidden');
    document.getElementById('del-password').value = '';
  } catch (e) {
    if (e instanceof ApiError && e.status > 0) {
      // 先試 delete 專用映射，再退回全域 BACKEND_ERR_MAP
      const k = DEL_ERR_MAP[e.body?.error] || BACKEND_ERR_MAP[e.body?.error];
      const base = k ? T(k) : T('del_err_generic').replace('${status}', e.status);
      msg.textContent = e.traceId ? `${base}（#${e.traceId}）` : base;
      console.warn('[delete-account]', e.status, e.body, 'traceId=', e.traceId);
    } else {
      msg.textContent = T('net_err');
    }
    msg.className = 'text-xs text-red-400';
    msg.classList.remove('hidden');
    btn.disabled = false;
  }
}

// ── block 2/3 ──
// Sidebar / mobile-overlay nav: scroll to section + active state
(function() {
  const sbItems = document.querySelectorAll('.sb-item[data-scroll], .m-ov-item[data-scroll]');
  sbItems.forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.scroll;
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior:'smooth', block:'start' });
    document.querySelectorAll('.sb-item[data-scroll]').forEach(b => b.classList.toggle('active', b.dataset.scroll === id));
    document.querySelectorAll('.m-ov-item[data-scroll]').forEach(b => b.classList.toggle('active', b.dataset.scroll === id));
  }));
})();

// Mobile overlay open/close
(function() {
  const ham = document.getElementById('m-ham-btn');
  const ov  = document.getElementById('m-overlay');
  const open = () => { ham?.classList.add('is-open'); ham?.setAttribute('aria-expanded','true'); ov?.classList.add('is-open'); ov?.removeAttribute('aria-hidden'); document.body.style.overflow='hidden'; };
  const close = () => { ham?.classList.remove('is-open'); ham?.setAttribute('aria-expanded','false'); ov?.classList.remove('is-open'); ov?.setAttribute('aria-hidden','true'); document.body.style.overflow=''; };
  ham?.addEventListener('click', () => ov?.classList.contains('is-open') ? close() : open());
  ov?.addEventListener('click', e => { if (e.target === ov) close(); });
  ov?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(close, 120)));
  document.addEventListener('keydown', e => { if (e.key==='Escape' && ov?.classList.contains('is-open')) close(); });
})();

// Mobile theme button → proxy to db-theme-btn; mobile lang button → toggle m-top-lang-drop
(function() {
  const mTheme = document.getElementById('m-theme-btn');
  const mLang  = document.getElementById('m-lang-btn');
  const mDrop  = document.getElementById('m-top-lang-drop');
  const dbTheme = document.getElementById('db-theme-btn');
  mTheme?.addEventListener('click', () => dbTheme?.click());
  mLang?.addEventListener('click', e => { e.stopPropagation(); mDrop?.classList.toggle('open'); });
  mDrop?.addEventListener('click', e => {
    const opt = e.target.closest('.db-lang-opt'); if (!opt) return;
    if (typeof applyLangD === 'function') applyLangD(opt.dataset.lang);
    mDrop.classList.remove('open');
  });
  document.addEventListener('click', () => mDrop?.classList.remove('open'));

  // Sync mobile theme icon with theme class
  function syncMTheme() {
    const dark = document.documentElement.classList.contains('theme-dark');
    const sun  = mTheme?.querySelector('.icon-sun');
    const moon = mTheme?.querySelector('.icon-moon');
    if (sun)  sun.hidden = dark;
    if (moon) moon.hidden = !dark;
  }
  syncMTheme();
  new MutationObserver(syncMTheme).observe(document.documentElement, { attributes:true, attributeFilter:['class'] });

  // Mobile overlay lang options
  document.getElementById('m-overlay')?.addEventListener('click', e => {
    const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return;
    if (typeof applyLangD === 'function') applyLangD(opt.dataset.lang);
  });
})();

// Sync setpw nav item visibility with section visibility
(function() {
  const sec = document.getElementById('setpw-section');
  const sbBtn = document.getElementById('sb-nav-setpw');
  const mBtn  = document.getElementById('m-ov-setpw');
  if (!sec) return;
  function sync() {
    const hidden = sec.classList.contains('hidden');
    if (sbBtn) sbBtn.hidden = hidden;
    if (mBtn)  mBtn.hidden  = hidden;
  }
  sync();
  new MutationObserver(sync).observe(sec, { attributes:true, attributeFilter:['class'] });
})();

// ── block 3/3 ──
(function(){
  const canvas=document.getElementById('neural-canvas');if(!canvas)return;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  let W=0,H=0,nodes=[];const DIST=155;
  function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight}
  function initNodes(){const n=W<768?40:90;nodes=Array.from({length:n},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.28,vy:(Math.random()-.5)*.28,r:Math.random()*1.1+.4,pulse:Math.random()*Math.PI*2}))}
  const mouse={x:-9999,y:-9999};document.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY});
  let cfg={r:'108',g:'110',b:'229',no:.22,lo:.09};
  function syncCfg(){const s=getComputedStyle(document.documentElement);cfg={r:s.getPropertyValue('--as-neural-r').trim()||'108',g:s.getPropertyValue('--as-neural-g').trim()||'110',b:s.getPropertyValue('--as-neural-b').trim()||'229',no:parseFloat(s.getPropertyValue('--as-neural-node-opacity').trim()||'.22'),lo:parseFloat(s.getPropertyValue('--as-neural-line-opacity').trim()||'.09')}}
  syncCfg();new MutationObserver(syncCfg).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  function draw(){ctx.clearRect(0,0,W,H);const{r,g,b,no,lo}=cfg;
    for(const n of nodes){const dx=n.x-mouse.x,dy=n.y-mouse.y,d2=dx*dx+dy*dy;if(d2<16900){const d=Math.sqrt(d2);n.vx+=dx/d*.055;n.vy+=dy/d*.055}n.vx*=.982;n.vy*=.982;n.x+=n.vx;n.y+=n.vy;if(n.x<-12)n.x=W+12;else if(n.x>W+12)n.x=-12;if(n.y<-12)n.y=H+12;else if(n.y>H+12)n.y=-12;n.pulse+=.011;const p=Math.sin(n.pulse)*.25+.75;ctx.beginPath();ctx.arc(n.x,n.y,n.r*p,0,Math.PI*2);ctx.fillStyle=`rgba(${r},${g},${b},${no*p})`;ctx.fill()}
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const dx=nodes[i].x-nodes[j].x,dy=nodes[i].y-nodes[j].y,d2=dx*dx+dy*dy;if(d2<DIST*DIST){const a=(1-Math.sqrt(d2)/DIST)*lo;ctx.beginPath();ctx.moveTo(nodes[i].x,nodes[i].y);ctx.lineTo(nodes[j].x,nodes[j].y);ctx.strokeStyle=`rgba(${r},${g},${b},${a})`;ctx.lineWidth=.5;ctx.stroke()}}
    requestAnimationFrame(draw)}
  resize();initNodes();draw();window.addEventListener('resize',()=>{resize();initNodes()});
})();

// ── Phase C-3 unified click delegation ──
// 用 document-level delegation 統一處理；id 與 data-* 都在這裡分派。
// 比個別 getElementById().addEventListener 穩：button 即使是動態 render 或 hidden 都 work。
document.addEventListener('click', e => {
  const t = e.target.closest('button, a, tr, [data-action], [data-revoke-id], [data-unbind], [data-bind], [data-open-modal], [data-load-page]');
  if (!t) return;
  // 靜態按鈕 by id
  if (t.id === 'tfa-enable-btn')   return startSetup2FA();
  if (t.id === 'tfa-disable-btn')  return showDisablePanel();
  if (t.id === 'setpw-btn')        return sendSetPasswordEmail();
  if (t.id === 'resend-btn')       return sendVerification();
  if (t.id === 'del-open-btn')     return showDeleteForm();
  if (t.id === 'del-submit-btn')   return submitDeleteAccount();
  // data-action
  const a = t.dataset.action;
  if (a === 'logout')              return logout();
  if (a === 'confirm-enable-2fa')  return confirmEnable2FA();
  if (a === 'confirm-disable-2fa') return confirmDisable2FA();
  if (a === 'close-tfa-backup')    return closeTfaBackup();
  if (a === 'hide-delete-form')    return hideDeleteForm();
  // dynamic content
  if (t.dataset.revokeId) return armRevoke(Number(t.dataset.revokeId));
  if (t.dataset.unbind)   return unbindProvider(t.dataset.unbind);
  if (t.dataset.bind)     return bindProvider(t.dataset.bind);
});
