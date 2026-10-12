import {context,handleApi} from '@/lib/salon-server';
export async function GET(){return handleApi(async()=>({connected:true,storeId:(await context()).ownerId}));}
