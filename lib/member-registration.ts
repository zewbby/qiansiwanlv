import { z } from "zod";

const input = z.object({
  name: z.string().trim().max(40,"姓名最多40个字").default(""),
  phone: z.string().trim().max(30).default("").refine(value => !value || /^\+?\d{7,20}$/.test(value.replace(/[\s()-]/g,"")),"请填写有效电话号码"),
  note: z.string().trim().max(500).default(""),
}).strict().refine(value => !!value.name || !!value.phone,"姓名或手机号至少填写一项");
export function parseMemberRegistration(raw: unknown) {
  const value = input.parse(raw);
  const phone = value.phone.replace(/[\s()-]/g,"");
  return {name:value.name || phone,phone,note:value.note};
}
