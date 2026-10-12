// Mock only the native transport/storage, then exercise the actual client against isolated D1.
import assert from 'node:assert/strict';import {build} from 'vite';import {randomUUID} from 'node:crypto';
await build({configFile:false,logLevel:'error',build:{outDir:'work/client-test',emptyOutDir:true,lib:{entry:'lib/salon-offline-client.ts',formats:['es'],fileName:'offline-client-test'}}});
const client=await import('../work/client-test/offline-client-test.js');
const origin='http://127.0.0.1:8789';let cookie='',saved=null,offline=false,loseResponse=false,pushes=0;
const store={path:'synthetic/vault',fallbackPath:'synthetic/vault',selected:false,warning:'',cloud:origin};
async function request(path,method='GET',body){const response=await fetch(origin+path,{method,headers:{Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,body:await response.json()};}
await request('/api/auth/login','POST',{username:'synthetic-admin',password:'SyntheticOnly!123'});
globalThis.window=new EventTarget();window.SalonNative={call(id,method,raw){void(async()=>{try{let value;const payload=JSON.parse(raw);switch(method){case 'readVault':value=structuredClone(saved);break;case 'writeVault':saved=structuredClone(payload.vault);value={storage:store};break;case 'storage':value=store;break;case 'cloud':if(offline)throw new Error('Synthetic offline transport');value=await request(payload.path,payload.method,payload.body);if(payload.method==='POST'){pushes++;if(loseResponse){loseResponse=false;throw new Error('Synthetic response lost AFTER server commit');}}break;default:throw new Error('Unexpected native method '+method);}window.__salonReply(id,{ok:true,value})}catch(e){window.__salonReply(id,{ok:false,error:e.message})}})()}};
await client.initializeFromCloud();const initialCount=saved.view.members.length;
offline=true;const key=randomUUID();await client.offlineApi('/api/members',{method:'POST',headers:{'X-Local-Operation-Id':key},body:JSON.stringify({name:'客户端队列测试'})});assert.equal(saved.pending.length,1);
await client.loadVault();assert.equal((await client.offlineApi('/api/bootstrap')).members.length,initialCount+1);
await client.retryCloud();assert.equal(client.offlineStatus().connected,false);assert.equal(saved.pending.length,1);
await client.synchronize();assert.equal(saved.pending.length,1,'failed connection must retain outbox');
offline=false;await client.retryCloud();assert.equal(client.offlineStatus().connected,true);assert.equal(saved.pending.length,1,'retry must NOT sync');
loseResponse=true;await client.synchronize();assert.equal(saved.pending.length,1,'lost response keeps identical retry operations');assert.equal((await request('/api/sync')).body.snapshot.data.members.filter(m=>m.id===key).length,1);
await client.synchronize();assert.equal(saved.pending.length,0);assert.equal(saved.view.members.filter(m=>m.id===key).length,1);
for(let i=0;i<12;i++)await client.offlineApi('/api/members',{method:'POST',body:JSON.stringify({name:'批次合成会员 '+i})});assert.equal(saved.pending.length,12);const start=pushes;await client.synchronize();assert.equal(pushes-start,2);assert.equal(saved.pending.length,0);
const card=saved.view.cards.find(c=>c.balanceCents>1000);assert.ok(card);
const localKey=randomUUID();await client.offlineApi('/api/transactions',{method:'POST',body:JSON.stringify({type:'consume',cardId:card.id,expectedVersion:card.version,amountCents:100,idempotencyKey:localKey})});
const cloud=await request('/api/transactions','POST',{type:'consume',cardId:card.id,expectedVersion:card.version,amountCents:200,idempotencyKey:randomUUID()});assert.equal(cloud.status,201);
await client.synchronize();assert.equal(saved.pending.length,1);assert.ok(saved.conflict);const preview=await client.conflictPreview();assert.equal(preview.rows.find(r=>r.merged===card.balanceCents-300)?.cloud,card.balanceCents-200);
await client.acceptRebase(preview);assert.equal(saved.pending.length,1,'confirmation prepares but does NOT push');await client.synchronize();assert.equal(saved.pending.length,0);assert.equal(saved.view.cards.find(c=>c.id===card.id).balanceCents,card.balanceCents-300);
console.log('Offline client integration PASSED: offline save/reload, retry without sync, failure preservation, lost-response idempotent retry, 10-operation batching, cloud conflict review and explicit rebase.');
