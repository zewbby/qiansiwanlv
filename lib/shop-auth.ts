import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { digest,passwordHash,sameHash,sessionToken } from "./shop-auth-crypto";

const COOKIE="salon_session";
const secretEnv = env as unknown as Record<string,string|D1Database|undefined>;
const config = () => {
  const username=secretEnv.SALON_ADMIN_USERNAME as string;
  const hash=secretEnv.SALON_ADMIN_HASH as string;
  const salt=secretEnv.SALON_ADMIN_SALT as string;
  const pepper=secretEnv.SALON_AUTH_PEPPER as string;
  const ownerId=secretEnv.SALON_OWNER_ID as string;
  if(!username||!hash||!salt||!pepper||!ownerId||!env.DB) throw new Error("Admin account not configured");
  return {username,hash,salt,pepper,ownerId,db:env.DB.withSession("first-primary")};
};
const privateHeaders={"Cache-Control":"private, no-store"};
export async function getShopUser() {
  const token=(await cookies()).get(COOKIE)?.value;
  if(!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const c=config();
  const session=await c.db.prepare("SELECT owner_id FROM salon_sessions WHERE token_hash=? AND expires_at>? AND credential_version=?").bind(await digest(token),Date.now(),c.hash).first<{owner_id:string}>();
  if(!session || session.owner_id!==c.ownerId) return null;
  return {userId:session.owner_id,displayName:c.username,email:c.username,fullName:null};
}
export async function requireShopUser() {const user=await getShopUser();if(!user) redirect("/login");return user;}
function checkOrigin(request:Request): boolean {return request.headers.get("origin")===new URL(request.url).origin && request.headers.get("sec-fetch-site")!=="cross-site";}
export async function login(request:Request):Promise<Response> {
  if(!checkOrigin(request)) return Response.json({error:"请从应用登录页面操作"},{status:403,headers:privateHeaders});
  if(!request.headers.get("content-type")?.includes("application/json")) return Response.json({error:"请求格式不正确"},{status:400,headers:privateHeaders});
  try {
    const raw=await request.text();if(raw.length>2048) return Response.json({error:"输入内容过长"},{status:413,headers:privateHeaders});
    let body: {username?:unknown;password?:unknown};try {body=JSON.parse(raw);} catch {return Response.json({error:"请求格式不正确"},{status:400,headers:privateHeaders});}
    if(typeof body?.username!=="string" || typeof body.password!=="string" || body.username.length>100 || body.password.length>256) return Response.json({error:"请输入账号和密码"},{status:400,headers:privateHeaders});
    const c=config(), now=Date.now(), windowStart=now-15*60*1000;
    const ipKey=await digest(`${c.pepper}:${request.headers.get("cf-connecting-ip")||"local"}`);
    const keys=[ipKey,"account"];
    await c.db.batch(keys.map(key=>c.db.prepare("INSERT INTO salon_login_limits (id,attempts,window_start) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END").bind(key,now,windowStart,windowStart)));
    const limits=await c.db.prepare("SELECT id,attempts FROM salon_login_limits WHERE id IN (?,?)").bind(...keys).all<{id:string;attempts:number}>();
    if(limits.results.some(r=>r.attempts>(r.id==="account"?100:10))) return Response.json({error:"登录尝试过多，请15分钟后重试"},{status:429,headers:{...privateHeaders,"Retry-After":"900"}});
    const calculated=await passwordHash(body.password,c.salt,c.pepper);
    if(!sameHash(calculated,c.hash) || body.username!==c.username) return Response.json({error:"账号或密码不正确"},{status:401,headers:privateHeaders});
    const token=sessionToken(), maxAge=14*86400;
    await c.db.batch([
      c.db.prepare("DELETE FROM salon_sessions WHERE expires_at<=?").bind(now),
      c.db.prepare("DELETE FROM salon_login_limits WHERE window_start<?").bind(windowStart),
      c.db.prepare("INSERT INTO salon_sessions (token_hash,owner_id,expires_at,credential_version) VALUES (?,?,?,?)").bind(await digest(token),c.ownerId,now+maxAge*1000,c.hash),
    ]);
    const secure=new URL(request.url).protocol==="https:"?"; Secure":"";
    return Response.json({ok:true},{headers:{...privateHeaders,"Set-Cookie":`${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`}});
  } catch {return Response.json({error:"登录服务暂时无法连接，请稍后重试"},{status:503,headers:privateHeaders});}
}
export async function logout(request:Request):Promise<Response> {
  if(!checkOrigin(request)) return Response.json({error:"请求来源不正确"},{status:403,headers:privateHeaders});
  try {
    const token=(await cookies()).get(COOKIE)?.value;
    if(token && /^[a-f0-9]{64}$/.test(token)) await config().db.prepare("DELETE FROM salon_sessions WHERE token_hash=?").bind(await digest(token)).run();
    return Response.json({ok:true},{headers:{...privateHeaders,"Set-Cookie":`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(request.url).protocol==="https:"?"; Secure":""}`}});
  } catch {return Response.json({error:"退出失败，请稍后重试"},{status:503,headers:privateHeaders});}
}
