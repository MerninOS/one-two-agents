// The open edition's slots: nothing is blocked, no extra Settings cards, no sign-up page.
// tsconfig points "operator-extensions" here; next.config.ts points it at ee/index.ts only when
// OPERATOR_EDITION=cloud (docs/extensions.md).
import type { Extensions } from "@/core/extension-types";

const none: Extensions = {
  edition: "open",
  planBlock: async () => null,
  SettingsCards: null,
  SignupPage: null,
};

export default none;
