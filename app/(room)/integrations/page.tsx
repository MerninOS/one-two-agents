import { redirect } from "next/navigation";

// Integrations became the Connections page (builder flow, slice 1).
export default function Integrations() {
  redirect("/connections");
}
