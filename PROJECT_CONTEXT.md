# Comunicación / Fecundidad project context

Last updated: 2026-07-26

This is the durable handoff for the site. It was reconstructed from the complete archived Codex thread titled `통계` (thread `019c3eaa-e0ed-7ee1-b4ff-1bc673426f5f`), the current worktree, repository documentation, and Git history. The current repository is authoritative whenever old requests and current code differ.

## 1. Product identity

The project evolved from a research visualization into a reusable Spanish-language digital newsroom called **Comunicación**. Its visual and editorial reference is high-end newspaper data journalism, especially the proportions, restraint, hierarchy, and interaction quality associated with Washington Post-style article pages, without using its logo or proprietary identity.

Key identity:

- Brand: `Comunicación`
- Motto: `Veritas lux mea`
- Language: public UI and article copy are primarily Spanish
- Primary artifact: a long-form interactive data report about digital leisure, time outside the home, and delayed maternity/fertility in the United States
- Broader product: a homepage, secure author login, rich article editor, reusable article template, and automatic publishing workflow

The user repeatedly rejected approximate, oversized, generic, or childish-looking UI. Visual changes should be measured against the existing design and tested at real viewport sizes. Fidelity of typography, spacing, proportions, and responsive behavior matters.

## 2. Current locations and URLs

- Local root: `/Users/macbookpro/Desktop/Portfolio/01_fecundidad_research_site/project`
- GitHub: `https://github.com/qdgvr/fecundidad.github.io`
- Production site: `https://qdgvr.github.io/fecundidad.github.io/`
- Editorial homepage: `main.html`
- Authoring UI: `admin/`
- Cloudflare Worker configured in `admin/config.js`:
  `https://comunicacion-publisher.comunicacion-qdgvr.workers.dev`

The project previously lived under `/Users/macbookpro/Desktop/database/fecundidad.github.io`; those paths are historical. Use the Portfolio path above.

## 3. Explicitly ignored state

`relationship-spec-c-data.json` has a local uncommitted modification. The user explicitly instructed that it be ignored.

Consequences:

- Do not treat it as incomplete work.
- Do not inspect it to infer the next task.
- Do not stage, revert, overwrite, format, or commit it.
- Exclude it from status-based summaries unless noting that it is intentionally ignored.

## 4. Historical evolution

### Phase A: article layout and first research visualizations

The site began by recreating the visual grammar of a premium newspaper article page. The user wanted:

- the Comunicación name in place of the reference newspaper logo;
- matching dark colors, typography roles, spacing, and proportions;
- no subscription button;
- a professional editorial feel, not a generic template;
- research maps and graphs embedded within a long-form article.

The first major visualization flow used a United States map with three research axes:

1. digital leisure / screen-based leisure;
2. time spent in in-person activities outside the home;
3. fertility outcomes by age and related fertility measures.

Internal names such as `DigitalOcio_hours` and `M_share` were to be replaced in the UI with concise, reader-friendly Spanish labels. Rates must show correct units and must not be formatted as misleading percentages.

### Phase B: data-reportage narrative

The article was expanded into a Spanish `reportaje de datos`. Its core interpretive sequence is:

1. screen-based leisure occupies more of the day;
2. time in shared, in-person spaces outside the home declines;
3. fertility changes differently by maternal age;
4. the pattern is read primarily as a shift/delay in the reproductive calendar, not as a simplistic claim that a screen directly replaces a birth.

The requested editorial framing is cautious:

- technology is not presented as the sole cause of low fertility;
- the analysis concerns associations, daily routines, opportunities for encounter, and timing;
- age-specific fertility is essential because a total rate can conceal postponement;
- model descriptions should be concise in the article, with technical details in notes/cards.

Important research language:

- Stage A / first link: more digital leisure is associated with less in-person time outside the home.
- Strict specification (Spec C): state and year fixed effects, macroeconomic controls, and state-specific linear trends.
- Models were discussed across lags 0–8 and with a sample excluding 2020.
- Sources named in the article context include ATUS, CDC Natality, Population Estimates Program, unemployment, per-capita personal income, and house-price controls.

### Phase C: globe-led scrollytelling

The opening became a full-screen 3D globe narrative:

- one continuous page scroll;
- the globe is the first major visual, not the report body;
- guided sequence through Europe, East Asia, the United States, then the report title/body;
- region/country/state TFR values;
- country borders and US state boundaries filled with a blue fertility scale rather than floating marker spheres;
- selected geography name and TFR displayed in the upper-left region label area;
- cards and unnecessary borders were progressively removed for a cleaner editorial composition;
- the globe remains visible behind the title transition;
- transition blur is acceptable, but persistent side blur that makes text unreadable is not;
- the header must stay fixed and not collide with map controls;
- no separate inner scroll for the interactive.

The current globe chapter sequence and copy in `index.html` are newer than the early four-step concept and should be preserved unless explicitly changed.

### Phase D: US map and report graph refinement

The United States interactive was redesigned to feel like the globe:

- full-width/full-screen composition;
- controls float without heavy card frames;
- zoom buttons remain, but wheel scrolling must not unexpectedly zoom the map;
- panels, map, labels, and lower trend chart must not overlap on wide, narrow, or mobile viewports;
- mobile selection should not create unwanted browser-style popups;
- chart labels, lag labels, and axes must remain legible on small screens;
- graphical arrows must render as designed shapes, not emoji glyphs.

The long report body was refined repeatedly:

- chapter framing should read like a story/movement, not a thesis outline;
- section backgrounds were unified;
- redundant titles were removed and nearby copy merged into body blocks;
- spacing between prose and graphs was tightened;
- later graph additions were reduced to the most useful final pair;
- relationship trends were limited to observed ranges and time labels formatted for readers;
- footer links and end-of-article interactions were refined.

### Phase E: reusable article system and newsroom

The published report became a master layout for additional reports.

Two creation paths exist:

1. CLI template:
   `node scripts/create-reportage.mjs <slug>`
2. Browser newsroom:
   `admin/`

The browser workflow was requested to operate like a real digital newsroom:

- sign in;
- one flexible rich body editor rather than rigid fixed paragraph boxes;
- title and article metadata;
- bold, italic, underline/strike, headings, links, alignment, lists, numeric font size, numeric line spacing, paragraph spacing controls;
- body image insertion and other media;
- local drafts;
- accurate preview;
- automatic publication into the shared article template;
- homepage index update.

The user specifically required controls to respond immediately and be tested by use:

- alignment and links must work;
- bold/italic must toggle without requiring Enter;
- font size and line spacing should use numeric controls, not vague small/normal/large labels;
- heading margins must not create excessive vertical gaps;
- paragraph spacing add/remove controls should behave predictably;
- the initial typing line height must be compact and intentional.

Commits `7f6c29b`, `ab1900f`, and `25c7f72` contain the main editor implementation and fixes.

### Phase F: secure automatic publishing

The publishing architecture uses:

- GitHub OAuth for author identity;
- a Cloudflare Worker to keep secrets off GitHub Pages;
- an encrypted, signed two-hour session;
- an allowlist of GitHub users;
- GitHub repository writes constrained to `qdgvr/fecundidad.github.io`;
- one commit per publication that creates article artifacts and updates `content/articles.json`;
- refusal to overwrite an existing slug;
- conflict handling without partial branch modification.

Current non-secret Worker configuration is in `worker/wrangler.jsonc`:

- site origin: `https://qdgvr.github.io`
- site URL: `https://qdgvr.github.io/fecundidad.github.io`
- repository: `qdgvr/fecundidad.github.io`
- branch: `main`
- allowed login: `qdgvr`

Secrets must exist only in Cloudflare:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`

Never place these in the repository, browser JavaScript, `.dev.vars`, or documentation values.

### Phase G: chart templates and fully interactive publication

The user requested a Datawrapper-like chart feature in the article editor, including import of JSON templates from GitHub. They explicitly rejected PNG output and required charts to remain interactive after publication.

Current implementation:

- chart types: bar, horizontal bar, line, area, scatter, donut;
- CSV or JSON data input;
- built-in template catalog;
- local JSON template import;
- public GitHub/Gist JSON catalog import;
- title, subtitle, source, axes, theme, primary color, legend, grid, and stacking options;
- live editor preview;
- validated encoded JSON specification stored in article HTML;
- Canvas rendering in the reader;
- pointer/touch tooltips;
- responsive resize;
- `Ver datos` / `Ocultar datos` accessible data table;
- server-side revalidation in the Worker;
- no execution of imported JavaScript.

Security and size limits are intentional:

- URL imports only from `raw.githubusercontent.com` and `gist.githubusercontent.com`;
- 40 templates per catalog;
- 250 rows;
- 8 series;
- 500 KB template input;
- approximately 180 KB encoded interactive chart spec.

The latest interactive-chart implementation was browser-tested before commit `d84e8a8`: 1600×900 Canvas rendering, table toggle, accessibility state, and no console warnings/errors were verified.

### Phase H: open electrical-infrastructure atlas

A special interactive article was added for public electrical-infrastructure mapping across Europe, the continental United States, China, Japan, South Korea, and Taiwan.

Durable implementation decisions:

- use one MapLibre GL JS map and move it with region-specific `fitBounds` controls;
- use the versioned OpenInfraMap vector tiles only for the geographic background; keep the electrical grid on the project's separately built and pinned regional OSM power PMTiles, and never load OpenInfraMap's power tiles;
- preserve the familiar voltage color scale and distinguish overhead from underground/underwater lines in the project-owned power style;
- keep the functional scope note explicit: OpenStreetMap coverage varies and the map is not a real-time grid-operations, power-flow, congestion, thermal-capacity, or breaker-state display;
- keep linked OpenStreetMap/ODbL, OpenInfraMap/CC BY 4.0, and Natural Earth fallback attribution visible;
- vendor the pinned MapLibre 5.21.1 runtime and license under `assets/vendor/`;
- publish this article manually as a static special artifact because the generic newsroom sanitizer intentionally removes scripts, iframes, and buttons.

The July 26 local-preview repair adds these durable rules:

- a direct `file://` preview must resolve project-owned `data/` requests to the CORS- and Range-capable GitHub Pages asset base; the project's power PMTiles cannot be read correctly from the local filesystem because they require HTTP `206` byte ranges, while OpenInfraMap background MVTs load directly with CORS;
- `mapReady=true` requires both the OpenInfraMap background and the regional OSM power archive; the fallback country GeoJSON is usable geography, but it must not be reported as the complete detailed basemap;
- do not treat MapLibre `isSourceLoaded` or an idle event as proof that OpenInfraMap responded successfully; each region must pass an explicit `200`/`206` protobuf tile probe before `osmBasemapReady=true`, with generation-safe retries after transient failures;
- road and place labels use `Noto Sans Regular` glyph PBFs from MapLibre's CORS-enabled demo asset host; this improves orientation but is a non-SLA external dependency, so glyph failure must not be confused with loss of the underlying geographic vectors;
- the high-detail regional context schema is `osm-context-v2`, z2–15, with landcover, landuse, water, waterways, coastline, buildings, roads, administrative boundaries, rail, and places;
- preserve project-built background archives and their reproducible pipeline as a recovery path, but exclude all background PMTiles from the GitHub Pages artifact; the verified Taiwan schema-2 archive alone is 269,734,207 bytes;
- keep the verified Taiwan schema-2 archive and exact build contract outside the Git repository at `../atlas-archives/osm-context-v2/taiwan-2026-07-25/`; the compact schema-1 world and six regional archives remain in the existing GitHub Release;
- the Pages workflow downloads and verifies only the six pinned power archives, rejects any packaged `osm-basemap/*.pmtiles`, and rejects an assembled site over 1,000,000,000 bytes.

The July 2026 atlas expansion adds these durable rules:

- keep `data/grid-atlas/source-registry.json` as the machine-readable provenance ledger and `region-profiles.json` as the reader-facing regional evidence summary;
- keep reproducible official-data builders and offline integrity checks under `scripts/grid-atlas/`; builders preserve original identifiers, dates, licence, evidence class, and transformation notes;
- prefer official geometry over inferred geometry, but never infer voltage, circuits, operator, status, topology, or connectivity when the publisher does not provide them;
- preserve the complete OS OpenMap Local Great Britain transmission-line geometry (3,414 unique features) and Kadaster BRT TOP10NL Netherlands high-voltage geometry (496 unique features) without simplification; render both in neutral grey under voltage filters because their numeric voltage is unpublished;
- load large verified assets only when their region is active: 15,764 continental EIA-860M plants, 5,570 Taiwan display cells representing all 505,791 valid official points, and the 580-feature KPG 193 synthetic model;
- expose China’s 51 NEA HVDC systems and KEPCO’s 848 public project-list records as searchable non-spatial inventories rather than inventing routes or coordinates; preserve KEPCO’s separate 849 dashboard total as an unresolved one-record discrepancy;
- keep official and modelled layers visibly separate: official regional lines are solid, official planning lines are dashed, and capacity-only/model corridors remain explicitly schematic;
- paginate the inventories responsively (30 records on desktop, 12 on narrow screens) instead of creating nested scrolling regions, while preserving keyboard focus, heading order, language tags, and live-status semantics.

## 5. Current architecture map

### Main report

- `index.html`: authoritative long-form fertility report and globe/report structure
- `styles.css`: primary report and visualization styling
- `globe-hero.js`: 3D globe, regions, scrolling, selections
- `us-map-widget.js`: US map interactions
- `us-states.json`: state geometry
- `research-map-data.csv`: state/year research data
- `additional-graphs.js` and `additional-graphs-data.json`: report graphs
- `relationship-graphs.js`: relationship/statistical bridge graphs
- `data/tfr-globe-data.json`: world/US fertility values used by globe
- `data/world-countries.geojson`: country geometry

### Reusable report template

- `TEMPLATE.md`: template workflow
- `scripts/create-reportage.mjs`: CLI report generator
- `article-template.js`: shared article configuration/runtime support
- `content/article.example.js`: content example

### Homepage and published articles

- `main.html`, `main.css`, `main.js`: Comunicación homepage
- `content/articles.json`: homepage article index
- `post-template.html`, `post-template.js`, `post.css`: generic published-article runtime
- `atlas-infraestructura-electrica.html`, `content/atlas-infraestructura-electrica.js`: electrical-atlas article shell and content
- `open-grid-atlas.js`, `open-grid-atlas.css`: MapLibre map runtime, searchable inventories, provenance popups, and responsive article module
- `grid-atlas-regional-sources.js`: viewport-aware official-source adapters for France, Great Britain, the Netherlands, Germany, Norway, California, and BPA territory
- `data/grid-atlas/`: normalized official/model assets, metadata sidecars, regional profiles, and the source registry
- `scripts/grid-atlas/`: reproducible source builders and offline registry/asset validators
- `assets/open-grid-atlas.svg`: homepage thumbnail
- `assets/vendor/maplibre-gl-5.21.1.*`: pinned third-party map runtime and license

### Newsroom/editor

- `admin/index.html`: authoring UI
- `admin/admin.js`: editor logic, sanitization, drafts, preview, chart insertion
- `admin/admin.css`: editor design
- `admin/preview.html`, `admin/preview.js`, `admin/preview-config.js`: preview runtime
- `admin/article-config.js`: article/template configuration
- `admin/config.js`: deployed Worker base URL (public, non-secret)

### Interactive article charts

- `admin/chart-templates.json`: built-in templates
- `admin/chart-template.example.json`: import example
- `chart-renderer.js`: shared parser, validation, spec encoding, Canvas renderer, hit areas
- `interactive-chart.js`: reader-side mount, tooltip, table, resize behavior
- `interactive-chart.css`: public chart styling

### Publishing service

- `worker/src/index.js`: OAuth/session/publishing API
- `worker/wrangler.jsonc`: non-secret deployment config
- `worker/README.md`: deployment/security procedure

## 6. Editorial and UX invariants

### Visual quality

- Preserve the black/dark editorial palette and restrained blue/cyan data accents.
- Avoid generic cards, inflated headings, excessive border radii, and unnecessary shadows.
- Prefer borderless, integrated overlays where established.
- Typography, line height, margins, and component proportions must feel like an editorial publication.
- Avoid regressions caused by adding isolated CSS overrides without understanding the cascade. Several historical versioned CSS files remain; inspect actual load order.

### Responsive behavior

Always verify at least:

- wide desktop;
- normal laptop;
- narrow/short desktop window;
- mobile portrait.

No text-to-text, text-to-chart, control-to-map, or panel-to-panel overlap is acceptable. Short viewport height is as important as narrow width.

### Interaction

- Keep a single narrative scroll.
- Scroll must not accidentally zoom the US map.
- Maintain explicit zoom/reset controls where present.
- Touch selection must not trigger unwanted popups.
- Interactive data must remain explorable after publication.
- Provide a readable table fallback for charts.
- Respect `prefers-reduced-motion`.

### Copy and data

- Public labels should be Spanish and reader-friendly.
- Explain units accurately: fertility rates are not ordinary percentages.
- Keep 2020 handling explicit; do not silently drop it.
- Distinguish total fertility, general fertility, age-specific fertility, first-birth rate, and maternal age.
- Avoid claiming a direct mechanical causal path from screens to births.
- Keep the narrative about reorganization of time and postponement of maternity.

## 7. Git history landmarks

- `21d61ff`: mirror of the earlier consumo page into this repository
- `a2f38a5`–`d9ff685`: report body restructuring and methodology/callout restoration
- `494d6fd`: final reportage graphs
- `dc6e687`–`1f31a86`: report text flow, graph layout, spacing, labels, footer, and interaction refinements
- `376e186`: newsroom and OAuth publishing workflow
- `7f6c29b`: rich article editor and generic publishing template
- `ab1900f`: editor/media publishing upgrade
- `25c7f72`: formatting and spacing control fixes
- `fd75c29`: chart templates in editor
- `d84e8a8`: fully interactive published article charts
- `a3aa185`: OpenInfraMap-based electrical infrastructure atlas with six regional views, evidence limits, responsive controls, accessible inspection, and production publication
- `fdc3ff4`: verified official-grid expansion with 26 registered sources, reproducible builders, searchable China/Korea inventories, and deployed static assets
- `6a25cbe`: replaced OpenInfraMap with project-built OSM extraction, normalization, PMTiles, styling, release assets, and verified GitHub Pages deployment

At the latest atlas publication check, `main`, `origin/main`, the annotated tag
`osm-power-2026-07-25-schema1`, and GitHub Pages were aligned at `6a25cbe`.
Pages run `30196898760` completed successfully. The matching GitHub release
contains six PMTiles archives plus the manifest; every server-side asset
digest and byte count matched the local manifest. The `gh` CLI and Git HTTPS
credentials were both valid for this deployment.

## 8. Known state and verification posture

Known completed and previously verified:

- full interactive chart publication instead of PNG;
- chart tooltip and data table toggle;
- editor-to-published-article chart spec flow;
- GitHub/Cloudflare publishing architecture committed and configured;
- electrical infrastructure atlas published for Europe, the continental United States, China, Japan, South Korea, and Taiwan;
- atlas layers, voltage filters, lifecycle states, feature popups, keyboard controls, responsive layouts, and eight evidence/limitations cards verified locally;
- production article and homepage card verified on GitHub Pages at `a3aa185`;
- current `main` synchronized with `origin/main` at `a3aa185`.

Known completed and locally plus production verified in the July 2026 expansion:

- 26 registered sources across the six atlas regions;
- official IGN, OS, Kadaster, BKG, BNetzA, NVE, SFOE, HIFLD, CEC, BPA, EIA, GSI, Taipower, NEA, KEPCO, and OCCTO integrations or evidence inventories, with OSM/GEM and synthetic models kept separate;
- offline asset validation for exact counts, schemas, bounds, hashes, licences, no-geometry/no-inference assertions, and static-file size limits;
- real-Chrome loading of the 9.56 MB EIA layer in about five seconds, Taiwan’s complete display layer, and the Netherlands TOP10NL layer with no user-visible warning;
- 390 px inventory layout without horizontal overflow or nested list/detail scrolling.
- GitHub Pages production loading of EIA 15,764, Taiwan 5,570 display cells / 505,791 source points, Netherlands 496, Korean and Chinese searchable inventories, with no tested console or CSP errors.
- self-built OSM power archives for all six atlas regions, with 8,228,430 unique valid source objects, 4,119,764 area-centroid companions, and 12,348,194 emitted vector features;
- removal of 4,106,696 duplicate line/area representations emitted by `osmium export`, with duplicate OSM identity rejected by the validator;
- strict Geofabrik MD5 verification, source/intermediate/output SHA-256 provenance, ten-layer TileJSON contracts, and a complete deployment manifest;
- a GitHub Release-backed Pages workflow that downloads the pinned archives, re-verifies them, and deploys the assembled site;
- production switching across all six PMTiles archives, OSM object popups, 390 px responsive rendering, and zero recent tested console warnings/errors.

Do not assume without rechecking:

- current external OAuth secret validity;
- live Cloudflare Worker session/login health;
- GitHub Pages deployment status after future commits;
- future Pages deployments after commits newer than `fdc3ff4`;
- every rich-editor control after unrelated changes;
- every responsive breakpoint after CSS changes.

For changes, test the affected end-to-end path rather than relying only on syntax checks.

## 9. How to continue work

1. Read `AGENTS.md` and this file.
2. Run `git status --short --branch`; ignore only the instructed `relationship-spec-c-data.json` modification.
3. Identify the current consumer and load order of any file you plan to edit.
4. Make the smallest coherent change that preserves the established design system.
5. Run syntax/static checks.
6. Use a browser to test the actual interaction and responsive states.
7. Check console errors and warnings.
8. If the user asks to publish, commit only intended files, push `main`, and verify the live deployment.
9. Update this document when the change establishes a durable product or architecture decision.
