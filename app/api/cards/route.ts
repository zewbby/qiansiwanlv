import { context, createCard, handleApi } from "@/lib/salon-server";
export async function POST(request: Request) { return handleApi(async () => createCard(await context(request,true),request),201); }
