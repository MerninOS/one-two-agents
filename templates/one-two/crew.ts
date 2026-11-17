// One Two's starting crew (docs/templates.md): its departments, org chart, agents with their specs
// and playbooks, chains and goals, as data a new org can install (core/install.ts). A snapshot of
// One Two's org on 2026-11-17, with chains off and goals without due dates.
import type { PackCrew } from "@/templates/types";
import crew from "./crew.json";

export const ONE_TWO_CREW = crew as PackCrew;
