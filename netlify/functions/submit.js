exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  let data;
  try { data = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ ok:false, error:"Invalid data" }) }; }

  // Honeypot
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

  const resp = await fetch("https://api.github.com/repos/DavideDalPos/museum-network/issues", {
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
