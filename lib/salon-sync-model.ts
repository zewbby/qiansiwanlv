import { z } from 'zod';
import { calculateEntry, SalonError, shanghaiDayRange } from './salon-finance.ts';
import { parseMemberRegistration } from './member-registration.ts';
import type { SalonBootstrap, LedgerTransaction, Card } from './salon-types';

const id=z.string().min(1).max(100), cents=z.number().int().min(0).max(100000000), note=z.string().trim().max(500).default('');
const transaction=z.discriminatedUnion('type',[
 z.object({type:z.literal('recharge'),cardId:id,expectedVersion:z.number().int().min(0),paidCents:cents.default(0),giftCents:cents.default(0),note,idempotencyKey:id}).strict(),
 z.object({type:z.literal('consume'),cardId:id,expectedVersion:z.number().int().min(0),amountCents:cents.optional(),serviceId:id.optional(),note,idempotencyKey:id}).strict(),
 z.object({type:z.literal('reversal'),transactionId:id,note,idempotencyKey:id}).strict(),
]);
export const operationSchema=z.object({id,createdAt:z.string().datetime(),kind:z.enum(['member','card','transaction','delete','restore','settings','service','servicePatch']),payload:z.record(z.unknown()),before:z.string().max(2000).optional()}).strict();
export type SyncOperation=z.infer<typeof operationSchema>;
export type SyncSnapshot={storeId:string;revision:number;data:SalonBootstrap};
export type LocalVault={format:1;base:SyncSnapshot;view:SalonBootstrap;pending:SyncOperation[];lastSyncedAt:string|null;conflict?:string};
export const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export const identity=(value:unknown)=>JSON.stringify(value);
export function recompute(data:SalonBootstrap,now=new Date()) {
 data.serverTime=now.toISOString();
 const day=shanghaiDayRange(now),start=new Date(day.start).getTime()-6*86400000;
 const within=(time:string)=>time>=day.start&&time<day.end;
 const daily=data.transactions.filter(t=>within(t.createdAt));
 data.summary={todayCashReceivedCents:daily.reduce((n,t)=>n+t.cashReceivedCents,0),todayServiceSpendCents:daily.reduce((n,t)=>n+t.serviceSpendCents,0),todayServices:daily.filter(t=>t.type==='consume'&&!data.transactions.some(r=>r.reversedTransactionId===t.id)).length,todayNewMembers:data.members.filter(m=>!m.deletedAt&&within(m.createdAt)).length,memberCount:data.members.filter(m=>!m.deletedAt).length,totalBalanceCents:data.cards.reduce((n,c)=>n+c.balanceCents,0),weekReceipts:Array.from({length:7},(_,i)=>{const date=new Date(start+i*86400000+8*3600000).toISOString().slice(0,10);return {date,cashReceivedCents:data.transactions.filter(t=>new Date(new Date(t.createdAt).getTime()+8*3600000).toISOString().slice(0,10)===date).reduce((n,t)=>n+t.cashReceivedCents,0)}})};
 data.members.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));data.cards.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));data.transactions.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
 return data;
}
function conflict(message:string):never {throw new SalonError(message,409,'SYNC_CONFLICT');}
function target(data:SalonBootstrap,op:SyncOperation) {
 if(op.kind==='settings')return data.settings;
 if(op.kind==='servicePatch')return data.services.find(s=>s.id===op.payload.id);
 if(op.kind==='delete'||op.kind==='restore')return data.members.find(m=>m.id===op.payload.id);
 return undefined;
}
export function prepareOperation(data:SalonBootstrap,raw:SyncOperation,rebase=false):SyncOperation {
 const op=clone(operationSchema.parse(raw));
 if(op.kind==='transaction'&&op.payload.type==='consume'&&op.payload.amountCents===undefined&&op.payload.serviceId){const service=data.services.find(s=>s.id===op.payload.serviceId&&s.active);if(!service)conflict('服务项目已停用或不存在');op.payload.amountCents=service.priceCents;}
 if(['settings','servicePatch','delete','restore'].includes(op.kind))op.before=identity(target(data,op));
 if(rebase&&op.kind==='transaction'&&op.payload.type!=='reversal'){
  const card=data.cards.find(c=>c.id===op.payload.cardId);if(!card)conflict('云端找不到待同步的会员卡');op.payload.expectedVersion=card.version;
 }
 return op;
}
export function applyOperation(data:SalonBootstrap,raw:SyncOperation) {
 const op=operationSchema.parse(raw), p=op.payload;
 if(['settings','servicePatch','delete','restore'].includes(op.kind)&&op.before!==identity(target(data,op)))conflict('云端资料已有变化，需要核对后重新同步');
 if(op.kind==='member'){
  const m=parseMemberRegistration(p);if(data.members.some(x=>x.id===op.id||(m.phone&&x.phone===m.phone)))conflict('会员或手机号已在云端登记，请核对重复会员');
  const member={id:op.id,...m,createdAt:op.createdAt,deletedAt:null};data.members.unshift(member);return {member};
 }
 if(op.kind==='card'){
  const payload=z.object({memberId:id,name:z.string().trim().min(1).max(40),type:z.literal('stored').default('stored'),paidCents:cents.default(0),giftCents:cents.default(0),idempotencyKey:id}).strict().parse(p);
  const member=data.members.find(m=>m.id===payload.memberId);if(!member||member.deletedAt)conflict('会员已删除或不存在，请先核对会员');
  if(data.cards.some(c=>c.memberId===member.id||c.id===op.id))conflict('这位会员在云端已经办卡，请核对');
  const card:Card={id:op.id,memberId:member.id,name:payload.name,type:'stored',cashBalanceCents:0,giftBalanceCents:0,balanceCents:0,status:'active',version:0,createdAt:op.createdAt};data.cards.unshift(card);
  if(payload.paidCents||payload.giftCents)append(data,card,calculateEntry(card,{type:'recharge',paidCents:payload.paidCents,giftCents:payload.giftCents}),{...op,id:op.id+':open'},'开卡充值','',null);
  return {card,transaction:data.transactions.find(t=>t.id===op.id+':open')||null};
 }
 if(op.kind==='transaction'){
  const input=transaction.parse(p);let original:LedgerTransaction|undefined;
  if(input.type==='reversal'){original=data.transactions.find(t=>t.id===input.transactionId);if(!original||original.type==='reversal'||data.transactions.some(t=>t.reversedTransactionId===original!.id))conflict('待撤销流水不存在或已撤销，请核对');}
  const card=data.cards.find(c=>c.id===(original?.cardId??('cardId' in input?input.cardId:'')));if(!card)conflict('待同步会员卡不存在');
  if(data.members.find(m=>m.id===card.memberId)?.deletedAt)conflict('会员已删除，不能同步新的账目');
  if(input.type!=='reversal'&&input.expectedVersion!==card.version)conflict('同一张会员卡在其他设备有新账目，已保留本机记录，请核对余额后重新同步');
  const service=input.type==='consume'&&input.serviceId?data.services.find(s=>s.id===input.serviceId&&s.active):undefined;
  if(input.type==='consume'&&input.serviceId&&!service)conflict('服务项目已停用或不存在');
  const entry=calculateEntry(card,input.type==='reversal'?{type:'reversal',original:original!}:input.type==='consume'?{type:'consume',amountCents:input.amountCents??service?.priceCents}:input);
  const t=append(data,card,entry,op,original?.serviceName??service?.name??(input.type==='recharge'?'会员充值':'自定义服务'),input.note,original?.id??null);return {transaction:t,card};
 }
 if(op.kind==='delete'||op.kind==='restore'){
  const member=data.members.find(m=>m.id===id.parse(p.id));if(!member)conflict('会员不存在');
  if(op.kind==='delete'&&data.cards.some(c=>c.memberId===member.id&&c.balanceCents>0))throw new SalonError('会员卡还有余额，请先核对并结清余额再删除',409,'MEMBER_HAS_BALANCE');
  member.deletedAt=op.kind==='delete'?op.createdAt:null;return {member};
 }
 if(op.kind==='settings'){
  const payload=z.object({shopName:z.string().trim().min(1).max(60).optional(),phone:z.string().trim().max(30).optional(),address:z.string().trim().max(200).optional(),lowBalanceCents:cents.optional()}).strict().refine(v=>Object.keys(v).length>0).parse(p);Object.assign(data.settings,payload);return {settings:data.settings};
 }
 const serviceInput=z.object({name:z.string().trim().min(1).max(50),priceCents:cents,active:z.boolean().default(true)}).strict();
 if(op.kind==='service'){const service={id:op.id,...serviceInput.parse(p),createdAt:op.createdAt};if(data.services.some(s=>s.id===op.id))conflict('服务项目重复');data.services.push(service);return {service};}
 const payload=serviceInput.partial().extend({id}).strict().parse(p),service=data.services.find(s=>s.id===payload.id);if(!service)conflict('服务项目不存在');Object.assign(service,payload);return {service};
}
function append(data:SalonBootstrap,card:Card,entry:ReturnType<typeof calculateEntry>,op:SyncOperation,serviceName:string,note:string,reversedTransactionId:string|null){
 if(data.transactions.some(t=>t.id===op.id))conflict('同一流水不能重复写入');
 const t:LedgerTransaction={id:op.id,memberId:card.memberId,cardId:card.id,...entry,serviceName,note,reversedTransactionId,createdAt:op.createdAt};
 card.cashBalanceCents+=entry.cashDeltaCents;card.giftBalanceCents+=entry.giftDeltaCents;card.balanceCents=entry.balanceAfterCents;card.version=entry.cardVersion+1;data.transactions.unshift(t);return t;
}
export function replay(data:SalonBootstrap,operations:SyncOperation[],rebase=false){
 const view=clone(data),ops:SyncOperation[]=[];
 for(const original of operations){const op=rebase?prepareOperation(view,original,true):clone(original);applyOperation(view,op);ops.push(op);}return {view:recompute(view),operations:ops};
}

