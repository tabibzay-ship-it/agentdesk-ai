"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
          <section className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-xl sm:p-12">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-400">AgentDesk AI</p>
            <h1 className="mt-3 text-3xl font-black">Something went wrong</h1>
            <p className="mt-4 text-slate-300">Your data was not changed. Try loading this page again.</p>
            <button type="button" onClick={reset} className="mt-7 min-h-11 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-500">
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
