import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--premium-bg)] px-4 text-[var(--premium-text)]">
      <section className="w-full max-w-lg rounded-3xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-8 text-center shadow-xl sm:p-12">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">404</p>
        <h1 className="mt-3 text-3xl font-black">Page not found</h1>
        <p className="mt-4 text-[var(--premium-muted)]">The page may have moved, or the address may be incorrect.</p>
        <Link href="/" className="mt-7 inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-700">
          Return to AgentDesk AI
        </Link>
      </section>
    </main>
  );
}
