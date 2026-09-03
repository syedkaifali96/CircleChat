ALTER TABLE "conversation_participants" ADD COLUMN "last_read_message_id" uuid;
--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_last_read_message_id_messages_id_fk" FOREIGN KEY ("last_read_message_id") REFERENCES "messages"("id") ON DELETE set null ON UPDATE no action;
