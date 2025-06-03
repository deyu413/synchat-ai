-- Define or replace all core RPC functions for the application

-- 1. vector_search (latest version with category filter and ivfflat_probes_param)
CREATE OR REPLACE FUNCTION public.vector_search(
    client_id_param uuid,
    query_embedding vector(1536),
    match_threshold double precision,
    match_count integer,
    p_category_filter text[] DEFAULT NULL,
    ivfflat_probes_param INT DEFAULT 10
)
RETURNS TABLE (
    id bigint,
    content text,
    metadata jsonb,
    knowledge_source_id uuid,
    similarity double precision
)
LANGUAGE plpgsql
AS $$
BEGIN
    EXECUTE 'SET LOCAL ivfflat.probes = ' || ivfflat_probes_param::TEXT;
    -- For HNSW (if used as the index): SET LOCAL hnsw.ef_search = <value>; -- Default is 40.

    RETURN QUERY
    SELECT
        kb.id,
        kb.content,
        kb.metadata,
        (kb.metadata->>'original_source_id')::uuid AS knowledge_source_id,
        1 - (kb.embedding <=> query_embedding) AS similarity -- Cosine distance
    FROM
        public.knowledge_base kb
    WHERE
        kb.client_id = client_id_param
        AND (1 - (kb.embedding <=> query_embedding)) > match_threshold
        AND (p_category_filter IS NULL OR (kb.metadata->'category_tags')::jsonb ?| p_category_filter)
    ORDER BY
        similarity DESC
    LIMIT
        match_count;
END;
$$;
COMMENT ON FUNCTION public.vector_search(uuid, vector, double precision, integer, text[], integer)
IS 'Performs vector similarity search on knowledge_base, with optional category filtering and configurable ivfflat_probes. Assumes cosine similarity.';

-- 2. fts_search_with_rank (latest version with category filter and corrected fts column)
CREATE OR REPLACE FUNCTION public.fts_search_with_rank(
    client_id_param uuid,
    query_text text,
    match_count integer,
    p_category_filter text[] DEFAULT NULL,
    language_config REGCONFIG DEFAULT 'pg_catalog.spanish' -- Defaulting to Spanish as per fts_update_trigger_function
)
RETURNS TABLE (
    id bigint,
    content text,
    metadata jsonb,
    knowledge_source_id uuid,
    rank real,
    highlighted_content TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    ts_query_obj tsquery;
BEGIN
    ts_query_obj := websearch_to_tsquery(language_config, query_text);

    RETURN QUERY
    SELECT
        kb.id,
        kb.content,
        kb.metadata,
        (kb.metadata->>'original_source_id')::uuid AS knowledge_source_id,
        ts_rank_cd(kb.fts, ts_query_obj) AS rank,
        ts_headline(
            language_config,
            kb.content,
            ts_query_obj,
            'StartSel=**,StopSel=**,MaxWords=35,MinWords=15,ShortWord=3,HighlightAll=FALSE'
        ) AS highlighted_content
    FROM
        public.knowledge_base kb
    WHERE
        kb.client_id = client_id_param
        AND kb.fts @@ ts_query_obj
        AND (p_category_filter IS NULL OR (kb.metadata->'category_tags')::jsonb ?| p_category_filter)
    ORDER BY
        rank DESC
    LIMIT
        match_count;
END;
$$;
COMMENT ON FUNCTION public.fts_search_with_rank(uuid, text, integer, text[], regconfig)
IS 'Performs Full-Text Search on knowledge_base (using kb.fts and specified language_config), with ranking, highlighting, and optional category filtering.';

-- 3. proposition_vector_search (from 20240715100500_create_search_rpc_functions.sql, assuming no later changes)
-- This RPC depends on knowledge_propositions table, which is NOT YET defined in this sequence.
-- This RPC definition will be moved to a later migration file, after knowledge_propositions is created.
-- For now, it's commented out here.
/*
CREATE OR REPLACE FUNCTION public.proposition_vector_search(
    client_id_param UUID,
    query_embedding VECTOR(1536),
    match_threshold FLOAT,
    match_count INT
)
RETURNS TABLE(proposition_id BIGINT, proposition_text TEXT, source_chunk_id BIGINT, similarity FLOAT)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        kp.proposition_id,
        kp.proposition_text,
        kp.source_chunk_id,
        (1 - (kp.embedding <=> query_embedding)) AS similarity
    FROM
        public.knowledge_propositions kp
    WHERE
        kp.client_id = client_id_param AND (1 - (kp.embedding <=> query_embedding)) > match_threshold
    ORDER BY
        similarity DESC
    LIMIT
        match_count;
END;
$$;
COMMENT ON FUNCTION public.proposition_vector_search(UUID, VECTOR, FLOAT, INT)
IS 'Performs vector similarity search on knowledge_propositions table.';
*/

-- 4. get_analytics_summary (from 20231031010000_create_analytics_rpc_functions.sql)
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
           AND ca_sub.resolution_status IS NOT NULL AND ca_sub.resolution_status::text <> 'bot_active' AND ca_sub.resolution_status::text <> 'open' AND ca_sub.resolution_status::text <> 'awaiting_agent_reply' AND ca_sub.resolution_status::text <> 'agent_replied' AND ca_sub.resolution_status::text <> 'escalated_to_human'
        ) AS avg_duration_seconds
    FROM public.conversation_analytics ca
    WHERE ca.client_id = p_client_id
      AND ca.first_message_at >= p_from_date
      AND ca.first_message_at < p_to_date;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION public.get_analytics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
IS 'Fetches aggregated conversation analytics for a given client and date range. avg_duration_seconds considers only completed/ended conversations.';

-- 5. get_unanswered_query_suggestions (from 20231031010000_create_analytics_rpc_functions.sql)
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
    ORDER BY frequency DESC, MAX(ca.first_message_at) DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION public.get_unanswered_query_suggestions(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER)
IS 'Fetches common summaries from conversations that were escalated or where the bot could not answer.';

-- 6. get_sentiment_distribution_for_client (from 20250531032004_create_rpc_get_sentiment_distribution.sql)
CREATE OR REPLACE FUNCTION public.get_sentiment_distribution_for_client(
    p_client_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
    sentiment TEXT,
    message_count BIGINT,
    percentage NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
    total_messages_in_period BIGINT;
BEGIN
    SELECT COUNT(m.message_id)
    INTO total_messages_in_period
    FROM public.messages m
    JOIN public.conversations c ON m.conversation_id = c.conversation_id
    WHERE c.client_id = p_client_id
      AND m."timestamp" >= p_start_date -- Using m.timestamp
      AND m."timestamp" <= p_end_date   -- Using m.timestamp
      AND m.sentiment IS NOT NULL
      AND m.sender = 'user'::public.message_sender_type;

    IF total_messages_in_period = 0 THEN
        RETURN QUERY SELECT s.type, 0::BIGINT, 0::NUMERIC
                     FROM (VALUES ('positive'), ('negative'), ('neutral')) AS s(type);
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        COALESCE(m.sentiment, 'unknown') AS sentiment,
        COUNT(m.message_id) AS message_count,
        ROUND((COUNT(m.message_id)::NUMERIC * 100.0 / total_messages_in_period), 2) AS percentage
    FROM public.messages m
    JOIN public.conversations c ON m.conversation_id = c.conversation_id
    WHERE c.client_id = p_client_id
      AND m."timestamp" >= p_start_date -- Using m.timestamp
      AND m."timestamp" <= p_end_date   -- Using m.timestamp
      AND m.sentiment IS NOT NULL
      AND m.sender = 'user'::public.message_sender_type
    GROUP BY COALESCE(m.sentiment, 'unknown')
    ORDER BY message_count DESC;
END;
$$;
COMMENT ON FUNCTION public.get_sentiment_distribution_for_client(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
IS 'Calculates the distribution of message sentiments (positive, negative, neutral) for a given client within a specified date range for user messages.';
