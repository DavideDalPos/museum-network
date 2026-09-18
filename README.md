# Enns Entomology Museum — Collaboration Network

A lightweight system for collecting the museum's research associates, visitors,
students, and collaborators, and plotting them on a network map — with a human
review step and no database to maintain.

People fill in a form on a Netlify-hosted page. A small serverless function
turns each submission into a GitHub **issue**. When a museum admin adds the
`approved` label, a GitHub Action geocodes the entry and appends it to
`data/associates.json`, which feeds the map.

## How the loop works

```
Visitor fills the form            (index.html, hosted on Netlify)
        │  submits in-page (no redirect, no GitHub account needed)
        ▼
Netlify serverless function       (netlify/functions/submit.js)
        │  creates an issue via the GitHub API, using a private token
        ▼
GitHub issue  ── labelled "associate-submission"
        │  a museum admin reviews it and adds the "approved" label
        ▼
GitHub Action                     (.github/workflows/add-associate.yml)
        │  reads the issue, geocodes City + Country, appends the record
        ▼
data/associates.json              ← the map reads this file
```

The GitHub token lives **only** in Netlify's environment variables. It never
appears in this repository, in the form, or in the browser.

## Files

| Path | What it does |
| --- | --- |
| `index.html` | The public submission form. Deployed to Netlify. |
| `netlify/functions/submit.js` | Serverless function; receives the form and opens a GitHub issue. |
| `.github/workflows/add-associate.yml` | On the `approved` label: geocodes and appends to the data file. |
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
  "issue": 12,
  "addedAt": "2026-09-18T14:30:00Z"
}
```

## Day-to-day use

1. Someone submits the form; a new issue appears under **Issues**, labelled
   `associate-submission`.
2. Review it. To publish, add the **`approved`** label.
3. The Action runs, `data/associates.json` gains the record (with coordinates),
   and the issue closes automatically.
4. If a place fails to geocode, `lat`/`lng` come back `null` — fix the city
   spelling in the issue and re-add the label, or set the coordinates by hand.

## Feeding the map

On the museum's site, read `data/associates.json`, filter `showOnMap === true`
for the public map, and draw a line from the museum (Columbia, MO ≈ 38.95,
−92.33) to each `[lat, lng]`. Colour or cluster markers by `role` to show the
mentoring / collaboration structure.

## Privacy

The form collects nothing private (no email, no personal contact details),
because submissions are stored as records in this repository. If private contact
information is ever needed, it should be gathered through a separate, private
channel — not through this pipeline.

## Setup

To build this loop from scratch — or to hand it to someone else — see
[`SETUP-GUIDE.md`](./SETUP-GUIDE.md).
