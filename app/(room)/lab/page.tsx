import { redirect } from "next/navigation";

// The runner test page (agent builder, slice 1) became the builder screen in slice 2.
export default function Lab() {
  redirect("/build");
}
