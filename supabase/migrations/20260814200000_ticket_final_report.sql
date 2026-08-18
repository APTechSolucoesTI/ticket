-- Laudo final: required before a ticket can be marked resolved/closed.
-- Enforced with a CHECK constraint (not just app-side validation) so no
-- code path — Kanban drag, status dropdown, a future API — can skip it.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS resolution_summary text,
  ADD COLUMN IF NOT EXISTS resolution_diagnosis text;

-- Backfill pre-existing resolved/closed tickets (e.g. seed/test data) so the
-- CHECK constraint below doesn't reject the migration on rows that predate
-- this feature.
UPDATE public.tickets
SET
  resolution_summary = COALESCE(NULLIF(btrim(resolution_summary), ''), '(sem laudo — ticket finalizado antes deste recurso existir)'),
  resolution_diagnosis = COALESCE(NULLIF(btrim(resolution_diagnosis), ''), '(sem laudo — ticket finalizado antes deste recurso existir)')
WHERE status IN ('resolved', 'closed');

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_resolution_required_check
  CHECK (
    status NOT IN ('resolved', 'closed')
    OR (
      resolution_summary IS NOT NULL AND btrim(resolution_summary) <> ''
      AND resolution_diagnosis IS NOT NULL AND btrim(resolution_diagnosis) <> ''
    )
  );
