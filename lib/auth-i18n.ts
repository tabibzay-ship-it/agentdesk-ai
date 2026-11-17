export type AuthLocale = "en";

export const authCopy = {
  en: {
    light: "Light", dark: "Dark", system: "System",
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
} as const;
