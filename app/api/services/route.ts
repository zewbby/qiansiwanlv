import { context, createService, handleApi, updateService } from "@/lib/salon-server";
export async function POST(request: Request) { return handleApi(async () => createService(await context(request,true),request),201); }
export async function PATCH(request: Request) { return handleApi(async () => updateService(await context(request,true),request)); }
