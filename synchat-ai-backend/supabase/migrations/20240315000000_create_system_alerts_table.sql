CREATE TYPE public.alert_severity AS ENUM (
    'info',
    'warning',
    'error',
    'critical'
);

CREATE TABLE public.system_alerts (
    alert_id BIGSERIAL PRIMARY KEY,
    function_name TEXT NOT NULL,
    severity public.alert_severity NOT NULL,
    message TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role inserts" ON public.system_alerts
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Deny all by default" ON public.system_alerts
FOR ALL
USING (false);
