import type { Metadata } from "next";
import Link from "next/link";
import ThemeSwitcher from "@/components/theme-switcher";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern use of AgentDesk AI.",
  alternates: { canonical: "/terms" },
};

const sections = [
  ["Using AgentDesk AI", "You must provide accurate account information, protect your sign-in methods, and use the service only for lawful business purposes. You are responsible for the people you authorize to use your workspace and for content you submit or connect."],
  ["Acceptable use", "Do not use AgentDesk AI to violate another person's rights, bypass security, distribute malware, unlawfully profile people, send unwanted messages, or generate content that you are not permitted to process. Do not attempt to access another customer's workspace, files, or usage allowance."],
  ["Your content", "You retain responsibility for your business information, knowledge sources, messages, and other content. You grant the limited permission needed to host, process, and transmit that content solely to operate the features you choose. You must have the necessary rights and notices for personal data you submit."],
  ["AI outputs", "AI responses can be incomplete or wrong and should be reviewed for important decisions. AgentDesk AI does not promise that generated content is accurate, unique, or suitable for legal, medical, financial, or other high-impact decisions."],
  ["Plans, trials, and billing", "An eligible verified new user may receive one five-day Pro trial with 250 total trial credits, ending when time or credits run out. Free-plan allowance is tracked separately. Paid checkout and automatic charges remain disabled until a supported provider is configured. If paid service is later offered, price, renewal, cancellation, and provider terms must be shown before consent."],
  ["Availability and changes", "The service may change to improve security, reliability, or functionality. Maintenance, provider outages, legal requirements, or abuse prevention can affect availability. Reasonable notice should be provided when a material change affects ongoing use."],
  ["Suspension and termination", "Access may be limited for security threats, unlawful use, material breach, or unpaid charges after paid billing is legitimately enabled. Data handling after closure remains subject to the Privacy Policy, backup windows, and applicable obligations."],
  ["Legal review", "The operator's legal identity, public contact, governing law, dispute process, warranty limitations, and any jurisdiction-specific consumer terms must be reviewed and completed before commercial publication. Nothing on this draft page waives rights that cannot lawfully be waived."],
] as const;

export default function TermsPage() {
  return <main className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)] sm:px-6">
    <div className="mx-auto max-w-3xl">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--premium-border)] pb-6">
        <Link href="/" className="text-xl font-black">AgentDesk <span className="text-blue-500">AI</span></Link>
        <ThemeSwitcher compact />
      </header>
      <article className="py-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-blue-500">Last updated October 14, 2026</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight">Terms of Service</h1>
        <p className="mt-5 leading-7 text-[var(--premium-text-muted)]">These terms are written to match the current AgentDesk AI product state. Provider activation, production publication, and any commercial legal commitment require separate review and authorization.</p>
        <div className="mt-10 space-y-9">
          {sections.map(([title, body]) => <section key={title}><h2 className="text-xl font-bold">{title}</h2><p className="mt-2 leading-7 text-[var(--premium-text-muted)]">{body}</p></section>)}
        </div>
      </article>
      <footer className="border-t border-[var(--premium-border)] py-6 text-sm text-[var(--premium-text-muted)]"><Link href="/privacy" className="font-semibold text-blue-500">Privacy Policy</Link></footer>
    </div>
  </main>;
}
