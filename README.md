# Enns Entomology Museum — Collaboration Network

A lightweight system for collecting the museum's research associates, visitors,
students, and collaborators, and plotting them on a network map — with a human
review step and no database to maintain.

People fill in a form on a Netlify-hosted page. As they type, their institution
and city autocomplete against real map data, so each entry arrives with
**coordinates already attached**. A small serverless function turns each
submission into a GitHub **issue**. When a museum admin adds the `approved`
label, a GitHub Action writes the entry into `data/associates.json`, which feeds
the map.

## How the loop works

```
Visitor fills the form            (index.html, hosted on Netlify)
        │  institution + city autocomplete → coordinates captured in-page
        │  submits by fetch (no redirect, no GitHub account needed)
        ▼
Netlify serverless function       (netlify/functions/submit.js)
        │  creates an issue via the GitHub API, using a private token
        │  the issue body carries a machine-readable JSON block
        ▼
GitHub issue  ── labelled "associate-submission"
        │  a museum admin reviews it and adds the "approved" label
        ▼
GitHub Action                     (.github/workflows/add-associate.yml)
        │  keeps the form's coordinates; geocodes only if they're missing
        │  appends the finished record and closes the issue
        ▼
data/associates.json              ← the map reads this file
```

The GitHub token lives **only** in Netlify's environment variables. It never
appears in this repository, in the form, or in the browser.

## Where coordinates come from

The map needs a point for every person. Coordinates are resolved in this order:

1. **Institution** — if the submitter picks their institution from the
   autocomplete dropdown, those coordinates are used (`coordSource: institution`).
   Institution points are preferred because they're the most meaningful for a
   collaboration map.
2. **City** — if no institution was picked but a city was, the city's
   coordinates are used (`coordSource: city`).
3. **Geocoded on approval** — if the submitter typed everything by hand without
   picking a suggestion, the Action geocodes `City, Country` when you approve
   (`coordSource: geocoded`).

People with **no institution** simply type `Private` (or *Independent*, *None*,
etc.) in the Affiliation field. That skips the institution lookup, and their
point comes from the City field instead.

## Files

| Path | What it does |
| --- | --- |
| `index.html` | The public form, with institution/city autocomplete. Deployed to Netlify. |
| `netlify/functions/submit.js` | Serverless function; opens a GitHub issue, carrying the form's coordinates. |
| `.github/workflows/add-associate.yml` | On the `approved` label: preserves or geocodes coordinates, appends to the data file. |
| `.github/ISSUE_TEMPLATE/associate.yml` | Optional manual fallback for creating a submission directly on GitHub. |
| `data/associates.json` | The growing dataset the map consumes. |

## Data format

Each approved submission becomes one record:

```json
{
  "firstName": "Maria",
  "lastName": "Rossi",
  "affiliation": "University of Padua",
  "department": "",
  "pi": "",
  "role": "Collaborator",
  "city": "Padua",
  "country": "Italy",
  "showOnMap": true,
  "lat": 45.4064,
  "lng": 11.8768,
  "coordSource": "institution",
  "issue": 12,
  "addedAt": "2026-09-18T14:30:00Z"
}
```

`coordSource` is one of `institution`, `city`, `geocoded`, or `none` (the last
means the place couldn't be resolved and needs a manual coordinate).

## Day-to-day use

1. Someone submits the form; a new issue appears under **Issues**, labelled
   `associate-submission`. Its body shows the details and a **Coordinates** line.
2. Review it. To publish, add the **`approved`** label.
3. The Action runs, `data/associates.json` gains the record, and the issue
   closes automatically.
4. If `coordSource` is `none` (nothing resolved), fix the city spelling and
   re-add the label, or set `lat`/`lng` by hand in the data file.

## Feeding the map

On the museum's site, read `data/associates.json`, filter `showOnMap === true`
for the public map, and draw a line from the museum (Columbia, MO ≈ 38.95,
−92.33) to each `[lat, lng]`. Colour or cluster markers by `role` to show the
mentoring / collaboration structure.

## Privacy

The form collects nothing private (no email, no personal contact details),
because submissions are stored as records in this repository. Someone with no
affiliation can enter `Private` rather than name an institution. If private
contact information is ever needed, gather it through a separate, private
channel — not through this pipeline.

## Maintenance

The only recurring upkeep is the GitHub access token the form uses to create
issues. It's a fine-grained personal access token stored **only** in Netlify's
environment variables as `GH_ISSUE_TOKEN`. If it was created with an expiry
(e.g. one year), it must be renewed on that date or the form will start failing
at submit. GitHub emails the account owner before a token expires, so keep that
address current. To renew: generate a new fine-grained token (scope: this repo
only, **Issues: Read and write**), then update the `GH_ISSUE_TOKEN` value in
Netlify → Site configuration → Environment variables, and redeploy. Nothing in
the repo, the function, or the form changes. Full steps are in
[`SETUP-GUIDE.md`](./SETUP-GUIDE.md#maintenance--renewing-the-access-token).

## Setup

To build this loop from scratch — or to hand it to someone else — see
[`SETUP-GUIDE.md`](./SETUP-GUIDE.md).
