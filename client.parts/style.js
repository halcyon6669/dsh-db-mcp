
    const CSS = `
      .dbmcp-page {
        height: 100%;
        overflow: auto;
        box-sizing: border-box;
        padding: 22px 26px 40px;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-base);
        font: inherit;
        font-size: 13px;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }
      .dbmcp-head h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        line-height: 1.4;
        letter-spacing: 0.01em;
      }
      /* The masthead is the panel's identity: title, then the state pills, then
         the two links. It sits on the page's own background, separated from the
         content below by the tab rule rather than by a box of its own. */
      .dbmcp-masthead {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 9px;
        margin: 0;
        min-height: 28px;
      }
      .dbmcp-masthead h1 {
        margin: 0;
        font-size: 19px;
        font-weight: 650;
        letter-spacing: -0.005em;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-masthead-spacer {
        flex: 1 1 auto;
      }
      .dbmcp-back {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 0;
        background: none;
        padding: 2px 6px 2px 0;
        font: inherit;
        font-size: 13px;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        border-radius: 6px;
      }
      .dbmcp-back:hover {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-back-caret {
        font-size: 15px;
        line-height: 1;
      }
      /* Seven tabs do not fit a sidebar. They used to be clipped, then they
         scrolled sideways with the bar hidden — which only traded one clipped tab
         for a half-cut pill whenever the active tab was the last one. The row
         wraps to a second line instead: nothing is hidden, and every pill stays
         whole. */
      .dbmcp-tabs {
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        gap: 6px 8px;
        margin: 16px 0 0;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      /* The active tab used to be a 2px underline and nothing else, which is the
         weakest possible signal on a row of eight words in the same colour. It now
         carries a filled pill and brand ink; the row keeps its rule so the tabs
         still read as a strip rather than as loose buttons. The gap above is the
         margin these pills need: at 2px a hovering tab touched the active one and
         the two fills read as a single blob. */
      .dbmcp-tab {
        appearance: none;
        border: 0;
        background: none;
        padding: 5px 11px 7px;
        margin-bottom: 5px;
        border-radius: 7px;
        font: inherit;
        font-size: 13px;
        line-height: 1.4;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        white-space: nowrap;
        transition: color 120ms ease, background 120ms ease;
      }
      /* The first pill sits on the same left edge as the masthead, the notices
         and the cards: its box is the thing that lines up, and the word inside
         keeps its own 11px inset. Pulling the pill left so the *text* landed on
         the heading's axis was the other way round, and it left the fill hanging
         11px outside every other box on the page. */
      .dbmcp-tab:first-child {
        margin-left: 0;
      }
      .dbmcp-tab:hover:not(.is-active) {
        color: var(--dsw-alias-label-primary);
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
      }
      .dbmcp-tab:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: -1px;
        border-radius: 7px;
      }
      .dbmcp-tab.is-active {
        color: var(--dsw-alias-brand-primary);
        font-weight: 600;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent);
      }
      .dbmcp-sub {
        margin: 6px 0 0;
        font-size: 13px;
        line-height: 1.6;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        margin: 16px 0 18px;
      }
      .dbmcp-crumbs {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin: 14px 0 0;
        font-size: 13px;
      }
      .dbmcp-crumb {
        appearance: none;
        border: 0;
        background: none;
        padding: 4px 2px;
        font: inherit;
        color: var(--dsw-alias-brand-primary);
        cursor: pointer;
        border-radius: 4px;
        border-bottom: 2px solid transparent;
      }
      .dbmcp-crumb:hover {
        text-decoration: underline;
      }
      .dbmcp-crumb.is-current {
        color: var(--dsw-alias-label-primary);
        cursor: default;
        font-weight: 500;
        text-decoration: none;
        border-bottom-color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-crumb-sep {
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-title-switch {
        appearance: none;
        border: 0;
        background: none;
        padding: 0;
        font: inherit;
        color: inherit;
        cursor: pointer;
        border-radius: 4px;
      }
      .dbmcp-title-switch:hover {
        color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-schema-head {
        margin-bottom: 10px;
      }
      .dbmcp-btn {
        appearance: none;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        line-height: 1.4;
        padding: 6px 14px;
        cursor: pointer;
        transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
      }
      .dbmcp-btn:hover:not(:disabled) {
        border-color: var(--dsw-alias-border-l2);
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-layer-2));
      }
      .dbmcp-btn:active:not(:disabled) {
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, var(--dsw-alias-bg-layer-2));
      }
      .dbmcp-btn:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .dbmcp-btn:disabled {
        opacity: 0.6;
        cursor: default;
      }
      /* The primary action is the one filled control on the page: an outlined
         button was indistinguishable from every secondary one next to it. */
      .dbmcp-btn.is-primary {
        border-color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-brand-primary);
        color: var(--dsw-alias-bg-base);
        font-weight: 500;
      }
      .dbmcp-btn.is-primary:hover:not(:disabled) {
        border-color: var(--dsw-alias-brand-primary);
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 86%, var(--dsw-alias-label-primary));
      }
      .dbmcp-btn.is-danger {
        border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-btn.is-danger:hover:not(:disabled) {
        border-color: var(--dsw-alias-state-error-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
      }
      .dbmcp-btn.is-small {
        font-size: 12px;
        padding: 3px 9px;
        border-radius: 7px;
      }
      .dbmcp-btn.is-plain {
        border-color: transparent;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        padding: 3px 8px;
      }
      .dbmcp-btn.is-plain:hover:not(:disabled) {
        border-color: transparent;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-btn.is-plain.is-danger {
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-btn.is-plain.is-danger:hover:not(:disabled) {
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        padding: 2px 9px;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      /* An anchor styled as a pill: the star sits next to the connection state,
         and the whole thing is a link out to the repository. */
      a.dbmcp-pill.dbmcp-star {
        text-decoration: none;
        cursor: pointer;
        transition: color 120ms ease, border-color 120ms ease;
      }
      a.dbmcp-pill.dbmcp-star:hover {
        color: var(--dsw-alias-brand-primary);
        border-color: var(--dsw-alias-brand-primary);
      }
      /* The star glyph carries the meaning; the word stays so the pill still
         reads as a link when the glyph is missing from the font. */
      .dbmcp-star-mark {
        font-size: 13px;
        line-height: 1;
      }
      /* A row used to carry half a dozen bordered pills, one of which was the
         only thing that could be clicked and looked exactly like the rest. The
         state words are plain text now; the switch below is the only chrome on
         the row, so what can be operated is what looks operable. */
      .dbmcp-note {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 0;
        padding: 0;
        font-size: 12px;
        font-weight: 400;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-note.is-broken {
        color: var(--dsw-alias-state-warn-primary);
      }
      /* The read-only / writable flip. A 36x20 track reads as a control at a
         glance, which is the one thing a pill with a status word on it never
         did — the word beside it still spells out which way the switch is.
         The filled track uses the ink token rather than the brand colour: at
         this size the brand read as a link, while ink reads as "this is
         switched on" in both themes (near-black on light, near-white on dark). */
      .dbmcp-switch {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        flex: 0 0 auto;
        padding: 0;
        border: 0;
        background: transparent;
        font-family: inherit;
        font-size: 12px;
        font-weight: 400;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dbmcp-switch-track {
        position: relative;
        flex: 0 0 auto;
        width: 36px;
        height: 20px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--dsw-alias-label-secondary) 32%, transparent);
        transition: background 140ms ease;
      }
      .dbmcp-switch-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--dsw-alias-bg-base);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
        transition: transform 140ms ease;
      }
      .dbmcp-switch:hover:not(:disabled) {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-switch.is-on {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-switch.is-on .dbmcp-switch-track {
        background: var(--dsw-alias-label-primary);
      }
      .dbmcp-switch.is-on .dbmcp-switch-knob {
        transform: translateX(16px);
      }
      .dbmcp-switch:disabled {
        cursor: default;
        opacity: 0.55;
      }
      .dbmcp-switch:focus-visible .dbmcp-switch-track {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .dbmcp-hint.is-warn {
        color: var(--dsw-alias-state-warn-primary);
      }
      /* The identifier is the handle every MCP tool takes as its datasource
         argument, so it gets a chip of its own instead of trailing the target
         string: the label says what it is, the mono value is what gets pasted
         into chat. */
      .dbmcp-idchip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        padding: 1px 9px;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 32%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
        color: var(--dsw-alias-brand-primary);
        font-family: inherit;
        font-size: 11px;
        line-height: 1.6;
        cursor: pointer;
        transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
      }
      .dbmcp-idchip:hover {
        border-color: var(--dsw-alias-brand-primary);
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
      }
      .dbmcp-idchip-key {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        opacity: 0.75;
        white-space: nowrap;
      }
      .dbmcp-idchip-value {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        font-weight: 600;
      }
      .dbmcp-idchip.is-copied {
        border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent);
        background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-idchip-mark {
        font-size: 11px;
        line-height: 1;
      }
      .dbmcp-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 16px;
        align-items: start;
      }
      .dbmcp-grid.is-single {
        grid-template-columns: minmax(0, 1fr);
      }
      /* A card sits one step above the page: a hairline border, a faint lift and
         a slightly tighter header. Without the shadow every card and every row
         shared the same plane, which is what made the panel read as a wireframe
         rather than a surface. */
      .dbmcp-card {
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
        padding: 10px 14px 12px;
        min-width: 0;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      }
      .dbmcp-audit-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .dbmcp-audit {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 8px;
        padding: 4px 10px 5px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
        font-size: 13px;
        min-width: 0;
        box-sizing: border-box;
      }
      .dbmcp-audit-time {
        color: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        white-space: nowrap;
      }
      .dbmcp-audit-tool {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
        padding: 1px 7px;
        border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l1);
      }
      /* Who ran the call. Narrower than the tool pill: the tool name is the
         thing you scan for, the caller is the thing you check afterwards. */
      .dbmcp-audit-client {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-audit-ok {
        font-size: 12px;
      }
      .dbmcp-audit-ok.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-audit-ok.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      /* The statement is the payload of an audit row: the one thing you come to
         this tab to read. It used to be secondary-coloured text inline with the
         metadata, which made a query look like a caption. It now gets its own
         recessed block, ink on the base surface with a brand rule down the left,
         so the row reads as "these facts about that statement". */
      .dbmcp-audit-sql {
        display: block;
        width: 100%;
        margin-top: 1px;
        padding: 5px 9px;
        border-left: 3px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent);
        border-radius: 4px 8px 8px 4px;
        background: var(--dsw-alias-bg-base);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12.5px;
        line-height: 1.45;
        color: var(--dsw-alias-label-primary);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        tab-size: 2;
        user-select: text;
        /* The Host keeps up to 2000 characters of a statement. Rendering all of
           it inline would let one long query push the rest of the audit out of
           sight; the block scrolls instead, and the text stays selectable. */
        max-height: 240px;
        overflow-y: auto;
      }
      .dbmcp-audit-sql.is-error {
        border-left-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 65%, transparent);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, var(--dsw-alias-bg-base));
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-schema-wrap {
        display: flex;
        flex-direction: column;
        gap: 12px;
        /* The panel is a sidebar, so its own width — not the viewport's — decides
           whether two columns still fit. The wrapper is the container because an
           element cannot answer a query about its own size. */
        container-type: inline-size;
      }
      .dbmcp-schema {
        display: grid;
        grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
        gap: 18px;
        align-items: start;
      }
      /* One column when the panel is narrow: the rail keeps its own scroll box
         above the column list instead of squeezing the names to two characters. */
      @container (max-width: 560px) {
        .dbmcp-schema {
          grid-template-columns: minmax(0, 1fr);
        }
        .dbmcp-schema-groups {
          max-height: 300px;
        }
      }
      .dbmcp-schema-side {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        padding: 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-schema-main {
        min-width: 0;
      }
      /* Sub-view header row: where you came from, which connection it is, and
         the identifier to hand to the agent — all on one line. */
      .dbmcp-view-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        min-width: 0;
        margin-bottom: 12px;
      }
      .dbmcp-view-target {
        min-width: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        word-break: break-all;
      }
      .dbmcp-schema-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        font-size: 12px;
        font-weight: 600;
        color: var(--dsw-alias-label-secondary);
      }
      /* The qualified name of the open table: the same truncation rule as the
         rail, so a long name cannot push the column count out of the card. */
      .dbmcp-schema-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-schema-head .dbmcp-hint {
        flex: 0 0 auto;
      }
      .dbmcp-schema-tables {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 420px;
        overflow: auto;
      }
      .dbmcp-schema-groups {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: 460px;
        overflow: auto;
      }
      .dbmcp-schema-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .dbmcp-schema-group-head {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 5px 6px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        font-weight: 650;
        letter-spacing: 0.01em;
        text-align: left;
        cursor: pointer;
        transition: background 100ms ease;
      }
      .dbmcp-schema-group-head:hover {
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-schema-caret {
        width: 12px;
        flex: 0 0 auto;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-schema-group-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-schema-table {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        padding: 6px 8px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        transition: background 100ms ease, border-color 100ms ease;
      }
      /* A GaussDB catalog hands out names like
         global_plancache_status_global_recovery_status — longer than the rail is
         wide. The name gets the room, truncates with an ellipsis, and keeps the
         full value in its title; the kind pill never shrinks. */
      .dbmcp-schema-name {
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-schema-table .dbmcp-pill {
        flex: 0 0 auto;
      }
      .dbmcp-schema-table:hover {
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-schema-table.is-active {
        border-color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-schema-tablegrid {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        margin-top: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        overflow: hidden;
      }
      /* Five columns of column names, types and defaults do not fit a narrow
         sidebar. The wrapper scrolls rather than letting the rightmost columns
         fall off the panel edge; the table keeps a readable floor so the type
         column still wraps in words instead of one character per line. */
      .dbmcp-schema-tablewrap {
        overflow-x: auto;
        border-radius: 10px;
      }
      .dbmcp-schema-tablewrap .dbmcp-schema-tablegrid {
        min-width: 320px;
      }
      .dbmcp-schema-tablegrid th,
      .dbmcp-schema-tablegrid td {
        text-align: left;
        padding: 5px 9px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        vertical-align: top;
      }
      .dbmcp-schema-tablegrid tbody tr:hover {
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-schema-tablegrid tr:last-child td {
        border-bottom: none;
      }
      .dbmcp-schema-tablegrid th {
        font-weight: 600;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-schema-note {
        margin-top: 10px;
      }
      .dbmcp-mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      .dbmcp-endpoint {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin: 8px 0 12px;
      }
      /* The URL and its three controls share one line. The URL grows into the
         leftover space but keeps a basis wide enough to stay readable; when the
         panel is too narrow for both, the controls wrap underneath instead of
         squeezing the address into a stub. */
      .dbmcp-endpoint-url {
        flex: 1 1 260px;
        min-width: 0;
        padding: 6px 10px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        user-select: all;
      }
      /* The port used to be a bare box between two buttons with only an
         aria-label: on screen nothing said what it held. It carries a visible
         label now, so the row reads "copy · port 8765 · stop". */
      .dbmcp-port-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-port {
        flex: 0 0 78px;
        width: 78px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      /* The three controls travel as one group so they wrap as a unit under the
         URL rather than splitting across two lines. */
      .dbmcp-endpoint-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
      }
      .dbmcp-clients {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .dbmcp-client {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 9px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
        transition: border-color 120ms ease;
      }
      .dbmcp-client:hover {
        border-color: var(--dsw-alias-border-l2);
      }
      .dbmcp-client-main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1 1 auto;
      }
      .dbmcp-client-name {
        font-size: 13px;
        font-weight: 500;
      }
      .dbmcp-client-main .dbmcp-hint {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-tools-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin: 16px 0 8px;
        flex-wrap: wrap;
      }
      .dbmcp-tools-title {
        margin: 0;
        font-size: 13px;
        font-weight: 650;
        letter-spacing: -0.003em;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-tools {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .dbmcp-tool {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 4px 9px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 9px;
        background: var(--dsw-alias-bg-layer-1);
        cursor: pointer;
        min-width: 0;
        transition: border-color 120ms ease, background 120ms ease;
      }
      .dbmcp-tool:hover {
        border-color: var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-tool.is-off .dbmcp-tool-main {
        opacity: 0.6;
      }
      /* Same control as the global write switch, so "on" looks the same on both
         pages. It sits where the checkbox used to, and the row itself still
         toggles: the switch stops propagation, so a click on it is one flip. */
      .dbmcp-tool .dbmcp-switch {
        margin-left: 1px;
      }
      .dbmcp-limit-unit { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      /* One card holds the numbers and the long-text setting, one setting per
         line: a labelled control on top, its explanation underneath. */
      .dbmcp-render-fields {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .dbmcp-render-field {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }
      .dbmcp-render-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .dbmcp-render-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--dsw-alias-label-primary);
        white-space: nowrap;
      }
      .dbmcp-render-hint {
        margin: 0;
        font-size: 12px;
        line-height: 1.45;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-render-input {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .dbmcp-render-field .dbmcp-limit {
        width: 72px;
        padding: 2px 6px;
        font-size: 12px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .dbmcp-textpolicy-select {
        width: auto;
        min-width: 160px;
      }
      .dbmcp-tool-main {
        display: flex;
        flex-direction: column;
        gap: 0;
        min-width: 0;
        flex: 1 1 auto;
      }
      .dbmcp-tool-name {
        font-family: var(--dbmcp-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        font-size: 12px;
        line-height: 1.4;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-tool-desc {
        font-size: 12px;
        line-height: 1.35;
        color: var(--dsw-alias-label-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 10px;
        min-height: 22px;
      }
      .dbmcp-card-title {
        margin: 0;
        font-size: 13px;
        font-weight: 650;
        letter-spacing: -0.003em;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-empty {
        padding: 26px 10px;
        text-align: center;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
        line-height: 1.7;
      }
      .dbmcp-empty strong {
        display: block;
        margin-bottom: 6px;
        color: var(--dsw-alias-label-primary);
        font-weight: 600;
      }
      .dbmcp-empty p {
        margin: 0 auto;
        max-width: 34em;
      }
      .dbmcp-rows {
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 13px;
        line-height: 1.5;
      }
      /* The list is a table: an id, a name and the data sources are three
         different kinds of thing, and three columns read across far better than
         a line of run-on text. It opens expanded, because a limit is set by the
         agent and the panel is the only place it can be read — hiding it behind
         a click made it invisible to the person who has to check it. The box
         scrolls and the header sticks, so a long list never pushes the page
         around. */
      .dbmcp-scope-box {
        margin-top: 10px;
        max-height: 280px;
        overflow: auto;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
      }
      .dbmcp-scope-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      .dbmcp-scope-th {
        position: sticky;
        top: 0;
        z-index: 1;
        padding: 6px 10px;
        text-align: left;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.02em;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1);
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        white-space: nowrap;
      }
      .dbmcp-scope-th.is-id {
        width: 40%;
      }
      .dbmcp-scope-th.is-title {
        width: 28%;
      }
      .dbmcp-scope-th.is-sources {
        width: 26%;
      }
      .dbmcp-scope-th.is-action {
        width: 48px;
      }
      .dbmcp-scope-cell {
        padding: 7px 10px;
        vertical-align: top;
        min-width: 0;
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-scope-row + .dbmcp-scope-row .dbmcp-scope-cell {
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      /* A parked row is informational: the limit belongs to a conversation that
         is no longer in the list, so it is dimmed rather than given a remove
         button the user cannot act on here. */
      .dbmcp-scope-row.is-parked .dbmcp-scope-cell {
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-scope-cell.is-action {
        text-align: right;
        white-space: nowrap;
      }
      /* The id is shown in full: it is the only thing the user can match against
         their own logs, so it wraps instead of being shortened. */
      .dbmcp-scope-id {
        display: block;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        line-height: 1.45;
        color: var(--dsw-alias-label-secondary);
        word-break: break-all;
      }
      .dbmcp-scope-title {
        display: block;
        font-weight: 500;
        color: var(--dsw-alias-label-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-scope-none {
        color: var(--dsw-alias-label-secondary);
        font-style: italic;
      }
      .dbmcp-scope-sources {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .dbmcp-scope-chip {
        max-width: 100%;
        padding: 0 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        background: var(--dsw-alias-bg-layer-1);
        font-size: 11px;
        line-height: 1.6;
        color: var(--dsw-alias-label-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-scope-tag {
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        padding: 0 6px;
        white-space: nowrap;
      }
      .dbmcp-scope-note .dbmcp-scope-cell {
        padding: 8px 10px 4px;
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1);
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .dbmcp-scope-remove {
        padding: 0 5px;
        border: 0;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font-size: 14px;
        line-height: 1.4;
        cursor: pointer;
        border-radius: 5px;
      }
      .dbmcp-scope-remove:hover:not(:disabled) {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-scope-remove:disabled {
        cursor: default;
        opacity: 0.5;
      }
      .dbmcp-row {
        display: grid;
        grid-template-columns: 116px minmax(0, 1fr);
        column-gap: 10px;
        align-items: baseline;
        padding: 3px 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1);
        min-width: 0;
      }
      .dbmcp-k {
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-v {
        color: var(--dsw-alias-label-primary);
        word-break: break-all;
      }
      /* A value made of text plus a control needs its own breathing room. */
      .dbmcp-inline {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        min-width: 0;
      }
      .dbmcp-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        margin-right: 6px;
        background: var(--dsw-alias-state-idle-primary);
      }
      .dbmcp-dot.is-ok {
        background: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-dot.is-error {
        background: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-error {
        border: 1px solid var(--dsw-alias-state-error-primary);
        border-radius: 12px;
        padding: 16px 18px;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 1.6;
      }
      .dbmcp-error code {
        display: block;
        margin: 8px 0 12px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        word-break: break-all;
      }
      .dbmcp-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
        /* Rows answer their own width, not the viewport's: in a narrow panel the
           four row buttons used to squeeze into a two-character column. The
           query sits further down, after the rules it overrides. */
        container-type: inline-size;
      }
      /* Rows get a hover plane of their own so a pointer anywhere over the row
         knows which row it is about — the row is a big click target for the
         switch, and previously nothing moved under the cursor. */
      .dbmcp-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 6px 9px;
        font-size: 13px;
        transition: border-color 120ms ease, background 120ms ease;
      }
      .dbmcp-item:hover {
        border-color: var(--dsw-alias-border-l2);
      }
      .dbmcp-item-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      .dbmcp-grip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 26px;
        flex: 0 0 18px;
        padding: 0;
        border: none;
        background: transparent;
        cursor: grab;
        user-select: none;
        border-radius: 4px;
      }
      .dbmcp-grip-dots {
        display: block;
        width: 12px;
        height: 15px;
        background-image: radial-gradient(circle, currentColor 1.5px, transparent 1.6px);
        background-size: 6px 5px;
        background-position: 0 0;
        background-repeat: repeat;
        color: var(--dsw-alias-label-secondary);
        opacity: 0.45;
      }
      .dbmcp-grip:hover .dbmcp-grip-dots {
        opacity: 0.85;
      }
      .dbmcp-grip:active {
        cursor: grabbing;
      }
      .dbmcp-kind-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        flex: 0 0 26px;
        margin-top: 1px;
        border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
        font-size: 10px;
        font-weight: 650;
        line-height: 1;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        overflow: hidden;
      }
      .dbmcp-item.is-failed {
        border-color: var(--dsw-alias-state-error-primary);
        border-left-width: 3px;
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-2));
      }
      .dbmcp-item-failure {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-fail-tri {
        flex: 0 0 auto;
        font-size: 13px;
        line-height: 1;
      }
      .dbmcp-fail-text {
        flex: 1 1 260px;
        min-width: 0;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      /* The strip that carries the MCP state, the counts and the filter chips.
         It is the first thing under the tabs, so it gets the page's one tinted
         surface: a bordered box the same weight as a card just read as another
         card and pushed the list down without saying anything. It carries no
         bottom margin of its own — the grid gap already separates it from the
         list, and the two together left a dead band under the strip. */
      .dbmcp-status {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, var(--dsw-alias-bg-layer-1));
      }
      .dbmcp-status-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 12px;
        min-height: 24px;
      }
      .dbmcp-status-row.is-filters {
        gap: 12px;
      }
      .dbmcp-stats {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        padding: 2px 10px;
        border-radius: 999px;
        color: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .dbmcp-stat {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .dbmcp-stat::before {
        content: none;
      }
      .dbmcp-stat.is-ok::before,
      .dbmcp-stat.is-error::before {
        content: '';
        width: 6px;
        height: 6px;
        flex: 0 0 6px;
        border-radius: 50%;
        background: currentColor;
      }
      .dbmcp-stat.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-stat.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-stat-sep {
        width: 1px;
        height: 11px;
        background: var(--dsw-alias-border-l2);
      }
      .dbmcp-status-spacer {
        flex: 1 1 auto;
      }
      /* The global write switch lives in the list card's title row, right after
         the group form. It is a decision about these sources, so it sits with
         them rather than in the diagnostics page. */
      .dbmcp-list-write {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
        margin-left: 4px;
      }
      .dbmcp-list-write-label {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        white-space: nowrap;
      }
      .dbmcp-status-label {
        font-weight: 600;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-status-sep {
        width: 1px;
        height: 12px;
        background: var(--dsw-alias-border-l2);
      }
      .dbmcp-status-dot {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-status-dot::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }
      .dbmcp-status-dot.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-status-dot.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-chips {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .dbmcp-chip-icon {
        font-size: 12px;
        line-height: 1;
      }
      .dbmcp-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font-family: inherit;
        font-size: 12px;
        padding: 4px 13px;
        cursor: pointer;
        transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
      }
      .dbmcp-chip:hover {
        color: var(--dsw-alias-label-primary);
        border-color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-chip.is-active {
        background: var(--dsw-alias-label-primary);
        border-color: var(--dsw-alias-label-primary);
        color: var(--dsw-alias-bg-base);
      }
      .dbmcp-chip.is-warn {
        color: var(--dsw-alias-state-error-primary);
        border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);
      }
      .dbmcp-chip.is-warn.is-active {
        background: var(--dsw-alias-state-error-primary);
        border-color: var(--dsw-alias-state-error-primary);
        color: var(--dsw-alias-bg-base);
      }
      .dbmcp-chip-count {
        opacity: 0.7;
      }
      .dbmcp-status-search {
        flex: 0 0 auto;
        width: 300px;
        max-width: 100%;
      }
      .dbmcp-status-search .dbmcp-input {
        width: 100%;
      }
      .dbmcp-item.is-selected {
        border-color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-item-pick {
        display: flex;
        align-items: center;
        padding-top: 2px;
        cursor: pointer;
      }
      .dbmcp-item-pick input {
        width: 14px;
        height: 14px;
        accent-color: var(--dsw-alias-brand-primary);
        cursor: pointer;
      }
      .dbmcp-groups {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .dbmcp-group {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .dbmcp-group-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 2px;
      }
      .dbmcp-group-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary);
        letter-spacing: 0.02em;
      }
      .dbmcp-card-head > .dbmcp-pill {
        margin-left: auto;
      }
      .dbmcp-list-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin: 2px 0 8px;
      }
      .dbmcp-list-head .dbmcp-card-title {
        margin-right: 4px;
        font-size: 13px;
        font-weight: 650;
      }
      .dbmcp-list-spacer {
        flex: 1 1 auto;
      }
      .dbmcp-fold {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 18px;
        flex: 0 0 14px;
        padding: 0;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dbmcp-fold::before {
        content: '';
        display: block;
        width: 0;
        height: 0;
        border-style: solid;
        border-width: 4.5px 0 4.5px 6.5px;
        border-color: transparent transparent transparent currentColor;
        transition: transform 130ms ease;
      }
      .dbmcp-fold:hover {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-fold.is-open::before {
        transform: rotate(90deg);
      }
      .dbmcp-card-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: 4px;
      }
      .dbmcp-group-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: auto;
      }
      .dbmcp-group-edit {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 1 auto;
      }
      .dbmcp-group-edit .dbmcp-input {
        width: 170px;
      }
      .dbmcp-group-edit .dbmcp-btn,
      .dbmcp-item-rename .dbmcp-btn {
        flex: 0 0 auto;
        white-space: nowrap;
        padding: 3px 10px;
      }
      .dbmcp-group.is-over {
        outline: 1px dashed var(--dsw-alias-brand-primary);
        outline-offset: 3px;
        border-radius: 6px;
      }
      .dbmcp-item.is-dragging {
        opacity: 0.55;
      }
      /* A checked block drags as one; the tint tells the user the whole block
         is in hand, not just the row under the cursor. */
      .dbmcp-list.is-dragging-block .dbmcp-item.is-dragging {
        opacity: 0.7;
        border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
      }
      .dbmcp-item.is-drop-before {
        box-shadow: 0 -2px 0 0 var(--dsw-alias-brand-primary);
      }
      .dbmcp-item.is-drop-after {
        box-shadow: 0 2px 0 0 var(--dsw-alias-brand-primary);
      }
      .dbmcp-item.is-taken {
        opacity: 0.6;
      }
      .dbmcp-item {
        cursor: default;
      }
      .dbmcp-item.is-selected {
        cursor: default;
      }
      .dbmcp-group-create {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .dbmcp-group-create .dbmcp-input {
        width: 170px;
        max-width: 220px;
      }
      .dbmcp-group-pick {
        width: 14px;
        height: 14px;
        accent-color: var(--dsw-alias-brand-primary);
        cursor: pointer;
      }
      .dbmcp-bulk {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 6px;
        padding: 4px 8px;
        border: 1px solid var(--dsw-alias-brand-primary);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-bulk-count {
        font-size: 12px;
        font-weight: 600;
        color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-bulk-group {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1 1 220px;
        min-width: 220px;
      }
      .dbmcp-bulk-group .dbmcp-input {
        flex: 1 1 auto;
        min-width: 120px;
      }
      .dbmcp-bulk .dbmcp-btn {
        flex: 0 0 auto;
        white-space: nowrap;
      }
      .dbmcp-item-main {
        min-width: 0;
        flex: 1 1 auto;
      }
      .dbmcp-item-name {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        flex-wrap: wrap;
      }
      .dbmcp-item-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        min-width: 0;
        margin-top: 3px;
      }
      .dbmcp-item-target {
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        word-break: break-all;
        margin-top: 2px;
      }
      .dbmcp-item-meta > .dbmcp-item-target {
        margin-top: 0;
      }
      .dbmcp-item-name > .is-renamable,
      .dbmcp-group-name.is-renamable {
        cursor: text;
      }
      .dbmcp-item-rename {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .dbmcp-item-rename .dbmcp-input {
        flex: 0 0 200px;
        width: 200px;
      }
      .dbmcp-item-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
        /* The buttons keep their size and the name gives way instead: letting
           this box shrink broke the four of them across two lines whenever a
           row carried a long identifier. */
        flex: 0 0 auto;
      }
      /* Narrow rows wrap: the name takes the first line, the four actions drop to
         a second one and start from the left. It has to live here, after the rules
         it overrides — a query above them loses on source order. */
      @container (max-width: 520px) {
        .dbmcp-item-row {
          flex-wrap: wrap;
          /* space-between would strand the checkbox and the badge at the far
             edge, a whole row away from the name they belong to. */
          justify-content: flex-start;
        }
        .dbmcp-item-actions {
          width: 100%;
          justify-content: flex-start;
          padding-left: 2px;
        }
      }
      .dbmcp-probe {
        margin-top: 6px;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-probe.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-probe.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      /* A notice is the panel's voice, so it is tinted: a plain bordered box the
         same colour as everything else was easy to read past. */
      .dbmcp-notice {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-left: 3px solid var(--dsw-alias-state-success-primary);
        border-radius: 10px;
        padding: 9px 12px;
        margin-bottom: 12px;
        font-size: 13px;
        line-height: 1.5;
        background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 7%, var(--dsw-alias-bg-layer-2));
      }
      .dbmcp-notice.is-error {
        border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, var(--dsw-alias-border-l1));
        border-left-color: var(--dsw-alias-state-error-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-2));
      }
      .dbmcp-form {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 12px 16px;
        align-items: start;
        font-size: 13px;
      }
      .dbmcp-form.is-compact {
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 14px 18px;
        max-width: 860px;
      }
      .dbmcp-form.is-compact .dbmcp-paste .dbmcp-check {
        flex: none;
        white-space: nowrap;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-form.is-page {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        max-width: none;
        box-sizing: border-box;
        font-size: 13px;
        /* The panel is a sidebar, so its width is the form's width — not the
           viewport's. Two- and three-column rows are declared below and folded
           back to one column by the query at the end of this block. */
        container-type: inline-size;
      }
      .dbmcp-form-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
      }
      .dbmcp-form-section.is-two,
      .dbmcp-form-section.is-three {
        display: grid;
        gap: 16px;
        align-items: start;
      }
      .dbmcp-form-section.is-two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .dbmcp-form-section.is-three {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .dbmcp-form-cell {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .dbmcp-form-head {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 20px;
      }
      .dbmcp-form-head .dbmcp-check {
        margin-left: auto;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-form-label {
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        font-weight: 500;
      }
      .dbmcp-form-note {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-form-mark {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        margin-top: 1px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 50%;
        font-size: 9px;
        font-style: normal;
        line-height: 1;
        text-transform: lowercase;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-tag {
        margin-left: auto;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent);
        border-radius: 6px;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
        color: var(--dsw-alias-brand-primary);
        font-size: 11px;
        line-height: 1;
        padding: 4px 8px;
        white-space: nowrap;
      }
      .dbmcp-form.is-page .dbmcp-input,
      .dbmcp-form.is-page .dbmcp-select {
        padding: 8px 10px;
      }
      .dbmcp-form.is-page .dbmcp-input::placeholder {
        color: var(--dsw-alias-label-secondary);
        opacity: 0.75;
      }
      .dbmcp-form-inner {
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 2px 2px 0;
      }
      .dbmcp-advanced.is-page {
        background: transparent;
        padding: 0;
      }
      .dbmcp-advanced.is-page > summary {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        font-size: 13px;
        transition: border-color 120ms ease, background 120ms ease;
      }
      .dbmcp-advanced.is-page > summary:hover {
        border-color: var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-advanced.is-page[open] > summary {
        margin-bottom: 16px;
      }
      .dbmcp-advanced-title {
        color: var(--dsw-alias-label-primary);
        font-weight: 500;
      }
      .dbmcp-advanced-hint {
        margin-left: auto;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        font-weight: 400;
      }
      .dbmcp-readonly {
        display: flex;
        flex-direction: column;
        gap: 4px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 14px 16px;
      }
      .dbmcp-readonly .dbmcp-check {
        font-size: 13px;
      }
      .dbmcp-readonly .dbmcp-hint {
        padding-left: 24px;
      }
      /* The DDL switch in the source form. It used to live inside a bordered
         policy block with the writable-schemas field; that field is gone, so the
         switch keeps the same box as the read-only block for visual weight. */
      .dbmcp-policy {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 14px 16px;
      }
      .dbmcp-help {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 50%;
        font-size: 9px;
        line-height: 1;
        color: var(--dsw-alias-label-secondary);
        cursor: help;
      }
      .dbmcp-btn.is-save {
        min-width: 104px;
        padding: 8px 18px;
      }
      .dbmcp-form-foot-hint {
        margin-left: auto;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-cell {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .dbmcp-cell.dbmcp-wide {
        grid-column: 1 / -1;
      }
      .dbmcp-label {
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 1.4;
      }
      .dbmcp-paste {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dbmcp-paste .dbmcp-input {
        flex: 1 1 auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      .dbmcp-parse {
        flex: none;
        font-size: 12px;
        white-space: nowrap;
      }
      .dbmcp-parse.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-parse.is-bad {
        color: var(--dsw-alias-state-warn-primary);
      }
      .dbmcp-advanced {
        grid-column: 1 / -1;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 10px 14px 14px;
      }
      .dbmcp-advanced > summary {
        cursor: pointer;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        padding: 2px 0;
      }
      .dbmcp-advanced > summary:hover {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-advanced[open] > summary {
        margin-bottom: 10px;
      }
      .dbmcp-input,
      .dbmcp-select {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        padding: 6px 9px;
        transition: border-color 120ms ease, box-shadow 120ms ease;
      }
      .dbmcp-input:hover:not(:disabled),
      .dbmcp-select:hover:not(:disabled) {
        border-color: var(--dsw-alias-border-l2);
      }
      /* A focus ring, not just a colour change: the border alone disappeared
         among the other borders on a form this dense. */
      .dbmcp-input:focus,
      .dbmcp-select:focus {
        outline: none;
        border-color: var(--dsw-alias-brand-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);
      }
      .dbmcp-input.is-invalid {
        border-color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-input.is-invalid:focus {
        border-color: var(--dsw-alias-state-error-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent);
      }
      .dbmcp-hint {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        line-height: 1.4;
      }
      /* The tools list is the one switch on this page that an outside client
         never feels, so it says so where the switch is rather than only in the
         safety page. A hanging rule keeps it readable as a caveat. */
      .dbmcp-hint.is-scope {
        margin: 8px 0 10px;
        padding-left: 8px;
        border-left: 2px solid var(--dsw-alias-border-l2);
      }
      .dbmcp-check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }
      .dbmcp-form-foot {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 12px;
      }
      .dbmcp-scan {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .dbmcp-scan-file {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        word-break: break-all;
      }
      .dbmcp-scan-bar {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin: 0 0 14px;
        padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-scan-bar .dbmcp-input {
        flex: 1 1 240px;
        min-width: 180px;
      }
      .dbmcp-scan-bar .dbmcp-btn {
        margin-left: auto;
        flex: 0 0 auto;
      }
      /* The select-all box belongs to the bar, not to the rows: it sits first in
         the reading order of the actions and dims out when the filter leaves
         nothing that could be picked. */
      .dbmcp-scan-all {
        flex: 0 0 auto;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        user-select: none;
      }
      .dbmcp-scan-all.is-off,
      .dbmcp-scan-all:has(input:disabled) {
        cursor: default;
        opacity: 0.55;
      }
      .dbmcp-scan-all .dbmcp-hint {
        font-variant-numeric: tabular-nums;
      }
      /* Narrow sidebar: two- and three-column rows have no room to sit side by
         side, and before this query they simply ran past the right edge — the
         labels and inputs on the right were cut off with no scrollbar to say
         so. Fold them to one column instead. */
      @container (max-width: 560px) {
        .dbmcp-form-section.is-two,
        .dbmcp-form-section.is-three {
          grid-template-columns: minmax(0, 1fr);
        }
        .dbmcp-form-head {
          flex-wrap: wrap;
          row-gap: 4px;
        }
      }
    `
