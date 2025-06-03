-- Define custom ENUM types used in various tables

DO $$ BEGIN
    CREATE TYPE public.suggestion_type AS ENUM ('content_gap', 'new_faq_from_escalation', 'new_faq_from_success', 'chunk_needs_review'); -- Added 'chunk_needs_review'
EXCEPTION
    WHEN duplicate_object THEN null; -- Type suggestion_type already exists, skipping.
END $$;
COMMENT ON TYPE public.suggestion_type IS 'Defines the types of suggestions that can be generated for knowledge base improvement, including flagging chunks for review.';

DO $$ BEGIN
    CREATE TYPE public.suggestion_status AS ENUM ('new', 'reviewed_pending_action', 'action_taken', 'dismissed');
EXCEPTION
    WHEN duplicate_object THEN null; -- Type suggestion_status already exists, skipping.
END $$;
COMMENT ON TYPE public.suggestion_status IS 'Defines the lifecycle statuses for knowledge suggestions.';

DO $$ BEGIN
    CREATE TYPE public.conversation_status_type AS ENUM (
        'open',
        'bot_active',
        'escalated_to_human',
        'awaiting_agent_reply',
        'agent_replied',
        'closed_by_agent',
        'closed_by_user',
        'resolved_by_ia',
        'archived'
    );
EXCEPTION
    WHEN duplicate_object THEN null; -- Type conversation_status_type already exists, skipping.
END $$;
COMMENT ON TYPE public.conversation_status_type IS 'Defines the set of possible statuses for a conversation.';

DO $$ BEGIN
    CREATE TYPE public.message_sender_type AS ENUM (
        'user',
        'bot',
        'agent'
    );
EXCEPTION
    WHEN duplicate_object THEN null; -- Type message_sender_type already exists, skipping.
END $$;
COMMENT ON TYPE public.message_sender_type IS 'Defines the type of sender for a message: user, bot, or agent.';

DO $$ BEGIN
    CREATE TYPE public.alert_severity AS ENUM (
        'info',
        'warning',
        'error',
        'critical'
    );
EXCEPTION
    WHEN duplicate_object THEN null; -- Type alert_severity already exists, skipping.
END $$;
COMMENT ON TYPE public.alert_severity IS 'Defines the severity levels for system alerts.';
