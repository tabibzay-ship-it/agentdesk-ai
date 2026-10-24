import type { Metadata } from "next";
import Link from "next/link";
import ThemeSwitcher from "@/components/theme-switcher";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How AgentDesk AI handles account, workspace, and service data.",
  alternates: { canonical: "/privacy" },
};

const sections = [
  ["Information we process", "AgentDesk AI processes the account details you provide, authentication identifiers, business profile and agent configuration, knowledge sources, conversations, attachments, leads, appointments, usage records, and subscription metadata needed to operate the service. If you choose Google sign-in, Supabase receives the basic profile information authorized by the openid, email, and profile scopes."],
  ["How we use information", "We use this information to authenticate users, keep customer workspaces separate, provide AI-assisted support features, enforce limits, secure the service, diagnose failures, and show accurate account and subscription status. We do not use a browser-reported payment result to activate a paid entitlement."],
  ["Service providers", "AgentDesk AI uses Supabase for authentication, database, and storage; Netlify for application hosting; OpenAI for configured AI responses; and Brevo for configured transactional email. Google is used only when a user chooses Google sign-in. A payment provider may be added later, but real checkout is disabled until it is separately configured and approved."],
  ["AI and uploaded content", "Prompts and supported attachments may be sent to the configured AI provider when you intentionally use an AI feature. Uploaded content is treated as untrusted, kept in private storage, and made available only through authenticated server-side access checks. AgentDesk AI does not intentionally execute uploaded code or document macros."],
  ["Payment information", "AgentDesk AI is designed to use hosted provider collection and tokenization. It does not store raw card numbers or card security codes. Only provider references and limited display metadata may be stored after a verified provider event."],
  ["Retention and deletion", "Information is retained while needed to provide and secure the service and to meet legitimate operational or legal requirements. Account deletion and export requests may be subject to identity verification, backup retention windows, and obligations that apply to the operator."],
  ["Security and choices", "We use authenticated sessions, row-level database controls, private storage, rate limits, and least-privilege server access. You can choose email/password sign-in instead of Google sign-in, disconnect an identity when another sign-in method remains, and withdraw optional marketing consent without affecting necessary service messages."],
  ["Contact and policy changes", "A monitored privacy contact address and the operator's legally required identity details must be confirmed before this policy is published for commercial use. Material changes should be dated and communicated through an appropriate service channel."],
] as const;

export default function PrivacyPage() {
  return <main className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)] sm:px-6">
    <div className="mx-auto max-w-3xl">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--premium-border)] pb-6">
        <Link href="/" className="text-xl font-black">AgentDesk <span className="text-blue-500">AI</span></Link>
        <ThemeSwitcher compact />
      </header>
      <article className="py-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-blue-500">Last updated October 14, 2026</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight">Privacy Policy</h1>
        <p className="mt-5 leading-7 text-[var(--premium-text-muted)]">This policy describes the current AgentDesk AI product design. It does not authorize a disabled integration or override the controls shown in your account.</p>
        <div className="mt-10 space-y-9">
          {sections.map(([title, body]) => <section key={title}><h2 className="text-xl font-bold">{title}</h2><p className="mt-2 leading-7 text-[var(--premium-text-muted)]">{body}</p></section>)}
        </div>
      </article>
      <footer className="border-t border-[var(--premium-border)] py-6 text-sm text-[var(--premium-text-muted)]"><Link href="/terms" className="font-semibold text-blue-500">Terms of Service</Link></footer>
    </div>
  </main>;
}
