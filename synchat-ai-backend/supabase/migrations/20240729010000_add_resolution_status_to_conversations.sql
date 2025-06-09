-- Migration to add resolution tracking to conversations

-- Step 1: Create a new ENUM type for clear resolution states.
CREATE TYPE public.resolution_status_enum AS ENUM (
    'pending',          -- The conversation is active and its final state has not been determined.
    'resolved_by_ia',   -- Successfully resolved by the AI. This is the primary trigger for a billable event.
    'escalated',        -- The conversation was escalated to a human agent.
    'user_abandoned',   -- The user left mid-conversation without a clear resolution signal (e.g., during clarification).
    'ia_cannot_answer'  -- The AI explicitly stated it could not answer the query.
);

-- Step 2: Add the new column to the conversations table.
ALTER TABLE public.conversations
ADD COLUMN resolution_status public.resolution_status_enum DEFAULT 'pending';

-- Step 3: Add a comment for schema clarity.
COMMENT ON COLUMN public.conversations.resolution_status IS 'Tracks the final resolution state of the conversation for analytics and billing.';
