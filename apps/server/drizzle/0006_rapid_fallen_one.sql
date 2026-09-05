ALTER TABLE "pinboard_items" DROP CONSTRAINT "pinboard_items_content_len_ck";--> statement-breakpoint
ALTER TABLE "pinboard_items" DROP COLUMN "content";--> statement-breakpoint
ALTER TABLE "pinboard_items" DROP COLUMN "order_index";