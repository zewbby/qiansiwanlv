import { SalonError } from "./salon-finance.ts";
import type { Member } from "./salon-types";

type Context = { ownerId: string; db: Pick<D1Database, "prepare"> };
async function find(ctx: Context, memberId: string): Promise<Member> {
  if (!memberId || memberId.length > 100) throw new SalonError("会员编号无效");
  const member = await ctx.db.prepare("SELECT id,name,phone,note,created_at AS createdAt,deleted_at AS deletedAt FROM salon_members WHERE id=? AND owner_id=?").bind(memberId,ctx.ownerId).first<Member>();
  if (!member) throw new SalonError("找不到这位会员",404,"MEMBER_NOT_FOUND");
  return member;
}
export async function deleteMember(ctx: Context, memberId: string) {
  const member = await find(ctx,memberId);
  if (member.deletedAt) return { member };
  // The balance predicate and update run in one SQL statement; triggers also
  // block new cards/ledger writes after deletion, closing concurrent-write races.
  await ctx.db.prepare("UPDATE salon_members SET deleted_at=? WHERE id=? AND owner_id=? AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM salon_cards WHERE member_id=salon_members.id AND owner_id=salon_members.owner_id AND balance_cents>0)").bind(new Date().toISOString(),memberId,ctx.ownerId).run();
  const updated = await find(ctx,memberId);
  if (!updated.deletedAt) throw new SalonError("会员卡还有余额，请先核对并结清余额再删除",409,"MEMBER_HAS_BALANCE");
  return { member: updated };
}
export async function restoreMember(ctx: Context, memberId: string) {
  await find(ctx,memberId);
  await ctx.db.prepare("UPDATE salon_members SET deleted_at=NULL WHERE id=? AND owner_id=? AND deleted_at IS NOT NULL").bind(memberId,ctx.ownerId).run();
  return { member: await find(ctx,memberId) };
}
