-- Define the public.system_alerts table

CREATE TABLE IF NOT EXISTS public.system_alerts (
    alert_id BIGSERIAL PRIMARY KEY,
    function_name TEXT NOT NULL, -- Name of the backend function/module generating the alert
    severity public.alert_severity NOT NULL, -- Uses the ENUM type defined earlier
    message TEXT NOT NULL,
    details JSONB NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Comments
COMMENT ON TABLE public.system_alerts IS 'Stores system-level alerts generated by backend functions or processes.';
COMMENT ON COLUMN public.system_alerts.alert_id IS 'Unique identifier for the system alert.';
COMMENT ON COLUMN public.system_alerts.function_name IS 'Name of the function or module that generated the alert.';
COMMENT ON COLUMN public.system_alerts.severity IS 'Severity level of the alert (info, warning, error, critical).';
COMMENT ON COLUMN public.system_alerts.message IS 'A concise message describing the alert.';
COMMENT ON COLUMN public.system_alerts.details IS 'JSONB field for storing additional details or context about the alert.';
COMMENT ON COLUMN public.system_alerts.created_at IS 'Timestamp of when the alert was created.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_system_alerts_severity ON public.system_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_system_alerts_created_at ON public.system_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_alerts_function_name ON public.system_alerts(function_name);

RAISE NOTICE 'Table public.system_alerts created with comments and indexes.';

-- RLS will be applied in a subsequent, dedicated RLS migration file.
ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;
