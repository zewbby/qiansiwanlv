import { bootstrap, context, handleApi } from "@/lib/salon-server";
export async function GET() { return handleApi(async () => bootstrap(await context())); }
