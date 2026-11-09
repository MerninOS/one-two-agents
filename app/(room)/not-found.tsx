import { Empty } from "@/dashboard/components/ui";

export default function NotFound() {
  return <Empty title="Nothing here." action={{ href: "/", label: "Back to mission control" }}>That agent or run doesn’t exist.</Empty>;
}
