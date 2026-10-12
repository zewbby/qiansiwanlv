import {applyOperation,prepareOperation,clone,recompute,replay,identity,type LocalVault,type SyncSnapshot,type SyncOperation} from './salon-sync-model';
import type { SalonBootstrap } from './salon-types';
declare global {interface Window {SalonNative?:{call(id:string,method:string,payload:string):void};__salonReply?:(id:string,result:{ok:boolean;value?:unknown;error?:string})=>void}}
export const isOfflineApp=()=>typeof window!=='undefined'&&!!window.SalonNative;
const waiting=new Map<string,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
export function nativeCall<T=unknown>(method:string,payload:unknown={}):Promise<T>{
 if(!isOfflineApp())return Promise.reject(new Error('请在新版安卓应用中使用本地存储'));
 window.__salonReply=(id,result)=>{const p=waiting.get(id);if(!p)return;clearTimeout(p.timer);waiting.delete(id);if(result.ok)p.resolve(result.value);else p.reject(new Error(result.error||'操作失败'));};
 return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{waiting.delete(id);reject(new Error('操作超时，本地记录仍保留，请重试'))},method==='chooseStorage'||method==='exportCsv'?600000:45000);waiting.set(id,{resolve:resolve as (v:unknown)=>void,reject,timer});window.SalonNative!.call(id,method,JSON.stringify(payload));});
}
export type OfflineStatus={connected:boolean;busy:boolean;pending:number;lastSyncedAt:string|null;message:string;conflict?:string;storage?:{path:string;fallbackPath:string;selected:boolean;warning:string;cloud:string};};
let vault:LocalVault|null=null;
let status:OfflineStatus={connected:false,busy:false,pending:0,lastSyncedAt:null,message:'未连接至云端，本地数据可正常使用'};
let mutation:Promise<unknown>=Promise.resolve();
function emit(){if(vault){status.pending=vault.pending.length;status.lastSyncedAt=vault.lastSyncedAt;status.conflict=vault.conflict;}window.dispatchEvent(new CustomEvent('salon-local-change'));}
export const offlineStatus=()=>({...status});
async function persist(next:LocalVault){const result=await nativeCall<{storage:OfflineStatus['storage']}>('writeVault',{vault:next});vault=next;status.storage=result.storage;emit();}
export async function loadVault(){vault=await nativeCall<LocalVault>('readVault');if(vault?.format!==1||!vault.base?.storeId)throw new Error('本地账本格式不正确，请保留文件并联系维护人员');recompute(vault.view);status.storage=await nativeCall('storage');emit();return vault;}
export async function cloud(path:string,method='GET',body?:unknown){
 try{const response=await nativeCall<{status:number;body:Record<string,unknown>}>('cloud',{path,method,body});if(response.status===401){status.connected=false;throw new Error('云端登录已过期，本地账本仍可用，请重新验证云端账号')}if(response.status>=400){const error=new Error(String(response.body.error||'云端操作失败'));Object.assign(error,{status:response.status,code:response.body.code});throw error;}status.connected=true;return response.body;}
 catch(error){if(!(error as {status?:number}).status)status.connected=false;throw error;}finally{emit();}
}
export async function retryCloud(){status.busy=true;emit();try{const result=await cloud('/api/sync/status');if(vault&&result.storeId!==vault.base.storeId)throw new Error('当前云端账号与本地门店不一致');status.message='已连接至云端；点击同步才会上传和下载账目';}catch(e){status.message=e instanceof Error?e.message:'云端未连接，本地可继续使用';}finally{status.busy=false;emit();}}
export async function refreshStorage(){status.storage=await nativeCall('storage');emit();}
export async function switchStorage(){await nativeCall('chooseStorage');await refreshStorage();}
export async function useDefaultStorage(){await nativeCall('defaultStorage');await refreshStorage();}
export async function initializeFromCloud(){const result=await cloud('/api/sync');const snapshot=result.snapshot as SyncSnapshot;await persist({format:1,base:snapshot,view:clone(snapshot.data),pending:[],lastSyncedAt:new Date().toISOString()});status.message='已连接至云端，数据已准备好；记账先保存在手机，可手动同步';await refreshStorage();}
export async function synchronize(){
 if(status.busy)return;status.busy=true;status.message='正在双向同步…';emit();
 try{
  await mutation;
  if(!vault)await loadVault();
  while(vault!.pending.length){
   const operations=clone(vault!.pending.slice(0,10));
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity(operations)));
   const batchId=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
   const result=await cloud('/api/sync','POST',{storeId:vault!.base.storeId,batchId,operations});
   const snapshot=result.snapshot as SyncSnapshot;
   if(snapshot.storeId!==vault!.base.storeId)throw new Error('同步门店不匹配，本机记录已保留');
   const acknowledged=new Set(result.acknowledged as string[]);if(!operations.every(op=>acknowledged.has(op.id)))throw new Error('云端未确认全部操作，请重试同一批同步');
   const pending=vault!.pending.filter(op=>!acknowledged.has(op.id));let view=vault!.view,conflict:string|undefined;
   try{view=replay(snapshot.data,pending).view}catch(e){conflict=e instanceof Error?e.message:'剩余记录需要核对'}
   await persist({...vault!,base:snapshot,view,pending,conflict,lastSyncedAt:new Date().toISOString()});
   if(conflict)throw new Error(conflict);
  }
  const result=await cloud('/api/sync'),snapshot=result.snapshot as SyncSnapshot;if(snapshot.storeId!==vault!.base.storeId)throw new Error('云端门店不一致');
  await persist({...vault!,base:snapshot,view:clone(snapshot.data),pending:[],conflict:undefined,lastSyncedAt:new Date().toISOString()});status.message='双向同步完成，本地和云端已更新';
 }catch(error){
  const message=error instanceof Error?error.message:'同步失败，本地记录仍保留';status.message=message;
  if((error as {status?:number}).status===409&&vault){vault.conflict=message;await persist(clone(vault));}
 }finally{status.busy=false;emit();}
}
export async function conflictPreview(){
 if(!vault)await loadVault();const result=await cloud('/api/sync'),snapshot=result.snapshot as SyncSnapshot;if(snapshot.storeId!==vault!.base.storeId)throw new Error('云端门店不一致');
 const proposed=replay(snapshot.data,vault!.pending,true);
 const changes:{label:string;local:string;cloud:string;merged:string}[]=[];
 const labels:Record<string,string>={shopName:'店名',phone:'联系电话',address:'地址',lowBalanceCents:'低余额提醒',name:'服务名称',priceCents:'服务价格',active:'服务状态'};
 const show=(key:string,value:unknown)=>key.endsWith('Cents')?`¥${(Number(value)/100).toFixed(2)}`:typeof value==='boolean'?value?'启用':'停用':String(value===''||value==null?'未填写':value);
 for(const op of vault!.pending){
  if(op.kind==='settings'||op.kind==='servicePatch'){
   const local=op.kind==='settings'?vault!.view.settings:vault!.view.services.find(s=>s.id===op.payload.id),remote=op.kind==='settings'?snapshot.data.settings:snapshot.data.services.find(s=>s.id===op.payload.id),merged=op.kind==='settings'?proposed.view.settings:proposed.view.services.find(s=>s.id===op.payload.id);
   for(const key of Object.keys(op.payload).filter(key=>key in labels))changes.push({label:labels[key],local:show(key,(local as unknown as Record<string,unknown>)?.[key]),cloud:show(key,(remote as unknown as Record<string,unknown>)?.[key]),merged:show(key,(merged as unknown as Record<string,unknown>)?.[key])});
  }
  if(op.kind==='delete'||op.kind==='restore'){const m=proposed.view.members.find(m=>m.id===op.payload.id);changes.push({label:m?.name||'会员状态',local:op.kind==='delete'?'删除':'恢复',cloud:snapshot.data.members.find(m=>m.id===op.payload.id)?.deletedAt?'已删除':'正常',merged:m?.deletedAt?'已删除':'正常'});}
 }
 return {snapshot,proposed,changes,rows:proposed.view.cards.filter(c=>vault!.pending.some(op=>op.payload.cardId===c.id||op.payload.transactionId&&vault!.view.transactions.find(t=>t.id===op.payload.transactionId)?.cardId===c.id)).map(c=>({name:proposed.view.members.find(m=>m.id===c.memberId)?.name||'会员',local:vault!.view.cards.find(x=>x.id===c.id)?.balanceCents??0,cloud:snapshot.data.cards.find(x=>x.id===c.id)?.balanceCents??0,merged:c.balanceCents})),pending:vault!.pending.length,original:identity(vault!.pending)};
}
export async function acceptRebase(preview:Awaited<ReturnType<typeof conflictPreview>>){
 if(status.busy)throw new Error('正在处理其他操作，请稍后核对');status.busy=true;emit();
 try{await mutation;if(!vault||preview.original!==identity(vault.pending))throw new Error('本地账目发生变化，请重新核对');await persist({...vault,base:preview.snapshot,view:preview.proposed.view,pending:preview.proposed.operations,conflict:undefined});status.message='已按你核对的余额准备记录，请再次点击双向同步';}finally{status.busy=false;emit();}
}
export async function offlineApi(path:string,options?:RequestInit):Promise<Record<string,unknown>>{
 if(!vault)await loadVault();const method=options?.method??'GET',url=new URL(path,'https://local.qiansiwanlv.invalid');
 if(url.pathname==='/api/auth/logout'){await nativeCall('lock');vault=null;window.dispatchEvent(new Event('salon-local-lock'));return {ok:true};}
 if(method==='GET'){
  if(url.pathname==='/api/bootstrap')return clone(recompute(vault!.view)) as unknown as Record<string,unknown>;
  if(url.pathname==='/api/transactions'){
   let rows=[...vault!.view.transactions];const type=url.searchParams.get('type'),from=url.searchParams.get('from'),to=url.searchParams.get('to');if(type)rows=rows.filter(t=>t.type===type);if(from)rows=rows.filter(t=>t.createdAt>=new Date(from+'T00:00:00+08:00').toISOString());if(to)rows=rows.filter(t=>t.createdAt<new Date(new Date(to+'T00:00:00+08:00').getTime()+86400000).toISOString());
   const cursor=url.searchParams.get('cursor');if(cursor){const last=JSON.parse(atob(cursor));rows=rows.filter(t=>t.createdAt<last.time||(t.createdAt===last.time&&t.id<last.id));}const limit=Math.min(500,Math.max(1,Number(url.searchParams.get('limit')||100))),page=rows.slice(0,limit),last=page.at(-1);return {transactions:clone(page),nextCursor:rows.length>limit&&last?btoa(JSON.stringify({time:last.createdAt,id:last.id})):null};
  }throw new Error('不支持的本地读取');
 }
 if(status.busy)throw new Error('同步进行中，请稍后再记账');
 const task=async()=>{
  const payload=options?.body?JSON.parse(String(options.body)):{};const headers=new Headers(options?.headers);const key=String(payload.idempotencyKey||headers.get('X-Local-Operation-Id')||crypto.randomUUID());
  const existing=vault!.pending.find(op=>op.id===key);if(existing){const view=vault!.view;return existing.kind==='member'?{member:view.members.find(m=>m.id===key)}:existing.kind==='card'?{card:view.cards.find(c=>c.id===key),transaction:view.transactions.find(t=>t.id===key+':open')||null}:existing.kind==='transaction'?{transaction:view.transactions.find(t=>t.id===key),card:view.cards.find(c=>c.id===view.transactions.find(t=>t.id===key)?.cardId)}:existing.kind==='settings'?{settings:view.settings}:existing.kind==='service'||existing.kind==='servicePatch'?{service:view.services.find(s=>s.id===(existing.payload.id||key))}:{member:view.members.find(m=>m.id===existing.payload.id)};}
  let kind:SyncOperation['kind'];if(url.pathname==='/api/members')kind='member';else if(url.pathname==='/api/cards')kind='card';else if(url.pathname==='/api/transactions')kind='transaction';else if(url.pathname==='/api/settings')kind='settings';else if(url.pathname==='/api/services')kind=method==='PATCH'?'servicePatch':'service';else if(url.pathname.startsWith('/api/members/')){kind=url.pathname.endsWith('/restore')?'restore':'delete';payload.id=decodeURIComponent(url.pathname.split('/')[3]);}else throw new Error('不支持的本地操作');
  const next=clone(vault!);const op=prepareOperation(next.view,{id:key,kind,payload,createdAt:new Date().toISOString()});const result=applyOperation(next.view,op);recompute(next.view);next.pending.push(op);await persist(next);status.message='已保存到本地，稍后可手动同步';emit();return clone(result);
 };
 const promise=mutation.then(task);mutation=promise.catch(()=>{});return promise;
}
