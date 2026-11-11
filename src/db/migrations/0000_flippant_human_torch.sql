CREATE TABLE "ad_tickets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"nonce" text NOT NULL,
	"price_paid" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_tickets_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "ad_views" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"provider" text NOT NULL,
	"nonce" text NOT NULL,
	"rewarded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_views_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_id" bigint NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anomalies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"kind" text NOT NULL,
	"score" numeric,
	"payload" jsonb,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_activity" (
	"user_id" bigint NOT NULL,
	"date_key" date NOT NULL,
	"taps" integer DEFAULT 0 NOT NULL,
	"ads_watched" integer DEFAULT 0 NOT NULL,
	"seconds_active" integer DEFAULT 0 NOT NULL,
	"quests_done" integer DEFAULT 0 NOT NULL,
	"coins_earned" bigint DEFAULT 0 NOT NULL,
	"momentum_snapshot" numeric(4, 2),
	"purchases" integer DEFAULT 0 NOT NULL,
	"workers_rented" integer DEFAULT 0 NOT NULL,
	"checked_in" boolean DEFAULT false NOT NULL,
	CONSTRAINT "daily_activity_user_id_date_key_pk" PRIMARY KEY("user_id","date_key")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"day_key" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"telegram_payment_charge_id" text NOT NULL,
	"stars" integer NOT NULL,
	"coins" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_telegram_payment_charge_id_unique" UNIQUE("telegram_payment_charge_id")
);
--> statement-breakpoint
CREATE TABLE "redemptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"coins" bigint NOT NULL,
	"gift_id" text NOT NULL,
	"stars" integer NOT NULL,
	"status" text NOT NULL,
	"admin_message_id" bigint,
	"error" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redemptions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"referrer_id" bigint NOT NULL,
	"invitee_id" bigint NOT NULL,
	"qualified" boolean DEFAULT false NOT NULL,
	"signup_ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_referrer_id_invitee_id_pk" PRIMARY KEY("referrer_id","invitee_id"),
	CONSTRAINT "referrals_invitee_id_unique" UNIQUE("invitee_id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"delta" bigint NOT NULL,
	"type" text NOT NULL,
	"ref_id" text,
	"idempotency_key" text,
	"momentum" numeric(4, 2),
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "upgrades" (
	"user_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "upgrades_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "used_nonces" (
	"user_id" bigint NOT NULL,
	"nonce" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "used_nonces_user_id_scope_nonce_pk" PRIMARY KEY("user_id","scope","nonce")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"username" text,
	"first_name" text,
	"photo_url" text,
	"language_code" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"energy" integer DEFAULT 50 NOT NULL,
	"energy_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"momentum" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"momentum_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"streak_days" integer DEFAULT 0 NOT NULL,
	"last_checkin_date" date,
	"referral_code" text NOT NULL,
	"referred_by" bigint,
	"referral_unlock" boolean DEFAULT false NOT NULL,
	"lifetime_coins_earned" bigint DEFAULT 0 NOT NULL,
	"lifetime_ad_views" integer DEFAULT 0 NOT NULL,
	"est_revenue_micro" bigint DEFAULT 0 NOT NULL,
	"risk_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active_buffs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id"),
	CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code"),
	CONSTRAINT "users_balance_non_negative" CHECK ("users"."balance" >= 0),
	CONSTRAINT "users_energy_non_negative" CHECK ("users"."energy" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"tier" integer NOT NULL,
	"rental_started_at" timestamp with time zone NOT NULL,
	"rental_ends_at" timestamp with time zone NOT NULL,
	"last_collected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_tickets" ADD CONSTRAINT "ad_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_views" ADD CONSTRAINT "ad_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_activity" ADD CONSTRAINT "daily_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_invitee_id_users_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrades" ADD CONSTRAINT "upgrades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_nonces" ADD CONSTRAINT "used_nonces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_tickets_user_idx" ON "ad_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ad_views_user_created_idx" ON "ad_views" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "anomalies_resolved_idx" ON "anomalies" USING btree ("resolved","created_at");--> statement-breakpoint
CREATE INDEX "anomalies_user_idx" ON "anomalies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "daily_activity_date_idx" ON "daily_activity" USING btree ("date_key");--> statement-breakpoint
CREATE INDEX "notifications_user_sent_idx" ON "notifications" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_kind_day_uq" ON "notifications" USING btree ("user_id","kind","day_key");--> statement-breakpoint
CREATE INDEX "redemptions_status_idx" ON "redemptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "redemptions_user_created_idx" ON "redemptions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "referrals_ip_idx" ON "referrals" USING btree ("signup_ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "transactions_user_created_idx" ON "transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_type_created_idx" ON "transactions" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "transactions_ref_idx" ON "transactions" USING btree ("ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "used_nonces_nonce_uq" ON "used_nonces" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by");--> statement-breakpoint
CREATE INDEX "workers_user_idx" ON "workers" USING btree ("user_id");