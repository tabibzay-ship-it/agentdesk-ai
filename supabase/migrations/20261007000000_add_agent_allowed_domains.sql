alter table public.agent_settings
add column if not exists allowed_domains text[]
not null default '{}';

comment on column public.agent_settings.allowed_domains is
'Exact website hostnames allowed to use this AI agent widget. An empty list preserves public access during rollout.';
