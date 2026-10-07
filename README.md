# AgentDesk AI

AgentDesk AI is a Next.js customer-support platform. A business can train an AI agent, test it in the dashboard, install a chat widget on approved websites, and review saved conversations.

## Local setup

Requirements: Node.js 20 or newer and a Supabase project.

1. Install packages with `npm install`.
2. Copy `.env.example` to `.env.local` and fill in the required values.
3. Apply the SQL files in `supabase/migrations` to the Supabase project.
4. Start the app with `npm run dev`, then open `http://localhost:3000`.

Required environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` are server-only secrets. Never prefix either one with `NEXT_PUBLIC_` or expose them in browser code.

## Domain allowlist rollout

The Agent settings page accepts bare hostnames or full URLs. Values are normalized to exact lowercase hostnames. `example.com` does not authorize `www.example.com` or other subdomains; list every approved hostname separately.

An empty `allowed_domains` array keeps existing agents publicly reachable so the migration does not break installed widgets. As soon as one valid hostname is saved, both `/api/widget-settings` and `/api/chat` enforce the allowlist. Blocked requests receive a 403 response before rate limiting or monthly usage reservation.

The AgentDesk application's own same-origin test chat remains available. Cross-port loopback origins are accepted only outside production for local development.

## Checks and production

Run these before deployment:

```bash
npm run lint
npm run build
```

Deploy the Next.js app to a Node-compatible host, configure the four environment variables there, apply the database migrations, and confirm the production app URL is included wherever the embedded widget is tested. The install page builds the widget script URL from the current deployment origin.
