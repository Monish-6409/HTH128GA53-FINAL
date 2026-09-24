REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

CREATE TABLE public.agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent text NOT NULL UNIQUE,
  provider_slot integer NOT NULL DEFAULT 1,
  model text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.agent_configs TO authenticated;
GRANT ALL ON public.agent_configs TO service_role;
ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read agent configs" ON public.agent_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY "coordinator manages agent configs" ON public.agent_configs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'coordinator')) WITH CHECK (public.has_role(auth.uid(),'coordinator'));

INSERT INTO public.agent_configs (agent, provider_slot, model) VALUES
  ('logistics',1,NULL),('medical',2,NULL),('communications',3,NULL);