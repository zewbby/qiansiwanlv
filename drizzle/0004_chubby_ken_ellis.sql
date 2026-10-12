CREATE TABLE `salon_sync_batches` (
	`owner_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`base_revision` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_owner_batch` ON `salon_sync_batches` (`owner_id`,`batch_id`);--> statement-breakpoint
CREATE TABLE `salon_sync_state` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO salon_sync_state(owner_id,revision) SELECT owner_id,0 FROM salon_settings;
--> statement-breakpoint
CREATE TRIGGER salon_sync_batch_guard BEFORE INSERT ON salon_sync_batches
WHEN NEW.base_revision <> COALESCE((SELECT revision FROM salon_sync_state WHERE owner_id=NEW.owner_id),0)
BEGIN SELECT RAISE(ABORT,'sync_revision_conflict'); END;
--> statement-breakpoint
CREATE TRIGGER sync_salon_members_insert AFTER INSERT ON salon_members BEGIN INSERT INTO salon_sync_state(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;

--> statement-breakpoint
CREATE TRIGGER sync_salon_members_update AFTER UPDATE ON salon_members BEGIN INSERT INTO salon_sync_state(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;

--> statement-breakpoint
CREATE TRIGGER sync_salon_cards_insert AFTER INSERT ON salon_cards BEGIN INSERT INTO salon_sync_state(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;

--> statement-breakpoint
CREATE TRIGGER sync_salon_cards_update AFTER UPDATE ON salon_cards BEGIN INSERT INTO salon_sync_state(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;

--> statement-breakpoint
CREATE TRIGGER sync_salon_transactions_insert AFTER INSERT ON salon_transactions BEGIN INSERT INTO salon_sync_state(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;

--> statement-breakpoint
CREATE TRIGGER sync_salon_transactions_update AFTER UPDATE ON salon_transactions BEGIN INSERT INTO salon_sync_state(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;

--> statement-breakpoint
CREATE TRIGGER sync_salon_services_insert AFTER INSERT ON salon_services BEGIN INSERT INTO salon_sync_state(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;

--> statement-breakpoint
CREATE TRIGGER sync_salon_services_update AFTER UPDATE ON salon_services BEGIN INSERT INTO salon_sync_state(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;

--> statement-breakpoint
CREATE TRIGGER sync_salon_settings_insert AFTER INSERT ON salon_settings BEGIN INSERT INTO salon_sync_state(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;

--> statement-breakpoint
CREATE TRIGGER sync_salon_settings_update AFTER UPDATE ON salon_settings BEGIN INSERT INTO salon_sync_state(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;

