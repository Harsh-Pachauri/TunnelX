CREATE TABLE "request_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tunnel_id" uuid NOT NULL,
	"stream_id" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status_code" integer,
	"request_bytes" integer DEFAULT 0 NOT NULL,
	"response_bytes" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"client_ip" text,
	"user_agent" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_tunnel_id_tunnels_id_fk" FOREIGN KEY ("tunnel_id") REFERENCES "public"."tunnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_logs_tunnel_id_created_at_idx" ON "request_logs" USING btree ("tunnel_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "request_logs_created_at_idx" ON "request_logs" USING btree ("created_at");