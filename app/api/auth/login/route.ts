import {login} from "@/lib/shop-auth";
export async function POST(request:Request) {return login(request);}
