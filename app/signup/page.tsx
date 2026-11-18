import { notFound } from "next/navigation";
import { extensions } from "@/core/extensions";

// Sign-up for the hosted edition (invite-only, card 128 slice 3). The open edition has no sign-up:
// an owner adds people on Settings > People, so this page is not found.
export const metadata = { title: "Sign up · Control Room" };

export default function Signup() {
  const Page = extensions.SignupPage;
  if (!Page) notFound();
  return <Page />;
}
