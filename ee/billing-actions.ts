"use server";
// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The Billing card's buttons. Owners only; each sends the owner to Stripe's own page.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { env } from "@/core/env";
import { asRole } from "@/dashboard/data";
import { checkoutUrl, portalUrl } from "./billing";

async function base() {
  if (env.dashboardUrl) return env.dashboardUrl;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `https://${host}` : "";
}
const back = (problem: string): never => redirect(`/settings?billing_problem=${encodeURIComponent(problem.slice(0, 200))}`);

export async function addCard(): Promise<void> {
  const { no } = await asRole("owner"); if (no) back(no.text);
  let url = "";
  try { url = await checkoutUrl(await base()); } catch (e) { back(e instanceof Error ? e.message : String(e)); }
  redirect(url);
}

export async function manageBilling(): Promise<void> {
  const { no } = await asRole("owner"); if (no) back(no.text);
  let url = "";
  try { url = await portalUrl(await base()); } catch (e) { back(e instanceof Error ? e.message : String(e)); }
  redirect(url);
}
