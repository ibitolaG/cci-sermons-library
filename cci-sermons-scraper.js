/**
 * CCI Sermons Scraper — Celebration Church International (Apostle Emmanuel Iren)
 * Sources: sermons-api.essantra.joincci.org (full API with descriptions + tags + series)
 *          + Apple Podcasts RSS feed as fallback
 *
 * Usage:
 *   node cci-sermons-scraper.js
 *   node cci-sermons-scraper.js --spotify-id CLIENT_ID --spotify-secret CLIENT_SECRET
 */

const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = __dirname;
const API_BASE   = "https://sermons-api.essantra.joincci.org";
const RSS_URL    = `${API_BASE}/rss.xml`;

// ─── TOPIC GROUPS ────────────────────────────────────────────────────────────
// Each group has a label and keyword lists for title + description matching.
// Keywords are matched case-insensitively against the full description.
// Phrase keywords (multi-word) are tried first, then single words.

const TOPIC_GROUPS = [
  {
    id: "tongues",
    label: "Speaking in Tongues / Prayer Language",
    keywords: [
      "speaking in tongues", "praying in tongues", "pray in tongues",
      "prayer language", "glossolalia", "glosso lalia", "gloss",
      "tongues", "why tongues", "nations and tongues", "nations & tongues",
    ],
  },
  {
    id: "gifts",
    label: "Gifts of the Spirit",
    keywords: [
      "gifts of the spirit", "gift of the spirit", "spiritual gifts",
      "desiring spiritual gifts", "word of knowledge", "word of wisdom",
      "discerning of spirits", "gift of healing", "gift of prophecy",
      "working of miracles", "gifts of healings", "1 corinthians 12",
      "1 cor 12", "charismata",
    ],
  },
  {
    id: "fruit",
    label: "Fruit of the Spirit",
    keywords: [
      "fruit of the spirit", "fruit of the spirit", "fruits of the spirit",
      "galatians 5:22", "galatians 5", "gal 5:22",
      "love, joy, peace", "love joy peace",
      "longsuffering", "gentleness", "meekness", "temperance", "self-control",
    ],
  },
  {
    id: "holy_spirit",
    label: "Holy Spirit — Person & Power",
    keywords: [
      "ministry of the spirit", "person of the holy spirit",
      "baptism of the holy spirit", "baptism in the spirit",
      "filled with the spirit", "infilling of the spirit",
      "holy spirit", "spirit of god", "the anointing",
      "anointing of the spirit", "power of the spirit",
    ],
  },
  {
    id: "prophecy",
    label: "Prophecy & Prophetic Ministry",
    keywords: [
      "prophetic", "prophecy", "gift of prophecy", "prophesying",
      "spirit of prophecy", "hearing from god", "voice of god",
      "word of the lord",
    ],
  },
  {
    id: "prayer",
    label: "Prayer & Intercession",
    keywords: [
      "praying with fire", "prayer and fasting", "intercession",
      "intercessory", "call to prayer", "power of prayer",
      "effectual prayer", "persistent prayer", "how to pray",
    ],
  },
];

// Tags from the API that map to topics (exact or partial match)
const TAG_TOPIC_MAP = {
  "holy spirit":     "holy_spirit",
  "gifts":           "gifts",
  "spiritual gifts": "gifts",
  "tongues":         "tongues",
  "fruit":           "fruit",
  "fruit of spirit": "fruit",
  "prophecy":        "prophecy",
  "prophetic":       "prophecy",
  "prayer":          "prayer",
  "intercession":    "prayer",
};

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/html, */*",
  "Accept-Language": "en-GB,en;q=0.9",
};

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log  = [];

  console.log("=== CCI Sermons Scraper — Celebration Church International ===");
  console.log("    Apostle Emmanuel Iren | sermons.joincci.org\n");

  // 1. Fetch all sermons from the rich API
  console.log("Step 1: Fetching all sermons from CCI API (with full descriptions, tags, series)...");
  let allSermons = await fetchAllFromApi(log);
  console.log(`  API returned ${allSermons.length} sermons.\n`);

  // 2. Enrich with podcast RSS audio links and fill any gaps.
  console.log("Step 2: Fetching podcast RSS for full-sermon audio links...");
  const rssSermons = await fetchRss(log);
  allSermons = mergeByTitle(allSermons, rssSermons);
  console.log(`  After RSS audio merge: ${allSermons.length} total sermons, ${allSermons.filter(s => s.audioUrl).length} with audio.\n`);

  // 3. Optional Spotify
  if (args.spotifyId && args.spotifySecret) {
    console.log("Step 3: Fetching from Spotify...");
    const spotifySermons = await scrapeSpotify(args.spotifyId, args.spotifySecret, log);
    allSermons = mergeByTitle(allSermons, spotifySermons);
    console.log(`  After Spotify merge: ${allSermons.length} total sermons.\n`);
  } else {
    log.push("Spotify: skipped. Pass --spotify-id CLIENT_ID --spotify-secret CLIENT_SECRET to enable.");
    console.log("Step 3: Spotify skipped (pass --spotify-id and --spotify-secret to enable).\n");
  }

  // Sort newest first
  allSermons.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // 4. Assign topics to every sermon
  console.log("Step 4: Classifying all sermons by topic using descriptions, tags, and titles...");
  for (const s of allSermons) {
    s.topics = classifySermon(s);
  }

  // 5. Build grouped view
  const grouped = buildGroups(allSermons);
  const unclassified = allSermons.filter(s => s.topics.length === 0);

  // Summary
  console.log(`\n  Total sermons: ${allSermons.length}`);
  console.log(`  Classified into topic groups:`);
  for (const g of grouped) {
    console.log(`    [${g.label}]: ${g.sermons.length} sermons`);
  }
  console.log(`    [Uncategorised]: ${unclassified.length} sermons`);

  // 6. Save
  const jsonPath    = path.join(OUTPUT_DIR, "cci-sermons-all.json");
  const groupedPath = path.join(OUTPUT_DIR, "cci-sermons-grouped.json");
  const htmlPath    = path.join(OUTPUT_DIR, "index.html");
  const logPath     = path.join(OUTPUT_DIR, "cci-sermons-log.txt");

  fs.writeFileSync(jsonPath,    JSON.stringify(allSermons, null, 2), "utf8");
  fs.writeFileSync(groupedPath, JSON.stringify(grouped,    null, 2), "utf8");
  fs.writeFileSync(htmlPath,    buildHtml(allSermons, grouped),       "utf8");
  fs.writeFileSync(logPath,     log.join("\n") + "\n",                "utf8");

  console.log(`\nSaved:`);
  console.log(`  ${jsonPath}       — all ${allSermons.length} sermons`);
  console.log(`  ${groupedPath}    — grouped by topic`);
  console.log(`  ${htmlPath}       — searchable HTML viewer`);
  console.log(`  ${logPath}`);

  // Print classified sermons
  for (const g of grouped) {
    console.log(`\n━━━ ${g.label.toUpperCase()} (${g.sermons.length}) ━━━`);
    for (const s of g.sermons) {
      const topicLabels = (s.topics || []).join(", ");
      console.log(`  • ${s.title}${s.date ? " (" + s.date + ")" : ""}`);
      if (s.series) console.log(`    Series : ${s.series}`);
      if (topicLabels) console.log(`    Matched: ${topicLabels}`);
      if (s.audioUrl)  console.log(`    Audio  : ${s.audioUrl}`);
      if (s.youtubeUrl) console.log(`    Video  : ${s.youtubeUrl}`);
    }
  }
}

// ─── API FETCHER ─────────────────────────────────────────────────────────────

async function fetchAllFromApi(log) {
  const sermons = [];

  // Try different page size params the API might accept
  const pageSizeParams = ["limit", "perPage", "per_page", "pageSize"];
  let workingParam = "limit";
  let perPage = 100;

  // Probe the API to find total and working pagination
  let probe;
  for (const param of pageSizeParams) {
    try {
      probe = await fetchJson(`${API_BASE}/sermons?${param}=100&page=1`);
      const count = probe?.data?.count || probe?.data?.perPage || 0;
      if (count > 0 || probe?.data?.data?.length > 0) {
        workingParam = param;
        perPage = probe?.data?.perPage || probe?.data?.count || 100;
        break;
      }
    } catch { /* try next */ }
  }

  if (!probe) {
    log.push("CCI API: Could not probe API, falling back to RSS");
    return [];
  }

  const total  = probe?.data?.total || 477;
  perPage = Math.min(probe?.data?.perPage || 20, 100);
  const pages  = Math.ceil(total / perPage);

  log.push(`CCI API: total=${total}, perPage=${perPage}, pages=${pages}, param=${workingParam}`);
  console.log(`  API: ${total} total sermons across ${pages} pages (${perPage}/page)`);

  for (let page = 1; page <= pages; page++) {
    try {
      const url  = `${API_BASE}/sermons?${workingParam}=${perPage}&page=${page}`;
      const data = await fetchJson(url);
      const items = data?.data?.data || data?.data || data?.results || data?.sermons || [];

      if (!Array.isArray(items) || items.length === 0) {
        log.push(`CCI API: page ${page} returned no items`);
        break;
      }

      for (const item of items) {
        sermons.push(normalizeApiItem(item));
      }

      process.stdout.write(`\r  Fetched page ${page}/${pages} (${sermons.length} sermons)...`);
    } catch (err) {
      log.push(`CCI API: page ${page} failed — ${err.message}`);
    }
  }

  process.stdout.write("\n");
  log.push(`CCI API: fetched ${sermons.length} sermons total`);
  return sermons;
}

function normalizeApiItem(item) {
  const audioInfo = item.audio_info || item.audioInfo || {};
  const audioUrl  = audioInfo.url || audioInfo.stream_url || audioInfo.streamUrl
    || item.audio_url || item.audioUrl || "";

  const thumbnailRaw = item.thumbnail || item.thumbnailUrl || item.artwork || "";
  const thumbnail = thumbnailRaw.startsWith("http") ? thumbnailRaw
    : thumbnailRaw ? `https://s3.eu-north-1.amazonaws.com/cci-axios-web-cms-assets/${thumbnailRaw}` : "";

  const theme = item.theme || item.series_info || {};
  const seriesName = theme.title || theme.name || item.series || item.seriesTitle || "";

  const tags = Array.isArray(item.tags) ? item.tags.map(t =>
    typeof t === "string" ? t : (t.name || t.label || t.title || JSON.stringify(t))
  ) : [];

  const descRaw = item.description_raw || item.description_string || item.description
    || item.excerpt || item.summary || "";

  return {
    source:      "cci-api",
    id:          item._id || item.id || "",
    slug:        item.slug || slugify(item.title || ""),
    title:       item.title || item.name || "",
    speaker:     item.preacher || item.speaker || item.author || "Apostle Emmanuel Iren",
    date:        item.sermon_date ? formatDate(item.sermon_date) : formatDate(item.date || ""),
    audioUrl,
    youtubeUrl:  item.youtube_link || item.youtubeLink || item.youtubeUrl || "",
    pageUrl:     `https://sermons.joincci.org/sermons/${item.slug || slugify(item.title || "")}`,
    thumbnail,
    duration:    audioInfo.duration_formatted || audioInfo.duration || item.duration || "",
    description: descRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    series:      seriesName,
    tags,
    topics:      [],
  };
}

// ─── RSS FALLBACK ─────────────────────────────────────────────────────────────

async function fetchRss(log) {
  const sermons = [];
  try {
    const xml   = await fetchText(RSS_URL);
    const items = parseRssItems(xml);
    for (const item of items) {
      sermons.push({ source: "cci-rss", ...item, topics: [] });
    }
    log.push(`RSS: ${RSS_URL} — ${items.length} items`);
  } catch (err) {
    log.push(`RSS: failed — ${err.message}`);
  }
  return sermons;
}

function parseRssItems(xml) {
  const items = [];
  const re    = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1];
    const title = decodeXml(extractXmlTag(raw, "title"));
    if (!title) continue;
    items.push({
      id:          "",
      slug:        slugify(title),
      title,
      speaker:     decodeXml(extractXmlTag(raw, "itunes:author") || extractXmlTag(raw, "author") || "Apostle Emmanuel Iren"),
      date:        formatDate(extractXmlTag(raw, "pubDate")),
      audioUrl:    extractEnclosureUrl(raw),
      youtubeUrl:  "",
      pageUrl:     `https://sermons.joincci.org/sermons/${slugify(title)}`,
      thumbnail:   extractAttr(raw, "itunes:image", "href"),
      duration:    extractXmlTag(raw, "itunes:duration"),
      description: decodeXml((extractXmlTag(raw, "description") || extractXmlTag(raw, "itunes:summary") || "").replace(/<[^>]+>/g, " ").trim()),
      series:      "",
      tags:        [],
    });
  }
  return items;
}

// ─── SPOTIFY ─────────────────────────────────────────────────────────────────

async function scrapeSpotify(clientId, clientSecret, log) {
  const sermons = [];
  let token;
  try {
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res   = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
      body:    "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    token = (await res.json()).access_token;
    log.push("Spotify: token OK");
  } catch (err) {
    log.push(`Spotify: auth failed — ${err.message}`);
    return sermons;
  }

  try {
    const search = await fetchJsonAuth(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent("Celebration Church International Emmanuel Iren")}&type=show&market=GB&limit=5`,
      token
    );
    for (const show of (search.shows?.items || []).filter(Boolean)) {
      log.push(`Spotify: show "${show.name}" (${show.id})`);
      let url = `https://api.spotify.com/v1/shows/${show.id}/episodes?market=GB&limit=50`;
      while (url) {
        const page = await fetchJsonAuth(url, token);
        for (const ep of (page.items || []).filter(Boolean)) {
          sermons.push({
            source:     "spotify",
            id:         ep.id,
            slug:       slugify(ep.name),
            title:      ep.name,
            speaker:    "Apostle Emmanuel Iren",
            date:       ep.release_date || "",
            audioUrl:   ep.external_urls?.spotify || "",
            youtubeUrl: "",
            pageUrl:    ep.external_urls?.spotify || "",
            thumbnail:  (ep.images || [])[0]?.url || "",
            duration:   formatDuration(ep.duration_ms),
            description: (ep.description || "").slice(0, 2000),
            series:     show.name,
            tags:       [],
            topics:     [],
          });
        }
        url = page.next || null;
      }
    }
    log.push(`Spotify: ${sermons.length} episodes total`);
  } catch (err) {
    log.push(`Spotify: failed — ${err.message}`);
  }
  return sermons;
}

// ─── CLASSIFICATION ──────────────────────────────────────────────────────────

function classifySermon(sermon) {
  const matchedGroups = new Set();

  const searchText = [
    sermon.title,
    sermon.description,
    sermon.series,
    ...(sermon.tags || []),
  ].filter(Boolean).join(" ").toLowerCase();

  // Match via topic group keywords
  for (const group of TOPIC_GROUPS) {
    for (const kw of group.keywords) {
      if (searchText.includes(kw.toLowerCase())) {
        matchedGroups.add(group.id);
        break;
      }
    }
  }

  // Match via API tags
  for (const tag of (sermon.tags || [])) {
    const tagLower = String(tag).toLowerCase().trim();
    for (const [tagKey, groupId] of Object.entries(TAG_TOPIC_MAP)) {
      if (tagLower.includes(tagKey)) {
        matchedGroups.add(groupId);
      }
    }
  }

  return [...matchedGroups];
}

function buildGroups(sermons) {
  return TOPIC_GROUPS.map((group) => ({
    id:      group.id,
    label:   group.label,
    sermons: sermons.filter((s) => (s.topics || []).includes(group.id)),
  })).filter((g) => g.sermons.length > 0);
}

function mergeByTitle(primary, secondary) {
  const byKey = new Map();
  for (const sermon of primary) {
    byKey.set(sermonSlugKey(sermon), sermon);
    byKey.set(sermonTitleKey(sermon), sermon);
  }
  const additions = [];

  for (const candidate of secondary) {
    const key = sermonSlugKey(candidate);
    const titleKey = sermonTitleKey(candidate);
    const existing = byKey.get(key);
    const titleMatch = byKey.get(titleKey);
    const match = existing || titleMatch;
    if (!match) {
      additions.push(candidate);
      byKey.set(key, candidate);
      byKey.set(titleKey, candidate);
      continue;
    }

    if (!match.audioUrl && candidate.audioUrl) match.audioUrl = candidate.audioUrl;
    if (!match.duration && candidate.duration) match.duration = candidate.duration;
    if (!match.thumbnail && candidate.thumbnail) match.thumbnail = candidate.thumbnail;
    if (!match.description && candidate.description) match.description = candidate.description;
  }

  return [...primary, ...additions];
}

function sermonSlugKey(sermon) {
  return (sermon.slug || slugify(sermon.title || "")).toLowerCase().trim();
}

function sermonTitleKey(sermon) {
  return String(sermon.title || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ─── HTML VIEWER ─────────────────────────────────────────────────────────────

function buildHtml(allSermons, grouped) {
  const totalByTopic = {};
  for (const s of allSermons) for (const t of (s.topics || [])) totalByTopic[t] = (totalByTopic[t] || 0) + 1;

  const groupOpts = TOPIC_GROUPS.map((g) =>
    `<option value="${g.id}">${g.label} (${totalByTopic[g.id] || 0})</option>`
  ).join("");

  const years = [...new Set(allSermons.map((s) => (s.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CCI Sermons - Apostle Emmanuel Iren</title>
  <style>
    :root {
      --bg:#fff7f7; --panel:#ffffff; --ink:#1f1414; --muted:#7b6262;
      --line:#f0d7d7; --accent:#b00000; --accent-2:#e11d1d; --soft-red:#fff0f0;
      --shadow:0 18px 45px rgba(176,0,0,.08); --radius:18px;
    }
    *,*::before,*::after{box-sizing:border-box}
    body{margin:0;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink);line-height:1.5}
    body::before{content:"";position:fixed;inset:0;background:linear-gradient(180deg,#ffffff 0,#fff7f7 26rem);pointer-events:none;z-index:-1}
    .shell{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:28px 0 56px}

    header{padding:28px 0 22px;border-bottom:1px solid var(--line);margin-bottom:18px}
    h1{font-size:clamp(2rem,4vw,4.4rem);line-height:.95;margin:0;letter-spacing:0;font-weight:800;max-width:760px}
    header p{margin:12px 0 0;color:var(--muted);font-size:1rem;max-width:680px}

    .controls{position:sticky;top:0;z-index:3;background:rgba(255,255,255,.92);backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:14px;padding:12px;display:grid;grid-template-columns:1.35fr repeat(3,minmax(150px,.75fr));gap:10px;margin:0 0 14px;box-shadow:var(--shadow)}
    .ctrl{display:flex;flex-direction:column;gap:5px;min-width:0}
    label{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#9f2b2b}
    input,select{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 11px;font:inherit;font-size:.92rem;background:#fff;color:var(--ink);outline:none}
    input:focus,select:focus{border-color:var(--accent-2);box-shadow:0 0 0 3px rgba(225,29,29,.12)}

    .count-line{margin:16px 0 12px;color:var(--muted);font-weight:700}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px;align-items:stretch}

    .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:0 10px 28px rgba(176,0,0,.05);display:flex;flex-direction:column;gap:12px;min-height:260px;overflow:hidden}
    .thumb,.thumb-placeholder{display:none}
    .card-body{display:flex;flex-direction:column;gap:12px;min-height:100%;flex:1}
    .card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .card-kicker{font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .card-date{font-size:.78rem;color:var(--muted);font-weight:700;white-space:nowrap}
    .card-title{font-size:1.18rem;line-height:1.18;font-weight:800;margin:0;letter-spacing:0}
    .card-meta{font-size:.86rem;color:var(--muted);font-weight:600}
    .card-desc{font-size:.9rem;color:#4f3d3d;line-height:1.55;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;min-height:5.55em}
    .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto}
    .tag{max-width:100%;padding:4px 8px;border-radius:7px;font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;overflow:hidden;text-overflow:ellipsis}
    .tag-topic{background:#ffe7e7;color:#b00000}
    .tag-series{background:#f7f7f7;color:#5b1c1c;border:1px solid #eed0d0}
    .links{display:flex;gap:8px;flex-wrap:wrap;padding-top:2px}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:7px 11px;border-radius:8px;font-size:.82rem;font-weight:800;text-decoration:none;border:1px solid var(--line);color:var(--accent);background:#fff}
    .btn:hover{border-color:rgba(176,0,0,.35);background:var(--soft-red)}
    .btn-yt{color:#fff;border-color:var(--accent);background:var(--accent)}
    .btn-yt:hover{background:#8f0000;color:#fff}

    .empty{grid-column:1/-1;padding:42px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:12px;background:rgba(255,255,255,.55)}
    details{margin-top:22px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px 16px}
    summary{cursor:pointer;font-weight:800;color:var(--accent);font-size:.9rem}
    .log{margin:10px 0 0;padding-left:18px;font-size:.84rem;color:var(--muted);line-height:1.75}
    @media(max-width:860px){.controls{position:static;grid-template-columns:1fr 1fr}.ctrl:first-child{grid-column:1/-1}}
    @media(max-width:560px){.shell{width:min(100% - 22px,1180px);padding-top:18px}.controls,.grid{grid-template-columns:1fr}h1{font-size:2.15rem}.card{min-height:0}}
  </style>
</head>
<body>
<div class="shell">
  <header>
    <h1>CCI Sermons</h1>
    <p>A focused library of Apostle Emmanuel Iren teachings from Celebration Church International.</p>
  </header>

  <div class="controls">
    <div class="ctrl">
      <label for="q">Search</label>
      <input id="q" type="search" placeholder="title, description...">
    </div>
    <div class="ctrl">
      <label for="topicSel">Topic group</label>
      <select id="topicSel">
        <option value="">All topics</option>
        ${groupOpts}
        <option value="__none__">Uncategorised</option>
      </select>
    </div>
    <div class="ctrl">
      <label for="seriesSel">Series</label>
      <select id="seriesSel">
        <option value="">All series</option>
        ${[...new Set(allSermons.map((s) => s.series).filter(Boolean))].sort()
          .map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}
      </select>
    </div>
    <div class="ctrl">
      <label for="yearSel">Year</label>
      <select id="yearSel">
        <option value="">All years</option>
        ${years.map((y) => `<option value="${y}">${y}</option>`).join("")}
      </select>
    </div>
  </div>

  <p class="count-line" id="countLine">Showing ${allSermons.length} sermons</p>
  <div class="grid" id="grid"></div>

  <details>
    <summary>Group breakdown</summary>
    <ul class="log">
      ${grouped.map((g) => `<li><strong>${esc(g.label)}</strong>: ${g.sermons.length} sermons</li>`).join("")}
      <li><strong>Uncategorised</strong>: ${allSermons.filter((s) => !s.topics || s.topics.length === 0).length} sermons</li>
    </ul>
  </details>
</div>

<script>
  const sermons = ${JSON.stringify(allSermons)};
  const GROUPS  = ${JSON.stringify(TOPIC_GROUPS.map((g) => ({ id: g.id, label: g.label })))};

  const q        = document.getElementById("q");
  const topicSel = document.getElementById("topicSel");
  const seriesSel= document.getElementById("seriesSel");
  const yearSel  = document.getElementById("yearSel");
  const grid     = document.getElementById("grid");
  const countLine= document.getElementById("countLine");

  function render() {
    const sq = q.value.trim().toLowerCase();
    const st = topicSel.value;
    const ss = seriesSel.value;
    const sy = yearSel.value;

    const filtered = sermons.filter((s) => {
      const hay = [s.title, s.description, s.series, ...(s.tags||[])].filter(Boolean).join(" ").toLowerCase();
      if (sq && !hay.includes(sq)) return false;
      if (st === "__none__" && s.topics && s.topics.length > 0) return false;
      if (st && st !== "__none__" && !(s.topics||[]).includes(st)) return false;
      if (ss && s.series !== ss) return false;
      if (sy && !(s.date||"").startsWith(sy)) return false;
      return true;
    });

    countLine.textContent = "Showing " + filtered.length + " sermon" + (filtered.length !== 1 ? "s" : "");
    if (!filtered.length) { grid.innerHTML = '<div class="empty">No sermons match.</div>'; return; }

    grid.innerHTML = filtered.map((s) => {
      const meta = [s.speaker, s.date, s.duration].filter(Boolean).join(" · ");
      const topicLabels = (s.topics||[]).map((tid) => {
        const g = GROUPS.find(g => g.id === tid);
        return g ? '<span class="tag tag-topic">' + esc(g.label) + '</span>' : "";
      }).join("");
      const seriesTag = s.series ? '<span class="tag tag-series">' + esc(s.series) + '</span>' : "";
      const apiTags = (s.tags||[]).slice(0,4).map(t => '<span class="tag tag-series">' + esc(t) + '</span>').join("");
      const audioBtn = s.audioUrl ? '<a class="btn" href="' + esc(s.audioUrl) + '" target="_blank" rel="noreferrer">Podcast audio</a>' : "";
      const ytBtn    = s.youtubeUrl ? '<a class="btn btn-yt" href="' + esc(s.youtubeUrl) + '" target="_blank" rel="noreferrer">▶ YouTube</a>' : "";
      const pageBtn  = "";
      const img = s.thumbnail
        ? '<img class="thumb" src="' + esc(s.thumbnail) + '" alt="" loading="lazy" onerror="this.style.display=&quot;none&quot;">'
        : '<div class="thumb-placeholder">🎙</div>';
      return '<article class="card">' + img +
        '<div class="card-body">' +
          '<div class="card-title">' + esc(s.title||"Untitled") + '</div>' +
          (meta ? '<div class="card-meta">' + esc(meta) + '</div>' : "") +
          (s.description ? '<div class="card-desc">' + esc(s.description) + '</div>' : "") +
          '<div class="tags">' + seriesTag + topicLabels + apiTags + '</div>' +
          '<div class="links">' + audioBtn + ytBtn + pageBtn + '</div>' +
        '</div></article>';
    }).join("");
  }

  function esc(v) {
    return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  q.addEventListener("input", render);
  topicSel.addEventListener("change", render);
  seriesSel.addEventListener("change", render);
  yearSel.addEventListener("change", render);
  render();
</script>
</body>
</html>`;
}

// ─── SMALL HELPERS ────────────────────────────────────────────────────────────

function esc(v) {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function fetchText(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { ...BROWSER_HEADERS, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchJsonAuth(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function extractXmlTag(xml, tag) {
  const re = new RegExp(`<${tag}(?:[^>]*)><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m  = xml.match(re);
  return m ? (m[1] || m[2] || "").trim() : "";
}

function extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, "i");
  const m  = xml.match(re);
  return m ? m[1] : "";
}

function extractEnclosureUrl(item) {
  const m = item.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

function decodeXml(str) {
  return String(str)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

function formatDate(raw) {
  if (!raw) return "";
  try { return new Date(raw).toISOString().slice(0, 10); } catch { return raw; }
}

function formatDuration(ms) {
  if (!ms) return "";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--spotify-id" && argv[i + 1]) a.spotifyId = argv[++i];
    if (argv[i] === "--spotify-secret" && argv[i + 1]) a.spotifySecret = argv[++i];
  }
  return a;
}

main().catch((err) => { console.error("Fatal:", err); process.exitCode = 1; });
