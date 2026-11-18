// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The cloud edition's slots (docs/extensions.md). Built in only when OPERATOR_EDITION=cloud.
// Billing (card 128 slice 3) fills planBlock, SettingsCards and SignupPage; for now they match the
// open edition, so a cloud build behaves the same.
import type { Extensions } from "@/core/extension-types";

const cloud: Extensions = {
  edition: "cloud",
  planBlock: async () => null,
  SettingsCards: null,
  SignupPage: null,
};

export default cloud;
