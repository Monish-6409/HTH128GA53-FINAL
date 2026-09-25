ALTER TABLE public.response_plans
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS analysis_type text NOT NULL DEFAULT 'incident' CHECK (analysis_type IN ('incident', 'batch')),
  ADD COLUMN IF NOT EXISTS incident_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS incident_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed';

CREATE INDEX IF NOT EXISTS idx_response_plans_batch_analysis
  ON public.response_plans (analysis_type, created_at DESC);

DROP POLICY IF EXISTS "staff_read_plans" ON public.response_plans;
CREATE POLICY "staff_read_plans" ON public.response_plans
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "coordinator_manages_plans" ON public.response_plans;
CREATE POLICY "coordinator_manages_plans" ON public.response_plans
  FOR INSERT TO authenticated
  WITH CHECK (true);
