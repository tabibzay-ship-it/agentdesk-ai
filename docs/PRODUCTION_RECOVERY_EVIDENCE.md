# Production recovery evidence — 2026-11-17

Read-only forensic record. No secret values, passphrases, identities or API keys
are reproduced here. Nothing in this file authorizes a deploy, migration,
payment, email, or data deletion.

## 1. Production Supabase status

| Probe | Result |
| --- | --- |
| Configured ref (`.env.local`, live CSP) | `cdynahtkwtcinjzmxjcs` |
| Google DNS (`dns.google`) | `Status: 3` — NXDOMAIN |
| Cloudflare DNS (`cloudflare-dns.com`) | `Status: 3` — NXDOMAIN |
| Windows `Resolve-DnsName` | `DNS name does not exist` |
| Control: staging ref `koqlnjctqeaykhbqkyuj` | `Status: 0`, resolves to two Cloudflare IPs |
| Control: `getagentdeskai.com` | `Status: 0`, resolves |
| Local service-role key against staging | HTTP 401 (key is not a staging key) |

Conclusion: the production project host has been removed from Supabase's DNS
zone. The failure is not local to this workstation (staging and the app domain
resolve normally). A paused project normally still resolves, so this is
consistent with deletion. Supabase Management API is not configured on this
machine (no access token, no CLI), so the account-side status cannot be read
from here.

## 2. Historical migration evidence (preserved)

Source: `%LOCALAPPDATA%\AgentDeskAI\production-migrations\phase45b-execution-20261107T215309Z.json`

- `project_ref`: `cdynahtkwtcinjzmxjcs`
- `preflight`: PASS, `final_verification`: PASS
- `data_preservation`: PASS, `ai_shutdown`: PASS
- `writes_performed`: false (verification only)
- ledger versions: **13**
- Postflight (`phase45b-final-postflight-20261107T215646Z.txt`):
  `ledger_versions: 13`, `all_eight_layers: PASS`, `rls_security: PASS`,
  `ai_fail_closed: PASS`, `four_indexes: PASS`, `transaction_read_only: on`

Meaning: as of 2026-11-07 the production schema, RLS, AI credit controls and
indexes were fully applied and verified. This is historical evidence only; the
live schema cannot be inspected while the project is unreachable.

## 3. Backup inventory and verification

### 3.1 2026-11-07 encrypted database archive (local)

`%LOCALAPPDATA%\AgentDeskAI\production-encrypted-backups\20261107-212430Z\`

| Item | Result |
| --- | --- |
| `production-database.custom.age` SHA-256 | `783F3008…862D` — matches `SHA256SUMS.txt` |
| Encryption | age v1, two X25519 recipients (independent identities) |
| `ram-only-restore-evidence.json` | `result: PASS`, all `error: null`, 2026-11-07T21:28Z |
| `manifest_version` | 1 (current validator expects 2) |
| Storage coverage | none |
| Decryptability today | **UNVERIFIED** — needs the recovery identity |

The recovery key on the recovery media is itself `age`-encrypted with `scrypt`.
Supplying that passphrase non-interactively is blocked: `age` prompts on the
terminal, and `age-plugin-batchpass.exe` is **blocked by the host Device Guard
policy**. Hash equality proves integrity, not decryptability.

### 3.2 2026-10-17 encrypted archives (recovery media `F:`)

`F:\AgentDesk-Private-Backups\`

| Archive | SHA-256 | Result |
| --- | --- | --- |
| `…20261017T112405Z-storage.7z` | `F044A72E…AE41` | matches manifest; **password-protected** |
| `…20261017T112405Z.7z` | (listed) | **password-protected** |

The stored DPAPI credentials (`recovery-passphrase-v2`, `encryption-key`) do not
open these 7z archives; their password is not held in the retrieved records.
They remain intact and untouched.

### 3.3 2026-10-09 encrypted archive (recovery media `F:`) — DECRYPTABLE

`F:\AgentDesk-Private-Backups\agentdesk-production-20261009T161726Z.7z`

Opened with the DPAPI-protected `…-encryption-key.credential.xml` (same Windows
user). Contents:

| File | Size |
| --- | --- |
| `database.dump` | 431,605 B (PostgreSQL custom format) |
| `schema.sql` | 338,970 B |
| `roles.sql` | 5,900 B |
| `manifest.txt` | 172 B |

This is the only backup proven decryptable on this machine. It is five weeks
older than the 2026-11-07 set, so restoring it would lose all data written
after 2026-10-09.

## 4. Private Storage status

- 2026-11-07 sets contain **no** Storage artifacts.
- 2026-10-17 `…-storage.7z` (83,804 B) exists and its SHA-256 matches, but it is
  password-protected with a secret not present in the stored credentials.
- No plaintext Storage object export was found in the authorized locations.
- No archive was modified, moved or deleted during this audit.

## 5. Public route verification in the release build

`npm run start` on the current build (commit `29005ab`), then local requests:

| Route | Release build | Production |
| --- | --- | --- |
| `/` | 200 | 200 |
| `/privacy` | 200 (`Privacy Policy \| AgentDesk AI`) | **404** |
| `/terms` | 200 (`Terms of Service \| AgentDesk AI`) | **404** |
| `/robots.txt` | 200 (`Disallow: /admin`, allows `/login`, `/register`) | **404** |
| `/sitemap.xml` | 200 (canonical `https://getagentdeskai.com`) | **404** |

The routes are implemented correctly; production serves an old build
(`Age ≈ 34.6 days`). The fix is deployment, not code.

## 6. Access matrix

| Service | Available | Missing |
| --- | --- | --- |
| GitHub | git push (credential manager) | API token / `gh` for PR merge |
| Netlify | site id only (`93173397-…`) | auth token; CLI not installed |
| Supabase | project keys (dead project) | account access / Management API token |
| OpenAI | — | `invalid_api_key` (revoked) |

## 7. Recovery options

1. **Best:** restore the original Supabase project from the Supabase dashboard if
   it is recoverable, then verify the 13-version ledger.
2. **If recoverable only from backup:** 2026-11-07 archive (complete, newest) once
   an X25519 recovery identity is supplied interactively; or 2026-10-17 archives
   once their 7z password is supplied.
3. **Last resort:** 2026-10-09 archive (proven decryptable) — loses 2026-10-09 →
   2026-11-07 data.
4. Storage objects after 2026-10-17 are not recoverable from any found archive.

Creating a replacement project is intentionally **not** performed here.
