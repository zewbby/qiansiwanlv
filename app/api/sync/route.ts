import {context,handleApi} from '@/lib/salon-server';
import {syncSnapshot,pushSync} from '@/lib/salon-sync-server';
export async function GET(){return handleApi(async()=>({snapshot:await syncSnapshot(await context())}));}
export async function POST(request:Request){return handleApi(async()=>pushSync(await context(request,true),request));}
