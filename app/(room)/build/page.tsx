import { redirect } from "next/navigation";

// The agent list and New agent moved to Crew (builder flow, slice 5).
export default function Build() {
  redirect("/crew");
}
