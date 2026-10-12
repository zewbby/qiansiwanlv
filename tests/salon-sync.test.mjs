import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {applyOperation,prepareOperation,replay,clone,recompute} from '../lib/salon-sync-model.ts';
const time='2026-10-12T01:00:00.000Z';
function empty(){return recompute({user:{displayName:'synthetic',email:'synthetic'},settings:{shopName:'测试门店',phone:'',address:'',lowBalanceCents:1000},members:[],cards:[],services:[],transactions:[],summary:{},serverTime:time});}
const op=(id,kind,payload)=>({id,kind,payload,createdAt:time});
function opened(){const data=empty(),operations=[op('member-test','member',{name:'离线测试'}),op('card-test','card',{memberId:'member-test',name:'储值卡',paidCents:10000,giftCents:2000,idempotencyKey:'card-test'})];for(const o of operations)applyOperation(data,o);return {data,operations};}
test('offline operations preserve original IDs, cash/gift split and versions after serialization',()=>{
 const {data,operations}=opened();operations.push(op('consume-test','transaction',{type:'consume',cardId:'card-test',expectedVersion:1,amountCents:5800,idempotencyKey:'consume-test'}));
 const restored=replay(empty(),JSON.parse(JSON.stringify(operations))).view;assert.equal(restored.cards[0].balanceCents,6200);assert.equal(restored.cards[0].cashBalanceCents,6200);assert.equal(restored.cards[0].giftBalanceCents,0);assert.equal(restored.cards[0].version,2);assert.equal(restored.transactions.find(t=>t.id==='consume-test').cardVersion,1);assert.equal(restored.summary.totalBalanceCents,6200);assert.equal(data.cards[0].balanceCents,12000);
});
test('same-card cloud changes reject a stale offline debit without altering the input snapshot',()=>{
 const {data}=opened();applyOperation(data,op('other-phone','transaction',{type:'consume',cardId:'card-test',expectedVersion:1,amountCents:1000,idempotencyKey:'other-phone'}));const original=JSON.stringify(data);
 assert.throws(()=>replay(data,[op('stale','transaction',{type:'consume',cardId:'card-test',expectedVersion:1,amountCents:500,idempotencyKey:'stale'})]),e=>e.code==='SYNC_CONFLICT');assert.equal(JSON.stringify(data),original);
});
test('explicit rebase keeps cloud ledger and applies local operations once against the latest balance',()=>{
 const {data}=opened();applyOperation(data,op('other-phone','transaction',{type:'consume',cardId:'card-test',expectedVersion:1,amountCents:1000,idempotencyKey:'other-phone'}));const result=replay(data,[op('local-debit','transaction',{type:'consume',cardId:'card-test',expectedVersion:1,amountCents:500,idempotencyKey:'local-debit'})],true);assert.equal(result.operations[0].payload.expectedVersion,2);assert.equal(result.view.cards[0].balanceCents,10500);assert.equal(result.view.transactions.length,3);assert.ok(result.view.transactions.some(t=>t.id==='other-phone'));
});
test('unrelated changes merge, but overdrafts, duplicate cards and funded-member deletion cannot',()=>{
 const {data}=opened();applyOperation(data,op('unrelated','member',{name:'另一位会员'}));assert.equal(replay(data,[op('debit','transaction',{type:'consume',cardId:'card-test',expectedVersion:1,amountCents:500,idempotencyKey:'debit'})]).view.members.length,2);
 assert.throws(()=>replay(data,[op('overdraw','transaction',{type:'consume',cardId:'card-test',expectedVersion:1,amountCents:13000,idempotencyKey:'overdraw'})]));assert.throws(()=>applyOperation(data,op('second-card','card',{memberId:'member-test',name:'储值卡',idempotencyKey:'second-card'})),e=>e.code==='SYNC_CONFLICT');assert.throws(()=>applyOperation(data,prepareOperation(data,op('delete','delete',{id:'member-test'}))),e=>e.code==='MEMBER_HAS_BALANCE');
});
test('a queued settings edit detects changes from another device and never silently overwrites',()=>{const d=empty(),change=prepareOperation(d,op('settings','settings',{shopName:'本地店名'}));d.settings.shopName='云端店名';assert.throws(()=>replay(d,[change]),e=>e.code==='SYNC_CONFLICT');assert.equal(d.settings.shopName,'云端店名');});
test('offline consumption freezes the price agreed locally even if the cloud service price changes',()=>{const {data}=opened();applyOperation(data,op('service','service',{name:'洗剪吹',priceCents:3000}));const change=prepareOperation(data,op('price-frozen','transaction',{type:'consume',serviceId:'service',cardId:'card-test',expectedVersion:1,idempotencyKey:'price-frozen'}));assert.equal(change.payload.amountCents,3000);data.services[0].priceCents=4000;assert.equal(replay(data,[change]).view.cards[0].balanceCents,9000);});
test('local summaries and reversals retain history beyond 500 rows',()=>{const {data}=opened();for(let i=0;i<600;i++)applyOperation(data,op('row-'+i,'transaction',{type:'recharge',cardId:'card-test',expectedVersion:i+1,paidCents:1,giftCents:0,idempotencyKey:'row-'+i}));const r=replay(data,[op('undo-old','transaction',{type:'reversal',transactionId:'row-0',idempotencyKey:'undo-old',note:'测试'})]).view;assert.equal(r.transactions.length,602);assert.equal(r.cards[0].balanceCents,12599);assert.equal(r.transactions.find(t=>t.id==='undo-old').cashDeltaCents,-1);});
test('migrated revision guard makes a conflicting batch atomic and observes legacy writes',()=>{
 const db=new DatabaseSync(':memory:');for(const file of ['0000_melodic_energizer.sql','0001_cold_the_twelve.sql','0002_member_deletion.sql','0003_single_card_identifier.sql','0004_chubby_ken_ellis.sql'])db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 db.exec("INSERT INTO salon_settings(owner_id) VALUES('owner-a');");const revision=()=>db.prepare("SELECT revision FROM salon_sync_state WHERE owner_id='owner-a'").get().revision;assert.equal(revision(),1);
 db.exec("UPDATE salon_settings SET shop_name='新店名' WHERE owner_id='owner-a'");assert.equal(revision(),2);
 db.exec('BEGIN');try{db.exec("INSERT INTO salon_members(id,owner_id,name,phone,created_at) VALUES('not-committed','owner-a','未提交','','2026-10-12')");assert.throws(()=>db.exec("INSERT INTO salon_sync_batches VALUES('owner-a','stale',1,'fingerprint','2026-10-12')"),/sync_revision_conflict/);db.exec('ROLLBACK');}catch(e){db.exec('ROLLBACK');throw e;}
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM salon_members').get().n,0);assert.equal(revision(),2);db.close();
});
