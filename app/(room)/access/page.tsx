import { redirect } from "next/navigation";

// Access became the Connections page (builder flow, slice 1): who can read, do and hand you what.
export default function Access() {
  redirect("/connections");
}
