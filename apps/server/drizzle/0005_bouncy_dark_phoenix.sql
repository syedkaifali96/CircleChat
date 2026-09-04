ALTER TABLE "media" DROP CONSTRAINT "media_kind_ck";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_type_ck";
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_kind_ck" CHECK ("media"."kind" IN ('image', 'video', 'voice', 'file', 'avatar', 'gif'));
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_type_ck" CHECK ("messages"."type" IN ('text', 'image', 'video', 'voice', 'file', 'gif'));
