// One Two's planned seats: agents on its plan that aren't built yet. The Control Room shows each one
// (Crew, the rail, the org chart) until an agent with the same id is built, and only in an org that
// has this pack's agents (core/install.ts plannedSeats).
import type { CrewMember } from "@/dashboard/crew";

export const ONE_TWO_PLANNED: readonly CrewMember[] = [
  { id: "blend_coach", name: "Sage", role: "Blend Coach", icon: "sliders-horizontal", built: false, phase: 3, tier: "Draft", trigger: "When a Shopify order is fulfilled + 5 days",
    job: "Post-purchase check-ins, blend ratio tweaks, reorder timing.",
    mandate: "I’ll check in after a bag lands, suggest blend tweaks and time the reorder. You approve what goes out." },
  { id: "roast_planner", name: "Blair", role: "Roast Planner", icon: "flame", built: false, phase: 3, tier: "Report", trigger: "Trigger set when built",
    job: "Roast schedule, green lot burn-down, days of cover, and a 60-day “start shopping” signal.",
    mandate: "I’ll plan the roast schedule and tell you how many days of green cover are left." },
  { id: "green_buyer", name: "Sol", role: "Green Buyer", icon: "leaf", built: false, phase: 3, tier: "Report", trigger: "Monthly, and when Roast Planner sees under 60 days of green cover",
    job: "Green coffee market pulse, offer ranking, buying suggestions.",
    mandate: "I’ll read importer offers and the market, rank what fits, and suggest what to buy. You decide." },
  { id: "merchandiser", name: "Remy", role: "Merchandiser", icon: "store", built: false, phase: 4, tier: "Act", trigger: "Trigger set when built",
    job: "Hide sold-out lots in the blend builder, back-in-stock, lot page drafts.",
    mandate: "I’ll hide sold-out lots, flag back-in-stock and draft lot pages, within limits you set." },
  { id: "concierge", name: "Jules", role: "Concierge", icon: "mail", built: false, phase: 4, tier: "Draft", trigger: "Trigger set when built",
    job: "Customer email triage and reply drafts.",
    mandate: "I’ll sort customer email and draft replies. You send them." },
  { id: "conversion_optimizer", name: "Ellis", role: "Conversion Optimizer", icon: "flask-conical", built: false, phase: 4, tier: "Draft",
    trigger: "First Monday of each month, 8:00 AM CT, plus a weekly code-only check Mondays 7:30 AM CT",
    job: "Runs one experiment at a time on the store's website and drafts each change as a pull request you review and merge. About $3 to $6 a month.",
    mandate: "I’ll run one experiment at a time on the site and draft each change as a pull request. You merge it. I never do." },
  { id: "content_scout", name: "Kit", role: "Content Scout", icon: "clapperboard", built: false, phase: 4, tier: "Report", trigger: "Trigger set when built",
    job: "Social content research, weekly ideas, creator briefs.",
    mandate: "I’ll research social content and bring you weekly ideas and creator briefs." },
];
