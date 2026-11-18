// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The cloud edition's slots (docs/extensions.md). Built in only when OPERATOR_EDITION=cloud.
import type { Extensions } from "@/core/extension-types";
import { planBlock } from "./plan";
import { BillingCard } from "./billing-card";

const cloud: Extensions = {
  edition: "cloud",
  planBlock,
  SettingsCards: BillingCard,
  SignupPage: null,
};

export default cloud;
