-- M1 database-level invariants (docs/DATABASE.md section 1.3, section 1.6, section 1.13, section 1.14, section 3).
-- These are the strongest realistic PostgreSQL enforcements; the application
-- layer adds transactional checks on top (conditional joins under row locks).

-- ---------------------------------------------------------------------------
-- Avatar foreign keys
-- Declared without .references() in the Drizzle schema to break the circular
-- CREATE TABLE dependency (users/circles <-> media); physical FKs live here.
-- Deleting a media row clears the avatar reference instead of blocking.
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_media_id_media_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circles" ADD CONSTRAINT "circles_avatar_media_id_media_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5-member Circle limit + denormalized members_count maintenance
-- Layer 1: BEFORE INSERT trigger re-counts actual membership and rejects the
--          sixth member (CIRCLE_FULL). Layer 2: CHECK (members_count <= 5)
--          (declared in migration 0000). Layer 3: the future service layer
--          inserts members conditionally under a row lock (M4).
-- The AFTER triggers keep members_count in sync and self-heal drift.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION circlechat_circle_members_before_insert() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM circle_members WHERE circle_id = NEW.circle_id) >= 5 THEN
    RAISE EXCEPTION 'CIRCLE_FULL';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER circle_members_capacity_guard
BEFORE INSERT ON circle_members
FOR EACH ROW EXECUTE FUNCTION circlechat_circle_members_before_insert();--> statement-breakpoint

CREATE OR REPLACE FUNCTION circlechat_circle_members_sync_count() RETURNS trigger AS $$
DECLARE
  v_circle uuid;
BEGIN
  v_circle := CASE WHEN TG_OP = 'DELETE' THEN OLD.circle_id ELSE NEW.circle_id END;
  UPDATE circles
  SET members_count = (SELECT count(*) FROM circle_members WHERE circle_id = v_circle)
  WHERE id = v_circle;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER circle_members_count_sync_insert
AFTER INSERT ON circle_members
FOR EACH ROW EXECUTE FUNCTION circlechat_circle_members_sync_count();--> statement-breakpoint

CREATE TRIGGER circle_members_count_sync_delete
AFTER DELETE ON circle_members
FOR EACH ROW EXECUTE FUNCTION circlechat_circle_members_sync_count();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Direct-conversation participant invariant
-- A 'direct' conversation must always have exactly two participants.
-- INSERT: a third participant is rejected. DELETE: removing a participant from
-- a still-existing direct conversation is rejected. When the parent
-- conversation row is already gone (cascade delete), the guard allows the
-- delete so cascades never break.
-- Note: this invariant intentionally blocks cascading a user deletion while
-- they participate in a direct conversation; account deletion is post-MVP and
-- the future service layer must handle DM cleanup first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION circlechat_conversation_participants_guard() RETURNS trigger AS $$
DECLARE
  v_conversation uuid;
  v_type text;
  v_count int;
BEGIN
  v_conversation := CASE WHEN TG_OP = 'DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END;
  SELECT type INTO v_type FROM conversations WHERE id = v_conversation;
  IF v_type IS NULL OR v_type <> 'direct' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_count := (SELECT count(*) FROM conversation_participants WHERE conversation_id = NEW.conversation_id);
    IF v_count >= 2 THEN
      RAISE EXCEPTION 'DIRECT_PARTICIPANT_LIMIT';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_count := (SELECT count(*) FROM conversation_participants WHERE conversation_id = OLD.conversation_id);
    IF v_count - 1 < 2 THEN
      RAISE EXCEPTION 'DIRECT_PARTICIPANT_MINIMUM';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER conversation_participants_direct_guard
BEFORE INSERT OR DELETE ON conversation_participants
FOR EACH ROW EXECUTE FUNCTION circlechat_conversation_participants_guard();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Polls exist only on Circle conversations (never on direct conversations)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION circlechat_polls_circle_only() RETURNS trigger AS $$
DECLARE
  v_type text;
BEGIN
  SELECT type INTO v_type FROM conversations WHERE id = NEW.conversation_id;
  IF v_type IS DISTINCT FROM 'circle' THEN
    RAISE EXCEPTION 'POLLS_CIRCLE_ONLY';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER polls_circle_only_guard
BEFORE INSERT OR UPDATE ON polls
FOR EACH ROW EXECUTE FUNCTION circlechat_polls_circle_only();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Poll votes: option_index must point at an existing option of the poll
-- (the array length bound; the 0..5 hard range is a CHECK in migration 0000)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION circlechat_poll_votes_option_guard() RETURNS trigger AS $$
DECLARE
  v_len int;
BEGIN
  SELECT jsonb_array_length(options) INTO v_len FROM polls WHERE id = NEW.poll_id;
  IF v_len IS NULL OR NEW.option_index >= v_len THEN
    RAISE EXCEPTION 'POLL_OPTION_INVALID';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER poll_votes_option_guard
BEFORE INSERT OR UPDATE ON poll_votes
FOR EACH ROW EXECUTE FUNCTION circlechat_poll_votes_option_guard();
