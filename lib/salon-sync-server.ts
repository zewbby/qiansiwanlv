import { z } from 'zod';
import { type Context, seedSettings,cardColumns,transactionColumns,memberColumns,settingsColumns,serviceColumns,publicCard,publicTransaction,publicService } from './salon-server';
import { applyOperation,clone,recompute,operationSchema,type SyncSnapshot,type SyncOperation } from './salon-sync-model';
import { createLedgerStatement } from './salon-ledger';
import { SalonError } from './salon-finance';
import type { Card,LedgerTransaction,Member,ShopSettings,Service,SalonBootstrap } from './salon-types';

export async function syncSnapshot(ctx:Context):Promise<SyncSnapshot>{
 await seedSettings(ctx);
 const initial={user:{displayName:ctx.user.displayName,email:ctx.user.email},summary:{} as SalonBootstrap['summary']};
 const results=await ctx.db.batch([
  ctx.db.prepare(`SELECT ${settingsColumns} FROM salon_settings WHERE owner_id=?`).bind(ctx.ownerId),
  ctx.db.prepare(`SELECT ${memberColumns} FROM salon_members WHERE owner_id=?`).bind(ctx.ownerId),
  ctx.db.prepare(`SELECT ${cardColumns} FROM salon_cards WHERE owner_id=?`).bind(ctx.ownerId),
  ctx.db.prepare(`SELECT ${serviceColumns} FROM salon_services WHERE owner_id=?`).bind(ctx.ownerId),
  ctx.db.prepare(`SELECT ${transactionColumns} FROM salon_transactions WHERE owner_id=? ORDER BY created_at DESC,id DESC`).bind(ctx.ownerId),
  ctx.db.prepare('SELECT revision FROM salon_sync_state WHERE owner_id=?').bind(ctx.ownerId),
 ]);
 const data={...initial,settings:results[0].results[0] as ShopSettings,members:results[1].results as unknown as Member[],cards:(results[2].results as unknown as Parameters<typeof publicCard>[0][]).map(publicCard),services:(results[3].results as unknown as Service[]).map(publicService),transactions:(results[4].results as unknown as Parameters<typeof publicTransaction>[0][]).map(publicTransaction),serverTime:new Date().toISOString()};
 return {storeId:ctx.ownerId,revision:(results[5].results[0] as {revision:number}|undefined)?.revision??0,data:recompute(data)};
}
async function hash(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
const pushInput=z.object({storeId:z.string().min(1).max(100),batchId:z.string().min(8).max(100),operations:z.array(operationSchema).min(1).max(10)}).strict();
export async function pushSync(ctx:Context,request:Request){
 if(!request.headers.get('content-type')?.includes('application/json'))throw new SalonError('请求格式必须是 JSON');
 const raw=await request.text();if(raw.length>150000)throw new SalonError('同步批次过大',413);
 let json:unknown;try{json=JSON.parse(raw)}catch{throw new SalonError('同步内容格式不正确')}
 const payload=pushInput.parse(json);if(payload.storeId!==ctx.ownerId)throw new SalonError('本地数据属于其他门店，请使用原账号同步',403,'STORE_MISMATCH');
 if(new Set(payload.operations.map(op=>op.id)).size!==payload.operations.length)throw new SalonError('同步操作编号重复');
 const fingerprint=await hash(payload.operations);
 const previous=await ctx.db.prepare('SELECT fingerprint FROM salon_sync_batches WHERE owner_id=? AND batch_id=?').bind(ctx.ownerId,payload.batchId).first<{fingerprint:string}>();
 if(previous){if(previous.fingerprint!==fingerprint)throw new SalonError('同一同步批次内容不能改变',409,'IDEMPOTENCY_CONFLICT');return {snapshot:await syncSnapshot(ctx),acknowledged:payload.operations.map(op=>op.id),replayed:true};}
 const snapshot=await syncSnapshot(ctx),plan=clone(snapshot.data),statements:D1PreparedStatement[]=[];
 statements.push(ctx.db.prepare('INSERT INTO salon_sync_batches(owner_id,batch_id,base_revision,fingerprint,created_at) VALUES (?,?,?,?,?)').bind(ctx.ownerId,payload.batchId,snapshot.revision,fingerprint,new Date().toISOString()));
 for(const op of payload.operations){
  if(new Date(op.createdAt).getTime()>Date.now()+300000)throw new SalonError('手机时间超前，请校准时间后同步',409,'CLOCK_ERROR');
  const before=clone(plan),result=applyOperation(plan,op);
  statements.push(...operationStatements(ctx,before,plan,op,result,fingerprint));
 }
 try{await ctx.db.batch(statements)}catch(error){
  const replay=await ctx.db.prepare('SELECT fingerprint FROM salon_sync_batches WHERE owner_id=? AND batch_id=?').bind(ctx.ownerId,payload.batchId).first<{fingerprint:string}>();
  if(replay?.fingerprint===fingerprint)return {snapshot:await syncSnapshot(ctx),acknowledged:payload.operations.map(op=>op.id),replayed:true};
  const message=String(error);if(message.includes('sync_revision_conflict')||message.includes('UNIQUE'))throw new SalonError('其他设备刚刚更新了账目，请重试同步；本机记录仍然保留',409,'SYNC_CONFLICT');throw error;
 }
 return {snapshot:await syncSnapshot(ctx),acknowledged:payload.operations.map(op=>op.id)};
}
function operationStatements(ctx:Context,before:SyncSnapshot['data'],after:SyncSnapshot['data'],op:SyncOperation,result:Record<string,unknown>,fingerprint:string){
 const statements:D1PreparedStatement[]=[];
 if(op.kind==='member'){const m=result.member as Member;statements.push(ctx.db.prepare('INSERT INTO salon_members(id,owner_id,name,phone,note,created_at,deleted_at) VALUES (?,?,?,?,?,?,NULL)').bind(m.id,ctx.ownerId,m.name,m.phone,m.note,m.createdAt));}
 if(op.kind==='card'){const c=result.card as Card;statements.push(ctx.db.prepare('INSERT INTO salon_cards(id,owner_id,member_id,name,type,request_key,request_fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(c.id,ctx.ownerId,c.memberId,c.name,c.type,op.id,fingerprint,c.createdAt));}
 if(op.kind==='card'||op.kind==='transaction'){
  const t=result.transaction as LedgerTransaction|null;
  if(t){const card=op.kind==='card'?{...(result.card as Card),cashBalanceCents:0,giftBalanceCents:0,balanceCents:0,version:0}:before.cards.find(c=>c.id===t.cardId)!;statements.push(createLedgerStatement(ctx,card,t,{id:t.id,key:t.id,fingerprint,createdAt:t.createdAt,serviceName:t.serviceName,note:t.note,reversedTransactionId:t.reversedTransactionId}));}
 }
 if(op.kind==='delete'||op.kind==='restore'){const m=result.member as Member;statements.push(ctx.db.prepare('UPDATE salon_members SET deleted_at=? WHERE id=? AND owner_id=?').bind(m.deletedAt??null,m.id,ctx.ownerId));}
 if(op.kind==='settings'){const s=after.settings;statements.push(ctx.db.prepare('UPDATE salon_settings SET shop_name=?,phone=?,address=?,low_balance_cents=? WHERE owner_id=?').bind(s.shopName,s.phone,s.address,s.lowBalanceCents,ctx.ownerId));}
 if(op.kind==='service'){const s=result.service as Service;statements.push(ctx.db.prepare('INSERT INTO salon_services(id,owner_id,name,price_cents,active,created_at) VALUES (?,?,?,?,?,?)').bind(s.id,ctx.ownerId,s.name,s.priceCents,s.active?1:0,s.createdAt));}
 if(op.kind==='servicePatch'){const s=result.service as Service;statements.push(ctx.db.prepare('UPDATE salon_services SET name=?,price_cents=?,active=? WHERE id=? AND owner_id=?').bind(s.name,s.priceCents,s.active?1:0,s.id,ctx.ownerId));}
 return statements;
}
