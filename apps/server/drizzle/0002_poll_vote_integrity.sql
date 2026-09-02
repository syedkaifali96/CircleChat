-- M1 fix: poll option/vote integrity on the UPDATE path (docs/DATABASE.md sections 1.13-1.14).
-- The INSERT/UPDATE guard on poll_votes (migration 0001) validates votes
-- against the poll's CURRENT options. This trigger closes the update-path
-- loophole: a poll's options cannot be changed to a set that would leave an
-- existing vote pointing past the end of the array. question/closes_at
-- updates are unaffected; options updates that keep every existing vote
-- valid remain allowed.
CREATE OR REPLACE FUNCTION circlechat_polls_options_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM poll_votes
    WHERE poll_id = NEW.id AND option_index >= jsonb_array_length(NEW.options)
  ) THEN
    RAISE EXCEPTION 'POLL_OPTIONS_INVALIDATE_VOTES';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER polls_options_guard
BEFORE UPDATE OF options ON polls
FOR EACH ROW EXECUTE FUNCTION circlechat_polls_options_guard();
