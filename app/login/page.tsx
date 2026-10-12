import {redirect} from "next/navigation";
import {getShopUser} from "@/lib/shop-auth";
import LoginForm from "./login-form";
export const dynamic="force-dynamic";
export default async function LoginPage() {if(await getShopUser()) redirect("/");return <LoginForm/>;}
