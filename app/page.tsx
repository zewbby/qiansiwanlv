import { requireShopUser } from "@/lib/shop-auth";
import SalonApp from "./components/salon-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireShopUser();
  return <SalonApp user={{ displayName: user.displayName, email: user.email }} />;
}
