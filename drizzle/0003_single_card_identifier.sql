DROP INDEX member_owner_phone;
--> statement-breakpoint
CREATE UNIQUE INDEX member_owner_phone ON salon_members(owner_id,phone) WHERE phone <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX card_one_member ON salon_cards(owner_id,member_id);
