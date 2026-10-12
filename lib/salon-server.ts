import { env } from "cloudflare:workers";
import { z } from "zod";
import { parseMemberRegistration } from "./member-registration";
import { type ChatGPTUser } from "@/app/chatgpt-auth";
import { getShopUser } from "./shop-auth";
import { calculateEntry, MAX_CENTS, SalonError, shanghaiDayRange } from "./salon-finance";
import { createLedgerStatement } from "./salon-ledger";
import type { Card, LedgerTransaction, Member, SalonBootstrap, Service, ShopSettings } from "./salon-types";

type Database = Pick<D1Database, "prepare" | "batch">;
export type Context = {db: Database; ownerId: string; user: ChatGPTUser};
type StoredCard = Card & {ownerId: string; requestKey: string; requestFingerprint: string};
type StoredTransaction = LedgerTransaction & {ownerId: string; requestKey: string; requestFingerprint: string};
export { cardColumns, transactionColumns, serviceColumns, memberColumns, settingsColumns, publicCard, publicTransaction, publicService, seedSettings };
const cardColumns = `id, owner_id AS ownerId, member_id AS memberId, name, type, cash_balance_cents AS cashBalanceCents, gift_balance_cents AS giftBalanceCents, balance_cents AS balanceCents, status, version, request_key AS requestKey, request_fingerprint AS requestFingerprint, created_at AS createdAt`;
const transactionColumns = `id, owner_id AS ownerId, member_id AS memberId, card_id AS cardId, type, amount_cents AS amountCents, cash_received_cents AS cashReceivedCents, gift_cents AS giftCents, service_spend_cents AS serviceSpendCents, cash_delta_cents AS cashDeltaCents, gift_delta_cents AS giftDeltaCents, balance_before_cents AS balanceBeforeCents, balance_after_cents AS balanceAfterCents, card_version AS cardVersion, service_name AS serviceName, note, reversed_transaction_id AS reversedTransactionId, request_key AS requestKey, request_fingerprint AS requestFingerprint, created_at AS createdAt`;
const serviceColumns = `id, name, price_cents AS priceCents, active, created_at AS createdAt`;
const memberColumns = `id, name, phone, note, created_at AS createdAt, deleted_at AS deletedAt`;
const settingsColumns = `shop_name AS shopName, phone, address, low_balance_cents AS lowBalanceCents`;
const cents = z.number().int("金额必须以分为整数").min(0).max(MAX_CENTS);
const text = (max = 200) => z.string().trim().max(max,`文字最多${max}个字符`);
const id = z.string().min(1).max(100);
const key = z.string().min(8,"请提供操作识别码").max(100);
const phone = text(30).regex(/^[+\d\s()-]{5,30}$/, "请填写有效电话号码");
const note = text(500).default("");

const cardInput = z.object({memberId:id,name:text(40).min(1,"请填写会员卡名称"),type:z.literal("stored").default("stored"),paidCents:cents.default(0),giftCents:cents.default(0),idempotencyKey:key}).strict();
const transactionInput = z.discriminatedUnion("type",[
  z.object({type:z.literal("recharge"),cardId:id,expectedVersion:z.number().int().min(0),idempotencyKey:key,paidCents:cents.default(0),giftCents:cents.default(0),note}).strict(),
  z.object({type:z.literal("consume"),cardId:id,expectedVersion:z.number().int().min(0),idempotencyKey:key,amountCents:cents.optional(),serviceId:id.optional(),note}).strict(),
  z.object({type:z.literal("reversal"),transactionId:id,idempotencyKey:key,note}).strict(),
]);
const settingsInput = z.object({shopName:text(60).min(1,"请填写店名").optional(),phone:text(30).optional(),address:text(200).optional(),lowBalanceCents:cents.optional()}).strict().refine(p=>Object.keys(p).length>0,"请填写设置内容");
const serviceInput = z.object({name:text(50).min(1,"请填写服务名称"),priceCents:cents,active:z.boolean().default(true)}).strict();
const servicePatchInput = z.object({id,name:text(50).min(1).optional(),priceCents:cents.optional(),active:z.boolean().optional()}).strict().refine(p=>Object.keys(p).length>1,"请填写修改内容");
const privateHeaders = {"Cache-Control":"private, no-store","Vary":"Cookie"};

export async function context(request?: Request, mutation = false): Promise<Context> {
  const user = await getShopUser();
  if (!user) throw new SalonError("请先登录，再管理会员和账目",401,"AUTH_REQUIRED");
  if (mutation && (env as unknown as Record<string,string>).SALON_READ_ONLY === "true") throw new SalonError("正在迁移云端数据，请稍后再记账",503,"MIGRATION_READ_ONLY");
  if (mutation && request) {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) throw new SalonError("请求来源不受信任，请从应用内操作",403,"INVALID_ORIGIN");
  }
  if (!env.DB) throw new SalonError("云数据库尚未接入，请完成部署后使用",503,"DATABASE_UNAVAILABLE");
  return {db:env.DB.withSession("first-primary"),ownerId:user.userId,user};
}
export async function handleApi(run: () => Promise<unknown>, status = 200): Promise<Response> {
  try { return Response.json(await run(),{status,headers:privateHeaders}); }
  catch(error) {
    if (error instanceof z.ZodError) {
      const message = error.issues[0]?.message ?? "";
      return Response.json({error:/[\u4e00-\u9fff]/.test(message) ? message : "输入内容不完整或格式不正确",code:"INVALID_INPUT"},{status:400,headers:privateHeaders});
    }
    if (error instanceof SalonError) return Response.json({error:error.message,code:error.code},{status:error.status,headers:privateHeaders});
    const message = error instanceof Error ? error.message : "";
    if (message.includes("card_one_member") || message.includes("salon_cards.owner_id, salon_cards.member_id")) return Response.json({error:"这位会员已有会员卡，请直接充值或划卡",code:"MEMBER_HAS_CARD"},{status:409,headers:privateHeaders});
    if (message.includes("member_owner_phone")) return Response.json({error:"这个电话号码已经登记过会员",code:"PHONE_EXISTS"},{status:409,headers:privateHeaders});
    if (message.includes("member_is_deleted")) return Response.json({error:"会员已删除，请先恢复会员再记账",code:"MEMBER_DELETED"},{status:409,headers:privateHeaders});
    if (message.includes("member_has_balance")) return Response.json({error:"会员卡还有余额，请先结清再删除",code:"MEMBER_HAS_BALANCE"},{status:409,headers:privateHeaders});
    console.error("Salon API failure",error instanceof Error ? error.name : "unknown");
    return Response.json({error:"云端保存失败，请稍后重试；请保留本次操作识别码",code:"SERVER_ERROR"},{status:500,headers:privateHeaders});
  }
}
async function json(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new SalonError("请求格式必须是 JSON");
  const raw = await request.text();
  if (raw.length > 10_000) throw new SalonError("提交内容过长",413,"PAYLOAD_TOO_LARGE");
  try { return JSON.parse(raw); } catch { throw new SalonError("提交内容格式不正确"); }
}
async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
function publicCard(row: StoredCard): Card { const {ownerId,requestKey,requestFingerprint,...card} = row; void ownerId; void requestKey; void requestFingerprint; return card; }
function publicTransaction(row: StoredTransaction): LedgerTransaction { const {ownerId,requestKey,requestFingerprint,...entry} = row; void ownerId; void requestKey; void requestFingerprint; return entry; }
function publicService(row: Service): Service {return {...row,active:Boolean(row.active)};}
async function getCard(ctx: Context, cardId: string): Promise<StoredCard> {
  const card = await ctx.db.prepare(`SELECT ${cardColumns} FROM salon_cards WHERE id = ? AND owner_id = ?`).bind(cardId,ctx.ownerId).first<StoredCard>();
  if (!card) throw new SalonError("找不到这张会员卡",404,"CARD_NOT_FOUND");
  return card;
}
async function getTransaction(ctx: Context, transactionId: string): Promise<StoredTransaction> {
  const entry = await ctx.db.prepare(`SELECT ${transactionColumns} FROM salon_transactions WHERE id = ? AND owner_id = ?`).bind(transactionId,ctx.ownerId).first<StoredTransaction>();
  if (!entry) throw new SalonError("找不到这笔流水",404,"TRANSACTION_NOT_FOUND");
  return entry;
}
async function findRequest(ctx: Context, requestKey: string, requestFingerprint: string): Promise<StoredTransaction | null> {
  const existing = await ctx.db.prepare(`SELECT ${transactionColumns} FROM salon_transactions WHERE owner_id = ? AND request_key = ?`).bind(ctx.ownerId,requestKey).first<StoredTransaction>();
  if (existing && existing.requestFingerprint !== requestFingerprint) throw new SalonError("同一操作识别码对应的内容发生变化，请刷新后重新操作",409,"IDEMPOTENCY_CONFLICT");
  return existing;
}
async function seedSettings(ctx: Context) {
  const now = new Date().toISOString();
  const defaultServices = [{name:"洗剪吹",price:5800},{name:"男士剪发",price:3800},{name:"染发",price:26800},{name:"烫发",price:39800}];
  // Settings and deterministic default service IDs use INSERT OR IGNORE, never customer/demo data.
  await ctx.db.batch([
    ctx.db.prepare(`INSERT OR IGNORE INTO salon_settings (owner_id) VALUES (?)`).bind(ctx.ownerId),
    ...defaultServices.map((service,i)=>ctx.db.prepare(`INSERT OR IGNORE INTO salon_services (id,owner_id,name,price_cents,active,created_at) VALUES (?,?,?,?,1,?)`).bind(`default-${ctx.ownerId}-${i}`,ctx.ownerId,service.name,service.price,now)),
  ]);
}
export async function bootstrap(ctx: Context): Promise<SalonBootstrap> {
  await seedSettings(ctx);
  const day = shanghaiDayRange();
  const weekStartMs = new Date(day.start).getTime() - 6 * 86400_000;
  const results = await ctx.db.batch([
    ctx.db.prepare(`SELECT ${settingsColumns} FROM salon_settings WHERE owner_id = ?`).bind(ctx.ownerId),
    ctx.db.prepare(`SELECT ${memberColumns} FROM salon_members WHERE owner_id = ? ORDER BY created_at DESC,id DESC`).bind(ctx.ownerId),
    ctx.db.prepare(`SELECT ${cardColumns} FROM salon_cards WHERE owner_id = ? ORDER BY created_at DESC,id DESC`).bind(ctx.ownerId),
    ctx.db.prepare(`SELECT ${serviceColumns} FROM salon_services WHERE owner_id = ? ORDER BY created_at,id`).bind(ctx.ownerId),
    ctx.db.prepare(`SELECT ${transactionColumns} FROM salon_transactions WHERE owner_id = ? ORDER BY created_at DESC,id DESC LIMIT 500`).bind(ctx.ownerId),
    ctx.db.prepare(`SELECT COALESCE(SUM(t.cash_received_cents),0) AS todayCashReceivedCents, COALESCE(SUM(t.service_spend_cents),0) AS todayServiceSpendCents, COALESCE(SUM(CASE WHEN t.type = 'consume' AND NOT EXISTS (SELECT 1 FROM salon_transactions r WHERE r.reversed_transaction_id = t.id AND r.owner_id = t.owner_id) THEN 1 ELSE 0 END),0) AS todayServices FROM salon_transactions t WHERE t.owner_id = ? AND t.created_at >= ? AND t.created_at < ?`).bind(ctx.ownerId,day.start,day.end),
    ctx.db.prepare(`SELECT COUNT(*) AS memberCount, COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END),0) AS todayNewMembers FROM salon_members WHERE owner_id = ? AND deleted_at IS NULL`).bind(day.start,day.end,ctx.ownerId),
    ctx.db.prepare(`SELECT COALESCE(SUM(balance_cents),0) AS totalBalanceCents FROM salon_cards WHERE owner_id = ?`).bind(ctx.ownerId),
    ctx.db.prepare(`SELECT substr(datetime(created_at,'+8 hours'),1,10) AS date, SUM(cash_received_cents) AS cashReceivedCents FROM salon_transactions WHERE owner_id = ? AND created_at >= ? AND created_at < ? GROUP BY substr(datetime(created_at,'+8 hours'),1,10) ORDER BY date`).bind(ctx.ownerId,new Date(weekStartMs).toISOString(),day.end),
  ]);
  const grouped = results[8].results as {date:string;cashReceivedCents:number}[];
  const weekReceipts = Array.from({length:7},(_,i)=>{
    const date = new Date(weekStartMs+i*86400_000+8*3600_000).toISOString().slice(0,10);
    return {date,cashReceivedCents:grouped.find(row=>row.date===date)?.cashReceivedCents ?? 0};
  });
  return {user:{displayName:ctx.user.displayName,email:ctx.user.email},settings:results[0].results[0] as ShopSettings,members:results[1].results as unknown as Member[],cards:(results[2].results as unknown as StoredCard[]).map(publicCard),services:(results[3].results as unknown as Service[]).map(publicService),transactions:(results[4].results as unknown as StoredTransaction[]).map(publicTransaction),summary:{...(results[5].results[0] as Record<string,number>),...(results[6].results[0] as Record<string,number>),...(results[7].results[0] as Record<string,number>),weekReceipts} as unknown as SalonBootstrap["summary"],serverTime:new Date().toISOString()};
}

export async function createMember(ctx: Context, request: Request) {
  const payload = parseMemberRegistration(await json(request));
  const member: Member = {id:crypto.randomUUID(),...payload,phone:payload.phone.replace(/[\s()-]/g,""),createdAt:new Date().toISOString()};
  const existing = member.phone ? await ctx.db.prepare(`SELECT id,deleted_at AS deletedAt FROM salon_members WHERE owner_id = ? AND phone = ?`).bind(ctx.ownerId,member.phone).first<{id:string;deletedAt:string|null}>() : null;
  if (existing) throw new SalonError(existing.deletedAt ? "这个电话号码的会员已删除，请在已删除列表恢复" : "这个电话号码已经登记过会员",409,"PHONE_EXISTS");
  try { await ctx.db.prepare(`INSERT INTO salon_members (id,owner_id,name,phone,note,created_at) VALUES (?,?,?,?,?,?)`).bind(member.id,ctx.ownerId,member.name,member.phone,member.note,member.createdAt).run(); }
  catch(error) {if (String(error).includes("UNIQUE")) throw new SalonError("这个电话号码已经登记过会员",409,"PHONE_EXISTS"); throw error;}
  return {member};
}

export async function createCard(ctx: Context, request: Request) {
  const payload = cardInput.parse(await json(request));
  const requestFingerprint = await fingerprint(payload);
  const existing = await ctx.db.prepare(`SELECT ${cardColumns} FROM salon_cards WHERE owner_id = ? AND request_key = ?`).bind(ctx.ownerId,payload.idempotencyKey).first<StoredCard>();
  if (existing) {
    if (existing.requestFingerprint !== requestFingerprint) throw new SalonError("同一操作识别码对应的开卡内容发生变化",409,"IDEMPOTENCY_CONFLICT");
    return {card:publicCard(existing),replayed:true};
  }
  const member = await ctx.db.prepare(`SELECT id FROM salon_members WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`).bind(payload.memberId,ctx.ownerId).first();
  if (!member) throw new SalonError("找不到这位会员",404,"MEMBER_NOT_FOUND");
  const priorCard = await ctx.db.prepare("SELECT id FROM salon_cards WHERE member_id=? AND owner_id=?").bind(payload.memberId,ctx.ownerId).first();
  if (priorCard) throw new SalonError("这位会员已有会员卡，请直接充值或划卡",409,"MEMBER_HAS_CARD");
  const now = new Date().toISOString();
  const card: StoredCard = {id:crypto.randomUUID(),ownerId:ctx.ownerId,memberId:payload.memberId,name:payload.name,type:payload.type,cashBalanceCents:0,giftBalanceCents:0,balanceCents:0,status:"active",version:0,requestKey:payload.idempotencyKey,requestFingerprint,createdAt:now};
  // A card can start empty; an initial balance is always represented by a recharge ledger row.
  const hasInitial = payload.paidCents > 0 || payload.giftCents > 0;
  const entry = hasInitial ? calculateEntry(card,{type:"recharge",paidCents:payload.paidCents,giftCents:payload.giftCents}) : null;
  const transactionId = crypto.randomUUID();
  const statements = [ctx.db.prepare(`INSERT INTO salon_cards (id,owner_id,member_id,name,type,request_key,request_fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(card.id,ctx.ownerId,card.memberId,card.name,card.type,payload.idempotencyKey,requestFingerprint,now)];
  if (entry) statements.push(createLedgerStatement(ctx,card,entry,{id:transactionId,key:`open:${payload.idempotencyKey}`,fingerprint:requestFingerprint,createdAt:now,serviceName:"开卡充值",note:"",reversedTransactionId:null}));
  try { await ctx.db.batch(statements); }
  catch(error) {
    const raced = await ctx.db.prepare(`SELECT ${cardColumns} FROM salon_cards WHERE owner_id = ? AND request_key = ?`).bind(ctx.ownerId,payload.idempotencyKey).first<StoredCard>();
    if (raced && raced.requestFingerprint === requestFingerprint) return {card:publicCard(raced),replayed:true};
    throw error;
  }
  return {card:publicCard(await getCard(ctx,card.id)),transaction:entry ? publicTransaction(await getTransaction(ctx,transactionId)) : null};
}

export async function createTransaction(ctx: Context, request: Request) {
  const payload = transactionInput.parse(await json(request));
  const requestFingerprint = await fingerprint(payload);
  const replay = await findRequest(ctx,payload.idempotencyKey,requestFingerprint);
  if (replay) return {transaction:publicTransaction(replay),card:publicCard(await getCard(ctx,replay.cardId)),replayed:true};
  let original: StoredTransaction | null = null;
  if (payload.type === "reversal") {
    original = await getTransaction(ctx,payload.transactionId);
    if (original.type === "reversal") throw new SalonError("冲正记录不能再次冲正");
    const reversed = await ctx.db.prepare(`SELECT id FROM salon_transactions WHERE reversed_transaction_id = ? AND owner_id = ?`).bind(original.id,ctx.ownerId).first();
    if (reversed) throw new SalonError("这笔流水已经冲正过",409,"ALREADY_REVERSED");
  }
  const card = await getCard(ctx,original?.cardId ?? (payload as {cardId:string}).cardId);
  const memberState = await ctx.db.prepare("SELECT deleted_at AS deletedAt FROM salon_members WHERE id=? AND owner_id=?").bind(card.memberId,ctx.ownerId).first<{deletedAt:string|null}>();
  if (memberState?.deletedAt) throw new SalonError("会员已删除，请先恢复会员再记账",409,"MEMBER_DELETED");
  if (payload.type !== "reversal" && payload.expectedVersion !== card.version) throw new SalonError("会员卡刚刚有新操作，请刷新余额后重试",409,"STALE_CARD");
  let service: Service | null = null;
  if (payload.type === "consume" && payload.serviceId) {
    service = await ctx.db.prepare(`SELECT ${serviceColumns} FROM salon_services WHERE id = ? AND owner_id = ? AND active = 1`).bind(payload.serviceId,ctx.ownerId).first<Service>();
    if (!service) throw new SalonError("这个服务项目已停用或不存在",404,"SERVICE_NOT_FOUND");
  }
  const operation = payload.type === "reversal" ? {type:"reversal" as const,original:original as StoredTransaction} : payload.type === "consume" ? {...payload,amountCents:payload.amountCents ?? service?.priceCents} : payload;
  const entry = calculateEntry(card,operation);
  const transactionId = crypto.randomUUID(), now = new Date().toISOString();
  try {
    const result = await ctx.db.batch([
      createLedgerStatement(ctx,card,entry,{id:transactionId,key:payload.idempotencyKey,fingerprint:requestFingerprint,createdAt:now,serviceName:original ? original.serviceName : (service?.name ?? (payload.type === "recharge" ? "会员充值" : "自定义服务")),note:payload.note,reversedTransactionId:original?.id ?? null}),
    ]);
    if (result[0].meta.changes === 0) {
      const duplicate = await findRequest(ctx,payload.idempotencyKey,requestFingerprint);
      if (duplicate) return {transaction:publicTransaction(duplicate),card:publicCard(await getCard(ctx,duplicate.cardId)),replayed:true};
      throw new SalonError("会员卡刚刚有新操作，请刷新余额后重试",409,"STALE_CARD");
    }
  } catch(error) {
    const duplicate = await findRequest(ctx,payload.idempotencyKey,requestFingerprint);
    if (duplicate) return {transaction:publicTransaction(duplicate),card:publicCard(await getCard(ctx,duplicate.cardId)),replayed:true};
    if (original) {
      const reversed = await ctx.db.prepare(`SELECT id FROM salon_transactions WHERE owner_id = ? AND reversed_transaction_id = ?`).bind(ctx.ownerId,original.id).first();
      if (reversed) throw new SalonError("这笔流水已经冲正过",409,"ALREADY_REVERSED");
    }
    throw error;
  }
  return {transaction:publicTransaction(await getTransaction(ctx,transactionId)),card:publicCard(await getCard(ctx,card.id))};
}

export async function updateSettings(ctx: Context, request: Request) {
  const payload = settingsInput.parse(await json(request));
  await seedSettings(ctx);
  const current = await ctx.db.prepare(`SELECT ${settingsColumns} FROM salon_settings WHERE owner_id = ?`).bind(ctx.ownerId).first<ShopSettings>();
  const settings = {...current,...payload} as ShopSettings;
  await ctx.db.prepare(`UPDATE salon_settings SET shop_name = ?,phone = ?,address = ?,low_balance_cents = ? WHERE owner_id = ?`).bind(settings.shopName,settings.phone,settings.address,settings.lowBalanceCents,ctx.ownerId).run();
  return {settings};
}
export async function createService(ctx: Context, request: Request) {
  const payload = serviceInput.parse(await json(request));
  const service: Service = {id:crypto.randomUUID(),...payload,createdAt:new Date().toISOString()};
  await ctx.db.prepare(`INSERT INTO salon_services (id,owner_id,name,price_cents,active,created_at) VALUES (?,?,?,?,?,?)`).bind(service.id,ctx.ownerId,service.name,service.priceCents,service.active ? 1 : 0,service.createdAt).run();
  return {service};
}
export async function updateService(ctx: Context, request: Request) {
  const payload = servicePatchInput.parse(await json(request));
  const current = await ctx.db.prepare(`SELECT ${serviceColumns} FROM salon_services WHERE id = ? AND owner_id = ?`).bind(payload.id,ctx.ownerId).first<Service>();
  if (!current) throw new SalonError("找不到这项服务",404,"SERVICE_NOT_FOUND");
  const service = publicService({...current,...payload});
  await ctx.db.prepare(`UPDATE salon_services SET name = ?,price_cents = ?,active = ? WHERE id = ? AND owner_id = ?`).bind(service.name,service.priceCents,service.active ? 1 : 0,service.id,ctx.ownerId).run();
  return {service};
}

export async function listTransactions(ctx: Context, request: Request) {
  const url = new URL(request.url), limit = Math.min(500,Math.max(1,Number(url.searchParams.get("limit") ?? 100)));
  if (!Number.isInteger(limit)) throw new SalonError("分页数量不正确");
  let sql = `SELECT ${transactionColumns} FROM salon_transactions WHERE owner_id = ?`;
  const params: (string|number)[] = [ctx.ownerId];
  const type = url.searchParams.get("type");
  if (type) {const selected = z.enum(["recharge","consume","reversal"]).parse(type);sql += " AND type = ?"; params.push(selected);}
  const from = url.searchParams.get("from"), to = url.searchParams.get("to");
  for (const date of [from,to]) {
    if (!date) continue;
    const midnight = new Date(`${date}T00:00:00+08:00`).getTime();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(midnight) || new Date(midnight+8*3600_000).toISOString().slice(0,10) !== date) throw new SalonError("日期格式不正确");
  }
  if (from && to && from > to) throw new SalonError("开始日期不能晚于结束日期");
  if (from) {sql += " AND created_at >= ?"; params.push(new Date(`${from}T00:00:00+08:00`).toISOString());}
  if (to) {sql += " AND created_at < ?"; params.push(new Date(new Date(`${to}T00:00:00+08:00`).getTime()+86400_000).toISOString());}
  const cursor = url.searchParams.get("cursor");
  if (cursor) {
    let parsed: {time:string;id:string};
    try {parsed = z.object({time:z.string().datetime(),id}).strict().parse(JSON.parse(atob(cursor)));} catch {throw new SalonError("分页游标不正确");}
    sql += " AND (created_at < ? OR (created_at = ? AND id < ?))"; params.push(parsed.time,parsed.time,parsed.id);
  }
  sql += " ORDER BY created_at DESC,id DESC LIMIT ?"; params.push(limit+1);
  const rows = (await ctx.db.prepare(sql).bind(...params).all<StoredTransaction>()).results;
  const page = rows.slice(0,limit), last = page.at(-1);
  return {transactions:page.map(publicTransaction),nextCursor:rows.length>limit && last ? btoa(JSON.stringify({time:last.createdAt,id:last.id})) : null};
}
