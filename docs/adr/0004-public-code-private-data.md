# Public code, private data behind Cloudflare Access

The app is reached from a phone with no home server, and must cost nothing. Code lives in a **public** repo, both because Transitous asks for open-source projects (ADR-0002) and because GitHub Pages from a private repo is paid. The site is hosted on **Cloudflare Pages** behind **Cloudflare Access** (free one-time email login), and personal data (the home Origin, Curated Parking Candidates and their notes) lives only in a small Cloudflare key-value store behind that login, never in the repo. Being public is not a mistake to "fix" by making the repo private.

## Consequences

- Cloudflare Zero Trust asks for payment details even on its Free plan. This is an accepted exception to ADR-0002's "no payment method wherever possible"; the Free plan is not charged.

## Considered Options

- **GitHub Pages, public repo, data in browser storage only**: free, but the site is open to anyone with the link and data doesn't sync across devices.
- **GitHub Pages from a private repo**: needs a paid plan, and the site itself would still be public.
- **Netlify / Vercel free tiers**: password protection is paid.
