import { context, createMember, handleApi } from "@/lib/salon-server";
export async function POST(request: Request) { return handleApi(async () => createMember(await context(request,true),request),201); }
