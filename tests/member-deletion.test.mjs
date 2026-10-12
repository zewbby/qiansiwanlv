import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {deleteMember,restoreMember} from '../lib/member-lifecycle.ts';
import {calculateEntry} from '../lib/salon-finance.ts';
import {createLedgerStatement} from '../lib/salon-ledger.ts';

function setup(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0000_melodic_energizer.sql','0001_cold_the_twelve.sql','0002_member_deletion.sql','0003_single_card_identifier.sql'])db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const ctx={ownerId:'shop-a',db:{prepare(sql){const stmt=db.prepare(sql);return {bind(...values){return {first(){return stmt.get(...values)||null},run(){return {meta:{changes:stmt.run(...values).changes}}}}}}}}};
 db.prepare('INSERT INTO salon_members(id,owner_id,name,phone,created_at) VALUES (?,?,?,?,?)').run('member-a','shop-a','测试会员','13800000000','2026-10-12');
 const addCard=()=>db.prepare("INSERT INTO salon_cards(id,owner_id,member_id,name,type,request_key,request_fingerprint,created_at) VALUES('card-a','shop-a','member-a','储值卡','stored','open-card','fp','2026-10-12')").run();
 const card=()=>db.prepare('SELECT id,member_id AS memberId,cash_balance_cents AS cashBalanceCents,gift_balance_cents AS giftBalanceCents,balance_cents AS balanceCents,version FROM salon_cards').get();
 let seq=0;
 const entry=(input)=>createLedgerStatement(ctx,card(),calculateEntry(card(),input),{id:'txn-'+(++seq),key:'key-'+seq,fingerprint:'fp',createdAt:'2026-10-12',serviceName:'洗剪吹',note:'',reversedTransactionId:null}).run();
 return {db,ctx,addCard,card,entry};
}
test('delete and restore are repeatable and preserve member identity and phone',async()=>{
 const {db,ctx}=setup();try{
 const deleted=await deleteMember(ctx,'member-a');assert.ok(deleted.member.deletedAt);
 assert.equal((await deleteMember(ctx,'member-a')).member.deletedAt,deleted.member.deletedAt);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM salon_members WHERE deleted_at IS NULL').get().n,0);
 assert.throws(()=>db.prepare("INSERT INTO salon_members(id,owner_id,name,phone,created_at) VALUES('duplicate','shop-a','重复','13800000000','now')").run(),/UNIQUE/);
 assert.equal((await restoreMember(ctx,'member-a')).member.deletedAt,null);
 assert.equal((await restoreMember(ctx,'member-a')).member.id,'member-a');
 }finally{db.close()}
});
test('positive cash or gift balance prevents deletion in API and database',async()=>{
 const {db,ctx,addCard,entry}=setup();try{addCard();entry({type:'recharge',paidCents:0,giftCents:100});
 await assert.rejects(deleteMember(ctx,'member-a'),e=>e.code==='MEMBER_HAS_BALANCE');
 assert.throws(()=>db.exec("UPDATE salon_members SET deleted_at='now'"),/member_has_balance/);
 assert.equal(db.prepare('SELECT deleted_at FROM salon_members').get().deleted_at,null);
 }finally{db.close()}
});
test('zero-balance member deletion preserves original ledger, totals and card',async()=>{
 const {db,ctx,addCard,entry,card}=setup();try{addCard();entry({type:'recharge',paidCents:1000});entry({type:'consume',amountCents:1000});
 const original=JSON.stringify(db.prepare('SELECT * FROM salon_transactions ORDER BY id').all());
 await deleteMember(ctx,'member-a');assert.equal(card().balanceCents,0);
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM salon_transactions ORDER BY id').all()),original);
 const totals=db.prepare('SELECT SUM(cash_received_cents) AS received,SUM(service_spend_cents) AS consumed FROM salon_transactions').get();assert.equal(totals.received,1000);assert.equal(totals.consumed,1000);
 await restoreMember(ctx,'member-a');entry({type:'recharge',paidCents:200});assert.equal(card().balanceCents,200);
 }finally{db.close()}
});
test('deletion closes subsequent card and recharge write races',async()=>{
 const {db,ctx,addCard,entry,card}=setup();try{addCard();await deleteMember(ctx,'member-a');
 assert.throws(()=>entry({type:'recharge',paidCents:100}),/member_is_deleted/);assert.equal(card().balanceCents,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM salon_transactions').get().n,0);
 assert.throws(()=>db.prepare("INSERT INTO salon_cards(id,owner_id,member_id,name,type,request_key,request_fingerprint,created_at) VALUES('card-b','shop-a','member-a','卡','stored','another-card','fp','now')").run(),/member_is_deleted/);
 }finally{db.close()}
});
test('delete and restore cannot act on another owner or nonexistent member',async()=>{
 const {db,ctx}=setup();try{const other={...ctx,ownerId:'shop-b'};
 await assert.rejects(deleteMember(other,'member-a'),e=>e.code==='MEMBER_NOT_FOUND');
 await assert.rejects(restoreMember(other,'member-a'),e=>e.code==='MEMBER_NOT_FOUND');
 await assert.rejects(deleteMember(ctx,'missing'),e=>e.code==='MEMBER_NOT_FOUND');
 assert.equal(db.prepare('SELECT deleted_at FROM salon_members').get().deleted_at,null);
 }finally{db.close()}
});
test('database enforces one card per member while allowing multiple name-only members',()=>{
 const {db,addCard}=setup();try{addCard();
 assert.throws(()=>db.prepare("INSERT INTO salon_cards(id,owner_id,member_id,name,type,request_key,request_fingerprint,created_at) VALUES('second-card','shop-a','member-a','卡','stored','new-key','fp','now')").run(),/UNIQUE/);
 for(const id of ['name-a','name-b']) db.prepare('INSERT INTO salon_members(id,owner_id,name,phone,created_at) VALUES(?,?,?,?,?)').run(id,'shop-a','王女士','','now');
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM salon_members WHERE phone=''").get().n,2);
 }finally{db.close()}
});
