CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"weekly_digest" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "idx_habits_user";--> statement-breakpoint
ALTER TABLE "check_ins" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "total_check_ins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "last_check_in_date" date;--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_checkins_habit_date" ON "check_ins" USING btree ("habit_id","date");--> statement-breakpoint
CREATE INDEX "idx_checkins_created" ON "check_ins" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "idx_follows_followee" ON "follows" USING btree ("followee_id");--> statement-breakpoint
CREATE INDEX "idx_habits_user_created" ON "habits" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "streaks_non_negative" CHECK ("habits"."current_streak" >= 0 AND "habits"."longest_streak" >= 0);