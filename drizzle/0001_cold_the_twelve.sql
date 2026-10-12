CREATE TABLE `salon_login_limits` ( `id` text PRIMARY KEY NOT NULL, `attempts` integer NOT NULL, `window_start` integer NOT NULL );
--> statement-breakpoint
CREATE TABLE `salon_sessions` ( `token_hash` text PRIMARY KEY NOT NULL, `owner_id` text NOT NULL, `expires_at` integer NOT NULL, `credential_version` text NOT NULL );
--> statement-breakpoint
CREATE INDEX `session_expiry` ON `salon_sessions` (`expires_at`);
