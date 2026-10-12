import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {clone,prepareOperation,replay} from '../lib/salon-sync-model.ts';
const base=new URL(process.argv[2]||'http://127.0.0.1:8789');
assert.ok(['localhost','127.0.0.1'].includes(base.hostname));assert.equal(base.protocol,'http:');
let cookie='';
async function call(path,method='GET',body,expected=200){
 for(let i=0;i<3;i++){
  const response=await fetch(new URL(path,base),{method,headers:{Origin:base.origin,'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors',Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const text=await response.text();if(response.status===503&&text.startsWith('Your worker restarted mid-request.')&&i<2)continue;
  assert.equal(response.status,expected,method+' '+path+': '+text);if(path==='/api/auth/login')cookie=response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('cache-control'),/no-store/);return JSON.parse(text);
 }
}
await call('/api/auth/login','POST',{username:'synthetic-admin',password:'SyntheticOnly!123'});
const status=await call('/api/sync/status');assert.equal(status.storeId,'synthetic-offline-sync');
let snapshot=(await call('/api/sync')).snapshot;
function operation(data,kind,payload){return prepareOperation(data,{id:randomUUID(),createdAt:new Date().toISOString(),kind,payload});}
function batch(ops){return {storeId:snapshot.storeId,batchId:createHash('sha256').update(JSON.stringify(ops)).digest('hex'),operations:ops};}
let data=clone(snapshot.data);const member=operation(data,'member',{name:'双向同步合成会员'});data=replay(data,[member]).view;
const card=operation(data,'card',{memberId:member.id,name:'会员卡',paidCents:20000,giftCents:2000,idempotencyKey:randomUUID()});data=replay(data,[card]).view;
const spend=operation(data,'transaction',{type:'consume',cardId:card.id,expectedVersion:1,amountCents:3000,idempotencyKey:randomUUID()});
const payload=batch([member,card,spend]);let result=await call('/api/sync','POST',payload);snapshot=result.snapshot;
assert.equal(snapshot.data.cards.find(c=>c.id===card.id).balanceCents,19000);assert.equal(snapshot.data.cards.find(c=>c.id===card.id).version,2);
assert.ok(snapshot.data.transactions.some(t=>t.id===spend.id));assert.ok(snapshot.data.transactions.some(t=>t.id===card.id+':open'));
const duplicate=await call('/api/sync','POST',payload);assert.equal(duplicate.replayed,true);assert.equal(duplicate.snapshot.data.transactions.length,snapshot.data.transactions.length);
await call('/api/sync','POST',{...payload,operations:[{...member,payload:{name:'篡改重试'}}]},409);
await call('/api/sync','POST',{...payload,batchId:randomUUID(),storeId:'wrong-store'},403);
const offlineSpend=operation(snapshot.data,'transaction',{type:'consume',cardId:card.id,expectedVersion:2,amountCents:1000,idempotencyKey:randomUUID()});
await call('/api/transactions','POST',{type:'consume',cardId:card.id,expectedVersion:2,amountCents:500,idempotencyKey:randomUUID()},201);
const unrelatedMember=operation(snapshot.data,'member',{name:'不应部分提交'});const count=snapshot.data.members.length;
const rejected=await call('/api/sync','POST',batch([unrelatedMember,offlineSpend]),409);assert.equal(rejected.code,'SYNC_CONFLICT');
snapshot=(await call('/api/sync')).snapshot;assert.equal(snapshot.data.members.length,count);assert.equal(snapshot.data.cards.find(c=>c.id===card.id).balanceCents,18500);
const rebased=replay(snapshot.data,[offlineSpend],true);result=await call('/api/sync','POST',batch(rebased.operations));snapshot=result.snapshot;assert.equal(snapshot.data.cards.find(c=>c.id===card.id).balanceCents,17500);
const independent=operation(snapshot.data,'member',{phone:'138'+Date.now().toString().slice(-8)});
await call('/api/settings','PATCH',{shopName:'云端另一台设备修改'});
result=await call('/api/sync','POST',batch([independent]));snapshot=result.snapshot;assert.equal(snapshot.data.settings.shopName,'云端另一台设备修改');
const oldSettings=operation(snapshot.data,'settings',{shopName:'本机待核对修改'});await call('/api/settings','PATCH',{shopName:'云端更新设置'});
await call('/api/sync','POST',batch([oldSettings]),409);snapshot=(await call('/api/sync')).snapshot;
const checked=replay(snapshot.data,[oldSettings],true);snapshot=(await call('/api/sync','POST',batch(checked.operations))).snapshot;assert.equal(snapshot.data.settings.shopName,'本机待核对修改');
const a=operation(snapshot.data,'transaction',{type:'consume',cardId:card.id,expectedVersion:4,amountCents:100,idempotencyKey:randomUUID()});
const b=operation(snapshot.data,'transaction',{type:'consume',cardId:card.id,expectedVersion:4,amountCents:100,idempotencyKey:randomUUID()});
const concurrent=await Promise.all([a,b].map(async op=>{const response=await fetch(new URL('/api/sync',base),{method:'POST',headers:{Origin:base.origin,'Sec-Fetch-Site':'same-origin',Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(batch([op])),signal:AbortSignal.timeout(20000)});const body=await response.json();return {status:response.status,body}}));
assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);snapshot=(await call('/api/sync')).snapshot;assert.equal(snapshot.data.cards.find(c=>c.id===card.id).balanceCents,17400);
assert.equal(snapshot.data.transactions.filter(t=>[a.id,b.id].includes(t.id)).length,1);
const zero=operation(snapshot.data,'card',{memberId:independent.id,name:'空余额卡',idempotencyKey:randomUUID()});snapshot=(await call('/api/sync','POST',batch([zero]))).snapshot;
const del=operation(snapshot.data,'delete',{id:independent.id});snapshot=(await call('/api/sync','POST',batch([del]))).snapshot;assert.ok(snapshot.data.members.find(m=>m.id===independent.id).deletedAt);
const restore=operation(snapshot.data,'restore',{id:independent.id});snapshot=(await call('/api/sync','POST',batch([restore]))).snapshot;assert.equal(snapshot.data.members.find(m=>m.id===independent.id).deletedAt,null);
const service=operation(snapshot.data,'service',{name:'同步服务',priceCents:4000});snapshot=(await call('/api/sync','POST',batch([service]))).snapshot;
const patch=operation(snapshot.data,'servicePatch',{id:service.id,priceCents:4500});snapshot=(await call('/api/sync','POST',batch([patch]))).snapshot;assert.equal(snapshot.data.services.find(s=>s.id===service.id).priceCents,4500);
await call('/api/auth/logout','POST');await call('/api/sync', 'GET',undefined,401);
console.log('Isolated bidirectional API tests PASSED: stable IDs, balances, retry idempotency, changed-payload rejection, store isolation, atomic conflict rejection, explicit rebase, unrelated cloud changes, settings conflicts, concurrent debit protection, deletion/restoration and services.');
