import { redirect } from "next/navigation";
import { BY_ID } from "@/dashboard/crew";
import { getFloor } from "@/dashboard/data";
import { Empty } from "@/dashboard/components/ui";

// "Run replay" in the sidebar opens the newest real run.
export default async function LatestReplay() {
  const f = await getFloor();
  const latest = f.runs.find((r) => r.status !== "skipped" && BY_ID[r.agent_id]);
  if (latest) redirect(`/runs/${latest.id}`);
  return <Empty title="No real runs to replay yet." action={{ href: "/runs", label: "Open the run log" }}>Skipped runs while agents are off duty have nothing to replay.</Empty>;
}
