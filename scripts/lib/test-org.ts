// The business the checks run as. Work with no business named is refused (core/tenancy.ts, card 135),
// so a check that runs work wraps it in withOrg(TEST_ORG, ...). Not a real org.
export const TEST_ORG = "0e1a7c4e-00aa-4000-8000-0000000000aa";
