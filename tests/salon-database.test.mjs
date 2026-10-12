import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { calculateEntry } from "../lib/salon-finance.ts";
import { createLedgerStatement } from "../lib/salon-ledger.ts";

const migration = readFileSync(new URL("../drizzle/0000_melodic_energizer.sql",import.meta.url),"utf8");
function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(migration);
  sqlite.prepare("INSERT INTO salon_members (id,owner_id,name,phone,created_at) VALUES (?,?,?,?,?)").run("member-a","owner-a","会员甲","13800000000","2026-10-11T01:00:00.000Z");
  sqlite.prepare("INSERT INTO salon_members (id,owner_id,name,phone,created_at) VALUES (?,?,?,?,?)").run("member-b","owner-b","会员乙","13800000000","2026-10-11T01:00:00.000Z");
  sqlite.prepare("INSERT INTO salon_cards (id,owner_id,member_id,name,type,request_key,request_fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?)").run("card-a","owner-a","member-a","会员卡","stored","open-a","fp","2026-10-11T01:00:00.000Z");
  const ctx = {
    ownerId:"owner-a",
    db: {
      prepare(sql) {
        return {bind(...args) {return {run() {return sqlite.prepare(sql).run(...args);}};}};
      },
    },
  };
  function card() {return sqlite.prepare("SELECT id,member_id AS memberId,name,type,cash_balance_cents AS cashBalanceCents,gift_balance_cents AS giftBalanceCents,balance_cents AS balanceCents,status,version,created_at AS createdAt FROM salon_cards WHERE id='card-a'").get();}
  let n = 0;
  function insert(entry,snapshot=card(),overrides={}) {
    n++;
    return createLedgerStatement(ctx,snapshot,entry,{id:`txn-${n}`,key:`operation-${n}`,fingerprint:"fp",createdAt:"2026-10-11T01:00:00.000Z",serviceName:"洗剪吹",note:"",reversedTransactionId:null,...overrides}).run();
  }
  return {sqlite,ctx,card,insert};
}

test("real migrated database atomically updates balances when a ledger is inserted",()=>{
  const {sqlite,card,insert} = setup();
  insert(calculateEntry(card(),{type:"recharge",paidCents:10000,giftCents:2000}));
  assert.equal(card().balanceCents,12000);
  assert.equal(card().version,1);
  const consume = calculateEntry(card(),{type:"consume",amountCents:5800});
  insert(consume,card(),{id:"consumption"});
  assert.equal(card().balanceCents,6200);
  assert.equal(card().cashBalanceCents,6200);
  assert.equal(card().giftBalanceCents,0);
  const totals = sqlite.prepare("SELECT SUM(cash_received_cents) AS cash,SUM(service_spend_cents) AS spend FROM salon_transactions").get();
  assert.equal(totals.cash,10000);
  assert.equal(totals.spend,5800);
  insert(calculateEntry(card(),{type:"reversal",original:consume}),card(),{reversedTransactionId:"consumption"});
  assert.equal(card().balanceCents,12000);
  assert.equal(card().giftBalanceCents,2000);
  assert.equal(sqlite.prepare("SELECT SUM(service_spend_cents) AS spend FROM salon_transactions").get().spend,0);
  sqlite.close();
});

test("two requests sharing a stale card snapshot cannot both debit",()=>{
  const {sqlite,card,insert} = setup();
  insert(calculateEntry(card(),{type:"recharge",paidCents:10000}));
  const sameSnapshot = card(), consume = calculateEntry(sameSnapshot,{type:"consume",amountCents:6000});
  assert.equal(insert(consume,sameSnapshot).changes,1);
  assert.equal(insert(consume,sameSnapshot).changes,0);
  assert.equal(card().balanceCents,4000);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM salon_transactions").get().n,2);
  sqlite.close();
});

test("idempotency uniqueness and one reversal are enforced by the database",()=>{
  const {sqlite,card,insert} = setup();
  const recharge = calculateEntry(card(),{type:"recharge",paidCents:10000});
  insert(recharge,card(),{id:"recharge",key:"same-operation"});
  assert.throws(()=>insert(calculateEntry(card(),{type:"recharge",paidCents:10000}),card(),{key:"same-operation"}),/UNIQUE/);
  assert.equal(card().balanceCents,10000);
  insert(calculateEntry(card(),{type:"reversal",original:recharge}),card(),{reversedTransactionId:"recharge"});
  assert.equal(card().balanceCents,0);
  insert(calculateEntry(card(),{type:"recharge",paidCents:10000}));
  assert.throws(()=>insert(calculateEntry(card(),{type:"reversal",original:recharge}),card(),{reversedTransactionId:"recharge"}),/UNIQUE/);
  assert.equal(card().balanceCents,10000);
  sqlite.close();
});

test("ledger is immutable and balance cannot be edited outside a ledger insertion",()=>{
  const {sqlite,card,insert} = setup();
  insert(calculateEntry(card(),{type:"recharge",paidCents:10000}));
  assert.throws(()=>sqlite.exec("UPDATE salon_transactions SET note = 'change'"),/ledger_is_immutable/);
  assert.throws(()=>sqlite.exec("DELETE FROM salon_transactions"),/ledger_is_immutable/);
  assert.throws(()=>sqlite.exec("UPDATE salon_cards SET cash_balance_cents=20000,balance_cents=20000,version=2 WHERE id='card-a'"),/balance_requires_ledger/);
  assert.equal(card().balanceCents,10000);
  sqlite.close();
});

test("incorrect financial snapshot aborts both ledger append and balance update",()=>{
  const {sqlite,card,insert} = setup();
  const malformed = {...calculateEntry(card(),{type:"recharge",paidCents:10000}),balanceBeforeCents:1,balanceAfterCents:10001};
  assert.throws(()=>insert(malformed),/stale_or_insufficient_card/);
  assert.equal(card().balanceCents,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM salon_transactions").get().n,0);
  sqlite.close();
});

test("owner isolation uses composite foreign keys and owner-scoped debit guards",()=>{
  const {sqlite,ctx,card} = setup();
  assert.throws(()=>sqlite.prepare("INSERT INTO salon_cards (id,owner_id,member_id,name,type,request_key,request_fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?)").run("wrong-card","owner-b","member-a","会员卡","stored","request-b","fp","2026-10-11T01:00:00.000Z"),/FOREIGN KEY/);
  const entry = calculateEntry(card(),{type:"recharge",paidCents:10000});
  const result = createLedgerStatement({...ctx,ownerId:"owner-b"},card(),entry,{id:"wrong-owner",key:"wrong-owner",fingerprint:"fp",createdAt:"2026-10-11T01:00:00.000Z",serviceName:"",note:"",reversedTransactionId:null}).run();
  assert.equal(result.changes,0);
  assert.equal(card().balanceCents,0);
  sqlite.close();
});
