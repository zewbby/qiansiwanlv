CREATE TABLE `salon_cards` ( `id` text PRIMARY KEY NOT NULL, `owner_id` text NOT NULL, `member_id` text NOT NULL, `name` text NOT NULL, `type` text NOT NULL, `cash_balance_cents` integer DEFAULT 0 NOT NULL, `gift_balance_cents` integer DEFAULT 0 NOT NULL, `balance_cents` integer DEFAULT 0 NOT NULL, `status` text DEFAULT 'active' NOT NULL, `version` integer DEFAULT 0 NOT NULL, `request_key` text NOT NULL, `request_fingerprint` text NOT NULL, `created_at` text NOT NULL, FOREIGN KEY (`member_id`,`owner_id`) REFERENCES `salon_members`(`id`,`owner_id`) ON UPDATE no action ON DELETE no action, CONSTRAINT "card_type" CHECK("salon_cards"."type" = 'stored'), CONSTRAINT "card_balances" CHECK(typeof("salon_cards"."cash_balance_cents") = 'integer' AND typeof("salon_cards"."gift_balance_cents") = 'integer' AND typeof("salon_cards"."balance_cents") = 'integer' AND "salon_cards"."cash_balance_cents" >= 0 AND "salon_cards"."gift_balance_cents" >= 0 AND "salon_cards"."balance_cents" = "salon_cards"."cash_balance_cents" + "salon_cards"."gift_balance_cents" AND "salon_cards"."balance_cents" <= 100000000), CONSTRAINT "card_version" CHECK(typeof("salon_cards"."version") = 'integer' AND "salon_cards"."version" >= 0) );
--> statement-breakpoint
CREATE UNIQUE INDEX `card_owner_request` ON `salon_cards` (`owner_id`,`request_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_member_owner` ON `salon_cards` (`id`,`member_id`,`owner_id`);
--> statement-breakpoint
CREATE INDEX `cards_owner` ON `salon_cards` (`owner_id`);
--> statement-breakpoint
CREATE TABLE `salon_members` ( `id` text PRIMARY KEY NOT NULL, `owner_id` text NOT NULL, `name` text NOT NULL, `phone` text NOT NULL, `note` text DEFAULT '' NOT NULL, `created_at` text NOT NULL );
--> statement-breakpoint
CREATE UNIQUE INDEX `member_owner_id` ON `salon_members` (`id`,`owner_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_owner_phone` ON `salon_members` (`owner_id`,`phone`);
--> statement-breakpoint
CREATE INDEX `members_owner` ON `salon_members` (`owner_id`);
--> statement-breakpoint
CREATE TABLE `salon_services` ( `id` text PRIMARY KEY NOT NULL, `owner_id` text NOT NULL, `name` text NOT NULL, `price_cents` integer NOT NULL, `active` integer DEFAULT true NOT NULL, `created_at` text NOT NULL, CONSTRAINT "service_price" CHECK(typeof("salon_services"."price_cents") = 'integer' AND "salon_services"."price_cents" BETWEEN 0 AND 100000000) );
--> statement-breakpoint
CREATE INDEX `services_owner` ON `salon_services` (`owner_id`);
--> statement-breakpoint
CREATE TABLE `salon_settings` ( `owner_id` text PRIMARY KEY NOT NULL, `shop_name` text DEFAULT '千丝万缕理发店' NOT NULL, `phone` text DEFAULT '' NOT NULL, `address` text DEFAULT '' NOT NULL, `low_balance_cents` integer DEFAULT 10000 NOT NULL );
--> statement-breakpoint
CREATE TABLE `salon_transactions` ( `id` text PRIMARY KEY NOT NULL, `owner_id` text NOT NULL, `member_id` text NOT NULL, `card_id` text NOT NULL, `type` text NOT NULL, `amount_cents` integer NOT NULL, `cash_received_cents` integer NOT NULL, `gift_cents` integer NOT NULL, `service_spend_cents` integer NOT NULL, `cash_delta_cents` integer NOT NULL, `gift_delta_cents` integer NOT NULL, `balance_before_cents` integer NOT NULL, `balance_after_cents` integer NOT NULL, `card_version` integer NOT NULL, `service_name` text DEFAULT '' NOT NULL, `note` text DEFAULT '' NOT NULL, `reversed_transaction_id` text, `request_key` text NOT NULL, `request_fingerprint` text NOT NULL, `created_at` text NOT NULL, FOREIGN KEY (`card_id`,`member_id`,`owner_id`) REFERENCES `salon_cards`(`id`,`member_id`,`owner_id`) ON UPDATE no action ON DELETE no action, CONSTRAINT "ledger_type" CHECK("salon_transactions"."type" IN ('recharge','consume','reversal')), CONSTRAINT "ledger_reversal" CHECK(("salon_transactions"."type" = 'reversal' AND "salon_transactions"."reversed_transaction_id" IS NOT NULL) OR ("salon_transactions"."type" != 'reversal' AND "salon_transactions"."reversed_transaction_id" IS NULL)), CONSTRAINT "ledger_after" CHECK("salon_transactions"."balance_after_cents" >= 0 AND "salon_transactions"."balance_after_cents" = "salon_transactions"."balance_before_cents" + "salon_transactions"."cash_delta_cents" + "salon_transactions"."gift_delta_cents") );
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_owner_request` ON `salon_transactions` (`owner_id`,`request_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_one_reversal` ON `salon_transactions` (`reversed_transaction_id`);
--> statement-breakpoint
CREATE INDEX `ledger_owner_time` ON `salon_transactions` (`owner_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER salon_ledger_no_update BEFORE UPDATE ON salon_transactions BEGIN SELECT RAISE(ABORT, 'ledger_is_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER salon_ledger_no_delete BEFORE DELETE ON salon_transactions BEGIN SELECT RAISE(ABORT, 'ledger_is_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER salon_card_zero_start BEFORE INSERT ON salon_cards WHEN NEW.cash_balance_cents != 0 OR NEW.gift_balance_cents != 0 OR NEW.balance_cents != 0 OR NEW.version != 0 BEGIN SELECT RAISE(ABORT, 'card_requires_opening_ledger'); END;
--> statement-breakpoint
CREATE TRIGGER salon_card_requires_ledger BEFORE UPDATE OF cash_balance_cents, gift_balance_cents, balance_cents, version ON salon_cards WHEN NOT EXISTS ( SELECT 1 FROM salon_transactions t WHERE t.card_id = OLD.id AND t.owner_id = OLD.owner_id AND t.member_id = OLD.member_id AND t.card_version = OLD.version AND NEW.version = OLD.version + 1 AND t.balance_before_cents = OLD.balance_cents AND t.balance_after_cents = NEW.balance_cents AND NEW.cash_balance_cents = OLD.cash_balance_cents + t.cash_delta_cents AND NEW.gift_balance_cents = OLD.gift_balance_cents + t.gift_delta_cents ) BEGIN SELECT RAISE(ABORT, 'balance_requires_ledger'); END;
--> statement-breakpoint
CREATE TRIGGER salon_reversal_matches_original BEFORE INSERT ON salon_transactions WHEN NEW.type = 'reversal' AND NOT EXISTS ( SELECT 1 FROM salon_transactions original WHERE original.id = NEW.reversed_transaction_id AND original.owner_id = NEW.owner_id AND original.card_id = NEW.card_id AND original.member_id = NEW.member_id AND original.type IN ('consume', 'recharge') AND NEW.cash_delta_cents = -original.cash_delta_cents AND NEW.gift_delta_cents = -original.gift_delta_cents AND NEW.amount_cents = -original.amount_cents AND NEW.cash_received_cents = -original.cash_received_cents AND NEW.gift_cents = -original.gift_cents AND NEW.service_spend_cents = -original.service_spend_cents ) BEGIN SELECT RAISE(ABORT, 'reversal_mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER salon_ledger_apply_balance AFTER INSERT ON salon_transactions BEGIN UPDATE salon_cards SET cash_balance_cents = cash_balance_cents + NEW.cash_delta_cents, gift_balance_cents = gift_balance_cents + NEW.gift_delta_cents, balance_cents = NEW.balance_after_cents, version = version + 1 WHERE id = NEW.card_id AND owner_id = NEW.owner_id AND member_id = NEW.member_id AND version = NEW.card_version AND balance_cents = NEW.balance_before_cents AND cash_balance_cents + NEW.cash_delta_cents >= 0 AND gift_balance_cents + NEW.gift_delta_cents >= 0; SELECT RAISE(ABORT, 'stale_or_insufficient_card') WHERE changes() != 1; END;
