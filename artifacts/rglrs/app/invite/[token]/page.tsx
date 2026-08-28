import { InviteRedemption } from "@/components/invite-redemption";

export default async function InvitePage({params}:{params:Promise<{token:string}>}) {
  const {token}=await params;
  return <InviteRedemption token={token}/>;
}