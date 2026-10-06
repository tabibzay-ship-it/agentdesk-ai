export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Navigation */}
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="text-2xl font-bold">
          AgentDesk <span className="text-blue-500">AI</span>
        </div>

        <div className="hidden gap-8 text-sm text-slate-300 md:flex">
          <a href="#features" className="hover:text-white">Features</a>
          <a href="#how" className="hover:text-white">How it works</a>
          <a href="#pricing" className="hover:text-white">Pricing</a>
        </div>

        <div className="flex items-center gap-3">
          <button className="px-4 py-2 text-sm text-slate-300 hover:text-white">
            Sign in
          </button>

          <button className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold hover:bg-blue-500">
            Start Free
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto grid max-w-7xl items-center gap-14 px-6 py-24 lg:grid-cols-2">
        <div>
          <div className="mb-6 inline-flex rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-400">
            ✨ AI Customer Support for Modern Businesses
          </div>

          <h1 className="text-5xl font-bold leading-tight md:text-6xl">
            Turn your website into a
            <span className="text-blue-500"> 24/7 AI support agent.</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-400">
            Train AgentDesk AI with your business information and let it answer
            customer questions instantly — day and night.
          </p>

          <div className="mt-9 flex flex-wrap gap-4">
            <button className="rounded-xl bg-blue-600 px-7 py-3.5 font-semibold hover:bg-blue-500">
              Start for Free →
            </button>

            <button className="rounded-xl border border-slate-700 px-7 py-3.5 font-semibold hover:bg-slate-900">
              View Demo
            </button>
          </div>

          <p className="mt-5 text-sm text-slate-500">
            No credit card required • Setup in minutes
          </p>
        </div>

        {/* Chat Preview */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <div className="mb-5 flex items-center gap-3 border-b border-slate-800 pb-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 font-bold">
              AI
            </div>

            <div>
              <p className="font-semibold">AI Support Assistant</p>
              <p className="text-sm text-green-400">● Online</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="max-w-xs rounded-2xl rounded-tl-sm bg-slate-800 p-4 text-sm">
              Hi! 👋 How can I help you today?
            </div>

            <div className="ml-auto max-w-xs rounded-2xl rounded-tr-sm bg-blue-600 p-4 text-sm">
              What time does your business open tomorrow?
            </div>

            <div className="max-w-sm rounded-2xl rounded-tl-sm bg-slate-800 p-4 text-sm leading-6">
              We open tomorrow at 8:00 AM and close at 6:00 PM. Would you like
              me to help you with anything else?
            </div>
          </div>

          <div className="mt-6 flex items-center rounded-xl border border-slate-700 bg-slate-950 p-2">
            <span className="flex-1 px-3 text-sm text-slate-500">
              Type your message...
            </span>
            <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm">
              Send
            </button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-slate-900 px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <p className="font-semibold text-blue-500">POWERFUL & SIMPLE</p>
            <h2 className="mt-3 text-4xl font-bold">
              Everything you need for AI support
            </h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                icon: "🧠",
                title: "Train Your AI",
                text: "Add your business information and FAQs. Your AI learns how to answer your customers.",
              },
              {
                icon: "💬",
                title: "Website Chat",
                text: "Add a beautiful AI chat widget to your website with a simple embed code.",
              },
              {
                icon: "📊",
                title: "Chat Analytics",
                text: "See customer conversations and understand what your visitors need.",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7"
              >
                <div className="text-3xl">{feature.icon}</div>
                <h3 className="mt-5 text-xl font-semibold">{feature.title}</h3>
                <p className="mt-3 leading-7 text-slate-400">{feature.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}