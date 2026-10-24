# Production synthetic chat cleanup plan

Status: **prepared only — not authorized or executed**

This plan applies exclusively to the production smoke identity created for:

- marker: `agentdesk-e2e-1791920531203`
- Auth user ID: `f6bdd7ee-6ddd-4fd4-be74-18fc3083e909`
- conversation ID: `36464f60-16dc-4b87-98df-80d9dfd0a95e`
- expected assistant text: `AGENTDESK_PRODUCTION_OK`

It must never be generalized to another account or executed with an
unqualified delete. Separate production authorization is required.

## Read-only ownership gate

Before deletion, use a transaction in read-only mode and verify all of the
following. Stop if any value differs or any unexpected dependent row exists.

| Object | Ownership predicate | Expected rows |
| --- | --- | ---: |
| `auth.users` | exact Auth user ID and `raw_user_meta_data->>'marker'` equals the marker | 1 |
| `public.agent_settings` | `user_id` equals the exact Auth user ID | 1 |
| `public.conversations` | exact conversation ID, user ID, and the recorded synthetic visitor ID | 1 |
| `public.messages` | `conversation_id` equals the exact conversation ID | 2 (`user`, `assistant`) |
| `public.usage_limits` | `user_id` equals the exact Auth user ID | 1; Free, used 1, limit 100 |
| `public.subscriptions` | `user_id` equals the exact Auth user ID | 1; Free and active |
| `agentdesk_private.ai_usage_reservations` | `user_id` equals the exact Auth user ID | 1 expected |
| `agentdesk_private.chat_rate_buckets` | `agent_id` equals the exact Auth user ID | 2 expected (account and visitor buckets) |
| `public.business_profiles`, `public.knowledge_sources`, `public.widget_settings` | exact user ID | 0 each |
| `public.chat_attachments` and private Storage objects | exact user/agent ID or user-prefixed path | 0 |
| billing events and payment transactions | exact user ID | 0 |
| leads, follow-ups, appointments, availability | exact user ID | 0 |
| Super Admin records or audit events | exact user ID | 0 |
| marketing preferences/events | exact user ID | 0 or trigger-created rows only; inspect before deciding |

Do not select conversation or message content for any other account. The only
permitted content assertions are the known synthetic prompt and response.

## Deletion procedure

1. Confirm the Supabase project ref is exactly `cdynahtkwtcinjzmxjcs`.
2. Capture only aggregate counts and the exact synthetic identifiers above.
3. Confirm there are no Storage objects and no unexpected business, billing,
   CRM, administrator, or payment rows.
4. If every ownership gate passes, delete the single Auth identity through the
   official Supabase Admin API using its exact user ID. Do not delete rows table
   by table and do not use an email-only predicate.
5. The reviewed foreign keys use `ON DELETE CASCADE` for the expected agent,
   conversation, messages, quota, subscription, private reservation and rate
   bucket rows. Re-query only the exact synthetic IDs and require zero rows.
6. Confirm the three global subscription plan rows are unchanged.

## Stop conditions and recovery

- Stop if the Auth marker is missing, the user ID differs, a Super Admin row
  exists, a paid-provider mapping exists, or any dependent count is unexpected.
- Auth deletion and its cascades are destructive. There is no safe application
  rollback after commit; recovery would require the encrypted production backup
  and would be disproportionate for this synthetic identity.
- Therefore the operation must be a separate, explicitly authorized maintenance
  action performed only after the read-only gate passes. This document does not
  authorize it.

