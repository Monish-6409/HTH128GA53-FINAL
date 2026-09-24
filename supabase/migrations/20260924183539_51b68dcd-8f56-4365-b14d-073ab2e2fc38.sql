CREATE TYPE public.app_role AS ENUM ('coordinator','officer');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE public.officers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  username text NOT NULL UNIQUE,
  agent_id text NOT NULL UNIQUE CHECK (agent_id ~ '^[0-9]{4}$'),
  role public.app_role NOT NULL DEFAULT 'officer',
  status text NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.officers TO authenticated;
GRANT ALL ON public.officers TO service_role;
ALTER TABLE public.officers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "officers readable by staff" ON public.officers FOR SELECT TO authenticated USING (true);
CREATE POLICY "coordinator manages officers" ON public.officers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'coordinator')) WITH CHECK (public.has_role(auth.uid(),'coordinator'));

CREATE TABLE public.emergency_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
GRANT INSERT ON public.emergency_requests TO anon;
GRANT SELECT, INSERT, UPDATE ON public.emergency_requests TO authenticated;
GRANT ALL ON public.emergency_requests TO service_role;
ALTER TABLE public.emergency_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can submit" ON public.emergency_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "staff read requests" ON public.emergency_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff update requests" ON public.emergency_requests FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  available integer NOT NULL DEFAULT 0,
  zone text,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resources TO authenticated;
GRANT ALL ON public.resources TO service_role;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read resources" ON public.resources FOR SELECT TO authenticated USING (true);
CREATE POLICY "coordinator manages resources" ON public.resources FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'coordinator')) WITH CHECK (public.has_role(auth.uid(),'coordinator'));

CREATE TABLE public.agent_outputs (
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
GRANT SELECT ON public.agent_outputs TO authenticated;
GRANT ALL ON public.agent_outputs TO service_role;
ALTER TABLE public.agent_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read agent outputs" ON public.agent_outputs FOR SELECT TO authenticated USING (true);

CREATE TABLE public.response_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.emergency_requests(id) ON DELETE CASCADE,
  summary text NOT NULL,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  resource_allocation jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.response_plans TO authenticated;
GRANT ALL ON public.response_plans TO service_role;
ALTER TABLE public.response_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read plans" ON public.response_plans FOR SELECT TO authenticated USING (true);

INSERT INTO public.officers (username, agent_id, role, status) VALUES
  ('umar','1000','coordinator','on-duty'),
  ('a.rahman','2041','officer','deployed'),
  ('s.iqbal','2042','officer','available'),
  ('n.verma','2043','officer','standby');

INSERT INTO public.resources (name, category, quantity, available, zone, status) VALUES
  ('Rescue boats','Marine',12,5,'Zone A - Riverside','deployed'),
  ('Ambulances','Medical',8,3,'Zone B - Old Town','active'),
  ('Water pumps','Engineering',20,14,'Zone C - Mill District','ready'),
  ('Medical kits','Medical',150,92,'Central Depot','ready'),
  ('Relief shelters','Shelter',6,2,'Zone D - Green Fields','active'),
  ('Food & water pallets','Logistics',300,180,'Central Depot','ready'),
  ('Search & rescue teams','Personnel',10,4,'Zone E - Harbour Road','deployed');

INSERT INTO public.emergency_requests (ref_code, emergency_type, severity, people_count, medical_notes, location_text, zone, status) VALUES
  ('RQ-48211','Flood - trapped','critical',6,'One elderly person on oxygen','14 Riverside Lane','Zone A - Riverside','dispatched'),
  ('RQ-48212','Flood - medical','high',2,'Diabetic, insulin needed','Old Town Market, Block 3','Zone B - Old Town','in-progress'),
  ('RQ-48213','Flood - evacuation','moderate',14,NULL,'Mill District community hall','Zone C - Mill District','received'),
  ('RQ-48214','Flood - supplies','moderate',30,'Two infants, needs formula','Green Fields relief camp','Zone D - Green Fields','received'),
  ('RQ-48215','Flood - trapped','critical',3,'Possible fracture','Harbour Road, warehouse roof','Zone E - Harbour Road','dispatched');