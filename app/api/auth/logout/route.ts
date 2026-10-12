import {logout} from "@/lib/shop-auth";
export async function POST(request:Request) {return logout(request);}
