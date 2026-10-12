import { context, handleApi, updateSettings } from "@/lib/salon-server";
export async function PATCH(request: Request) { return handleApi(async () => updateSettings(await context(request,true),request)); }
