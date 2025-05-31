-- migrations/20250531032004_create_rpc_get_sentiment_distribution.sql
CREATE OR REPLACE FUNCTION get_sentiment_distribution_for_client(
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
    -- Calculate the total number of messages with sentiment within the period for the client
    SELECT COUNT(m.id) -- Changed from COUNT(*) to COUNT(m.id) for clarity
    INTO total_messages_in_period
    FROM public.messages m
    JOIN public.conversations c ON m.conversation_id = c.conversation_id
    WHERE c.client_id = p_client_id
      AND m.created_at >= p_start_date
      AND m.created_at <= p_end_date
      AND m.sentiment IS NOT NULL
      AND m.sender = 'user'; -- Only consider user messages for sentiment distribution

    IF total_messages_in_period = 0 THEN
        -- Return an empty set if no messages with sentiment in the period
        -- Or, could return sentiments with 0 count/percentage if desired
        RETURN QUERY SELECT s.type, 0::BIGINT, 0::NUMERIC
                     FROM (VALUES ('positive'), ('negative'), ('neutral')) AS s(type);
        RETURN;
    END IF;

    -- Return the count and percentage for each sentiment
    RETURN QUERY
    SELECT
        COALESCE(m.sentiment, 'unknown') AS sentiment, -- Should not be 'unknown' due to "m.sentiment IS NOT NULL"
        COUNT(m.id) AS message_count,
        ROUND((COUNT(m.id)::NUMERIC * 100.0 / total_messages_in_period), 2) AS percentage
    FROM public.messages m
    JOIN public.conversations c ON m.conversation_id = c.conversation_id
    WHERE c.client_id = p_client_id
      AND m.created_at >= p_start_date
      AND m.created_at <= p_end_date
      AND m.sentiment IS NOT NULL -- Only include messages where sentiment was classified
      AND m.sender = 'user'      -- Only user messages
    GROUP BY COALESCE(m.sentiment, 'unknown') -- Group by the actual sentiment values
    ORDER BY message_count DESC;

END;
$$;

COMMENT ON FUNCTION get_sentiment_distribution_for_client(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
IS 'Calculates the distribution of message sentiments (positive, negative, neutral) for a given client within a specified date range for user messages.';
