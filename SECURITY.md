# Security

OPERATOR holds businesses' sign-ins and can propose payments and emails, so security reports get
priority.

## Reporting a vulnerability

Report privately through GitHub's "Report a vulnerability" (Security tab), or email
earlybiirrd@gmail.com. Please don't open a public issue. Include what you found, how to reproduce it and
what it could lead to. We reply within 3 working days and keep you posted until it's fixed.

## In scope

Anything that would let an agent, a web page, an inbound email or another org:

- send, pay, post or write outside the approval gateway (`core/gateway`), or past a cap;
- read or change another org's rows (`core/tenancy.ts`, row-level security);
- read a token or key from the vault (`core/vault.ts`), a log, a trace or an error;
- choose a recipient, URL, product or category from untrusted text;
- call an MCP tool its profile doesn't name.

## Supported versions

The latest release and `main` get fixes.
