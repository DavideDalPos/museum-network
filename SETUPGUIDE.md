# Guide: A form → Netlify → GitHub issue → map loop

This guide walks through building the whole pipeline from an empty repository.
It's written to be reusable — swap the field names and it works for any
"collect submissions, review them, put approved ones on a map" project.

**The idea:** a static form posts to a Netlify serverless function; the function
opens a GitHub issue using a private token; a reviewer approves the issue with a
label; a GitHub Action converts approved issues into a JSON data file. No
database, no server to run, and one review gate you control.

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

This is what the map will read, and what the Action appends to.

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
bots (honeypot), and opens a GitHub issue whose body carries a machine-readable
JSON block that the Action will read later. **Replace the `repos/OWNER/REPO`
path** with your own.

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

  const record = {
    firstName: data.first_name.trim(),
    lastName: data.last_name.trim(),
    affiliation: data.affiliation.trim(),
    department: (data.department || "").trim(),
    pi: (data.pi || "").trim(),
    role: data.role.trim(),
    city: data.city.trim(),
    country: data.country.trim(),
    showOnMap: /^Yes/i.test(data.show_on_map)
  };

  const body = [
    `**Name:** ${record.firstName} ${record.lastName}`,
    `**Affiliation:** ${record.affiliation}`,
    record.department ? `**Department:** ${record.department}` : null,
    record.pi ? `**PI / supervisor:** ${record.pi}` : null,
    `**Relationship:** ${record.role}`,
    `**Location:** ${record.city}, ${record.country}`,
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

## Step 7 — The form posts to the function

The form (`index.html`) submits with `fetch` to `/.netlify/functions/submit`
and shows a thank-you in place — no redirect, no GitHub account. The essential
part is the script; style it however you like.

```html
<form id="f">
  <!-- honeypot: keep it visually hidden with CSS -->
  <input name="company" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" />
  <input name="first_name" required /> <input name="last_name" required />
  <input name="affiliation" required />
  <input name="department" /> <input name="pi" />
  <select name="role" required>…</select>
  <input name="city" required /> <input name="country" required />
  <select name="show_on_map" required>…</select>
  <button type="submit">Submit</button>
</form>
<div id="status" aria-live="polite"></div>

<script>
  const form = document.getElementById("f");
  const statusEl = document.getElementById("status");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const resp = await fetch("/.netlify/functions/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      const result = await resp.json();
      if (resp.ok && result.ok) {
        form.style.display = "none";
        statusEl.textContent = "Thank you! You'll appear on the map after review.";
      } else { throw new Error(result.error || "Submission failed"); }
    } catch (err) {
      statusEl.textContent = "Something went wrong: " + err.message;
    }
  });
</script>
```

The form field `name`s must match the `required` list in the function.

## Step 8 — The Action that publishes approved submissions

Create `.github/workflows/add-associate.yml`. It fires when the `approved` label
is added, extracts the JSON block from the issue, geocodes `City, Country`, and
appends the record. **Put a real contact email in the Nominatim User-Agent** —
their usage policy requires one.

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

      - name: Extract, geocode, and append
        env:
          ISSUE_BODY: ${{ github.event.issue.body }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
        run: |
          python3 - <<'PY'
          import os, json, re, urllib.parse, urllib.request

          body = os.environ["ISSUE_BODY"]
          m = re.search(r"```json\s*(\{.*?\})\s*```", body, re.S)
          if not m:
              raise SystemExit("No JSON block found in issue body")
          rec = json.loads(m.group(1))

          q = f"{rec['city']}, {rec['country']}"
          url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
              {"format": "json", "limit": 1, "q": q})
          req = urllib.request.Request(url, headers={
              "User-Agent": "enns-museum-network/1.0 (YOUR-EMAIL@example.com)"})
          try:
              geo = json.load(urllib.request.urlopen(req, timeout=20))
              rec["lat"] = float(geo[0]["lat"]) if geo else None
              rec["lng"] = float(geo[0]["lon"]) if geo else None
          except Exception:
              rec["lat"] = rec["lng"] = None

          rec["issue"] = int(os.environ["ISSUE_NUMBER"])
          from datetime import datetime, timezone
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

1. Open your Netlify form, fill it in, and submit. You should get the thank-you
   message, and a new issue should appear under **Issues**.
2. Add the **`approved`** label to that issue.
3. Watch the **Actions** tab: the workflow runs, commits to
   `data/associates.json`, and closes the issue.
4. Open `data/associates.json` — your record is there, with `lat`/`lng` filled.

If the Action can't find a JSON block, the submission didn't come through the
function (someone opened a plain issue). If `lat`/`lng` are `null`, the place
name didn't geocode — correct it and re-apply the label.

## Optional: manual fallback via a GitHub issue form

If you also want people *with* GitHub accounts to be able to submit directly on
GitHub, add a YAML issue form at `.github/ISSUE_TEMPLATE/associate.yml` with the
same fields. Give each field an `id`; those ids can even be pre-filled from a URL
(`.../issues/new?template=associate.yml&city=Padua`). Note that issues created
this way won't contain the JSON block, so either keep the function as the primary
path or extend the Action to parse issue-form fields as well.

---

## Recap of what lives where

| Thing | Location |
| --- | --- |
| Form page | `index.html`, served by Netlify |
| Serverless function | `netlify/functions/submit.js` |
| PAT (Issues: read/write) | Netlify env var `GH_ISSUE_TOKEN` — nowhere else |
| Review gate | the `approved` label |
| Publishing automation | `.github/workflows/add-associate.yml` |
| Data for the map | `data/associates.json` |
