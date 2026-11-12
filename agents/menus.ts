// Every agent that has a menu, by its id in the `agents` table. An agent without one runs
// on the values in its own code, as before, and loads no setup.
import type { AgentMenu } from "@/core/setup";
import { MENU as chiefOfStaff } from "./chief-of-staff/menu";

export const MENUS: Record<string, AgentMenu> = {
  chief_of_staff: chiefOfStaff,
};
