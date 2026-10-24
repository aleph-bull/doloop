# Schools

Verify a school email from **Social → School** or the profile editor. A code is sent to
the address, and the school appears on the profile only after confirmation. The existing
15-minute expiry, five guesses, resend limits and one-address-per-account rule remain.
Login email and Google/Outlook accounts stay separate.

## Directory and marks

`packages/core/data/schools/` contains a pinned snapshot of [Hipo's university directory](https://github.com/Hipo/university-domains-list),
with over 10,000 university and college records: names, domains and countries. `source.json`
records the commit/date, and `LICENSE.txt` preserves the MIT license. No email is sent to
Hipo and no external lookup runs during verification. Existing Ontario IDs and reviewed
student domains take precedence. Matching respects subdomains and domain boundaries;
ambiguous shared domains are rejected. An arbitrary `.edu` suffix is insufficient.

Refresh explicitly with `node scripts/update-school-directory.mjs`, then review the diff
and preserve existing IDs before release. This is a university/college list, not a full
K–12 or accreditation registry. A code confirms access to the email address, not enrollment
or a role. Unlisted schools need a reviewed directory addition. The registry initializes
lazily and stays out of unrelated pages and the browser extension.

The directory does not include crests. Initial official marks are stored without alteration
in `apps/portal/public/schools/`; other schools use a fallback icon:

| File           | Original asset                                                                                 | Reference                                                               |
| -------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `toronto.png`  | `https://trademarks.utoronto.ca/wp-content/uploads/cropped-U-of-T-favicon-reverse-180x180.png` | [U of T branding](https://trademarks.utoronto.ca/branding-information/) |
| `mcmaster.gif` | `https://www.mcmaster.ca/coat/weecrest.gif`                                                    | [McMaster insignia](https://www.mcmaster.ca/coat/)                      |

Institutional marks remain their owners' marks and are not covered by the directory's
MIT license. Registry entries retain their source and credit. Add further marks with
their provenance; an image that cannot load falls back to the school icon.

## Sharing and rankings

- **School** shows current sessions and public posts from verified schoolmates who
  enabled **Share study activity with my school**. This setting defaults off. It resets
  off when a school is verified or removed. Friends-only posts stay hidden. Email addresses
  never appear in community or ranking responses.
- **Leaderboard → My school** ranks verified classmates by all-time completed focus time.
- **Leaderboard → Schools** totals completed focus time by school for this week (Monday
  in the viewer's timezone) or all time. Contributor counts make group size visible.
  Equal totals share a rank. Ongoing sessions and breaks add nothing.
- Existing **All boards / Friends only / Off** controls apply. Friends-only and opted-out
  accounts do not enter school rankings. Suspended users and test accounts are excluded.
  Admins follow the current global board's rules. Every query keeps dev worlds separate.

Membership comes from `university_verifications.verified_at`, not a display label.
Removing proof revokes access immediately. The new preference uses existing settings JSON;
no schema migration is needed.

## Testing

Run an isolated local mail sandbox as described in [SETUP.md](SETUP.md). After Send code,
**Local test email** displays the code without sending real mail. Hosted delivery uses the
existing Resend domain/key setup. Tests cover legacy IDs, international domains, spoofed
suffixes, code confirmation, privacy controls, rank periods, removals and dev isolation.
