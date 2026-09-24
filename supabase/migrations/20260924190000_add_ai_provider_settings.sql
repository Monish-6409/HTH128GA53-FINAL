CREATE TABLE public.ai_provider_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot integer NOT NULL UNIQUE CHECK (slot BETWEEN 1 AND 3),
  name text NOT NULL DEFAULT 'Provider slot',
  base_url text,
  api_key text,
  default_model text,
  active boolean NOT NULL DEFAULT false,
  model_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.ai_provider_settings TO authenticated;
GRANT ALL ON public.ai_provider_settings TO service_role;
ALTER TABLE public.ai_provider_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read provider settings" ON public.ai_provider_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "coordinator manages provider settings" ON public.ai_provider_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'coordinator')) WITH CHECK (public.has_role(auth.uid(),'coordinator'));

INSERT INTO public.ai_provider_settings (slot, name, base_url, api_key, default_model, active, model_list)
VALUES
  (1, 'Provider slot 1', NULL, NULL, NULL, true, '[]'::jsonb),
  (2, 'Provider slot 2', NULL, NULL, NULL, false, '[]'::jsonb),
  (3, 'Provider slot 3', NULL, NULL, NULL, false, '[]'::jsonb)
ON CONFLICT (slot) DO NOTHING;
