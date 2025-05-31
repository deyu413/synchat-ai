-- Migration to create RPC functions for fetching analytics data

-- Function to get aggregated analytics summary
CREATE OR REPLACE FUNCTION public.get_analytics_summary(
    p_client_id UUID,
    p_from_date TIMESTAMPTZ,
    p_to_date TIMESTAMPTZ
)
RETURNS TABLE (
    total_conversations BIGINT,
    escalated_conversations BIGINT,
    unanswered_by_bot_conversations BIGINT,
    avg_messages_per_conversation DOUBLE PRECISION,
    avg_duration_seconds DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) AS total_conversations,
        SUM(CASE WHEN ca.escalation_timestamp IS NOT NULL THEN 1 ELSE 0 END) AS escalated_conversations,
        SUM(CASE WHEN ca.tags @> ARRAY['bot_cannot_answer']::text[] THEN 1 ELSE 0 END) AS unanswered_by_bot_conversations,
        AVG(ca.total_messages) AS avg_messages_per_conversation,
        (SELECT AVG(EXTRACT(EPOCH FROM (COALESCE(ca_sub.last_message_at, NOW()) - ca_sub.first_message_at)))
         FROM public.conversation_analytics ca_sub
         WHERE ca_sub.client_id = p_client_id
           AND ca_sub.first_message_at >= p_from_date
           AND ca_sub.first_message_at < p_to_date
           AND ca_sub.resolution_status IS NOT NULL AND ca_sub.resolution_status::text <> 'active' -- Ensure only completed convos for duration
        ) AS avg_duration_seconds
    FROM public.conversation_analytics ca
    WHERE ca.client_id = p_client_id
      AND ca.first_message_at >= p_from_date
      AND ca.first_message_at < p_to_date;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_analytics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
IS 'Fetches aggregated conversation analytics for a given client and date range. avg_duration_seconds is calculated for conversations that are no longer active.';

-- Function to get unanswered query suggestions
CREATE OR REPLACE FUNCTION public.get_unanswered_query_suggestions(
    p_client_id UUID,
    p_from_date TIMESTAMPTZ,
    p_to_date TIMESTAMPTZ,
    p_limit INTEGER
)
RETURNS TABLE (
    summary TEXT,
    frequency BIGINT,
    last_occurred_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ca.summary,
        COUNT(*) AS frequency,
        MAX(ca.first_message_at) AS last_occurred_at
    FROM public.conversation_analytics ca
    WHERE
        ca.client_id = p_client_id
        AND ca.first_message_at >= p_from_date
        AND ca.first_message_at < p_to_date
        AND (ca.escalation_timestamp IS NOT NULL OR ca.tags @> ARRAY['bot_cannot_answer']::text[])
        AND ca.summary IS NOT NULL AND ca.summary <> ''
    GROUP BY ca.summary
    ORDER BY frequency DESC, MAX(ca.first_message_at) DESC -- Ensure consistent ordering for ties in frequency
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_unanswered_query_suggestions(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER)
IS 'Fetches common summaries (containing user queries) from conversations that were escalated or where the bot could not answer, grouped by summary content and ordered by frequency.';

-- Note on Security:
-- Both functions are created with the default SECURITY INVOKER.
-- This means they execute with the permissions of the role calling them.
-- Since databaseService.js uses the Supabase service_role key, these functions will have
-- the necessary permissions to access the conversation_analytics table, bypassing RLS if any were restrictive.
-- If these functions were to be called by less privileged roles directly via PostgREST,
-- then RLS on conversation_analytics would apply, or SECURITY DEFINER with careful search_path management would be needed.
