export type AuthLocale = "en" | "ps" | "fa";

export const AUTH_LANGUAGE_KEY = "agentdesk-dashboard-language";

export const authCopy = {
  en: {
    language: "Language", light: "Light", dark: "Dark", system: "System",
    haveAccount: "Already have an account?", noAccount: "Don't have an account?", signIn: "Sign In", startFree: "Start Free",
    welcome: "Welcome back", loginSubtitle: "Sign in to manage your AI support agent.", email: "Email address", password: "Password",
    enterPassword: "Enter your password", show: "Show", hide: "Hide", forgot: "Forgot password?", signingIn: "Signing in...",
    secureLogin: "Secure login • AgentDesk AI", invalidLogin: "Please enter a valid email address and password.", tooMany: "Too many attempts. Please try again later.",
    loginFailed: "Could not sign in. Check your credentials and email confirmation.", noSession: "Login failed. No session was created.", generic: "Something went wrong. Please try again.",
    confirmed: "Email confirmed. You can sign in now.", resetSuccess: "Password updated. Sign in with your new password.",
    createTitle: "Create your account", createSubtitle: "Start building your AI support agent for free.", fullName: "Full name", namePlaceholder: "John Smith",
    createPassword: "Create a strong password", passwordHint: "Use at least 12 characters with a letter and number.", confirmPassword: "Confirm password",
    creating: "Creating account...", createAccount: "Create Free Account", invalidName: "Please enter a full name of up to 200 characters.", invalidEmail: "Please enter a valid email address.",
    weakPassword: "Use 12 or more characters with at least one letter and one number.", mismatch: "Passwords do not match.", createFailed: "Could not create this account. Check your details or sign in.",
    createRetry: "Could not create this account. Please try again.", checkEmail: "If this address can be registered, check your email to confirm your account.",
    marketingConsent: "I agree to receive occasional product news and helpful tips. This is optional and can be withdrawn later.",
    resendVerification: "Resend verification email", resendingVerification: "Sending verification email...", verificationResent: "If this address is awaiting confirmation, a new verification email has been sent.",
    resetTitle: "Reset your password", resetSubtitle: "Enter your account email and we will send a secure verification code.", sending: "Sending...", sendRecovery: "Send Verification Code",
    recoverySent: "If an account exists for this email, a verification code has been sent.", recoveryFailed: "The recovery request could not be completed. Check your connection and try again.", backToSignIn: "Back to Sign In",
    choosePassword: "Choose a new password", checkingRecovery: "Checking your recovery authorization…", invalidRecovery: "Your recovery authorization is invalid or expired. Request a new verification code.", invalidRecoveryShort: "Your recovery authorization is invalid or expired. Request a new code.",
    newPassword: "New password", showPasswords: "Show passwords", hidePasswords: "Hide passwords", updating: "Updating...", updatePassword: "Update password", requestNew: "Request a new link",
    updateFailed: "Password could not be updated. Request a new verification code.", updateNetwork: "Password could not be updated. Check your connection and try again.",
  },
  ps: {
    language: "ژبه", light: "روښانه", dark: "تیاره", system: "سیسټم",
    haveAccount: "له مخکې حساب لرئ؟", noAccount: "حساب نه لرئ؟", signIn: "ننوتل", startFree: "وړیا پیل کړئ",
    welcome: "بیا ښه راغلاست", loginSubtitle: "د خپل AI ملاتړ استازي د اداره کولو لپاره ننوځئ.", email: "برېښنالیک", password: "پټنوم",
    enterPassword: "خپل پټنوم ولیکئ", show: "ښکاره", hide: "پټ", forgot: "پټنوم مو هېر شوی؟", signingIn: "ننوتل روان دي...",
    secureLogin: "خوندي ننوتل • AgentDesk AI", invalidLogin: "سم برېښنالیک او پټنوم ولیکئ.", tooMany: "هڅې ډېرې شوې. وروسته بیا هڅه وکړئ.",
    loginFailed: "ننوتل ونه شول. معلومات او د برېښنالیک تایید وګورئ.", noSession: "ننوتل ناکام شول؛ ناسته جوړه نه شوه.", generic: "ستونزه رامنځته شوه. بیا هڅه وکړئ.",
    confirmed: "برېښنالیک تایید شو. اوس ننوتلی شئ.", resetSuccess: "پټنوم بدل شو. په نوي پټنوم ننوځئ.",
    createTitle: "خپل حساب جوړ کړئ", createSubtitle: "خپل AI ملاتړ استازی وړیا جوړول پیل کړئ.", fullName: "بشپړ نوم", namePlaceholder: "بشپړ نوم",
    createPassword: "قوي پټنوم جوړ کړئ", passwordHint: "لږ تر لږه ۱۲ توري، یو حرف او یوه شمېره وکاروئ.", confirmPassword: "پټنوم بیا ولیکئ",
    creating: "حساب جوړېږي...", createAccount: "وړیا حساب جوړ کړئ", invalidName: "تر ۲۰۰ تورو پورې بشپړ نوم ولیکئ.", invalidEmail: "سم برېښنالیک ولیکئ.",
    weakPassword: "۱۲ یا زیات توري، لږ تر لږه یو حرف او یوه شمېره وکاروئ.", mismatch: "پټنومونه سره یو شان نه دي.", createFailed: "حساب جوړ نه شو. معلومات وګورئ یا ننوځئ.",
    createRetry: "حساب جوړ نه شو. بیا هڅه وکړئ.", checkEmail: "که دا پته د ثبت وړ وي، د تایید لپاره خپل برېښنالیک وګورئ.",
    marketingConsent: "زه د محصول کله ناکله خبرونو او ګټورو لارښوونو ترلاسه کول منم. دا اختیاري ده او وروسته یې بېرته اخیستلی شم.",
    resendVerification: "د تایید برېښنالیک بیا ولېږئ", resendingVerification: "د تایید برېښنالیک لېږل کېږي...", verificationResent: "که دا پته تایید ته منتظره وي، نوی تاییدي برېښنالیک ولېږل شو.",
    resetTitle: "خپل پټنوم بېرته تنظیم کړئ", resetSubtitle: "د حساب برېښنالیک ولیکئ؛ خوندي لارښوونې به درولېږو.", sending: "لېږل کېږي...", sendRecovery: "د بیا تنظیم برېښنالیک ولېږئ",
    recoverySent: "که حساب د بیا تنظیم برېښنالیک ترلاسه کولی شي، لارښوونې ولېږل شوې.", recoveryFailed: "غوښتنه بشپړه نه شوه. انټرنېټ وګورئ او بیا هڅه وکړئ.", backToSignIn: "ننوتلو ته ستنېدل",
    choosePassword: "نوی پټنوم وټاکئ", checkingRecovery: "د بیا تنظیم لینک کتل کېږي…", invalidRecovery: "دا لینک ناسم یا زوړ شوی. نوی برېښنالیک وغواړئ.", invalidRecoveryShort: "دا لینک ناسم یا زوړ شوی. نوی لینک وغواړئ.",
    newPassword: "نوی پټنوم", showPasswords: "پټنومونه ښکاره کړئ", hidePasswords: "پټنومونه پټ کړئ", updating: "بدلېږي...", updatePassword: "پټنوم بدل کړئ", requestNew: "نوی لینک وغواړئ",
    updateFailed: "پټنوم بدل نه شو. نوی لینک وغواړئ.", updateNetwork: "پټنوم بدل نه شو. انټرنېټ وګورئ او بیا هڅه وکړئ.",
  },
  fa: {
    language: "زبان", light: "روشن", dark: "تیره", system: "سیستم",
    haveAccount: "از قبل حساب دارید؟", noAccount: "حساب ندارید؟", signIn: "ورود", startFree: "شروع رایگان",
    welcome: "خوش آمدید", loginSubtitle: "برای مدیریت عامل پشتیبانی هوش مصنوعی وارد شوید.", email: "ایمیل", password: "رمز عبور",
    enterPassword: "رمز عبور خود را وارد کنید", show: "نمایش", hide: "پنهان", forgot: "رمز عبور را فراموش کرده‌اید؟", signingIn: "در حال ورود...",
    secureLogin: "ورود امن • AgentDesk AI", invalidLogin: "ایمیل و رمز عبور معتبر وارد کنید.", tooMany: "تلاش‌ها بیش از حد است. بعداً دوباره کوشش کنید.",
    loginFailed: "ورود ممکن نشد. اطلاعات و تأیید ایمیل را بررسی کنید.", noSession: "ورود ناموفق بود؛ نشست ایجاد نشد.", generic: "مشکلی رخ داد. دوباره کوشش کنید.",
    confirmed: "ایمیل تأیید شد. اکنون وارد شوید.", resetSuccess: "رمز عبور تغییر کرد. با رمز جدید وارد شوید.",
    createTitle: "حساب خود را بسازید", createSubtitle: "ساخت عامل پشتیبانی هوش مصنوعی را رایگان آغاز کنید.", fullName: "نام کامل", namePlaceholder: "نام کامل",
    createPassword: "یک رمز قوی بسازید", passwordHint: "حداقل ۱۲ نویسه همراه با یک حرف و یک عدد استفاده کنید.", confirmPassword: "تأیید رمز عبور",
    creating: "در حال ساخت حساب...", createAccount: "ساخت حساب رایگان", invalidName: "نام کامل را تا ۲۰۰ نویسه وارد کنید.", invalidEmail: "یک ایمیل معتبر وارد کنید.",
    weakPassword: "۱۲ نویسه یا بیشتر، حداقل یک حرف و یک عدد استفاده کنید.", mismatch: "رمزهای عبور یکسان نیستند.", createFailed: "حساب ساخته نشد. اطلاعات را بررسی یا وارد شوید.",
    createRetry: "حساب ساخته نشد. دوباره کوشش کنید.", checkEmail: "اگر این آدرس قابل ثبت باشد، ایمیل خود را برای تأیید بررسی کنید.",
    marketingConsent: "با دریافت گاه‌به‌گاه خبرهای محصول و راهنمایی‌های مفید موافقم. این گزینه اختیاری است و بعداً قابل لغو است.",
    resendVerification: "ارسال دوباره ایمیل تأیید", resendingVerification: "ایمیل تأیید در حال ارسال است...", verificationResent: "اگر این آدرس منتظر تأیید باشد، ایمیل تأیید جدید ارسال شد.",
    resetTitle: "بازنشانی رمز عبور", resetSubtitle: "ایمیل حساب را وارد کنید تا راهنمای امن بازیابی ارسال شود.", sending: "در حال ارسال...", sendRecovery: "ارسال ایمیل بازیابی",
    recoverySent: "اگر حساب بتواند ایمیل بازیابی دریافت کند، راهنما ارسال شده است.", recoveryFailed: "درخواست بازیابی کامل نشد. اتصال را بررسی و دوباره کوشش کنید.", backToSignIn: "بازگشت به ورود",
    choosePassword: "رمز عبور جدید انتخاب کنید", checkingRecovery: "در حال بررسی لینک بازیابی…", invalidRecovery: "این لینک نامعتبر یا منقضی است. ایمیل بازیابی جدید درخواست کنید.", invalidRecoveryShort: "این لینک نامعتبر یا منقضی است. لینک جدید درخواست کنید.",
    newPassword: "رمز عبور جدید", showPasswords: "نمایش رمزها", hidePasswords: "پنهان کردن رمزها", updating: "در حال تغییر...", updatePassword: "تغییر رمز عبور", requestNew: "درخواست لینک جدید",
    updateFailed: "رمز عبور تغییر نکرد. لینک بازیابی جدید درخواست کنید.", updateNetwork: "رمز عبور تغییر نکرد. اتصال را بررسی و دوباره کوشش کنید.",
  },
} as const;

export function getSavedAuthLocale(): AuthLocale {
  if (typeof window === "undefined") return "en";
  try {
    const saved = localStorage.getItem(AUTH_LANGUAGE_KEY);
    return saved === "ps" || saved === "fa" ? saved : "en";
  } catch {
    return "en";
  }
}
