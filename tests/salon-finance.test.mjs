import test from "node:test";
import assert from "node:assert/strict";
import { calculateEntry, SalonError, shanghaiDayRange } from "../lib/salon-finance.ts";

const empty = {cashBalanceCents:0,giftBalanceCents:0,balanceCents:0,version:0};
function after(card, entry) {return {...card,cashBalanceCents:card.cashBalanceCents+entry.cashDeltaCents,giftBalanceCents:card.giftBalanceCents+entry.giftDeltaCents,balanceCents:entry.balanceAfterCents,version:card.version+1};}

test("cash received excludes gift credit and service consumption",()=>{
  const recharge = calculateEntry(empty,{type:"recharge",paidCents:10000,giftCents:2000});
  assert.equal(recharge.cashReceivedCents,10000);
  assert.equal(recharge.amountCents,12000);
  assert.equal(recharge.serviceSpendCents,0);
  const consume = calculateEntry(after(empty,recharge),{type:"consume",amountCents:5800});
  assert.equal(consume.cashReceivedCents,0);
  assert.equal(consume.serviceSpendCents,5800);
  assert.equal(consume.giftDeltaCents,-2000);
  assert.equal(consume.cashDeltaCents,-3800);
});

test("a reversal restores the original cash/gift split and signed metrics",()=>{
  const start = {cashBalanceCents:10000,giftBalanceCents:2000,balanceCents:12000,version:1};
  const consume = calculateEntry(start,{type:"consume",amountCents:5800});
  const reversal = calculateEntry(after(start,consume),{type:"reversal",original:consume});
  assert.equal(reversal.serviceSpendCents,-5800);
  assert.deepEqual({...after(after(start,consume),reversal),version:1},start);
  assert.throws(()=>calculateEntry(start,{type:"reversal",original:reversal}),SalonError);
});

test("used recharge cannot be reversed using a different cash/gift split",()=>{
  const recharge = calculateEntry(empty,{type:"recharge",paidCents:10000,giftCents:2000});
  const card = after(empty,recharge);
  const consume = calculateEntry(card,{type:"consume",amountCents:1000});
  assert.throws(()=>calculateEntry(after(card,consume),{type:"reversal",original:recharge}),/余额不足/);
});

test("reject fractional cents, overdraw, zero consumption and excessive balances",()=>{
  assert.throws(()=>calculateEntry(empty,{type:"recharge",paidCents:0.1}),SalonError);
  assert.throws(()=>calculateEntry(empty,{type:"recharge",paidCents:-1}),SalonError);
  assert.throws(()=>calculateEntry(empty,{type:"consume",amountCents:1}),/余额不足/);
  assert.throws(()=>calculateEntry(empty,{type:"consume",amountCents:0}),SalonError);
  assert.throws(()=>calculateEntry(empty,{type:"recharge",paidCents:100000000,giftCents:1}),SalonError);
});

test("Shanghai accounting day changes at UTC 16:00",()=>{
  assert.deepEqual(shanghaiDayRange(new Date("2026-10-10T15:59:59.999Z")),{start:"2026-10-09T16:00:00.000Z",end:"2026-10-10T16:00:00.000Z"});
  assert.deepEqual(shanghaiDayRange(new Date("2026-10-10T16:00:00.000Z")),{start:"2026-10-10T16:00:00.000Z",end:"2026-10-11T16:00:00.000Z"});
});
