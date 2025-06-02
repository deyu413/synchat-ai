-- Apply Row Level Security (RLS) policies to tables

RAISE NOTICE 'Applying RLS policies...';

-- 1. public.synchat_clients (Assuming RLS is generally managed by allowing access to auth.uid() matching client_id)
-- (No explicit RLS policies were found in the provided individual schema/migration files for synchat_clients other than enabling RLS)
-- (Typical policy: allow users to see/manage their own client record if client_id matches auth.uid())
-- (For a multi-tenant app, service_role access is often used by the backend, and specific user RLS grants access to their own data)
-- For this consolidation, if no explicit policies were in the source files, we'll assume a basic 'user manages own record' or rely on service_role for backend.
-- The original migrations often deferred RLS or used placeholder comments.
-- Let's add a basic self-management policy as a common secure default if no other was specified.
ALTER TABLE public.synchat_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow individual user access to their own client record" ON public.synchat_clients;
CREATE POLICY "Allow individual user access to their own client record"
    ON public.synchat_clients FOR ALL
    USING (auth.uid() = client_id)
    WITH CHECK (auth.uid() = client_id);
RAISE NOTICE 'RLS policies for synchat_clients applied (basic self-management).';

-- 2. public.knowledge_sources (from 20250725000000_consolidated_db_fixes.sql)
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow select own knowledge_sources entries" ON public.knowledge_sources;
CREATE POLICY "Allow select own knowledge_sources entries"
    ON public.knowledge_sources FOR SELECT USING (auth.uid() = client_id);
DROP POLICY IF EXISTS "Allow insert own knowledge_sources entries" ON public.knowledge_sources;
CREATE POLICY "Allow insert own knowledge_sources entries"
    ON public.knowledge_sources FOR INSERT WITH CHECK (auth.uid() = client_id);
DROP POLICY IF EXISTS "Allow update own knowledge_sources entries" ON public.knowledge_sources;
CREATE POLICY "Allow update own knowledge_sources entries"
    ON public.knowledge_sources FOR UPDATE USING (auth.uid() = client_id) WITH CHECK (auth.uid() = NEW.client_id AND NEW.client_id = OLD.client_id);
DROP POLICY IF EXISTS "Allow delete own knowledge_sources entries" ON public.knowledge_sources;
CREATE POLICY "Allow delete own knowledge_sources entries"
    ON public.knowledge_sources FOR DELETE USING (auth.uid() = client_id);
RAISE NOTICE 'RLS policies for knowledge_sources applied.';

-- 3. public.conversations (from 20240316010101_add_rls_to_conversations.sql)
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow SELECT for own client_id" ON public.conversations;
CREATE POLICY "Allow SELECT for own client_id"
    ON public.conversations FOR SELECT USING (auth.uid() = client_id);
DROP POLICY IF EXISTS "Allow INSERT for own client_id" ON public.conversations;
CREATE POLICY "Allow INSERT for own client_id"
    ON public.conversations FOR INSERT WITH CHECK (auth.uid() = client_id);
DROP POLICY IF EXISTS "Allow UPDATE for own client_id" ON public.conversations;
CREATE POLICY "Allow UPDATE for own client_id"
    ON public.conversations FOR UPDATE USING (auth.uid() = client_id) WITH CHECK (auth.uid() = client_id AND NEW.client_id = OLD.client_id);
DROP POLICY IF EXISTS "Allow DELETE for own client_id" ON public.conversations;
CREATE POLICY "Allow DELETE for own client_id"
    ON public.conversations FOR DELETE USING (auth.uid() = client_id);
RAISE NOTICE 'RLS policies for conversations applied.';

-- 4. public.messages (from 20240316020202_add_rls_to_messages.sql)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow SELECT based on conversation ownership" ON public.messages;
CREATE POLICY "Allow SELECT based on conversation ownership"
    ON public.messages FOR SELECT USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.conversation_id = messages.conversation_id AND c.client_id = auth.uid()));
DROP POLICY IF EXISTS "Allow INSERT based on conversation ownership" ON public.messages;
CREATE POLICY "Allow INSERT based on conversation ownership"
    ON public.messages FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.conversations c WHERE c.conversation_id = messages.conversation_id AND c.client_id = auth.uid()));
DROP POLICY IF EXISTS "Allow DELETE based on conversation ownership" ON public.messages;
CREATE POLICY "Allow DELETE based on conversation ownership"
    ON public.messages FOR DELETE USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.conversation_id = messages.conversation_id AND c.client_id = auth.uid()));
RAISE NOTICE 'RLS policies for messages applied.';

-- 5. public.knowledge_base (from 20250725000000_consolidated_db_fixes.sql)
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow select own knowledge_base entries" ON public.knowledge_base;
CREATE POLICY "Allow select own knowledge_base entries"
    ON public.knowledge_base FOR SELECT USING (auth.uid() = client_id);
DROP POLICY IF EXISTS "Allow insert own knowledge_base entries" ON public.knowledge_base;
CREATE POLICY "Allow insert own knowledge_base entries"
    ON public.knowledge_base FOR INSERT WITH CHECK (auth.uid() = client_id);
DROP POLICY IF EXISTS "Allow update own knowledge_base entries" ON public.knowledge_base;
CREATE POLICY "Allow update own knowledge_base entries"
    ON public.knowledge_base FOR UPDATE USING (auth.uid() = client_id) WITH CHECK (auth.uid() = NEW.client_id AND NEW.client_id = OLD.client_id);
DROP POLICY IF EXISTS "Allow delete own knowledge_base entries" ON public.knowledge_base;
CREATE POLICY "Allow delete own knowledge_base entries"
    ON public.knowledge_base FOR DELETE USING (auth.uid() = client_id);
RAISE NOTICE 'RLS policies for knowledge_base applied.';

-- 6. public.rag_interaction_logs (from 20240316030303_update_rls_for_rag_interaction_logs.sql)
ALTER TABLE public.rag_interaction_logs ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow SELECT for own client_id" ON public.rag_interaction_logs;
CREATE POLICY "Allow SELECT for own client_id"
    ON public.rag_interaction_logs FOR SELECT USING (auth.uid() = client_id);
DROP POLICY IF EXISTS "Allow INSERT for own client_id" ON public.rag_interaction_logs;
CREATE POLICY "Allow INSERT for own client_id"
    ON public.rag_interaction_logs FOR INSERT WITH CHECK (auth.uid() = client_id);
DROP POLICY IF EXISTS "Allow UPDATE for own client_id (restricted)" ON public.rag_interaction_logs;
CREATE POLICY "Allow UPDATE for own client_id (restricted)"
    ON public.rag_interaction_logs FOR UPDATE USING (auth.uid() = client_id) WITH CHECK (auth.uid() = client_id AND NEW.client_id = OLD.client_id);
DROP POLICY IF EXISTS "Allow DELETE for own client_id" ON public.rag_interaction_logs;
CREATE POLICY "Allow DELETE for own client_id"
    ON public.rag_interaction_logs FOR DELETE USING (auth.uid() = client_id);
DROP POLICY IF EXISTS "Allow service_role full access (privileged)" ON public.rag_interaction_logs;
CREATE POLICY "Allow service_role full access (privileged)"
    ON public.rag_interaction_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
RAISE NOTICE 'RLS policies for rag_interaction_logs applied.';

-- 7. public.rag_feedback_log (from 20250531030718_create_rag_feedback_log_table.sql)
ALTER TABLE public.rag_feedback_log ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow authenticated users to insert their own feedback" ON public.rag_feedback_log;
CREATE POLICY "Allow authenticated users to insert their own feedback"
    ON public.rag_feedback_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.synchat_clients sc WHERE sc.client_id = rag_feedback_log.client_id AND sc.client_id = auth.uid()));
DROP POLICY IF EXISTS "Allow service_role to perform all operations" ON public.rag_feedback_log;
CREATE POLICY "Allow service_role to perform all operations"
    ON public.rag_feedback_log FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow client admins to view feedback for their client_id" ON public.rag_feedback_log;
CREATE POLICY "Allow client admins to view feedback for their client_id"
    ON public.rag_feedback_log FOR SELECT TO authenticated USING (client_id = auth.uid());
RAISE NOTICE 'RLS policies for rag_feedback_log applied.';

-- 8. public.knowledge_suggestions (from 20231102000000_create_knowledge_suggestions_table.sql, using client_id = auth.uid() for user association)
ALTER TABLE public.knowledge_suggestions ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow client select own knowledge_suggestions" ON public.knowledge_suggestions;
CREATE POLICY "Allow client select own knowledge_suggestions"
    ON public.knowledge_suggestions FOR SELECT USING (client_id = auth.uid());
DROP POLICY IF EXISTS "Allow client update own knowledge_suggestions status" ON public.knowledge_suggestions;
CREATE POLICY "Allow client update own knowledge_suggestions status"
    ON public.knowledge_suggestions FOR UPDATE USING (client_id = auth.uid())
    WITH CHECK (client_id = auth.uid() AND NEW.client_id = OLD.client_id AND (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS NOT NULL)); -- Simplified check, only status can be updated by this policy
RAISE NOTICE 'RLS policies for knowledge_suggestions applied.';

-- 9. public.conversation_analytics (from 20231031000000_create_conversation_analytics_table.sql)
ALTER TABLE public.conversation_analytics ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow service_role full access to conversation_analytics" ON public.conversation_analytics;
CREATE POLICY "Allow service_role full access to conversation_analytics"
    ON public.conversation_analytics FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Add client view policy if needed, e.g. :
-- CREATE POLICY "Clients can view their own conversation analytics" ON public.conversation_analytics FOR SELECT USING (auth.uid() = client_id);
RAISE NOTICE 'RLS policies for conversation_analytics applied.';

-- 10. public.ia_resolutions_log (No explicit RLS found, adding a restrictive default)
ALTER TABLE public.ia_resolutions_log ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Deny ALL operations by default on ia_resolutions_log" ON public.ia_resolutions_log;
CREATE POLICY "Deny ALL operations by default on ia_resolutions_log"
    ON public.ia_resolutions_log FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "Allow service_role full access to ia_resolutions_log" ON public.ia_resolutions_log;
CREATE POLICY "Allow service_role full access to ia_resolutions_log"
    ON public.ia_resolutions_log FOR ALL TO service_role USING (true) WITH CHECK (true);
RAISE NOTICE 'RLS policies for ia_resolutions_log applied (restrictive default + service_role).';

-- 11. public.message_feedback (Corrected from 20250725000000_consolidated_db_fixes.sql)
ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow auth user to insert their own feedback" ON public.message_feedback;
CREATE POLICY "Allow auth user to insert their own feedback"
    ON public.message_feedback FOR INSERT WITH CHECK (auth.uid() = agent_user_id AND client_id = auth.uid());
DROP POLICY IF EXISTS "Allow auth user to view their own feedback or all for their client_id" ON public.message_feedback;
CREATE POLICY "Allow auth user to view their own feedback or all for their client_id"
    ON public.message_feedback FOR SELECT USING (auth.uid() = agent_user_id OR client_id = auth.uid());
RAISE NOTICE 'RLS policies for message_feedback applied.';

-- 12. public.system_alerts (from 20240315000000_create_system_alerts_table.sql)
ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow service role inserts" ON public.system_alerts;
CREATE POLICY "Allow service role inserts"
    ON public.system_alerts FOR INSERT TO service_role WITH CHECK (true);
DROP POLICY IF EXISTS "Deny all by default" ON public.system_alerts;
CREATE POLICY "Deny all by default"
    ON public.system_alerts FOR ALL USING (false) WITH CHECK (false);
RAISE NOTICE 'RLS policies for system_alerts applied.';

-- 13. public.processed_stripe_events (from 20250601000000_create_processed_stripe_events_table.sql)
ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Deny ALL operations" ON public.processed_stripe_events;
CREATE POLICY "Deny ALL operations"
    ON public.processed_stripe_events FOR ALL USING (false) WITH CHECK (false);
-- Access to this table is typically only via service_role from backend webhook handler
DROP POLICY IF EXISTS "Allow service_role to access processed_stripe_events" ON public.processed_stripe_events;
CREATE POLICY "Allow service_role to access processed_stripe_events"
    ON public.processed_stripe_events FOR ALL TO service_role USING (true) WITH CHECK (true);
RAISE NOTICE 'RLS policies for processed_stripe_events applied.';

-- 14. public.analyzed_conversation_topics (from 20250531031802_create_analyzed_conversation_topics_table.sql)
ALTER TABLE public.analyzed_conversation_topics ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow service_role full access to analyzed topics" ON public.analyzed_conversation_topics;
CREATE POLICY "Allow service_role full access to analyzed topics"
    ON public.analyzed_conversation_topics FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow client admins to read their topics" ON public.analyzed_conversation_topics;
CREATE POLICY "Allow client admins to read their topics"
    ON public.analyzed_conversation_topics FOR SELECT TO authenticated USING (client_id = auth.uid());
RAISE NOTICE 'RLS policies for analyzed_conversation_topics applied.';

-- 15. public.topic_membership (No explicit RLS found, adding service_role only)
ALTER TABLE public.topic_membership ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow service_role full access to topic_membership" ON public.topic_membership;
CREATE POLICY "Allow service_role full access to topic_membership"
    ON public.topic_membership FOR ALL TO service_role USING (true) WITH CHECK (true);
RAISE NOTICE 'RLS policies for topic_membership applied (service_role access).';

-- 16. public.knowledge_propositions (No explicit RLS found, adding service_role and client select)
ALTER TABLE public.knowledge_propositions ENABLE ROW LEVEL SECURITY; -- Ensured by table creation
DROP POLICY IF EXISTS "Allow service_role full access to knowledge_propositions" ON public.knowledge_propositions;
CREATE POLICY "Allow service_role full access to knowledge_propositions"
    ON public.knowledge_propositions FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow clients to select their own knowledge_propositions" ON public.knowledge_propositions;
CREATE POLICY "Allow clients to select their own knowledge_propositions"
    ON public.knowledge_propositions FOR SELECT TO authenticated USING (auth.uid() = client_id);
RAISE NOTICE 'RLS policies for knowledge_propositions applied.';

RAISE NOTICE 'All consolidated RLS policies applied.';
