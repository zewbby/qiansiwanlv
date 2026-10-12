import assert from "node:assert/strict";

// Integration checks write synthetic records ONLY to an isolated built Wrangler loopback preview.
// This script intentionally refuses remotely hosted URLs and never uses real member information.
const base = new URL(process.argv[2] ?? "http://127.0.0.1:8787");
assert.ok(["127.0.0.1","localhost","[::1]"].includes(base.hostname),"Only a local loopback preview may be tested");
assert.equal(base.protocol,"http:","Use the isolated local HTTP preview");
const run = String(Date.now()), ownerA = `synthetic-${run}-a`, ownerB = `synthetic-${run}-b`;
const timeoutMs = Number(process.env.SALON_TEST_TIMEOUT_MS ?? 20000);
assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 120000, "Invalid local test timeout");
// Miniflare can reject the next POST after an Origin rejection while restarting its proxy.
// Retry only its explicit restart response, using the exact same request and idempotency key.
async function localFetch(url, options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, options);
    if (response.status !== 503 || !(await response.clone().text()).startsWith("Your worker restarted mid-request.")) return response;
    if (attempt === 2) return response;
    console.log("Local Wrangler proxy restarted; replaying the same request.");
  }
}
let sessionCookie='';
const headers = owner => owner === ownerA ? {Cookie:sessionCookie} : owner ? {"oai-authenticated-user-id":owner,"oai-authenticated-user-email":owner+"@example.test"} : {};
async function api(path,{owner=ownerA,method="GET",body,expected=200,extraHeaders={}}={}) {
  
  const response = await localFetch(new URL(path,base),{method,headers:{Origin:base.origin,"Sec-Fetch-Site":"same-origin","Sec-Fetch-Mode":"cors",...headers(owner),...(body ? {"Content-Type":"application/json","Origin":base.origin} : {}),...extraHeaders},body:body ? JSON.stringify(body) : undefined,signal:AbortSignal.timeout(timeoutMs)});
  if(response.status!==expected) assert.fail(method+" "+path+": expected "+expected+", received "+response.status+": "+await response.text());
  assert.match(response.headers.get("cache-control") ?? "",/no-store/,`${path} must not cache private data or errors`);
  return response.json();
}
const requestKey = label => `${run}-${label}`;

await api("/api/bootstrap",{owner:null,expected:401});
await api("/api/bootstrap",{owner:ownerB,expected:401});
await api("/api/auth/login",{method:"POST",body:{username:"synthetic-admin",password:"wrong-password"},expected:401});
const loggedIn=await localFetch(new URL("/api/auth/login",base),{method:"POST",headers:{"Content-Type":"application/json",Origin:base.origin,"Sec-Fetch-Site":"same-origin","Sec-Fetch-Mode":"cors"},body:JSON.stringify({username:"synthetic-admin",password:"SyntheticOnly!123"}),signal:AbortSignal.timeout(timeoutMs)});
assert.equal(loggedIn.status,200,await loggedIn.clone().text());
const setCookie=loggedIn.headers.get("set-cookie");
assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Lax/);assert.match(setCookie,/Max-Age=1209600/);
sessionCookie=setCookie.split(";")[0];
await loggedIn.text();
await api("/api/bootstrap",{owner:null,extraHeaders:{Cookie:"salon_session="+"0".repeat(64)},expected:401});

let empty;
for (let attempt=1;attempt<=3;attempt++) {
  try { empty = await api("/api/bootstrap"); break; }
  catch(error) {
    // A local Miniflare cold database may finish initialization after the request times out.
    // Retry only this read with the SAME owner; every fetch remains bounded at 20 seconds.
    if (error?.name !== "TimeoutError" || attempt === 3) throw error;
    console.log(`Local D1 bootstrap warmup timed out (${attempt}/3); retrying the same synthetic owner.`);
  }
}
assert.equal(empty.members.length,0,"Built preview should honor a fresh synthetic owner");
assert.equal(empty.summary.weekReceipts.length,7);
assert.ok(empty.summary.weekReceipts.every(day=>day.cashReceivedCents===0));
const phone = `138${run.slice(-8)}`;
const {member} = await api("/api/members",{method:"POST",body:{name:"合成测试会员",phone,note:"仅本地功能测试"},expected:201});
await api("/api/members",{method:"POST",body:{name:"重复手机号",phone},expected:409});
const openPayload = {memberId:member.id,name:"合成会员卡",type:"stored",paidCents:80000,giftCents:20000,idempotencyKey:requestKey("open")};
const opened = await api("/api/cards",{method:"POST",body:openPayload,expected:201});
assert.equal(opened.card.balanceCents,100000);
assert.equal(opened.card.version,1);
const replayOpen = await api("/api/cards",{method:"POST",body:openPayload,expected:201});
assert.equal(replayOpen.card.id,opened.card.id);
assert.equal(replayOpen.card.balanceCents,100000);
await api('/api/cards',{method:'POST',body:{...openPayload,idempotencyKey:requestKey('second-card')},expected:409});
await api("/api/transactions",{method:"POST",body:{type:"recharge",cardId:opened.card.id,expectedVersion:opened.card.version,paidCents:0,giftCents:0,idempotencyKey:requestKey("zero-recharge")},expected:400});
const topUpPayload={type:"recharge",cardId:opened.card.id,expectedVersion:opened.card.version,paidCents:10000,giftCents:1000,idempotencyKey:requestKey("top-up")};
const topUp=await api("/api/transactions",{method:"POST",body:topUpPayload,expected:201});
assert.equal(topUp.card.balanceCents,111000);
assert.equal(topUp.card.giftBalanceCents,21000);
assert.equal(topUp.transaction.cashReceivedCents,10000);
assert.equal((await api("/api/transactions",{method:"POST",body:topUpPayload,expected:201})).transaction.id,topUp.transaction.id);
const reverseTopUp=await api("/api/transactions",{method:"POST",body:{type:"reversal",transactionId:topUp.transaction.id,idempotencyKey:requestKey("reverse-top-up"),note:"测试充值冲正"},expected:201});
assert.equal(reverseTopUp.card.balanceCents,100000);
assert.equal(reverseTopUp.card.giftBalanceCents,20000);
opened.card=reverseTopUp.card;
const consumePayload = {type:"consume",cardId:opened.card.id,expectedVersion:opened.card.version,amountCents:5800,idempotencyKey:requestKey("consume"),note:"合成洗剪吹"};
const consumed = await api("/api/transactions",{method:"POST",body:consumePayload,expected:201});
assert.equal(consumed.card.balanceCents,94200);
assert.equal(consumed.card.giftBalanceCents,14200);
assert.equal(consumed.transaction.cashReceivedCents,0);
const replayConsume = await api("/api/transactions",{method:"POST",body:consumePayload,expected:201});
assert.equal(replayConsume.transaction.id,consumed.transaction.id);
assert.equal(replayConsume.card.balanceCents,94200);
await api("/api/transactions",{method:"POST",body:{...consumePayload,amountCents:5900},expected:409});
await api("/api/transactions",{method:"POST",body:{...consumePayload,idempotencyKey:requestKey("stale")},expected:409});
await api("/api/transactions",{method:"POST",body:{...consumePayload,expectedVersion:consumed.card.version,amountCents:120000,idempotencyKey:requestKey("overdraw")},expected:409});

const simultaneous = await Promise.all(["parallel-a","parallel-b"].map(async label=>{
  const response = await localFetch(new URL("/api/transactions",base),{method:"POST",headers:{...headers(ownerA),"Content-Type":"application/json",Origin:base.origin},body:JSON.stringify({...consumePayload,expectedVersion:consumed.card.version,amountCents:10000,idempotencyKey:requestKey(label)}),signal:AbortSignal.timeout(timeoutMs)});
  return {status:response.status,body:await response.json()};
}));
assert.deepEqual(simultaneous.map(r=>r.status).sort(),[201,409],"Only one operation can commit the same card version");
const active = simultaneous.find(r=>r.status===201).body;
assert.equal(active.card.balanceCents,84200);
const reversed = await api("/api/transactions",{method:"POST",body:{type:"reversal",transactionId:consumed.transaction.id,idempotencyKey:requestKey("reverse"),note:"合成冲正"},expected:201});
assert.equal(reversed.card.balanceCents,90000);
assert.equal(reversed.transaction.serviceSpendCents,-5800);
await api("/api/transactions",{method:"POST",body:{type:"reversal",transactionId:consumed.transaction.id,idempotencyKey:requestKey("second-reverse")},expected:409});
await api("/api/transactions",{method:"POST",body:{type:"reversal",transactionId:opened.transaction.id,idempotencyKey:requestKey("used-recharge-reverse")},expected:409});

await api("/api/transactions",{owner:ownerB,method:"POST",body:{...consumePayload,expectedVersion:reversed.card.version,idempotencyKey:requestKey("cross-owner")},expected:401});

const updatedSettings = await api("/api/settings",{method:"PATCH",body:{shopName:"合成测试门店",lowBalanceCents:5000}});
assert.equal(updatedSettings.settings.shopName,"合成测试门店");
const createdService = await api("/api/services",{method:"POST",body:{name:"合成服务",priceCents:3000},expected:201});
await api("/api/services",{method:"PATCH",body:{id:createdService.service.id,priceCents:4000,active:false}});
const final = await api("/api/bootstrap");
assert.equal(final.summary.todayCashReceivedCents,80000);
assert.equal(final.summary.todayServiceSpendCents,10000);
assert.equal(final.summary.todayServices,1);
assert.equal(final.summary.totalBalanceCents,90000);
assert.equal(final.summary.weekReceipts.reduce((sum,day)=>sum+day.cashReceivedCents,0),80000);
assert.equal(final.services.find(s=>s.id===createdService.service.id).active,false);

let cursor = null, all = [];
do {
  const page = await api(`/api/transactions?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
  all.push(...page.transactions); cursor = page.nextCursor;
} while (cursor);
assert.equal(all.length,6);
assert.equal(new Set(all.map(t=>t.id)).size,6);
const consumes = await api("/api/transactions?type=consume&limit=500");
assert.equal(consumes.transactions.length,2);
assert.ok(consumes.transactions.every(t=>t.type==="consume"));
const none = await api("/api/transactions?from=2000-01-01&to=2000-01-02");
assert.equal(none.transactions.length,0);
await api("/api/transactions?from=2026-02-31",{expected:400});
await api("/api/transactions?from=2026-10-11&to=2026-10-10",{expected:400});
await api("/api/transactions?type=not-a-type",{expected:400});
await api("/api/transactions?cursor=not-a-cursor",{expected:400});
await api(`/api/members/${member.id}`,{method:"DELETE",expected:409});
await api(`/api/members/${member.id}`,{owner:null,method:"DELETE",expected:401});
await api(`/api/members/${member.id}/restore`,{owner:null,method:"POST",expected:401});
const removable=(await api('/api/members',{method:'POST',body:{name:'删除测试会员',phone:`139${run.slice(-8)}`},expected:201})).member;
const removableCard=(await api('/api/cards',{method:'POST',body:{memberId:removable.id,name:'删除测试卡',paidCents:100,giftCents:20,idempotencyKey:requestKey('delete-open')},expected:201})).card;
await api('/api/transactions',{method:'POST',body:{type:'consume',cardId:removableCard.id,expectedVersion:removableCard.version,amountCents:120,idempotencyKey:requestKey('delete-consume')},expected:201});
const beforeDelete=await api('/api/bootstrap');
const removed=await api(`/api/members/${removable.id}`,{method:'DELETE'});
assert.ok(removed.member.deletedAt);
assert.equal((await api(`/api/members/${removable.id}`,{method:'DELETE'})).member.deletedAt,removed.member.deletedAt);
const afterDelete=await api('/api/bootstrap');
assert.equal(afterDelete.summary.memberCount,beforeDelete.summary.memberCount-1);
assert.deepEqual(afterDelete.transactions,beforeDelete.transactions);
assert.deepEqual(afterDelete.cards,beforeDelete.cards);
await api('/api/cards',{method:'POST',body:{memberId:removable.id,name:'禁止新卡',idempotencyKey:requestKey('deleted-open')},expected:404});
await api('/api/transactions',{method:'POST',body:{type:'recharge',cardId:removableCard.id,expectedVersion:2,paidCents:10,idempotencyKey:requestKey('deleted-recharge')},expected:409});
await api(`/api/members/${removable.id}/restore`,{method:'POST'});
const restored=await api('/api/bootstrap');assert.equal(restored.summary.memberCount,beforeDelete.summary.memberCount);
assert.equal(restored.members.find(m=>m.id===removable.id).deletedAt,null);
const nameOnly=(await api('/api/members',{method:'POST',body:{name:'只用姓名登记'},expected:201})).member;assert.equal(nameOnly.phone,'');
await api('/api/members',{method:'POST',body:{name:'另一位姓名登记'},expected:201});
const phoneOnly=(await api('/api/members',{method:'POST',body:{phone:`137${run.slice(-8)}`},expected:201})).member;assert.equal(phoneOnly.name,phoneOnly.phone);
await api('/api/members',{method:'POST',body:{name:'',phone:''},expected:400});
console.log("Member deletion, restoration, one-card and either-identifier API checks passed.");
await api("/api/auth/login",{method:"POST",body:{username:"synthetic-admin",password:"SyntheticOnly!123"},extraHeaders:{Origin:"https://untrusted.example.test"},expected:403});
await api("/api/members",{method:"POST",body:{name:"合成测试",phone:"13800000000"},extraHeaders:{Origin:"https://untrusted.example.test"},expected:403});
await api(`/api/members/${removable.id}`,{method:'DELETE',extraHeaders:{Origin:'https://untrusted.example.test'},expected:403});
await api("/api/auth/logout",{method:"POST",body:{},extraHeaders:{Origin:"https://untrusted.example.test"},expected:403});
await api("/api/cards",{owner:null,method:"POST",body:{memberId:"forged",name:"forged",idempotencyKey:"forged-request"},expected:401});
await api("/api/auth/logout",{method:"POST"});
await api("/api/bootstrap",{expected:401});
await api("/api/transactions",{method:"POST",body:{type:"consume"},expected:401});
sessionCookie='';
for(let i=0;i<12;i++) {
 const response=await localFetch(new URL("/api/auth/login",base),{method:"POST",headers:{"Content-Type":"application/json",Origin:base.origin,"Sec-Fetch-Site":"same-origin","Sec-Fetch-Mode":"cors"},body:JSON.stringify({username:"synthetic-admin",password:"wrong"}),signal:AbortSignal.timeout(timeoutMs)});
 const status=response.status;await response.text();
 if(status===429) {assert.ok(i<=10);break;}assert.equal(status,401);assert.ok(i<11,"Rate limit must activate");
}
console.log("Local synthetic integration passed: auth, no-store, members, stored cards, gift/cash accounting, idempotency, concurrency, insufficient funds, reversals, isolation, settings, services, full pagination, date/type filters, full-database summaries.");









