# Non-runnable database baselines

Files in this directory are reference snapshots for creating or comparing disposable, non-production environments. Supabase CLI migration discovery only reads timestamped SQL files from `supabase/migrations`, so these baselines are deliberately stored outside that directory.

`staging_baseline.sql` must never be passed to `supabase db push`, linked to a production project, or executed against an existing database. It is not an incremental migration and does not reconcile schema drift. Use it only through a separately reviewed, explicitly targeted local bootstrap procedure.
