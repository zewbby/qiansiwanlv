import { context, handleApi } from "@/lib/salon-server";
import { deleteMember } from "@/lib/member-lifecycle";
import { SalonError } from "@/lib/salon-finance";
export async function DELETE(request: Request, { params }: { params: Promise<{id:string}> }) {
  return handleApi(async () => {
    const ctx = await context(request,true);
    if ((await request.text()).length > 2048) throw new SalonError("提交内容过长",413);
    return deleteMember(ctx,(await params).id);
  });
}
