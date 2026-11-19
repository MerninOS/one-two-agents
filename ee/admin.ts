// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The admin business (card 135): the one business whose owners make sign-up codes. Which business it
// is, is one setting in the deployment, OPERATOR_ADMIN_ORG_ID (an org id, not a secret). Unset or not
// an id: nobody makes codes and sign-up is closed. No business is the admin by being first.
import "server-only";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The admin business's id, or null when sign-up is closed on this deployment. */
export function adminOrgId(): string | null {
  const v = process.env.OPERATOR_ADMIN_ORG_ID?.trim().toLowerCase() ?? "";
  return UUID.test(v) ? v : null;
}

export const SIGNUP_CLOSED = "Sign-up is closed on this deployment for now.";
