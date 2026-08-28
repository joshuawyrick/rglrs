import type { Metadata } from "next";
import { SignupInviteRedemption } from "@/components/signup-invite-redemption";

export const metadata: Metadata = {
  title: "You’re invited to RGLRS",
  description: "Join a private social network for the people who matter.",
  robots: { index: false, follow: false },
};

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SignupInviteRedemption token={token} />;
}