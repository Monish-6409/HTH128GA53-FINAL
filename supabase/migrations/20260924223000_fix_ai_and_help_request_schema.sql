DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'app_role'
  ) THEN
    CREATE TYPE public.app_role AS ENUM ('coordinator', 'officer');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('officer', 'coordinator')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.officers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  username text NOT NULL UNIQUE,
  agent_id text NOT NULL UNIQUE CHECK (agent_id ~ '^[0-9]{4}$'),
  role public.app_role NOT NULL DEFAULT 'officer',
  status text NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  available integer NOT NULL DEFAULT 0,
  zone text,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.emergency_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ref_code text NOT NULL UNIQUE,
  emergency_type text NOT NULL,
  severity text NOT NULL,
  people_count integer NOT NULL DEFAULT 1,
  medical_notes text,
  location_text text NOT NULL,
  zone text,
  contact text,
  status text NOT NULL DEFAULT 'received',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent text NOT NULL UNIQUE,
  provider_slot integer NOT NULL DEFAULT 1,
  model text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.emergency_requests(id) ON DELETE CASCADE,
  agent text NOT NULL,
  provider_slot integer,
  provider_name text,
  model text,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  resource_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority text,
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasoning_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.response_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.emergency_requests(id) ON DELETE CASCADE,
  summary text NOT NULL,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  resource_allocation jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_provider_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot integer NOT NULL UNIQUE CHECK (slot BETWEEN 1 AND 3),
  name text NOT NULL DEFAULT 'Provider slot',
  base_url text,
  api_key text,
  default_model text,
  active boolean NOT NULL DEFAULT false,
  model_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emergency_requests_user_id
  ON public.emergency_requests (user_id);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.officers TO authenticated;
GRANT ALL ON public.officers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resources TO authenticated;
GRANT ALL ON public.resources TO service_role;
GRANT INSERT ON public.emergency_requests TO anon;
GRANT SELECT, INSERT, UPDATE ON public.emergency_requests TO authenticated;
GRANT ALL ON public.emergency_requests TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.agent_configs TO authenticated;
GRANT ALL ON public.agent_configs TO service_role;
GRANT SELECT ON public.agent_outputs TO authenticated;
GRANT ALL ON public.agent_outputs TO service_role;
GRANT SELECT ON public.response_plans TO authenticated;
GRANT ALL ON public.response_plans TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ai_provider_settings TO authenticated;
GRANT ALL ON public.ai_provider_settings TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.officers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.response_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_provider_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

DROP POLICY IF EXISTS "own roles readable" ON public.user_roles;
CREATE POLICY "own roles readable" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "profiles_read_own" ON public.profiles;
CREATE POLICY "profiles_read_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_coordinator_read_all" ON public.profiles;
CREATE POLICY "profiles_coordinator_read_all" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'));

DROP POLICY IF EXISTS "profiles_coordinator_update_all" ON public.profiles;
CREATE POLICY "profiles_coordinator_update_all" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));

DROP POLICY IF EXISTS "officers_readable_by_staff" ON public.officers;
CREATE POLICY "officers_readable_by_staff" ON public.officers
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "coordinator_manages_officers" ON public.officers;
CREATE POLICY "coordinator_manages_officers" ON public.officers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));

DROP POLICY IF EXISTS "staff_read_resources" ON public.resources;
CREATE POLICY "staff_read_resources" ON public.resources
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "coordinator_manages_resources" ON public.resources;
CREATE POLICY "coordinator_manages_resources" ON public.resources
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));

DROP POLICY IF EXISTS "emergency_requests_insert_public" ON public.emergency_requests;
CREATE POLICY "emergency_requests_insert_public" ON public.emergency_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "emergency_requests_select_own_or_staff" ON public.emergency_requests;
CREATE POLICY "emergency_requests_select_own_or_staff" ON public.emergency_requests
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'coordinator')
    OR public.has_role(auth.uid(), 'officer')
  );

DROP POLICY IF EXISTS "emergency_requests_update_own_or_staff" ON public.emergency_requests;
CREATE POLICY "emergency_requests_update_own_or_staff" ON public.emergency_requests
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'coordinator')
    OR public.has_role(auth.uid(), 'officer')
  )
  WITH CHECK (
    user_id IS NULL
    OR user_id = auth.uid()
    OR public.has_role(auth.uid(), 'coordinator')
    OR public.has_role(auth.uid(), 'officer')
  );

DROP POLICY IF EXISTS "staff_read_agent_configs" ON public.agent_configs;
CREATE POLICY "staff_read_agent_configs" ON public.agent_configs
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "coordinator_manages_agent_configs" ON public.agent_configs;
CREATE POLICY "coordinator_manages_agent_configs" ON public.agent_configs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));

DROP POLICY IF EXISTS "staff_read_agent_outputs" ON public.agent_outputs;
CREATE POLICY "staff_read_agent_outputs" ON public.agent_outputs
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff_read_plans" ON public.response_plans;
CREATE POLICY "staff_read_plans" ON public.response_plans
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff_read_provider_settings" ON public.ai_provider_settings;
CREATE POLICY "staff_read_provider_settings" ON public.ai_provider_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "coordinator_manages_provider_settings" ON public.ai_provider_settings;
CREATE POLICY "coordinator_manages_provider_settings" ON public.ai_provider_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));

CREATE OR REPLACE VIEW public.help_requests AS
SELECT
  id,
  user_id,
  ref_code,
  emergency_type AS category,
  severity,
  people_count,
  medical_notes AS description,
  location_text,
  zone,
  contact,
  status,
  created_at
FROM public.emergency_requests;

INSERT INTO public.officers (username, agent_id, role, status)
VALUES
  ('umar', '1000', 'coordinator', 'on-duty'),
  ('a.rahman', '2041', 'officer', 'deployed'),
  ('s.iqbal', '2042', 'officer', 'available'),
  ('n.verma', '2043', 'officer', 'standby')
ON CONFLICT (username) DO NOTHING;

INSERT INTO public.resources (name, category, quantity, available, zone, status)
VALUES
  ('Rescue boats', 'Marine', 12, 5, 'Zone A - Riverside', 'deployed'),
  ('Ambulances', 'Medical', 8, 3, 'Zone B - Old Town', 'active'),
  ('Water pumps', 'Engineering', 20, 14, 'Zone C - Mill District', 'ready'),
  ('Medical kits', 'Medical', 150, 92, 'Central Depot', 'ready'),
  ('Relief shelters', 'Shelter', 6, 2, 'Zone D - Green Fields', 'active'),
  ('Food & water pallets', 'Logistics', 300, 180, 'Central Depot', 'ready'),
  ('Search & rescue teams', 'Personnel', 10, 4, 'Zone E - Harbour Road', 'deployed')
ON CONFLICT DO NOTHING;

INSERT INTO public.agent_configs (agent, provider_slot, model)
VALUES
  ('logistics', 1, NULL),
  ('medical', 2, NULL),
  ('communications', 3, NULL)
ON CONFLICT (agent) DO NOTHING;

INSERT INTO public.ai_provider_settings (slot, name, base_url, api_key, default_model, active, model_list)
VALUES
  (1, 'OpenRouter', 'https://openrouter.ai/api/v1', NULL, 'openrouter/free', true, '[]'::jsonb),
  (2, 'Provider slot 2', NULL, NULL, NULL, false, '[]'::jsonb),
  (3, 'Provider slot 3', NULL, NULL, NULL, false, '[]'::jsonb)
ON CONFLICT (slot) DO UPDATE
SET name = EXCLUDED.name,
    base_url = EXCLUDED.base_url,
    api_key = EXCLUDED.api_key,
    default_model = EXCLUDED.default_model,
    active = EXCLUDED.active,
    model_list = EXCLUDED.model_list,
    updated_at = now();
