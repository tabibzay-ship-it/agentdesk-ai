# AgentDesk AI

AgentDesk AI is a Next.js customer-support platform. A business can train an AI agent, test it in the dashboard, install a chat widget on approved websites, and review saved conversations.

## Local setup

Requirements: Node.js 22 or newer (maintained Node.js 24 LTS recommended) and a Supabase project.

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
AGENTDESK_APP_ORIGIN=https://app.example.com
```

`SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` are server-only secrets. Never prefix either one with `NEXT_PUBLIC_` or expose them in browser code.

## Domain allowlist rollout

The Agent settings page accepts bare hostnames or full URLs. Values are normalized to exact lowercase hostnames. `example.com` does not authorize `www.example.com` or other subdomains; list every approved hostname separately.

An empty `allowed_domains` array keeps existing agents publicly reachable so the migration does not break installed widgets. As soon as one valid hostname is saved, both `/api/widget-settings` and `/api/chat` enforce the allowlist. Blocked requests receive a 403 response before rate limiting or monthly usage reservation.

The AgentDesk application's own same-origin test chat remains available. Cross-port loopback origins are accepted only outside production for local development.

## Automatic installation verification

The `/install` page checks the published website through authenticated `POST /api/verify-installation`. The server resolves the signed-in account's Public Agent ID and requires it on the same executable script tag as this AgentDesk deployment's `/widget.js`. Domain Allowlist rules are checked on the initial URL and every redirect. No allowlist or agent setting is changed by verification.

The check reads public HTML; place the snippet directly in the page rather than injecting it through JavaScript or a tag manager. A successful check saves `widget_settings.is_installed` and `updated_at`, preserving existing customization. Failed checks leave a previous saved installation intact. Localhost verification is available only in development; production rejects private addresses. Website reads have a timeout, redirect limit and 2 MB limit, with DNS-pinned connections to prevent internal-network requests.

Open the **agentdesk-ai** folder when editing the running local app. Changes in **agentdesk-ai-backup** do not affect its server.

## Checks and production

Run these before deployment:

```bash
npm run lint
npm test
npm run build
```

Deploy the Next.js app to a Node-compatible host, configure the environment variables there, apply the database migrations, and confirm the production app URL is included wherever the embedded widget is tested. Outside Vercel, `AGENTDESK_APP_ORIGIN` is required so installation verification cannot trust a forged request host. See [SECURITY_DEPLOYMENT.md](./SECURITY_DEPLOYMENT.md) for the complete production checklist and live verification SQL.
