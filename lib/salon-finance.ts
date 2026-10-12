export const MAX_CENTS = 100_000_000;
export type FinancialCard = {cashBalanceCents: number; giftBalanceCents: number; balanceCents: number; version: number};
export type FinancialEntry = {type: "recharge" | "consume" | "reversal"; amountCents: number; cashReceivedCents: number; giftCents: number; serviceSpendCents: number; cashDeltaCents: number; giftDeltaCents: number; balanceBeforeCents: number; balanceAfterCents: number; cardVersion: number};

export class SalonError extends Error {
  status: number; code: string;
  constructor(message: string, status = 400, code = "INVALID_INPUT") { super(message); this.name = "SalonError"; this.status = status; this.code = code; }
}
function integer(value: number, max: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new SalonError(`${label}超出允许范围`);
}

export function calculateEntry(card: FinancialCard, operation: {type: "recharge"; paidCents?: number; giftCents?: number} | {type: "consume"; amountCents?: number} | {type: "reversal"; original: FinancialEntry}): FinancialEntry {
  let cashDeltaCents = 0, giftDeltaCents = 0, amountCents = 0, cashReceivedCents = 0, giftCents = 0, serviceSpendCents = 0;
  if (operation.type === "recharge") {
    cashReceivedCents = operation.paidCents ?? 0; giftCents = operation.giftCents ?? 0;
    integer(cashReceivedCents, MAX_CENTS, "实收金额"); integer(giftCents, MAX_CENTS, "赠送金额");
    if (cashReceivedCents + giftCents <= 0) throw new SalonError("请填写实收或赠送金额");
    cashDeltaCents = cashReceivedCents; giftDeltaCents = giftCents; amountCents = cashReceivedCents + giftCents;
  } else if (operation.type === "consume") {
    amountCents = operation.amountCents ?? 0;
    integer(amountCents, MAX_CENTS, "服务金额");
    if (amountCents <= 0) throw new SalonError("请填写正数消费金额");
    if (amountCents > card.balanceCents) throw new SalonError("卡内余额不足",409,"INSUFFICIENT_BALANCE");
    giftDeltaCents = -Math.min(card.giftBalanceCents, amountCents); cashDeltaCents = -(amountCents + giftDeltaCents);
    serviceSpendCents = amountCents;
  } else {
    const original = operation.original;
    if (original.type === "reversal") throw new SalonError("冲正记录不能再次冲正");
    cashDeltaCents = -original.cashDeltaCents; giftDeltaCents = -original.giftDeltaCents;
    amountCents = -original.amountCents; cashReceivedCents = -original.cashReceivedCents; giftCents = -original.giftCents; serviceSpendCents = -original.serviceSpendCents;
    if (card.cashBalanceCents + cashDeltaCents < 0 || card.giftBalanceCents + giftDeltaCents < 0) throw new SalonError("原充值已被使用，当前余额不足以冲正",409,"INSUFFICIENT_BALANCE");
  }
  const balanceAfterCents = card.balanceCents + cashDeltaCents + giftDeltaCents;
  integer(balanceAfterCents,MAX_CENTS,"卡内余额");
  return {type:operation.type, amountCents,cashReceivedCents,giftCents,serviceSpendCents,cashDeltaCents,giftDeltaCents,balanceBeforeCents:card.balanceCents,balanceAfterCents,cardVersion:card.version};
}

export function shanghaiDayRange(now = new Date()): {start: string; end: string} {
  const localDay = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0,10);
  const startMs = new Date(`${localDay}T00:00:00+08:00`).getTime();
  return {start:new Date(startMs).toISOString(),end:new Date(startMs+86400_000).toISOString()};
}
