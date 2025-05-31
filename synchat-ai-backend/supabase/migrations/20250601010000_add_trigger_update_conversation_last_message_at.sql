-- Function to update the last_message_at timestamp in the conversations table
CREATE OR REPLACE FUNCTION public.update_conversation_last_message_at()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the last_message_at field of the corresponding conversation
    -- with the timestamp of the new message.
    UPDATE public.conversations
    SET last_message_at = NEW.timestamp
    WHERE conversation_id = NEW.conversation_id; -- Corrected: conversation_id instead of id

    -- Return the new message record
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.update_conversation_last_message_at() IS 'Trigger function to update the last_message_at field in the conversations table when a new message is inserted.';

-- Trigger to update conversation timestamp after a new message is inserted
CREATE TRIGGER on_new_message_update_conversation_timestamp
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.update_conversation_last_message_at();

COMMENT ON TRIGGER on_new_message_update_conversation_timestamp ON public.messages IS 'After a new message is inserted, updates the last_message_at timestamp in the parent conversation record.';
