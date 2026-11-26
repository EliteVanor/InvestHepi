# Security

## Reporting a problem

Please don't open a public issue for a security problem. Use GitHub's private vulnerability reporting instead: the repository's **Security** tab → **Report a vulnerability**. Include what you found, how to reproduce it, and what it affects. You'll get an answer as soon as possible.

Please don't test against the live site with write requests, load, or other people's accounts. Run your own copy (see the README) to reproduce a problem.

## What the app protects

- Each signed-in person's data (interests, holdings, alert settings, Ask AI chats) is kept apart by account. Visitors who aren't signed in can only read.
- Alert emails go only to the signed-in Google account's own address.
- AI spend is capped per person and per network address, and visitor-triggered AI work stops at 70% of a model's free daily allowance.
- The AI never sees money amounts or share counts, only position weights and gain percentages.
- Feed and source links are limited to http(s). The app sends standard security headers (no framing, no MIME sniffing, a strict referrer policy).

Secrets live only in the host's environment variables; none are in this repository.
