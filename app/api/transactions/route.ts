import { context, createTransaction, handleApi, listTransactions } from "@/lib/salon-server";
export async function POST(request: Request) { return handleApi(async () => createTransaction(await context(request,true),request),201); }
export async function GET(request: Request) { return handleApi(async () => listTransactions(await context(),request)); }
