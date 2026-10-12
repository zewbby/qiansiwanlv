import type { FinancialEntry } from "./salon-finance";
import type { Card } from "./salon-types";

type LedgerContext = {db:Pick<D1Database,"prepare">;ownerId:string};
export function createLedgerStatement(ctx: LedgerContext, card: Card, entry: FinancialEntry, info: {id:string;key:string;fingerprint:string;createdAt:string;serviceName:string;note:string;reversedTransactionId:string|null}): D1PreparedStatement {
  // Guard the snapshot before appending. The migration's AFTER INSERT trigger updates the card in the same SQLite transaction.
  return ctx.db.prepare(`INSERT INTO salon_transactions (id,owner_id,member_id,card_id,type,amount_cents,cash_received_cents,gift_cents,service_spend_cents,cash_delta_cents,gift_delta_cents,balance_before_cents,balance_after_cents,card_version,service_name,note,reversed_transaction_id,request_key,request_fingerprint,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM salon_cards WHERE id = ? AND owner_id = ? AND version = ? AND cash_balance_cents + ? >= 0 AND gift_balance_cents + ? >= 0`).bind(info.id,ctx.ownerId,card.memberId,card.id,entry.type,entry.amountCents,entry.cashReceivedCents,entry.giftCents,entry.serviceSpendCents,entry.cashDeltaCents,entry.giftDeltaCents,entry.balanceBeforeCents,entry.balanceAfterCents,entry.cardVersion,info.serviceName,info.note,info.reversedTransactionId,info.key,info.fingerprint,info.createdAt,card.id,ctx.ownerId,card.version,entry.cashDeltaCents,entry.giftDeltaCents);
}
