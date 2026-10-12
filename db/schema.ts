import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const members = sqliteTable("salon_members", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
}, (t) => [uniqueIndex("member_owner_id").on(t.id, t.ownerId), uniqueIndex("member_owner_phone").on(t.ownerId, t.phone).where(sql`${t.phone} <> ''`), index("members_owner").on(t.ownerId)]);

export const cards = sqliteTable("salon_cards", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), memberId: text("member_id").notNull(),
  name: text("name").notNull(), type: text("type").notNull(),
  cashBalanceCents: integer("cash_balance_cents").notNull().default(0),
  giftBalanceCents: integer("gift_balance_cents").notNull().default(0),
  balanceCents: integer("balance_cents").notNull().default(0),
  status: text("status").notNull().default("active"), version: integer("version").notNull().default(0),
  requestKey: text("request_key").notNull(), requestFingerprint: text("request_fingerprint").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [
  uniqueIndex("card_owner_request").on(t.ownerId, t.requestKey), uniqueIndex("card_member_owner").on(t.id, t.memberId, t.ownerId),
  uniqueIndex("card_one_member").on(t.ownerId,t.memberId),
  index("cards_owner").on(t.ownerId),
  foreignKey({columns:[t.memberId,t.ownerId],foreignColumns:[members.id,members.ownerId]}),
  check("card_type", sql`${t.type} = 'stored'`),
  check("card_balances", sql`typeof(${t.cashBalanceCents}) = 'integer' AND typeof(${t.giftBalanceCents}) = 'integer' AND typeof(${t.balanceCents}) = 'integer' AND ${t.cashBalanceCents} >= 0 AND ${t.giftBalanceCents} >= 0 AND ${t.balanceCents} = ${t.cashBalanceCents} + ${t.giftBalanceCents} AND ${t.balanceCents} <= 100000000`),
  check("card_version", sql`typeof(${t.version}) = 'integer' AND ${t.version} >= 0`),
]);

export const transactions = sqliteTable("salon_transactions", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), memberId: text("member_id").notNull(), cardId: text("card_id").notNull(),
  type: text("type").notNull(), amountCents: integer("amount_cents").notNull(),
  cashReceivedCents: integer("cash_received_cents").notNull(), giftCents: integer("gift_cents").notNull(),
  serviceSpendCents: integer("service_spend_cents").notNull(),
  cashDeltaCents: integer("cash_delta_cents").notNull(), giftDeltaCents: integer("gift_delta_cents").notNull(),
  balanceBeforeCents: integer("balance_before_cents").notNull(), balanceAfterCents: integer("balance_after_cents").notNull(),
  cardVersion: integer("card_version").notNull(), serviceName: text("service_name").notNull().default(""), note: text("note").notNull().default(""),
  reversedTransactionId: text("reversed_transaction_id"),
  requestKey: text("request_key").notNull(), requestFingerprint: text("request_fingerprint").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [
  uniqueIndex("ledger_owner_request").on(t.ownerId,t.requestKey), uniqueIndex("ledger_one_reversal").on(t.reversedTransactionId),
  index("ledger_owner_time").on(t.ownerId,t.createdAt),
  foreignKey({columns:[t.cardId,t.memberId,t.ownerId],foreignColumns:[cards.id,cards.memberId,cards.ownerId]}),
  check("ledger_type", sql`${t.type} IN ('recharge','consume','reversal')`),
  check("ledger_reversal", sql`(${t.type} = 'reversal' AND ${t.reversedTransactionId} IS NOT NULL) OR (${t.type} != 'reversal' AND ${t.reversedTransactionId} IS NULL)`),
  check("ledger_after", sql`${t.balanceAfterCents} >= 0 AND ${t.balanceAfterCents} = ${t.balanceBeforeCents} + ${t.cashDeltaCents} + ${t.giftDeltaCents}`),
]);

export const services = sqliteTable("salon_services", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
  active: integer("active",{mode:"boolean"}).notNull().default(true), createdAt: text("created_at").notNull(),
}, (t) => [index("services_owner").on(t.ownerId),check("service_price",sql`typeof(${t.priceCents}) = 'integer' AND ${t.priceCents} BETWEEN 0 AND 100000000`)]);

export const settings = sqliteTable("salon_settings", {
  ownerId: text("owner_id").primaryKey(), shopName: text("shop_name").notNull().default("千丝万缕理发店"),
  phone: text("phone").notNull().default(""), address: text("address").notNull().default(""),
  lowBalanceCents: integer("low_balance_cents").notNull().default(10000),
});

export const sessions = sqliteTable("salon_sessions", {
  tokenHash:text("token_hash").primaryKey(), ownerId:text("owner_id").notNull(),
  expiresAt:integer("expires_at").notNull(), credentialVersion:text("credential_version").notNull(),
},t=>[index("session_expiry").on(t.expiresAt)]);
export const loginLimits = sqliteTable("salon_login_limits", {
  id:text("id").primaryKey(),attempts:integer("attempts").notNull(),windowStart:integer("window_start").notNull(),
});
export const syncState = sqliteTable('salon_sync_state',{ownerId:text('owner_id').primaryKey(),revision:integer('revision').notNull().default(0)});
export const syncBatches = sqliteTable('salon_sync_batches',{ownerId:text('owner_id').notNull(),batchId:text('batch_id').notNull(),baseRevision:integer('base_revision').notNull(),fingerprint:text('fingerprint').notNull(),createdAt:text('created_at').notNull()},t=>[uniqueIndex('sync_owner_batch').on(t.ownerId,t.batchId)]);
