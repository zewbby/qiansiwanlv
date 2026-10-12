ALTER TABLE salon_members ADD COLUMN deleted_at text;
--> statement-breakpoint
CREATE TRIGGER salon_member_delete_balance BEFORE UPDATE OF deleted_at ON salon_members
WHEN NEW.deleted_at IS NOT NULL AND EXISTS (SELECT 1 FROM salon_cards WHERE member_id=NEW.id AND owner_id=NEW.owner_id AND balance_cents>0)
BEGIN SELECT RAISE(ABORT, 'member_has_balance'); END;
--> statement-breakpoint
CREATE TRIGGER salon_deleted_member_no_card BEFORE INSERT ON salon_cards
WHEN EXISTS (SELECT 1 FROM salon_members WHERE id=NEW.member_id AND owner_id=NEW.owner_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'member_is_deleted'); END;
--> statement-breakpoint
CREATE TRIGGER salon_deleted_member_no_ledger BEFORE INSERT ON salon_transactions
WHEN EXISTS (SELECT 1 FROM salon_members WHERE id=NEW.member_id AND owner_id=NEW.owner_id AND deleted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'member_is_deleted'); END;
