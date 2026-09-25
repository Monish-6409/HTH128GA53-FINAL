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

CREATE TABLE IF NOT EXISTS public.ai_provider_settings (
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

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_provider_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.user_roles') IS NOT NULL THEN
    DROP POLICY IF EXISTS "own roles readable" ON public.user_roles;
    CREATE POLICY "own roles readable" ON public.user_roles
      FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

DROP POLICY IF EXISTS "profiles_read_own" ON public.profiles;
CREATE POLICY "profiles_read_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_coordinator_read_all" ON public.profiles;
CREATE POLICY "profiles_coordinator_read_all" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'));

DROP POLICY IF EXISTS "staff_read_provider_settings" ON public.ai_provider_settings;
CREATE POLICY "staff_read_provider_settings" ON public.ai_provider_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "coordinator_manages_provider_settings" ON public.ai_provider_settings;
CREATE POLICY "coordinator_manages_provider_settings" ON public.ai_provider_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));

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
