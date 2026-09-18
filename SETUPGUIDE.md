# Guide: A form → Netlify → GitHub issue → map loop

This guide walks through building the whole pipeline from an empty repository.
It's written to be reusable — swap the field names and it works for any
"collect submissions, review them, put approved ones on a map" project.

**The idea:** a static form posts to a Netlify serverless function; the function
opens a GitHub issue using a private token; a reviewer approves the issue with a
label; a GitHub Action converts approved issues into a JSON data file. No
database, no server to run, and one review gate you control. The form also
attaches map coordinates as the person types, so most entries need no geocoding
at all.

---

## Two different GitHub tokens (don't confuse them)

- **A fine-grained Personal Access Token (PAT)** — used *only* by the Netlify
  function to create issues. It lives in Netlify's environment variables.
- **The built-in `GITHUB_TOKEN`** — provided automatically to GitHub Actions.
  The Action uses it to commit the data file and close issues. You never create
  or copy this one.

> **Security rule:** a token is a password. Never paste it into a chat, a
> commit, the form, or a file in the repo. The only place your PAT goes is the
> Netlify environment-variables screen. If a token is ever exposed, revoke it
> immediately and generate a new one.

---

## Step 1 — Create the repository

Create a new **public** repository on GitHub (public is what lets the issue and
data files be read openly; the form deliberately collects nothing private).
Add a README so it isn't empty.

## Step 2 — Add the data file

Create `data/associates.json` containing an empty array:

```json
[]
```

This is what the map reads, and what the Action appends to.

## Step 3 — Create the labels

In the repo: **Issues → Labels → New label**. Create two:

- `associate-submission` — applied automatically to every new submission.
- `approved` — you add this by hand to publish an entry. **This is the review
  gate.** Nothing reaches the data file until you apply it.

## Step 4 — Create the PAT (for the Netlify function)

GitHub → your avatar → **Settings → Developer settings → Personal access tokens
→ Fine-grained tokens → Generate new token**.

- **Resource owner:** your account.
- **Repository access:** *Only select repositories* → your repo.
- **Permissions → Repository permissions → Issues: Read and write.** (That's the
  only permission needed.)
- **Expiration:** your call. A shorter expiry is safer but must be renewed (see
  [Maintenance](#maintenance--renewing-the-access-token)); because this token can
  only create issues in one repo, a longer expiry is a reasonable trade-off.
- Generate, and **copy the token once** — GitHub shows it a single time.

## Step 5 — Deploy the form to Netlify and store the token

1. At **app.netlify.com**, log in with GitHub. **Add new site → Import an
   existing project → Deploy with GitHub**, and pick your repo.
2. Leave the **build command** empty and **publish directory** empty (or `.`) —
   it's a static file.
3. After the first deploy, go to **Site configuration → Environment variables →
   Add a variable**. Key: `GH_ISSUE_TOKEN`. Value: paste the PAT. Save.

The token now lives only on Netlify's servers, where the function can read it.

## Step 6 — Add the serverless function

Create `netlify/functions/submit.js`. It validates the submission, drops obvious
bots (honeypot), reads the coordinates the form captured, and opens a GitHub
issue whose body carries a machine-readable JSON block for the Action to read.
**Replace the `repos/OWNER/REPO` path** with your own.

```js
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  let data;
  try { data = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ ok:false, error:"Invalid data" }) }; }

  // Honeypot — bots fill this hidden field; humans never see it.
  if (data.company) return { statusCode: 200, body: JSON.stringify({ ok:true }) };

  const required = ["first_name","last_name","affiliation","role","city","country","show_on_map"];
  for (const f of required) {
    if (!data[f] || !String(data[f]).trim())
      return { statusCode: 400, body: JSON.stringify({ ok:false, error:`Missing field: ${f}` }) };
  }

  const token = process.env.GH_ISSUE_TOKEN;
  if (!token) return { statusCode: 500, body: JSON.stringify({ ok:false, error:"Server not configured" }) };

  // Coordinates chosen by the form (institution first, then city). May be absent.
  const lat = parseFloat(data.lat);
  const lng = parseFloat(data.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  const record = {
    firstName: data.first_name.trim(),
    lastName: data.last_name.trim(),
    affiliation: data.affiliation.trim(),
    department: (data.department || "").trim(),
    pi: (data.pi || "").trim(),
    role: data.role.trim(),
    city: data.city.trim(),
    country: data.country.trim(),
    showOnMap: /^Yes/i.test(data.show_on_map),
    lat: hasCoords ? lat : null,
    lng: hasCoords ? lng : null,
    coordSource: hasCoords ? (data.coord_source || "form") : "none"
  };

  const body = [
    `**Name:** ${record.firstName} ${record.lastName}`,
    `**Affiliation:** ${record.affiliation}`,
    record.department ? `**Department:** ${record.department}` : null,
    record.pi ? `**PI / supervisor:** ${record.pi}` : null,
    `**Relationship:** ${record.role}`,
    `**Location:** ${record.city}, ${record.country}`,
    hasCoords ? `**Coordinates:** ${lat}, ${lng} (from ${record.coordSource})`
              : `**Coordinates:** not provided — will be geocoded on approval`,
    `**Show on public map:** ${record.showOnMap ? "Yes" : "No"}`,
    ``,
    `<!-- machine-readable; do not edit -->`,
    "```json",
    JSON.stringify(record, null, 2),
    "```"
  ].filter(Boolean).join("\n");

  const resp = await fetch("https://api.github.com/repos/OWNER/REPO/issues", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "museum-network-form"
    },
    body: JSON.stringify({
      title: `Associate: ${record.firstName} ${record.lastName}`,
      body,
      labels: ["associate-submission"]
    })
  });

  if (!resp.ok) return { statusCode: 502, body: JSON.stringify({ ok:false, error:`GitHub error ${resp.status}` }) };
  const issue = await resp.json();
  return { statusCode: 200, headers: { "Content-Type":"application/json" }, body: JSON.stringify({ ok:true, issue: issue.number }) };
};
```

## Step 7 — The form, with autocomplete

The full styled page is `index.html`. The parts that matter for this loop are
below. Two fields (institution and city) autocomplete against
[Nominatim](https://nominatim.openstreetmap.org) — free, no API key — and stash
the chosen coordinates in hidden fields. On submit, the form sends **institution
coordinates if present, else city coordinates, else none**, and posts to the
function with `fetch` (no redirect).

Key markup — each autocompleting field pairs a text input with a list and two
hidden coordinate inputs:

```html
<!-- honeypot, hidden with CSS -->
<input name="company" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" />

<label>Affiliation / institution — no institution? just type "Private"</label>
<input id="affiliation" name="affiliation" required autocomplete="off" />
<ul class="ac-list" id="affiliation-list"></ul>
<input type="hidden" name="inst_lat" id="inst_lat" />
<input type="hidden" name="inst_lng" id="inst_lng" />

<input id="city" name="city" required autocomplete="off" />
<ul class="ac-list" id="city-list"></ul>
<input type="hidden" name="city_lat" id="city_lat" />
<input type="hidden" name="city_lng" id="city_lng" />

<input id="country" name="country" required autocomplete="off" />
```

Key script — a reusable autocomplete, plus the submit handler that sets the
coordinate priority:

```js
const skipWords = ["private","independent","none","n/a","na","unaffiliated"];

function setupAutocomplete({ inputId, listId, latId, lngId, allowSkip, onPick }) {
  const input = document.getElementById(inputId);
  const list  = document.getElementById(listId);
  const latEl = document.getElementById(latId);
  const lngEl = document.getElementById(lngId);
  let timer, last = "";
  const clearCoords = () => { latEl.value = ""; lngEl.value = ""; };

  input.addEventListener("input", () => {
    clearCoords();                                   // typing invalidates a pick
    const q = input.value.trim();
    clearTimeout(timer);
    if (allowSkip && skipWords.includes(q.toLowerCase())) { list.innerHTML = ""; return; }
    if (q.length < 3) { list.innerHTML = ""; return; }
    timer = setTimeout(() => search(q), 500);        // debounce for usage limits
  });

  async function search(q) {
    if (q === last) return; last = q;
    const url = "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({ q, format: "json", limit: "5", addressdetails: "1" });
    try { render(await (await fetch(url)).json()); } catch { list.innerHTML = ""; }
  }

  function render(results) {
    list.innerHTML = "";
    (results || []).forEach(r => {
      const li = document.createElement("li");
      li.textContent = r.display_name;
      li.addEventListener("mousedown", (e) => {      // mousedown beats blur
        e.preventDefault();
        latEl.value = r.lat; lngEl.value = r.lon;
        list.innerHTML = "";
        if (onPick) onPick(r);
      });
      list.appendChild(li);
    });
  }
  input.addEventListener("blur", () => setTimeout(() => { list.innerHTML = ""; }, 150));
}

const cityInput = document.getElementById("city");
const countryInput = document.getElementById("country");

setupAutocomplete({ inputId:"affiliation", listId:"affiliation-list",
  latId:"inst_lat", lngId:"inst_lng", allowSkip:true,
  onPick: r => { const a = r.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.county;
    if (city && !cityInput.value) cityInput.value = city;
    if (a.country && !countryInput.value) countryInput.value = a.country; } });

setupAutocomplete({ inputId:"city", listId:"city-list",
  latId:"city_lat", lngId:"city_lng", allowSkip:false,
  onPick: r => { const a = r.address || {}; if (a.country) countryInput.value = a.country; } });

document.getElementById("associate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  data.lat = data.inst_lat || data.city_lat || "";                        // institution first
  data.lng = data.inst_lng || data.city_lng || "";
  data.coord_source = data.inst_lat ? "institution" : (data.city_lat ? "city" : "none");

  const resp = await fetch("/.netlify/functions/submit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const result = await resp.json();
  // ...show a thank-you on success, an error message otherwise...
});
```

The form field `name`s must match the `required` list in the function. Someone
with no institution types `Private`, which the `skipWords` list keeps from
firing a pointless lookup; their point then comes from the City field.

## Step 8 — The Action that publishes approved submissions

Create `.github/workflows/add-associate.yml`. It fires when the `approved` label
is added, reads the JSON block from the issue, **keeps the coordinates the form
supplied**, and only geocodes `City, Country` as a fallback when they're missing.
**Put a real contact email in the Nominatim User-Agent** — their usage policy
requires one.

```yaml
name: Add approved associate to the network
on:
  issues:
    types: [labeled]

permissions:
  contents: write
  issues: write

jobs:
  add-associate:
    if: github.event.label.name == 'approved'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Read record, geocode if needed, append
        env:
          ISSUE_BODY: ${{ github.event.issue.body }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
        run: |
          python3 - <<'PY'
          import os, json, re, urllib.parse, urllib.request
          from datetime import datetime, timezone

          body = os.environ["ISSUE_BODY"]
          m = re.search(r"```json\s*(\{.*?\})\s*```", body, re.S)
          if not m:
              raise SystemExit("No JSON block found in issue body")
          rec = json.loads(m.group(1))

          # Keep the form's coordinates; geocode only when they're missing.
          if rec.get("lat") is None or rec.get("lng") is None:
              q = f"{rec['city']}, {rec['country']}"
              url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
                  {"format": "json", "limit": 1, "q": q})
              req = urllib.request.Request(url, headers={
                  "User-Agent": "enns-museum-network/1.0 (YOUR-EMAIL@example.com)"})
              try:
                  geo = json.load(urllib.request.urlopen(req, timeout=20))
                  if geo:
                      rec["lat"] = float(geo[0]["lat"]); rec["lng"] = float(geo[0]["lon"])
                      rec["coordSource"] = "geocoded"
                  else:
                      rec["lat"] = rec["lng"] = None; rec["coordSource"] = "none"
              except Exception:
                  rec["lat"] = rec["lng"] = None; rec["coordSource"] = "none"

          rec["issue"] = int(os.environ["ISSUE_NUMBER"])
          rec["addedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

          path = "data/associates.json"
          try:
              with open(path) as fh: arr = json.load(fh)
          except FileNotFoundError:
              arr = []
          arr.append(rec)
          os.makedirs("data", exist_ok=True)
          with open(path, "w") as fh: json.dump(arr, fh, indent=2, ensure_ascii=False)
          print("Added:", json.dumps(rec, ensure_ascii=False))
          PY

      - name: Commit the new record
        run: |
          git config user.name  "museum-network-bot"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/associates.json
          git commit -m "Add associate from issue #${{ github.event.issue.number }}" || echo "No changes"
          git push

      - name: Close the issue
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh issue close ${{ github.event.issue.number }} --comment "Added to the map — thank you!"
```

**One repo setting the Action needs:** Settings → Actions → General → Workflow
permissions → **Read and write permissions** → Save. Without this the Action
can't commit the data file.

## Step 9 — Test the whole loop

1. Open your Netlify form. Type an institution and **pick a suggestion** (you'll
   see the location attach); do the same for city if you like. Submit.
2. A new issue appears under **Issues**, with a **Coordinates** line and a JSON
   block containing `lat`, `lng`, and `coordSource`.
3. Add the **`approved`** label. Watch the **Actions** tab: the workflow runs,
   commits to `data/associates.json`, and closes the issue.
4. Open `data/associates.json` — your record is there, coordinates and all.

Failure cues: no JSON block means the issue wasn't made by the function (someone
opened a plain issue); `coordSource: none` means nothing resolved — fix the city
and re-apply the label, or set the coordinates by hand.

## Maintenance — renewing the access token

The one recurring task is the PAT the Netlify function uses. If you gave it an
expiry, it stops working on that date and the form fails at submit with a `401`
from GitHub — not silently, so you'll notice. GitHub also emails the account
owner a few days before expiry, so keep that address current.

To renew (about two minutes):

1. GitHub → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**. Same scope as before: **this repo
   only, Issues: Read and write.** Copy it once.
2. Netlify → your site → **Site configuration → Environment variables →
   `GH_ISSUE_TOKEN` → edit → paste the new value → Save.**
3. Trigger a redeploy (Netlify → **Deploys → Trigger deploy**) so the function
   picks up the new value.

Nothing in the repo, the function code, or the form changes — only the env-var
value. Because this token can do only one thing (create issues in this one repo),
a longer or non-expiring token is a reasonable convenience-vs-risk trade if you'd
rather not rotate on a schedule; the worst case if it leaked is issue spam in
this repo, fixed by revoking. If you want zero rotation, a GitHub App uses
auto-refreshing short-lived tokens instead, at the cost of more setup.

## Optional: manual fallback via a GitHub issue form

If you also want people *with* GitHub accounts to submit directly on GitHub, add
a YAML issue form at `.github/ISSUE_TEMPLATE/associate.yml` with the same fields
(give each an `id`; ids can be pre-filled from a URL like
`.../issues/new?template=associate.yml&city=Padua`). Issues created this way have
no JSON block and no coordinates, so the Action's geocoding fallback handles them.

---

## Recap of what lives where

| Thing | Location |
| --- | --- |
| Form page (with autocomplete) | `index.html`, served by Netlify |
| Serverless function | `netlify/functions/submit.js` |
| PAT (Issues: read/write) | Netlify env var `GH_ISSUE_TOKEN` — nowhere else |
| Review gate | the `approved` label |
| Publishing automation | `.github/workflows/add-associate.yml` |
| Data for the map | `data/associates.json` |
