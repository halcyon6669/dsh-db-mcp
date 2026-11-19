
    /** Re-render on locale switch / late dictionary registration. */
    function useLocale() {
      const service = localeService
      const subscribe = React.useCallback(
        (onChange) => (typeof service?.subscribe === 'function' ? service.subscribe(onChange) : () => {}),
        [service],
      )
      const getSnapshot = React.useCallback(
        () => (typeof service?.getSnapshot === 'function' ? service.getSnapshot() : 0),
        [service],
      )
      React.useSyncExternalStore(subscribe, getSnapshot)
      return service
    }

    /* ---------- theme-aware solid surfaces ----------
       A custom theme may paint translucent surfaces over a wallpaper: cards then
       dissolve into the picture and labels lose contrast. Re-derive solid
       equivalents of the alias tokens from the active palette and overlay them
       on the panel subtree, so the panel reads the same on white, black and
       wallpapered themes. */

    let themeService = null
    const themeSubs = new Set()
    const NO_PALETTE = Object.freeze({})
    let paletteCache = NO_PALETTE
    let paletteKey = ''

    function parseColor(value) {
      if (typeof value !== 'string') return null
      const text = value.trim()
      let match = /^#([0-9a-f]{3,8})$/i.exec(text)
      if (match) {
        let hex = match[1]
        if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((part) => part + part).join('')
        if (hex.length !== 6 && hex.length !== 8) return null
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
        }
      }
      match = /^rgba?\(([^)]+)\)$/i.exec(text)
      if (!match) return null
      const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      if (parts.length < 3 || parts.slice(0, 3).some((item) => !Number.isFinite(item))) return null
      const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1
      return { r: parts[0], g: parts[1], b: parts[2], a: Math.max(0, Math.min(1, alpha)) }
    }

    function composite(color, base) {
      const alpha = Math.max(0, Math.min(1, color.a))
      return {
        r: color.r * alpha + base.r * (1 - alpha),
        g: color.g * alpha + base.g * (1 - alpha),
        b: color.b * alpha + base.b * (1 - alpha),
        a: 1,
      }
    }

    function mixColor(from, to, weight) {
      return {
        r: from.r + (to.r - from.r) * weight,
        g: from.g + (to.g - from.g) * weight,
        b: from.b + (to.b - from.b) * weight,
        a: 1,
      }
    }

    function drift(a, b) {
      return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
    }

    function toCss(color) {
      const channel = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
      return '#' + channel(color.r) + channel(color.g) + channel(color.b)
    }

    function paletteOf(snapshot) {
      const active = (snapshot && snapshot.active) || {}
      const tokens = active.tokens || {}
      const dark = active.colorScheme === 'dark'
      const floor = dark ? { r: 12, g: 12, b: 14, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }
      const token = (name) => parseColor(tokens[name])

      const baseRaw = token('--dsw-alias-bg-base')
      const canvas = baseRaw ? composite(baseRaw, floor) : floor

      const layerRaw = token('--dsw-alias-bg-layer-1')
      let surface = layerRaw ? composite(layerRaw, canvas) : canvas
      const layer2Raw = token('--dsw-alias-bg-layer-2')
      let surface2 = layer2Raw ? composite(layer2Raw, surface) : surface

      const inkRaw = token('--dsw-alias-label-primary') || (dark ? { r: 232, g: 232, b: 236, a: 1 } : { r: 26, g: 26, b: 30, a: 1 })
      const ink = composite(inkRaw, canvas)

      /* On a pure black or pure white scheme the theme's layers collapse onto the
         canvas; lift them a little so cards still separate from the page. */
      if (drift(surface, canvas) < 8) surface = mixColor(canvas, ink, dark ? 0.14 : 0.05)
      if (drift(surface2, surface) < 8) surface2 = mixColor(surface, ink, dark ? 0.2 : 0.07)

      const secondRaw = token('--dsw-alias-label-secondary')
      const ink2 = secondRaw ? composite(secondRaw, surface) : mixColor(surface, ink, 0.45)

      const lineRaw = token('--dsw-alias-border-l1')
      let line = lineRaw ? composite(lineRaw, surface) : mixColor(surface, ink, 0.16)
      if (drift(line, surface) < 10) line = mixColor(surface, ink, 0.18)
      const line2Raw = token('--dsw-alias-border-l2')
      let line2 = line2Raw ? composite(line2Raw, surface2) : mixColor(surface2, ink, 0.24)
      if (drift(line2, surface2) < 10) line2 = mixColor(surface2, ink, 0.26)

      const accent = (name, fallback) => {
        const raw = token(name)
        if (!raw) return fallback
        return raw.a >= 0.999 ? raw : composite(raw, surface)
      }

      return {
        '--dsw-alias-bg-base': toCss(canvas),
        '--dsw-alias-bg-layer-1': toCss(surface),
        '--dsw-alias-bg-layer-2': toCss(surface2),
        '--dsw-alias-bg-overlay': toCss(surface2),
        '--dsw-alias-border-l1': toCss(line),
        '--dsw-alias-border-l2': toCss(line2),
        '--dsw-alias-label-primary': toCss(ink),
        '--dsw-alias-label-secondary': toCss(ink2),
        '--dsw-alias-brand-primary': toCss(accent('--dsw-alias-brand-primary', { r: 36, g: 123, b: 191, a: 1 })),
        '--dsw-alias-state-success-primary': toCss(accent('--dsw-alias-state-success-primary', { r: 38, g: 158, b: 92, a: 1 })),
        '--dsw-alias-state-warn-primary': toCss(accent('--dsw-alias-state-warn-primary', { r: 191, g: 128, b: 20, a: 1 })),
        '--dsw-alias-state-error-primary': toCss(accent('--dsw-alias-state-error-primary', { r: 213, g: 68, b: 68, a: 1 })),
        '--dsw-alias-state-idle-primary': toCss(accent('--dsw-alias-state-idle-primary', mixColor(surface, ink, 0.4))),
      }
    }

    function paletteSnapshot() {
      const service = themeService
      if (!service || typeof service.getTheme !== 'function') return NO_PALETTE
      let snapshot = null
      try {
        snapshot = service.getTheme()
      } catch (error) {
        return NO_PALETTE
      }
      const key = `${(snapshot && snapshot.revision) || ''}:${(snapshot && snapshot.preference) || ''}`
      if (key !== paletteKey) {
        paletteKey = key
        paletteCache = paletteOf(snapshot)
      }
      return paletteCache
    }

    function subscribeTheme(onChange) {
      themeSubs.add(onChange)
      return () => {
        themeSubs.delete(onChange)
      }
    }

    function useThemePalette() {
      return React.useSyncExternalStore(subscribeTheme, paletteSnapshot, paletteSnapshot)
    }

    function fmt(text, values) {
      return String(text).replace(/\{(\w+)\}/g, (all, key) => (values && values[key] !== undefined ? String(values[key]) : all))
    }

    async function apiGet(path) {
      const response = await fetch(API + path, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data) {
        const payload = data || null
        const message = (payload && (payload.error || payload.message)) || `HTTP ${response.status}`
        const error = new Error(String(message))
        error.payload = payload
        throw error
      }
      return data
    }

    async function apiPost(path, body) {
      const response = await fetch(API + path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data) {
        const message = (data && data.error) || `HTTP ${response.status}`
        const error = new Error(message)
        error.payload = data
        throw error
      }
      return data
    }

    /** Sidebar icon: a stacked-database glyph drawn with currentColor. */
    function SidebarIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('ellipse', { cx: 12, cy: 5.5, rx: 7.5, ry: 3 }),
        h('path', { d: 'M4.5 5.5v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6' }),
        h('path', { d: 'M4.5 11.5v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6' }),
      )
    }

    /* The header is skipped entirely when the card carries no title, aside or
       actions. The list card passes title: null and draws its own header, and a
       header that renders empty still took its min-height plus its margin —
       thirty pixels of nothing above the list, measured. */
    function Card(props) {
      const head =
        props.title == null && props.aside == null && props.actions == null
          ? null
          : h(
              'header',
              { className: 'dbmcp-card-head' },
              props.title == null ? null : h('h2', { className: 'dbmcp-card-title' }, props.title),
              props.aside == null ? null : h('span', { className: 'dbmcp-pill' }, props.aside),
              props.actions == null ? null : h('div', { className: 'dbmcp-card-actions' }, props.actions),
            )
      return h('section', { className: 'dbmcp-card' }, head, props.children)
    }

    /** One card per line, matching the audit entries below it. */
    function Row(props) {
      return h(
        'div',
        { className: 'dbmcp-row' },
        h('span', { key: 'k', className: 'dbmcp-k' }, props.label),
        h('div', { key: 'v', className: 'dbmcp-v' }, props.children),
      )
    }

    function Field(props) {
      return h(
        'div',
        { className: 'dbmcp-cell' + (props.wide ? ' dbmcp-wide' : '') },
        h('label', { className: 'dbmcp-label' }, props.label),
        props.children,
        props.hint ? h('div', { className: 'dbmcp-hint' }, props.hint) : null,
      )
    }

    /**
     * A track switch, for the one setting on a source row that can be flipped.
     *
     * The row used to carry a line of identical bordered pills, and the only
     * clickable one was a status word among status words: nothing said where to
     * press until the pointer happened to rest on it. A track reads as something
     * to operate before it is touched, and the state word stays beside it so the
     * direction is spelled out rather than inferred from the knob's position.
     */
    function Switch(props) {
      const on = props.checked === true
      return h(
        'button',
        {
          type: 'button',
          className: 'dbmcp-switch' + (on ? ' is-on' : ''),
          role: 'switch',
          'aria-checked': on ? 'true' : 'false',
          title: props.title || undefined,
          disabled: props.disabled === true,
          onClick: (event) => {
            event.stopPropagation()
            if (props.disabled === true) return
            props.onChange(!on)
          },
        },
        h(
          'span',
          { className: 'dbmcp-switch-track', 'aria-hidden': 'true' },
          h('span', { className: 'dbmcp-switch-knob' }),
        ),
        props.label == null ? null : h('span', null, props.label),
      )
    }

    /**
     * The `readOnly` value to POST when the row's writable switch is clicked.
     *
     * The switch is checked when the source is writable (`readOnly === false`),
     * but the API takes a `readOnly` flag, so the two move in opposite
     * directions: a click must send the opposite of the stored value. 0.9.9
     * shipped the un-inverted value, which re-posted the state already stored —
     * the banner said "is read-only now" and the switch looked dead. Kept here
     * as a pure function so the inversion is pinned by a unit test.
     */
    function nextReadOnly(source) {
      // A read-only source (true) POSTs false; a writable one (false) POSTs true.
      return source.readOnly === false
    }

    function TextInput(props) {
      return h('input', {
        className: 'dbmcp-input' + (props.invalid ? ' is-invalid' : ''),
        type: props.type || 'text',
        value: props.value == null ? '' : props.value,
        placeholder: props.placeholder || '',
        autoComplete: props.autoComplete || 'off',
        autoFocus: props.autoFocus === true,
        spellCheck: false,
        disabled: props.disabled === true,
        title: props.title || undefined,
        'aria-invalid': props.invalid ? 'true' : undefined,
        onChange: (event) => props.onChange(event.target.value),
        onKeyDown: props.onKeyDown || undefined,
      })
    }

    function stripQuotes(value) {
      return String(value == null ? '' : value).trim().replace(/^["']|["']$/g, '')
    }

    function slugId(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)
    }

    function baseConfig(kind) {
      return {
        file: '',
        host: kind === 'sqlite' ? '' : 'localhost',
        port: DEFAULT_PORTS[kind] || '',
        database: '',
        user: '',
        schema: '',
        serviceName: '',
        sid: '',
        charset: kind === 'mysql' ? 'utf8mb4' : '',
        sslMode: '',
      }
    }

    function fileStem(file) {
      const name = String(file || '').split(/[\\/]/).pop() || ''
      return name.replace(/\.(db|sqlite3?|db3)$/i, '')
    }

    function decodePart(value) {
      try {
        return decodeURIComponent(value || '')
      } catch (error) {
        return String(value || '')
      }
    }

    function parseQueryString(search) {
      const out = {}
      const text = String(search || '').replace(/^\?/, '')
      if (!text) return out
      text.split('&').forEach((pair) => {
        if (!pair) return
        const index = pair.indexOf('=')
        const key = decodePart(index < 0 ? pair : pair.slice(0, index)).trim().toLowerCase()
        if (!key) return
        out[key] = index < 0 ? '' : decodePart(pair.slice(index + 1))
      })
      return out
    }

    function fromUrl(kind, body) {
      // `new URL` reads `#` and `?` inside a password as fragment and query
      // markers, and rejects a comma-separated node list, so the string is
      // split by hand: credentials up to the last `@`, then the node list up to
      // the first `/`, then the path, then the query.
      let rest = body.startsWith('//') ? body.slice(2) : body
      const infoAt = rest.lastIndexOf('@')
      let info = ''
      if (infoAt >= 0) {
        info = rest.slice(0, infoAt)
        rest = rest.slice(infoAt + 1)
      }
      const slash = rest.indexOf('/')
      const authority = slash >= 0 ? rest.slice(0, slash) : rest
      const tail = slash >= 0 ? rest.slice(slash) : ''
      const mark = tail.indexOf('?')
      const path = mark >= 0 ? tail.slice(0, mark) : tail
      const query = parseQueryString(mark >= 0 ? tail.slice(mark) : '')
      const database = decodePart(path.replace(/^\/+/, ''))

      const nodes = authority
        .split(',')
        .map((piece) => /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(piece.trim()))
        .filter(Boolean)
        .map((match) => ({
          host: match[1].replace(/^\[|\]$/g, ''),
          port: match[2] ? Number(match[2]) : null,
        }))
      if (!nodes.length) return { ok: false, code: 'url' }

      const config = baseConfig(kind)
      config.host = nodes[0].host
      // Form fields hold strings; the node list keeps numbers for the driver.
      config.port = nodes[0].port ? String(nodes[0].port) : DEFAULT_PORTS[kind] || ''
      if (nodes.length > 1) {
        config.hosts = nodes.map((node) => ({ host: node.host, port: node.port || Number(config.port) || null }))
        config.host = nodes.map((node) => node.host).join(',')
      }
      const colon = info.indexOf(':')
      config.user = decodePart(colon >= 0 ? info.slice(0, colon) : info) || query.user || query.username || ''
      if (kind === 'oracle') {
        config.serviceName = database || query.servicename || query.service || ''
        config.sid = query.sid || ''
      } else {
        config.database = database || query.database || query.dbname || ''
      }
      if (query.sslmode) config.sslMode = query.sslmode
      if (query.charset || query.characterencoding) config.charset = query.charset || query.characterencoding
      if (query.schema || query.currentschema || query.searchpath) {
        config.schema = query.schema || query.currentschema || query.searchpath
      }
      // The password stays raw here; `canonicalUrl` never renders it back.
      const password = colon >= 0 ? decodePart(info.slice(colon + 1)) : ''
      const name = kind === 'oracle' ? config.serviceName || config.sid : config.database || config.host
      return { ok: true, kind, config, password, name: name || kind }
    }

    function parseTns(text) {
      const config = baseConfig('oracle')
      /**
       * `DESCRIPTION_LIST` wraps `ADDRESS_LIST` wraps `ADDRESS`, so the values are
       * found by scanning for the named parameter instead of matching a shape.
       * Quotes are optional in TNS, and `PORT` may sit next to its `HOST`.
       */
      const param = (name) => {
        const match = new RegExp(`\\(\\s*${name}\\s*=\\s*([^()]+?)\\s*\\)`, 'i').exec(text)
        return match ? stripQuotes(match[1].trim()) : ''
      }
      config.host = param('HOST') || 'localhost'
      config.port = param('PORT') || '1521'
      config.serviceName = param('SERVICE_NAME')
      config.sid = param('SID')
      if (!config.serviceName && !config.sid) return { ok: false, code: 'tns' }
      return { ok: true, kind: 'oracle', config, password: '', name: config.serviceName || config.sid }
    }

    function parseOracleThin(text) {
      const body = String(text || '').replace(/^@/, '').trim()
      const config = baseConfig('oracle')
      if (body.startsWith('//')) {
        const match = /^\/\/([^/:]+)(?::(\d+))?\/(.+)$/.exec(body)
        if (!match) return { ok: false, code: 'url' }
        config.host = match[1]
        config.port = match[2] || '1521'
        config.serviceName = match[3].split(/[?#]/)[0]
      } else {
        const match = /^([^:]+)(?::(\d+))?:(.+)$/.exec(body)
        if (!match) return { ok: false, code: 'url' }
        config.host = match[1]
        config.port = match[2] || '1521'
        const target = match[3].split(/[?#]/)[0]
        if (target.includes('/') || target.includes('.')) config.serviceName = target
        else config.sid = target
      }
      if (!config.serviceName && !config.sid) return { ok: false, code: 'url' }
      return { ok: true, kind: 'oracle', config, password: '', name: config.serviceName || config.sid }
    }

    function parseSqliteFile(text) {
      let file = stripQuotes(String(text || '').replace(/^file:/i, ''))
      if (/^\/+[A-Za-z]:/.test(file)) file = file.replace(/^\/+/, '')
      else if (/^\/{2,}/.test(file)) file = '/' + file.replace(/^\/+/, '')
      if (!file || file === '/') return { ok: false, code: 'file' }
      const config = baseConfig('sqlite')
      config.file = file
      return { ok: true, kind: 'sqlite', config, password: '', name: fileStem(file) || 'sqlite' }
    }

    /**
     * Accepts a DSN, a JDBC URL, an Oracle TNS descriptor, or a SQLite file path.
     * Returns { ok, kind, config, password, name } so the form can fill itself.
     */
    function parseConnectionText(input) {
      const raw = stripQuotes(input)
      if (!raw) return { ok: false, code: 'empty' }
      if (/^\(\s*DESCRIPTION/i.test(raw)) return parseTns(raw)

      const lower = raw.toLowerCase()
      if (lower.startsWith('jdbc:')) {
        const rest = raw.slice(5)
        const restLower = rest.toLowerCase()
        if (restLower.startsWith('sqlite:')) return parseSqliteFile(rest.slice('sqlite:'.length))
        if (restLower.startsWith('oracle:thin:@')) {
          const body = rest.slice('oracle:thin:@'.length)
          return /^\s*\(/.test(body) ? parseTns(body) : parseOracleThin(body)
        }
        if (restLower.startsWith('postgresql://')) return fromUrl('postgres', rest.slice('postgresql:'.length))
        if (restLower.startsWith('opengauss://')) return fromUrl('gauss', rest.slice('opengauss:'.length))
        if (restLower.startsWith('gaussdb://')) return fromUrl('gauss', rest.slice('gaussdb:'.length))
        if (restLower.startsWith('mysql://')) return fromUrl('mysql', rest.slice('mysql:'.length))
        if (restLower.startsWith('mariadb://')) return fromUrl('mysql', rest.slice('mariadb:'.length))
        return { ok: false, code: 'jdbc' }
      }

      const scheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(raw)
      if (scheme) {
        const name = scheme[1].toLowerCase()
        const body = '//' + scheme[2]
        if (name === 'sqlite' || name === 'sqlite3' || name === 'file') return parseSqliteFile(body.slice(2))
        if (name === 'oracle') return fromUrl('oracle', body)
        if (name === 'postgres' || name === 'postgresql' || name === 'psql') return fromUrl('postgres', body)
        if (name === 'opengauss' || name === 'gaussdb' || name === 'gauss') return fromUrl('gauss', body)
        if (name === 'mysql' || name === 'mariadb') return fromUrl('mysql', body)
        return { ok: false, code: 'scheme' }
      }

      if (/^@?\s*\(/.test(raw)) return parseTns(raw)
      if (raw.startsWith('@') || /^[\w.-]+:\d{2,5}[:/]/.test(raw)) return parseOracleThin(raw)
      if (!raw.includes('://') && /\.(db|sqlite3?|db3)$/i.test(raw)) return parseSqliteFile(raw)
      if (/^([a-z]:[\\/]|\\\\|\/)/i.test(raw)) return parseSqliteFile(raw)
      return { ok: false, code: 'unrecognized' }
    }

    /** Append -2, -3, ... until the id is free; the registry requires unique ids. */
    function uniqueId(base, taken) {
      const seed = slugId(base) || 'source'
      const used = new Set((taken || []).map((value) => String(value || '').toLowerCase()))
      if (!used.has(seed)) return seed
      for (let index = 2; index < 100; index += 1) {
        const candidate = `${seed.slice(0, 28)}-${index}`
        if (!used.has(candidate)) return candidate
      }
      return seed
    }

    function formatUptime(ms) {
      const total = Math.max(0, Math.floor((ms || 0) / 1000))
      if (total < 60) return `${total}s`
      const minutes = Math.floor(total / 60)
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      return `${hours}h ${minutes % 60}m`
    }

    /** Tool descriptions run to several paragraphs; a list row shows the first sentence. */
    function firstLine(value) {
      const text = String(value || '').replace(/\s+/g, ' ').trim()
      if (!text) return ''
      const stop = text.search(/[.!?]\s/)
      const head = stop > 20 ? text.slice(0, stop + 1) : text
      return head.length > 140 ? `${head.slice(0, 137)}…` : head
    }

    /** UTC offset of the viewer's clock, e.g. "UTC+08:00". */
    function zoneLabel() {
      const offset = -new Date().getTimezoneOffset()
      const sign = offset >= 0 ? '+' : '-'
      const abs = Math.abs(offset)
      const pad = (part) => String(part).padStart(2, '0')
      return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    }

    /**
     * The audit log keeps UTC ISO stamps so the file stays comparable across
     * machines; the panel shows them on the viewer's clock instead. Rows can span
     * days and weeks, so the date travels with the time.
     */
    function localClock(value) {
      const text = String(value || '')
      const at = Date.parse(text)
      if (!Number.isFinite(at)) {
        // A stamp we cannot parse is still worth showing: an ISO string keeps its
        // date and time, anything else is printed as it came.
        return text.length >= 19 ? text.slice(0, 19).replace('T', ' ') : text
      }
      const date = new Date(at)
      const pad = (part) => String(part).padStart(2, '0')
      const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    /** Full local timestamp with the zone, used as the hover title of an audit row. */
    function localStamp(value) {
      const at = Date.parse(String(value || ''))
      if (!Number.isFinite(at)) return String(value || '')
      return `${localClock(value)} ${zoneLabel()}`
    }

    function pythonLabel(t, python) {
      if (!python) return '-'
      if (python.ok) return `${python.command} ${python.version}`
      return `${t('state.failed')} · ${t('python.missing')}`
    }

    function emptyDraft() {
      return {
        id: '',
        name: '',
        group: '',
        kind: 'sqlite',
        readOnly: true,
        config: baseConfig('sqlite'),
        // DDL is a separate permission from writing rows: `create table` and
        // `drop table` change what everybody else reads, so they are opted into.
        allowDdl: false,
        password: '',
        hasSecret: false,
        secretBroken: false,
        nameTouched: false,
        idTouched: false,
      }
    }

    function draftFromSource(source) {
      const config = (source && source.config) || {}
      const draft = emptyDraft()
      const fallback = baseConfig(source.kind || 'sqlite')
      draft.id = source.id
      draft.name = source.name || ''
      draft.group = (source && source.group) || ''
      draft.kind = source.kind || 'sqlite'
      draft.readOnly = source.readOnly !== false
      draft.hasSecret = source.hasSecret === true
      draft.secretBroken = source.secretBroken === true
      draft.allowDdl = source.allowDdl === true
      draft.config = {
        ...fallback,
        file: config.file || '',
        host: config.host || fallback.host,
        port: config.port == null ? fallback.port : String(config.port),
        database: config.database || '',
        user: config.user || '',
        schema: config.schema || '',
        serviceName: config.serviceName || '',
        sid: config.sid || '',
        charset: config.charset || fallback.charset,
        sslMode: config.sslMode || '',
      }
      return draft
    }

    /** Render the current draft back to a connection string (never includes the password). */
    function canonicalUrl(draft) {
      const config = draft.config || {}
      if (draft.kind === 'sqlite') return config.file || ''
      const user = config.user ? `${config.user}@` : ''
      const port = config.port ? `:${config.port}` : ''
      const host = config.host || 'localhost'
      if (draft.kind === 'oracle') {
        // Service name and SID are different address forms: only the SID form
        // round-trips through `jdbc:oracle:thin:@host:port:sid`.
        if (config.serviceName) return `oracle://${user}${host}${port}/${config.serviceName}`
        if (config.sid && config.port) return `jdbc:oracle:thin:@${host}${port}:${config.sid}`
        return ''
      }
      // openGauss URLs carry the scheme the driver expects, and every node.
      if (draft.kind === 'gauss') {
        if (!config.database) return ''
        const nodes = Array.isArray(config.hosts) && config.hosts.length > 1
          ? config.hosts.map((node) => `${node.host}${node.port ? `:${node.port}` : ''}`).join(',')
          : `${host}${port}`
        return `opengauss://${user}${nodes}/${config.database}`
      }
      return config.database ? `${draft.kind}://${user}${host}${port}/${config.database}` : ''
    }

    function SourceForm(props) {
      const t = props.t
      const [draft, setDraft] = React.useState(props.draft)
      const [raw, setRaw] = React.useState(() => (props.editing ? canonicalUrl(props.draft) : ''))
      const [parsed, setParsed] = React.useState(null)
      const [saveSecret, setSaveSecret] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [probing, setProbing] = React.useState(false)
      const [probeResult, setProbeResult] = React.useState(null)
      const [error, setError] = React.useState(null)
      // Required fields stay unmarked until the first save attempt, so the form
      // does not open in a red state.
      const [missing, setMissing] = React.useState({})
      const editing = props.editing

      const patch = (changes) => setDraft((prev) => ({ ...prev, ...changes }))
      const patchConfig = (changes) => setDraft((prev) => ({ ...prev, config: { ...prev.config, ...changes } }))

      const fillFrom = (result) => {
        setDraft((prev) => {
          const next = { ...prev, kind: result.kind, config: { ...prev.config, ...result.config } }
          if (result.password) next.password = result.password
          if (result.name && (!prev.nameTouched || !prev.name.trim())) next.name = result.name
          if (!editing && (!prev.idTouched || !prev.id.trim())) {
            next.id = uniqueId(result.name || result.kind, props.takenIds)
          }
          return next
        })
      }

      const onRawChange = (value) => {
        setRaw(value)
        if (!value.trim()) {
          setParsed(null)
          // Deleting a recognised connection string also drops what it filled
          // in; editing keeps the identifier and group the source already owns.
          setDraft((prev) => {
            const fresh = emptyDraft()
            if (!editing) return fresh
            return {
              ...fresh,
              id: prev.id,
              nameTouched: prev.nameTouched,
              idTouched: prev.idTouched,
              group: prev.group,
              readOnly: prev.readOnly,
            }
          })
          setMissing({})
          setProbeResult(null)
          return
        }
        const result = parseConnectionText(value)
        setParsed({ ok: result.ok, code: result.code || null })
        if (result.ok) fillFrom(result)
      }

      const changeKind = (kind) => {
        setDraft((prev) => ({
          ...prev,
          kind,
          config: { ...baseConfig(kind), file: prev.config.file, user: prev.config.user, database: prev.kind === 'oracle' ? '' : prev.config.database },
        }))
      }

      const submit = async () => {
        setError(null)
        // The connection string, the user and the password are what a source
        // cannot work without, so they are checked before anything is sent.
        const needsCredentials = draft.kind !== 'sqlite'
        const gaps = {
          url: !raw.trim(),
          user: needsCredentials && !String(draft.config.user || '').trim(),
          password: needsCredentials && !editing && !draft.hasSecret && !draft.password.trim(),
        }
        setMissing(gaps)
        if (gaps.url || gaps.user || gaps.password) {
          setError(t('form.requiredHint'))
          return
        }
        const needsTarget =
          draft.kind === 'oracle' ? !draft.config.serviceName.trim() && !draft.config.sid.trim() : !draft.config.database.trim()
        const incomplete = draft.kind === 'sqlite' ? !draft.config.file.trim() : !draft.config.host.trim() || needsTarget
        if (incomplete) {
          setError(t('form.invalid'))
          return
        }
        setBusy(true)
        try {
          const body = {
            id: draft.id.trim(),
            name: draft.name.trim() || draft.id || t('form.untitled'),
            group: (draft.group || '').trim(),
            kind: draft.kind,
            readOnly: draft.readOnly,
            config: { ...draft.config, port: draft.config.port ? Number(draft.config.port) : undefined },
            allowDdl: draft.allowDdl === true,
            password: saveSecret && draft.password !== '' ? draft.password : undefined,
          }
          if (!body.id) delete body.id
          const data = await apiPost('/datasources/save', body)
          props.onSaved(data.datasource)
        } catch (caught) {
          const existingId = caught && caught.payload && caught.payload.existingId
          setError(existingId ? fmt(t('form.duplicate'), { name: existingId }) : String((caught && caught.message) || caught))
        } finally {
          setBusy(false)
        }
      }

      /** Probes the draft as typed, before it is saved. */
      const testDraft = async () => {
        setError(null)
        setProbeResult(null)
        const needsTarget =
          draft.kind === 'oracle' ? !String(draft.config.serviceName || '').trim() && !String(draft.config.sid || '').trim() : !String(draft.config.database || '').trim()
        const incomplete = draft.kind === 'sqlite' ? !String(draft.config.file || '').trim() : !String(draft.config.host || '').trim() || needsTarget
        if (incomplete) {
          setError(t('form.invalid'))
          return
        }
        setProbing(true)
        try {
          const body = {
            kind: draft.kind,
            config: { ...draft.config, port: draft.config.port ? Number(draft.config.port) : undefined },
          }
          if (draft.id && props.editing) body.id = draft.id.trim()
          if (draft.password !== '') body.password = draft.password
          const data = await apiPost('/datasources/test', body)
          setProbeResult({
            ok: Boolean(data.probe && data.probe.ok),
            message: (data.probe && data.probe.message) || t('form.probeUnknown'),
            ms: data.probe && data.probe.latencyMs,
          })
        } catch (caught) {
          setProbeResult({ ok: false, message: String((caught && caught.message) || caught) })
        } finally {
          setProbing(false)
        }
      }

      const manual = []
      if (draft.kind === 'sqlite') {
        manual.push(
          h(
            Field,
            { key: 'file', wide: true, label: t('form.file'), hint: t('form.fileHint') },
            h(TextInput, { value: draft.config.file, onChange: (value) => patchConfig({ file: value }) }),
          ),
        )
      } else {
        manual.push(
          h(
            Field,
            { key: 'host', label: t('form.host') },
            h(TextInput, { value: draft.config.host, onChange: (value) => patchConfig({ host: value }) }),
          ),
          h(
            Field,
            { key: 'port', label: t('form.port') },
            h(TextInput, {
              value: draft.config.port,
              placeholder: DEFAULT_PORTS[draft.kind] || '',
              onChange: (value) => patchConfig({ port: value.replace(/[^\d]/g, '') }),
            }),
          ),
        )
        if (draft.kind === 'oracle') {
          manual.push(
            h(
              Field,
              { key: 'serviceName', label: t('form.serviceName') },
              h(TextInput, { value: draft.config.serviceName, onChange: (value) => patchConfig({ serviceName: value }) }),
            ),
            h(
              Field,
              { key: 'sid', label: t('form.sid'), hint: t('form.sidHint') },
              h(TextInput, { value: draft.config.sid, onChange: (value) => patchConfig({ sid: value }) }),
            ),
          )
        } else {
          manual.push(
            h(
              Field,
              { key: 'database', label: t('form.database') },
              h(TextInput, { value: draft.config.database, onChange: (value) => patchConfig({ database: value }) }),
            ),
          )
        }
        manual.push(
          h(
            Field,
            { key: 'schema', label: t('form.schema'), hint: t('form.schemaHint') },
            h(TextInput, { value: draft.config.schema, onChange: (value) => patchConfig({ schema: value }) }),
          ),
        )
      }
      if (draft.kind === 'postgres' || draft.kind === 'gauss') {
        manual.push(
          h(
            Field,
            { key: 'sslMode', label: t('form.sslMode') },
            h(
              'select',
              {
                className: 'dbmcp-select',
                value: draft.config.sslMode || '',
                onChange: (event) => patchConfig({ sslMode: event.target.value }),
              },
              h('option', { value: '' }, 'default'),
              h('option', { value: 'disable' }, 'disable'),
              h('option', { value: 'prefer' }, 'prefer'),
              h('option', { value: 'require' }, 'require'),
            ),
          ),
        )
      }
      if (draft.kind === 'mysql') {
        manual.push(
          h(
            Field,
            { key: 'charset', label: t('form.charset') },
            h(TextInput, { value: draft.config.charset, onChange: (value) => patchConfig({ charset: value }) }),
          ),
        )
      }

      const note = (text, extra) =>
        h(
          'p',
          { className: 'dbmcp-form-note' },
          h('span', { className: 'dbmcp-form-mark', 'aria-hidden': 'true' }, 'i'),
          h('span', null, text),
          extra || null,
        )

      return h(
        'div',
        { className: 'dbmcp-form is-page' },
        error
          ? h(
              'div',
              { className: 'dbmcp-notice is-error' },
              h('span', null, error),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setError(null) }, '×'),
            )
          : null,
        h(
          'section',
          { className: 'dbmcp-form-section' },
          h(
            'div',
            { className: 'dbmcp-form-head' },
            h('span', { className: 'dbmcp-form-label' }, t('form.paste')),
            h('span', { className: 'dbmcp-tag' }, t('form.smart')),
          ),
          h(TextInput, {
            value: raw,
            onChange: (value) => {
              onRawChange(value)
              if (missing.url) setMissing((prev) => ({ ...prev, url: false }))
            },
            invalid: missing.url === true,
            placeholder: t('form.pastePlaceholder'),
            autoFocus: !editing,
          }),
          note(
            editing ? t('form.pasteHintEdit') : t('form.pasteHintShort'),
            parsed
              ? h(
                  'span',
                  { className: 'dbmcp-parse ' + (parsed.ok ? 'is-ok' : 'is-bad') },
                  parsed.ok ? t('form.parseOk') : t('form.parseBad'),
                )
              : null,
          ),
        ),
        h(
          'section',
          { className: 'dbmcp-form-section is-two' },
          h(
            'div',
            { className: 'dbmcp-form-cell' },
            h('label', { className: 'dbmcp-form-label' }, t('form.user')),
            h(TextInput, {
              value: draft.config.user,
              placeholder: t('form.userPlaceholder'),
              onChange: (value) => {
                patchConfig({ user: value })
                if (missing.user) setMissing((prev) => ({ ...prev, user: false }))
              },
              invalid: missing.user === true,
              autoComplete: 'off',
            }),
          ),
          h(
            'div',
            { className: 'dbmcp-form-cell' },
            h(
              'div',
              { className: 'dbmcp-form-head' },
              h('label', { className: 'dbmcp-form-label' }, t('form.password')),
              h(
                'label',
                { className: 'dbmcp-check' },
                h('input', {
                  type: 'checkbox',
                  checked: saveSecret,
                  onChange: (event) => setSaveSecret(event.target.checked),
                }),
                h('span', null, t('form.savePassword')),
              ),
            ),
            h(TextInput, {
              type: 'password',
              value: draft.password,
              autoComplete: 'new-password',
              invalid: missing.password === true,
              placeholder: draft.hasSecret ? '********' : t('form.passwordEmpty'),
              onChange: (value) => {
                patch({ password: value })
                if (missing.password && value.trim()) setMissing((prev) => ({ ...prev, password: false }))
              },
            }),
            draft.hasSecret ? h('span', { className: 'dbmcp-hint' }, t('form.passwordKeep')) : null,
            draft.secretBroken ? h('span', { className: 'dbmcp-hint is-warn' }, t('form.schemaBroken')) : null,
          ),
        ),
        h(
          'details',
          { className: 'dbmcp-advanced is-page' },
          h(
            'summary',
            null,
            h('span', { className: 'dbmcp-advanced-title' }, t('form.more')),
            h('span', { className: 'dbmcp-advanced-hint' }, t('form.moreHint')),
          ),
          h(
            'div',
            { className: 'dbmcp-form-inner' },
            h(
              'div',
              { className: 'dbmcp-form-section is-three' },
              h(
                Field,
                { key: 'name', label: t('form.name'), hint: t('form.optional') },
                h(TextInput, {
                  value: draft.name,
                  placeholder: draft.id || '',
                  onChange: (value) => patch({ name: value, nameTouched: true }),
                }),
              ),
              h(
                Field,
                { key: 'group', label: t('form.group'), hint: t('form.groupHint') },
                h(TextInput, {
                  value: draft.group || '',
                  placeholder: t('group.unassigned'),
                  onChange: (value) => patch({ group: value }),
                }),
              ),
              h(
                Field,
                { key: 'id', label: t('form.id'), hint: editing ? null : t('form.idHint') },
                h(TextInput, {
                  value: draft.id,
                  disabled: Boolean(editing),
                  placeholder: 'prod-main',
                  onChange: (value) =>
                    patch({ id: value.toLowerCase().replace(/[^a-z0-9-]/g, ''), idTouched: true }),
                }),
              ),
            ),
            h(
              'div',
              { className: 'dbmcp-form-section is-two' },
              h(
                Field,
                { key: 'kind', label: t('form.kind') },
                h(
                  'select',
                  {
                    className: 'dbmcp-select',
                    value: draft.kind,
                    disabled: Boolean(editing),
                    onChange: (event) => changeKind(event.target.value),
                  },
                  KINDS.map((kind) => h('option', { key: kind, value: kind }, kind)),
                ),
              ),
            ),
            h('div', { className: 'dbmcp-form-section is-two' }, manual),
            h(
              'div',
              { className: 'dbmcp-policy' },
              // DDL is its own switch, the same shape as the writable switch on
              // a row: a source can take `insert` and still be one whose tables
              // belong to somebody else, so shape-changing statements opt in.
              h(Switch, {
                checked: draft.allowDdl === true,
                label: t('form.allowDdl'),
                title: t('form.allowDdlHint'),
                onChange: (next) => patch({ allowDdl: next }),
              }),
            ),
            h(
              'div',
              { className: 'dbmcp-readonly' },
              h(
                'label',
                { className: 'dbmcp-check' },
                h('input', {
                  type: 'checkbox',
                  checked: draft.readOnly,
                  onChange: (event) => patch({ readOnly: event.target.checked }),
                }),
                h('span', null, t('form.readOnly')),
                h('span', { className: 'dbmcp-help', title: t('form.readOnlyHint'), 'aria-hidden': 'true' }, '?'),
              ),
              h('span', { className: 'dbmcp-hint' }, t('form.readOnlyHint')),
            ),
          ),
        ),
        probeResult
          ? h(
              'div',
              { className: 'dbmcp-notice' + (probeResult.ok ? '' : ' is-error') },
              h(
                'span',
                null,
                probeResult.ok
                  ? fmt(t('form.probeOk'), { name: draft.name || draft.id || draft.kind, ms: probeResult.ms == null ? '—' : probeResult.ms })
                  : `${t('form.probeFail')} ${probeResult.message}`,
              ),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setProbeResult(null) }, '×'),
            )
          : null,
        h(
          'div',
          { className: 'dbmcp-form-foot' },
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn', disabled: busy || probing, onClick: testDraft },
            probing ? t('action.testing') : t('action.test'),
          ),
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-primary is-save', disabled: busy || probing, onClick: submit },
            busy ? t('action.saving') : t('action.save'),
          ),
          h('span', { className: 'dbmcp-form-foot-hint' }, t('form.autoApply')),
        ),
      )
    }

    /** Tables grouped by schema; the group order is stable and alphabetical. */
    /** Brand colours keep the four engines readable without an icon font. */
const KIND_BADGE = {
  postgres: { label: 'PG', color: '#336791' },
  gauss: { label: 'GS', color: '#00a3a3' },
  mysql: { label: 'MY', color: '#00758f' },
  oracle: { label: 'OR', color: '#c74634' },
  sqlite: { label: 'SQ', color: '#003b5c' },
}

const kindBadge = (kind) => {
  const key = String(kind || '').trim().toLowerCase()
  if (KIND_BADGE[key]) return KIND_BADGE[key]
  const label = key ? key.slice(0, 2).toUpperCase() : '?'
  return { label, color: 'var(--dsw-alias-label-secondary)' }
}

/**
 * The identifier is the value every MCP tool takes as its `datasource`
 * argument, which is why it is a labelled chip and not a tail on the target
 * line: click it to copy the exact token the user has to type in chat.
 */
function IdChip(props) {
  const { t, id, copied, onCopy } = props
  if (!id) return null
  return h(
    'button',
    {
      type: 'button',
      className: 'dbmcp-idchip' + (copied ? ' is-copied' : ''),
      title: copied ? t('sources.idCopied') : `${id} — ${t('sources.idChipHint')}`,
      'aria-label': `${t('sources.idChip')}: ${id}`,
      onClick: (event) => {
        event.stopPropagation()
        if (typeof onCopy === 'function') onCopy(id)
      },
    },
    h('span', { className: 'dbmcp-idchip-key' }, t('sources.idChip')),
    h('code', { className: 'dbmcp-idchip-value' }, id),
    copied ? h('span', { className: 'dbmcp-idchip-mark', 'aria-hidden': 'true' }, '✓') : null,
  )
}

/** Clipboard write that still works when the async API is blocked by the host shell. */
async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      /* fall through to the textarea trick */
    }
  }
  const holder = document.createElement('textarea')
  holder.value = text
  holder.setAttribute('readonly', 'readonly')
  holder.style.position = 'fixed'
  holder.style.top = '-1000px'
  holder.style.opacity = '0'
  document.body.appendChild(holder)
  holder.select()
  const done = document.execCommand('copy')
  document.body.removeChild(holder)
  if (!done) throw new Error('the clipboard is not available')
}

/** A stored probe that ended in failure is what the red row is about. */
const probeFailed = (source) => Boolean(source && source.lastProbe && source.lastProbe.ok === false)

/** Older registries still carry `host:port / database`; a pasted report wants no padding. */
const reportTarget = (source) => {
  const raw = String((source && source.target) || '').trim()
  if (!raw) return '-'
  return raw.replace(/\s+\/\s+/g, '/')
}

/** Whole failure report for one source, so it can be pasted straight into an issue. */
const probeReport = (source, plugin) => {
  const probeInfo = (source && source.lastProbe) || {}
  return [
    `datasource: ${source.name || source.id}`,
    `id: ${source.id}`,
    `kind: ${source.kind}`,
    `target: ${reportTarget(source)}`,
    probeInfo.at ? `at: ${localStamp(probeInfo.at)}` : '',
    `error: ${probeInfo.message || '-'}`,
    plugin ? `plugin: ${plugin.name} ${plugin.version}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const sourceMatches = (source, needle) => {
  const text = String(needle || '').trim().toLowerCase()
  if (!text) return true
  const hay = [source.name, source.id, source.kind, source.target, source.group, source.lastProbe && source.lastProbe.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(text)
}

/**
 * Section order for the list. "Ungrouped" is a bucket like any other, but it is
 * not a declared group, so it has to be added here — otherwise filtering on it
 * renders nothing.
 */
function sectionOrder(groupNames, sources, narrowing) {
  const names = groupNames.slice()
  const loose = sources.some((source) => !String(source.group || '').trim())
  if (loose) names.push('')
  if (!narrowing) return names.indexOf('') === -1 ? [...names, ''] : names
  return names.filter((name) => sources.some((source) => String(source.group || '').trim() === name))
}

/**
 * The order a drop should produce.
 *
 * A group of checked rows drags as one block: the block keeps its own relative
 * order and lands whole — above `target`, or below it when `after`. No row in
 * the block is left behind at the old position.
 */
function reorderForDrop(order, moving, target, after) {
  const block = order.filter((id) => moving.includes(id) && id !== target)
  if (block.length === 0) return order.slice()
  const rest = order.filter((id) => !block.includes(id))
  const at = rest.indexOf(target)
  if (at < 0) return rest.concat(block)
  const cut = at + (after ? 1 : 0)
  return rest.slice(0, cut).concat(block, rest.slice(cut))
}

function groupTables(tables) {
  const buckets = new Map()
  for (const table of tables || []) {
    const key = table.schema || ''
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(table)
  }
  return Array.from(buckets.entries()).sort((left, right) => (left[0] || '').localeCompare(right[0] || ''))
}

    function tableMatches(table, needle) {
      if (!needle) return true
      return (
        String(table.name || '').toLowerCase().includes(needle) ||
        String(table.schema || '').toLowerCase().includes(needle)
      )
    }

    function connectionMatches(item, needle) {
      if (!needle) return true
      return [item.name, item.id, item.target, item.user, item.kind].some((value) =>
        String(value || '').toLowerCase().includes(needle),
      )
    }

    function ImportView(props) {
      const t = props.t
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [selected, setSelected] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [filter, setFilter] = React.useState('')

      React.useEffect(() => {
        let alive = true
        apiGet('/dbeaver/scan')
          .then((data) => {
            if (alive) setState({ status: 'ready', data, error: null })
          })
          .catch((error) => {
            if (alive) setState({ status: 'error', data: null, error: String((error && error.message) || error) })
          })
        return () => {
          alive = false
        }
      }, [])

      const existing = props.existingIds || []
      const all = state.data ? state.data.sources : []

      const toggle = (id) =>
        setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))

      const runImport = async () => {
        setBusy(true)
        try {
          const data = await apiPost('/dbeaver/import', { ids: selected })
          props.onImported(data)
        } catch (error) {
          setState((prev) => ({ ...prev, error: String((error && error.message) || error) }))
        } finally {
          setBusy(false)
        }
      }

      const needle = filter.trim().toLowerCase()
      const files = (all || [])
        .map((source) => ({ ...source, connections: (source.connections || []).filter((item) => connectionMatches(item, needle)) }))
        .filter((source) => source.connections.length > 0)
      const totalConnections = (all || []).reduce((sum, source) => sum + (source.connections || []).length, 0)
      const visibleConnections = files.reduce((sum, source) => sum + source.connections.length, 0)

      /* Only what the filter currently shows, and only what can actually be
         imported: a row that is already in the registry can never be picked, so
         it must not hold the button in a half-selected state. */
      const pickable = files.reduce(
        (ids, source) =>
          ids.concat(
            source.connections
              .filter((item) => item.importable && item.alreadyImported !== true && !existing.includes(item.id))
              .map((item) => item.id),
          ),
        [],
      )
      const allPicked = pickable.length > 0 && pickable.every((id) => selected.includes(id))
      const toggleAll = () =>
        setSelected((prev) =>
          allPicked ? prev.filter((id) => !pickable.includes(id)) : Array.from(new Set([...prev, ...pickable])),
        )

      if (state.status === 'loading') return h('div', { className: 'dbmcp-empty' }, t('loading'))
      if (state.status === 'error') {
        return h('div', { className: 'dbmcp-error' }, h('div', null, state.error))
      }

      return h(
        'div',
        { className: 'dbmcp-scan' },
        // The bar stays put while the list scrolls, so the action never leaves
        // the viewport no matter how many connections DBeaver knows about.
        h(
          'div',
          { className: 'dbmcp-scan-bar' },
          h(TextInput, {
            value: filter,
            placeholder: t('import.searchPlaceholder'),
            label: t('import.searchPlaceholder'),
            onChange: setFilter,
          }),
          h('span', { className: 'dbmcp-hint' }, fmt(t('import.matches'), { n: visibleConnections, total: totalConnections })),
          h(
            'label',
            { className: 'dbmcp-check dbmcp-scan-all' + (pickable.length === 0 ? ' is-off' : '') },
            h('input', {
              type: 'checkbox',
              checked: allPicked,
              disabled: pickable.length === 0,
              onChange: toggleAll,
            }),
            h('span', null, t('import.selectAll')),
            pickable.length > 0 ? h('span', { className: 'dbmcp-hint' }, `(${pickable.length})`) : null,
          ),
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-primary', disabled: busy || selected.length === 0, onClick: runImport },
            busy ? t('action.importing') : `${t('action.importSelected')} (${selected.length})`,
          ),
        ),
        h('p', { className: 'dbmcp-sub' }, t('import.body')),
        all.length === 0
          ? h(
              'div',
              { className: 'dbmcp-empty' },
              h('strong', null, t('import.empty')),
              h(
                'p',
                null,
                state.data.roots.join(' · '),
              ),
            )
          : visibleConnections === 0
            ? h('div', { className: 'dbmcp-empty' }, t('import.noMatch'))
            : files.map((source) =>
              h(
                'div',
                { key: source.file },
                h(Card, { title: t('import.file'), aside: source.credentialsFound ? t('import.credentialsFound') : t('import.credentialsMissing') },
                  h('div', { className: 'dbmcp-scan-file' }, source.file),
                  h(
                    'ul',
                    { className: 'dbmcp-list', style: { marginTop: '10px' } },
                    source.connections.map((item) => {
                      const duplicate = item.alreadyImported === true
                      const taken = duplicate || existing.includes(item.id)
                      return h(
                        'li',
                        { className: 'dbmcp-item' + (duplicate ? ' is-taken' : ''), key: item.id },
                        h(
                          'div',
                          { className: 'dbmcp-item-main' },
                          h(
                            'div',
                            { className: 'dbmcp-item-name' },
                            item.importable
                              ? h('input', {
                                  type: 'checkbox',
                                  checked: selected.includes(item.id),
                                  disabled: taken,
                                  title: duplicate ? t('import.already') : undefined,
                                  onChange: () => toggle(item.id),
                                })
                              : null,
                            h('span', null, item.name || item.id),
                            item.kind ? h('span', { className: 'dbmcp-pill' }, item.kind) : null,
                            duplicate ? h('span', { className: 'dbmcp-pill' }, t('import.already')) : null,
                          ),
                          h(
                            'div',
                            { className: 'dbmcp-item-target' },
                            duplicate
                              ? t('import.alreadyAs').replace('{name}', item.duplicateName || item.duplicateId || '')
                              : [item.importable ? item.target : item.reason, item.user].filter(Boolean).join(' · '),
                          ),
                          duplicate
                            ? null
                            : h(
                                'div',
                                { className: 'dbmcp-item-target' },
                                item.importable ? (item.hasPassword ? t('sources.hasPassword') : t('sources.noPassword')) : '',
                              ),
                        ),
                      )
                    }),
                  ),
                ),
              ),
            ),
      )
    }

    /** P7: read-only structure browser. Only lists tables and columns. */
    function SchemaView(props) {
      const { t, source, onBack } = props
      const [tables, setTables] = React.useState(null)
      // A table is identified by schema + name: the same name can live in two
      // schemas, and describe_table needs the schema to find the right one.
      const [picked, setPicked] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(true)
      const [filter, setFilter] = React.useState('')
      const [collapsed, setCollapsed] = React.useState({})

      const refresh = React.useCallback(async () => {
        const data = await apiGet(`/schema?datasource=${encodeURIComponent(source.id)}`)
        if (!data.ok) {
          const failure = data.error || {}
          const error = new Error(failure.message || t('schema.error'))
          error.payload = failure
          throw error
        }
        return data
      }, [source.id, t])

      React.useEffect(() => {
        let alive = true
        setBusy(true)
        ;(async () => {
          try {
            const data = await refresh()
            if (alive) {
              setTables(data.tables || [])
              setError(null)
            }
          } catch (failure) {
            if (!alive) return
            const payload = (failure && failure.payload) || {}
            setError(payload.hint ? `${payload.error || failure.message} — ${payload.hint}` : String((failure && failure.message) || failure))
            setTables([])
          } finally {
            if (alive) setBusy(false)
          }
        })()
        return () => {
          alive = false
        }
      }, [refresh])

      const pickedSchema = picked ? picked.schema || '' : ''
      const pickedName = picked ? picked.name : ''

      React.useEffect(() => {
        if (!picked) {
          setDetail(null)
          return undefined
        }
        let alive = true
        setDetail({ loading: true })
        ;(async () => {
          try {
            const schemaPart = picked.schema ? `&schema=${encodeURIComponent(picked.schema)}` : ''
            const data = await apiGet(
              `/schema?datasource=${encodeURIComponent(source.id)}&table=${encodeURIComponent(picked.name)}${schemaPart}`,
            )
            if (alive) setDetail(data)
          } catch (failure) {
            const payload = (failure && failure.payload) || {}
            if (alive) setDetail({ ok: false, error: { message: payload.error || String((failure && failure.message) || failure) } })
          }
        })()
        return () => {
          alive = false
        }
      }, [pickedSchema, pickedName, source.id])

      const groups = React.useMemo(() => groupTables(tables), [tables])

      const needle = filter.trim().toLowerCase()
      const visible = groups
        .map(([schema, items]) => [schema, items.filter((table) => tableMatches(table, needle))])
        .filter(([, items]) => items.length > 0)
      const visibleCount = visible.reduce((sum, [, items]) => sum + items.length, 0)
      const groupLabel = (schema) => (schema ? schema : t('schema.defaultSchema'))

      const side = h(
        'div',
        { className: 'dbmcp-schema-side' },
        h(
          'div',
          { className: 'dbmcp-schema-head' },
          h('span', null, fmt(t('schema.tables'), { n: tables ? tables.length : 0 })),
          needle ? h('span', { className: 'dbmcp-hint' }, fmt(t('schema.matching'), { n: visibleCount })) : null,
        ),
        h(TextInput, {
          value: filter,
          placeholder: t('schema.search'),
          label: t('schema.search'),
          onChange: setFilter,
        }),
        !tables || tables.length === 0
          ? h('div', { className: 'dbmcp-empty' }, t('schema.empty'))
          : visibleCount === 0
            ? h('div', { className: 'dbmcp-empty' }, t('schema.noMatch'))
            : h(
                'div',
                { className: 'dbmcp-schema-groups' },
                visible.map(([schema, items]) => {
                  const closed = collapsed[schema] === true
                  return h(
                    'section',
                    { key: `group-${schema || '_'}`, className: 'dbmcp-schema-group' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dbmcp-schema-group-head',
                        'aria-expanded': closed ? 'false' : 'true',
                        onClick: () => setCollapsed({ ...collapsed, [schema]: !closed }),
                      },
                      h('span', { className: 'dbmcp-schema-caret', 'aria-hidden': 'true' }, closed ? '▸' : '▾'),
                      h('span', { className: 'dbmcp-schema-group-name', title: groupLabel(schema) }, groupLabel(schema)),
                      h('span', { className: 'dbmcp-hint' }, String(items.length)),
                    ),
                    closed
                      ? null
                      : h(
                          'ul',
                          { className: 'dbmcp-schema-tables' },
                          items.map((table) => {
                            const active = pickedName === table.name && pickedSchema === (table.schema || '')
                            return h(
                              'li',
                              { key: `${table.schema || ''}.${table.name}` },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'dbmcp-schema-table' + (active ? ' is-active' : ''),
                                  onClick: () => setPicked({ schema: table.schema || '', name: table.name }),
                                },
                                h('span', { className: 'dbmcp-schema-name', title: table.name }, table.name),
                                table.type ? h('span', { className: 'dbmcp-pill' }, table.type) : null,
                              ),
                            )
                          }),
                        ),
                  )
                }),
              ),
      )

      let content
      if (busy && !tables) {
        content = h('div', { className: 'dbmcp-empty' }, t('schema.loading'))
      } else if (error) {
        content = h('div', { className: 'dbmcp-error' }, h('div', null, t('schema.error')), h('code', null, error))
      } else {
        content = h(
          'div',
          { className: 'dbmcp-schema' },
          side,
          h(
            'div',
            { className: 'dbmcp-schema-main' },
            !picked
              ? h('div', { className: 'dbmcp-empty' }, t('schema.pick'))
              : detail && detail.loading
                ? h('div', { className: 'dbmcp-empty' }, t('schema.loading'))
                : detail && detail.ok === false
                  ? h(
                      'div',
                      { className: 'dbmcp-error' },
                      h('code', null, (detail.error && detail.error.message) || t('schema.error')),
                    )
                  : detail && detail.ok
                    ? h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'dbmcp-schema-head' },
                          h(
                            'span',
                            { className: 'dbmcp-schema-title', title: pickedSchema ? `${pickedSchema}.${detail.table}` : detail.table },
                            pickedSchema ? `${pickedSchema}.${detail.table}` : detail.table,
                          ),
                          h('span', { className: 'dbmcp-hint' }, fmt(t('schema.columns'), { n: (detail.columns || []).length })),
                        ),
                        h(
                          'div',
                          { className: 'dbmcp-schema-tablewrap' },
                          h(
                            'table',
                            { className: 'dbmcp-schema-tablegrid' },
                            h(
                              'thead',
                              null,
                              h(
                                'tr',
                                null,
                                h('th', null, t('schema.column')),
                                h('th', null, t('schema.type')),
                                h('th', null, t('schema.nullable')),
                                h('th', null, t('schema.default')),
                                h('th', null, t('schema.pk')),
                              ),
                            ),
                            h(
                              'tbody',
                              null,
                              (detail.columns || []).map((column) =>
                                h(
                                  'tr',
                                  { key: column.name },
                                  h('td', null, column.name),
                                  h('td', { className: 'dbmcp-mono' }, column.type || ''),
                                  h('td', null, column.nullable ? t('schema.yes') : t('schema.no')),
                                  h('td', { className: 'dbmcp-mono' }, column.default === null || column.default === undefined ? '' : String(column.default)),
                                  h('td', null, column.primaryKey ? '●' : ''),
                                ),
                              ),
                            ),
                          ),
                        ),
                        h('div', { className: 'dbmcp-hint dbmcp-schema-note' }, t('schema.readonlyNote')),
                      )
                    : null,
          ),
        )
      }

      return h('div', { className: 'dbmcp-schema-wrap' }, content)
    }

    function crumbLabel(t, view) {
      if (view.mode === 'schema' && view.source) return view.source.name || view.source.id
      if (view.mode === 'create') return t('action.new')
      if (view.mode === 'edit' && view.source) return fmt(t('form.edit'), { name: view.source.name || view.source.id })
      if (view.mode === 'import') return t('action.import')
      return t('panel.title')
    }

    function Breadcrumbs({ t, trail }) {
      const items = []
      trail.forEach((step, index) => {
        if (index > 0) items.push(h('span', { key: `sep-${index}`, className: 'dbmcp-crumb-sep' }, '/'))
        if (typeof step.onSelect === 'function') {
          items.push(
            h('button', { key: `step-${index}`, type: 'button', className: 'dbmcp-crumb', onClick: step.onSelect }, step.label),
          )
        } else {
          items.push(h('span', { key: `step-${index}`, className: 'dbmcp-crumb is-current' }, step.label))
        }
      })
      return h('nav', { className: 'dbmcp-crumbs', 'aria-label': t('panel.title') }, items)
    }

    /**
     * The global write switch, drawn where the sources are listed.
     *
     * It used to sit in the diagnostics card, reading as one more fact among
     * facts; it then moved to the status strip and finally here, in the list
     * card's title row next to the group form — the same row as the sources it
     * governs. Renders nothing when the panel hands it no handler, so a
     * read-only host cannot show a switch that would do nothing.
     */
    function WriteSwitch(props) {
      const { t, allowWrite, busy, onWrite } = props
      if (typeof onWrite !== 'function') return null
      const on = allowWrite === true
      return h(
        'span',
        { className: 'dbmcp-list-write' },
        h(Switch, {
          checked: on,
          title: t('write.hint'),
          disabled: busy === true,
          onChange: (next) => onWrite(next),
        }),
        h('span', { className: 'dbmcp-list-write-label' }, on ? t('write.on') : t('write.off')),
      )
    }

    /** Quiet strip above the list: bridge health, totals, filters and search. */
  function StatusStrip(props) {
    const { t, data, sources, failedSources, groupNames, filter, setFilter, query, setQuery } = props
    if (!data) return null
    const mcpReady = Boolean(data.mcp && data.mcp.phase === 'ready')
    const failed = failedSources.length
    const healthy = Math.max(sources.length - failed, 0)
    const chips = [{ id: 'all', label: t('filter.all'), count: sources.length }]
    for (const name of groupNames) {
      const count = sources.filter((source) => String(source.group || '').trim() === name).length
      chips.push({ id: 'group:' + name, label: name, count })
    }
    const loose = sources.filter((source) => !String(source.group || '').trim()).length
    if (loose > 0) chips.push({ id: 'group:', label: t('group.unassigned'), count: loose })
    if (failed > 0) chips.push({ id: 'failed', label: t('filter.failed'), count: failed, warn: true })
    return h(
      'div',
      { className: 'dbmcp-status' },
      h(
        'div',
        { className: 'dbmcp-status-row' },
        h('span', { className: 'dbmcp-dot ' + (mcpReady ? 'is-ok' : 'is-error') }),
        h('span', { className: 'dbmcp-status-label' }, mcpReady ? t('status.mcpOk') : t('status.mcpDown')),
        h(
          'span',
          { className: 'dbmcp-stats' },
          h('span', { className: 'dbmcp-stat' }, t('status.total').replace('{n}', String(sources.length))),
          h('span', { className: 'dbmcp-stat-sep' }),
          h(
            'span',
            { className: 'dbmcp-stat is-ok' },
            t('status.healthy').replace('{n}', String(healthy)),
          ),
          failed > 0 ? h('span', { className: 'dbmcp-stat-sep' }) : null,
          failed > 0
            ? h(
                'span',
                { className: 'dbmcp-stat is-error' },
                t('status.failing').replace('{n}', String(failed)),
                ' ',
                t('status.failingNames').replace(
                  '{names}',
                  failedSources.map((source) => source.name || source.id).join(', '),
                ),
              )
            : null,
        ),
        h('span', { className: 'dbmcp-status-spacer' }),
        h('div', { className: 'dbmcp-status-search' }, h(TextInput, {
          value: query,
          onChange: setQuery,
          placeholder: t('sources.searchPlaceholder'),
          title: t('sources.searchPlaceholder'),
        })),
      ),
      h(
        'div',
        { className: 'dbmcp-status-row is-filters' },
        h(
          'div',
          { className: 'dbmcp-chips' },
          chips.map((chip) =>
            h(
              'button',
              {
                key: chip.id,
                type: 'button',
                className: 'dbmcp-chip' + (filter === chip.id ? ' is-active' : '') + (chip.warn ? ' is-warn' : ''),
                onClick: () => setFilter(filter === chip.id ? 'all' : chip.id),
              },
              chip.warn ? h('span', { className: 'dbmcp-chip-icon', 'aria-hidden': 'true' }, '⚠') : null,
              chip.label,
              h('span', { className: 'dbmcp-chip-count' }, String(chip.count)),
            ),
          ),
        ),
      ),
    )
  }

  function MainPanel() {
      const service = useLocale()
      const palette = useThemePalette()
      const t = React.useMemo(() => (service ? service.bind(NS) : (key) => key), [service])
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [busy, setBusy] = React.useState(false)
      const [view, setView] = React.useState({ mode: 'list' })
      const tab = tabOfMode(view.mode)
      const [notice, setNotice] = React.useState(null)
      const [probing, setProbing] = React.useState(null)
      const [pendingDelete, setPendingDelete] = React.useState(null)
      const [selected, setSelected] = React.useState([])
      const [bulkGroup, setBulkGroup] = React.useState('')
      const [pendingBulkDelete, setPendingBulkDelete] = React.useState(false)
      const [groupDraft, setGroupDraft] = React.useState('')
      const [editingGroup, setEditingGroup] = React.useState(null)
      const [pendingGroupDelete, setPendingGroupDelete] = React.useState(null)
      const [dragIds, setDragIds] = React.useState([])
      const [dragOverGroup, setDragOverGroup] = React.useState(null)
      const [dropMark, setDropMark] = React.useState(null)
      const [renamingSource, setRenamingSource] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [filter, setFilter] = React.useState('all')
      const [copiedId, setCopiedId] = React.useState(null)
      const [copiedEndpoint, setCopiedEndpoint] = React.useState(false)
      const [copiedChip, setCopiedChip] = React.useState(null)
      const [collapsed, setCollapsed] = React.useState([])

      const toggleFolded = (name) => {
        setCollapsed((prev) => (prev.includes(name) ? prev.filter((item) => item !== name) : prev.concat(name)))
      }

      /** Switching a tab only swaps the card below; the chrome never moves. */
      const selectTab = (id) => {
        setView({ mode: id })
      }

      const backToChat = () => {
        const layout = layoutService
        if (!layout || typeof layout.selectPanel !== 'function') return
        try {
          layout.selectPanel(null)
        } catch (error) {
          /* older shells may not expose selectPanel; staying on the panel is fine */
        }
      }
      const [settings, setSettings] = React.useState(null)
      const [audit, setAudit] = React.useState({ entries: [], file: null })
      const [env, setEnv] = React.useState(null)
      const [installing, setInstalling] = React.useState(false)
      const [scopes, setScopes] = React.useState(null)
      const [scopesOpen, setScopesOpen] = React.useState(true)
      const [http, setHttp] = React.useState(null)
      const [clients, setClients] = React.useState(null)
      const [tools, setTools] = React.useState(null)
      const [portDraft, setPortDraft] = React.useState('')
      const [clientBusy, setClientBusy] = React.useState('')

      const load = React.useCallback(async () => {
        setBusy(true)
        try {
          const data = await apiGet('/health')
          setState({ status: 'ready', data, error: null })
          if (data.settings) setSettings(data.settings)
          void apiGet('/audit?limit=12')
            .then((payload) => setAudit({ entries: payload.entries || [], file: payload.file || null }))
            .catch(() => {})
          void apiGet('/python/env')
            .then((payload) => setEnv(payload))
            .catch(() => {})
          void apiGet('/scopes')
            .then((payload) => setScopes({ sessions: payload.sessions || [], archived: payload.archived || [] }))
            .catch(() => {})
          void apiGet('/http/status')
            .then((payload) => setHttp(payload))
            .catch(() => {})
          void apiGet('/clients')
            .then((payload) => setClients(payload))
            .catch(() => {})
          void apiGet('/tools')
            .then((payload) => setTools(payload))
            .catch(() => {})
        } catch (error) {
          setState({ status: 'error', data: null, error: String((error && error.message) || error) })
        } finally {
          setBusy(false)
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const data = state.data
      const apiOk = state.status === 'ready' && data && data.ok === true
      const sources = (data && data.datasources) || []

      const finish = (message, isError) => {
        setNotice({ message, isError: Boolean(isError) })
        setView({ mode: 'list' })
        load()
      }

      const save = (source) => finish(fmt(t('notice.saved'), { name: source.name || source.id }), false)

      const remove = async (source) => {
        if (pendingDelete !== source.id) {
          setPendingDelete(source.id)
          return
        }
        setPendingDelete(null)
        try {
          await apiPost('/datasources/delete', { id: source.id })
          finish(fmt(t('notice.deleted'), { name: source.name || source.id }), false)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const toggleSelected = (id) => {
        setPendingBulkDelete(false)
        setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
      }

      const runBulk = async (action, extra = {}) => {
        if (selected.length === 0) return
        setBusy(true)
        try {
          const payload = await apiPost('/datasources/bulk', { action, ids: selected, ...extra })
          const affected = Number(payload && payload.affected) || selected.length
          setSelected([])
          setPendingBulkDelete(false)
          setBulkGroup('')
          if (action === 'group') {
            const name = String(extra.group || '').trim() || t('group.unassigned')
            finish(t('notice.bulkGrouped').replace('{n}', String(affected)).replace('{group}', name), false)
          } else {
            finish(t('notice.bulkDone').replace('{n}', String(affected)), false)
          }
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setBusy(false)
        }
      }

      /**
       * Flip one source between read-only and writable from its row switch.
       *
       * Writable now means "may write to every schema it can see": there is no
       * whitelist to ask about, so the switch is a pure flag flip.
       */
      const toggleReadOnly = async (source) => {
        await setReadOnly(source, nextReadOnly(source))
      }

      /** POST the flag; `allowDdl` rides along when a DDL switch flips. */
      const setReadOnly = async (source, readOnly, allowDdl) => {
        const name = source.name || source.id
        setBusy(true)
        try {
          const body = { action: 'readOnly', ids: [source.id], readOnly }
          if (allowDdl !== undefined) body.allowDdl = allowDdl === true
          await apiPost('/datasources/bulk', body)
          const globalOpen = Boolean(settings && settings.allowWrite)
          const message = readOnly
            ? t('notice.nowReadOnly').replace('{name}', name)
            : globalOpen
              ? t('notice.nowWritable').replace('{name}', name)
              : t('notice.nowWritableLocked').replace('{name}', name)
          setNotice({ message, isError: false })
          load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
          throw error
        } finally {
          setBusy(false)
        }
      }

      /** Flip the DDL switch, which rides alongside the writable flag. */
      const toggleDdl = async (source) => {
        await setReadOnly(source, false, source.allowDdl !== true)
      }

      const bulkDelete = async () => {
        if (selected.length === 0) return
        if (!pendingBulkDelete) {
          setPendingBulkDelete(true)
          return
        }
        await runBulk('delete')
      }

      const probe = async (source) => {        setProbing(source.id)
        try {
          const result = await apiPost('/datasources/test', { id: source.id })
          const probeInfo = result.probe || {}
          if (probeInfo.ok) {
            setNotice({ message: fmt(t('notice.probeOk'), { name: source.name, ms: probeInfo.latencyMs }), isError: false })
          } else {
            /* the failing row already carries the message; a banner on top would just repeat it */
            setNotice(null)
          }
          load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setProbing(null)
        }
      }

      const restartMcp = async () => {
        setBusy(true)
        try {
          const result = await apiPost('/mcp/restart', {})
          setNotice({
            message: result.ok
              ? t('notice.mcpReady').replace('{count}', String((result.tools || []).length))
              : `${t('diag.mcpFailed')} ${result.error || ''}`,
            isError: !result.ok,
          })
          await load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setBusy(false)
        }
      }

      const copyProbe = async (source) => {
        try {
          await copyText(probeReport(source, data.plugin))
          setCopiedId(source.id)
          setTimeout(() => setCopiedId((prev) => (prev === source.id ? null : prev)), 1600)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** The chip copies the bare id: that is the token the user pastes in chat. */
      const copyId = async (id) => {
        try {
          await copyText(id)
          setCopiedChip(id)
          setTimeout(() => setCopiedChip((prev) => (prev === id ? null : prev)), 1600)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** Copy the MCP endpoint, ready to paste into another agent's settings. */
      const copyEndpoint = async (url) => {
        if (!url) return
        try {
          await copyText(url)
          setCopiedEndpoint(true)
          setTimeout(() => setCopiedEndpoint(false), 1600)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const toggleWrite = async (next) => {
        try {
          const payload = await apiPost('/settings', { allowWrite: next })
          setSettings(payload.settings || { allowWrite: next })
          setNotice({ message: next ? t('notice.writeOn') : t('notice.writeOff'), isError: false })
          load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** Drop the limits the agent put on one conversation. */
      const removeScope = async (session) => {
        try {
          const payload = await apiPost('/scopes/delete', { session })
          setScopes({ sessions: payload.sessions || [], archived: payload.archived || [] })
          setNotice({ message: t('scopes.removed'), isError: false })
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** Drop every conversation limit at once. */
      const clearScopes = async () => {
        try {
          await apiPost('/scopes/clear', {})
          setScopes({ sessions: [], archived: [] })
          setNotice({ message: t('scopes.cleared'), isError: false })
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const installDeps = async () => {
        setInstalling(true)
        setNotice(null)
        try {
          const payload = await apiPost('/python/setup', {})
          if (payload && payload.python) setEnv(payload.python)
          setNotice({ message: payload && payload.ok ? t('notice.depsOk') : t('notice.depsFail'), isError: !(payload && payload.ok) })
          load()
        } catch (error) {
          setNotice({ message: `${t('notice.depsFail')} ${String((error && error.message) || error)}`, isError: true })
        } finally {
          setInstalling(false)
        }
      }

      /** Start or stop the HTTP endpoint other agents connect to. */
      const controlHttp = async (action) => {
        setBusy(true)
        try {
          const port = Number(portDraft || (http && http.port) || (settings && settings.httpPort) || 8765)
          const payload = await apiPost(`/http/${action}`, action === 'start' ? { port } : {})
          if (payload && payload.http) setHttp(payload.http)
          setNotice({
            message: payload && payload.http && payload.http.running ? t('notice.httpOn') : t('notice.httpOff'),
            isError: !(payload && payload.ok !== false),
          })
          await load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setBusy(false)
        }
      }

      /** Write this server into one client's own configuration file. */
      const configureClient = async (client) => {
        setClientBusy(client.id)
        setNotice(null)
        try {
          const payload = await apiPost('/clients/configure', { client: client.id })
          setNotice({
            message: fmt(t('notice.clientReady'), { name: client.label, transport: payload.transport || 'http' }),
            isError: false,
          })
          await load()
        } catch (error) {
          const body = (error && error.payload) || {}
          const hint = body.hint ? ` ${body.hint}` : ''
          setNotice({ message: `${String((error && error.message) || error)}${hint}`, isError: true })
        } finally {
          setClientBusy('')
        }
      }

      /** Publish or withdraw one tool for the agent. */
      const [limitDraft, setLimitDraft] = React.useState({})

      /** Drafted value of the long-text policy while the select is open. */
      const [textPolicyDraft, setTextPolicyDraft] = React.useState(undefined)

      /** Save the chosen long-text policy; the server clamps invalid values. */
      const commitTextPolicy = async () => {
        const next = textPolicyDraft !== undefined ? textPolicyDraft : (tools && tools.textPolicy) || 'auto'
        if (next === ((tools && tools.textPolicy) || 'auto')) return
        try {
          await apiPost('/settings', { textPolicy: next })
          setTextPolicyDraft(undefined)
          setNotice({ message: t('render.textSaved'), isError: false })
          await load()
        } catch (error) {
          setTextPolicyDraft(undefined)
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** Save one default row count; the server clamps it to its own cap. */
      const commitLimit = async (limit) => {
        const raw = Number(limitDraft[limit.key])
        if (!Number.isInteger(raw) || raw < limit.min || raw > limit.max) {
          setLimitDraft({ ...limitDraft, [limit.key]: String(limit.value) })
          return
        }
        if (raw === limit.value) return
        const next = { ...((tools && tools.limits) || {}), [limit.key]: raw }
        try {
          await apiPost('/settings', { limits: next })
          setLimitDraft({ ...limitDraft, [limit.key]: undefined })
          setNotice({ message: t('tools.limitSaved'), isError: false })
          await load()
        } catch (error) {
          setLimitDraft({ ...limitDraft, [limit.key]: String(limit.value) })
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const toggleTool = async (name, on) => {
        const current = (tools && Array.isArray(tools.disabled) ? tools.disabled : []).filter((item) => item !== name)
        const next = on ? current : [...current, name]
        setBusy(true)
        setNotice(null)
        try {
          await apiPost('/settings', { disabledTools: next })
          setNotice({ message: on ? fmt(t('tools.on'), { name }) : fmt(t('tools.off'), { name }), isError: false })
          await load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setBusy(false)
        }
      }

      /** Declared groups plus any group that a source already carries. */
      const groupNames = (() => {
        const seen = new Set()
        const declared = data && Array.isArray(data.groups) ? data.groups : []
        for (const name of declared) {
          const key = String(name || '').trim()
          if (key) seen.add(key)
        }
        for (const source of sources) {
          const key = String(source.group || '').trim()
          if (key) seen.add(key)
        }
        return [...seen].sort((a, b) => a.localeCompare(b))
      })()

      const reportError = (error) => {
        setNotice({ message: String((error && error.message) || error), isError: true })
      }

      const createGroup = async () => {
        const name = groupDraft.trim()
        if (!name) return
        try {
          await apiPost('/groups/save', { name })
          setGroupDraft('')
          setNotice({ message: t('notice.groupSaved').replace('{name}', name), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      const renameGroup = async () => {
        if (!editingGroup) return
        const name = String(editingGroup.name || '').trim()
        if (!name) return
        try {
          await apiPost('/groups/save', { name, from: editingGroup.from })
          setEditingGroup(null)
          setNotice({ message: t('notice.groupSaved').replace('{name}', name), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      /** A source keeps its id; double-clicking the name only changes the label. */
      const renameSource = async () => {
        if (!renamingSource) return
        const name = String(renamingSource.name || '').trim()
        const source = sources.find((item) => item.id === renamingSource.id)
        if (!source || !name) {
          setRenamingSource(null)
          return
        }
        try {
          await apiPost('/datasources/save', {
            id: source.id,
            name,
            kind: source.kind,
            readOnly: source.readOnly,
            isDefault: source.isDefault,
            tags: source.tags,
            group: source.group,
            config: source.config,
          })
          setRenamingSource(null)
          setNotice({ message: t('notice.saved').replace('{name}', name), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      const removeGroup = async (name) => {
        if (pendingGroupDelete !== name) {
          setPendingGroupDelete(name)
          return
        }
        setPendingGroupDelete(null)
        try {
          await apiPost('/groups/delete', { name })
          setNotice({ message: t('notice.groupDeleted').replace('{name}', name), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      /**
       * Drop the tick from rows that were just moved as a block. Dragging a row
       * that was not checked leaves the existing selection alone — the user did
       * not ask to move those.
       */
      const clearMovedSelection = (moved) => {
        const allMoved = moved.length > 0 && moved.every((id) => selected.includes(id))
        if (allMoved) setSelected([])
      }

      /**
       * Move a dragged block into a group.
       *
       * `ids` is usually one row, but grabbing a checked row drags every checked
       * row, so the call takes the whole block and the backend moves them in one
       * write.
       */
      const moveToGroup = async (ids, name) => {
        const list = Array.isArray(ids) ? ids : [ids]
        if (list.length === 0) return
        try {
          await apiPost('/datasources/bulk', { action: 'group', ids: list, group: name })
          const label = name || t('group.unassigned')
          setNotice({
            message:
              list.length > 1
                ? t('notice.movedMany').replace('{n}', String(list.length)).replace('{group}', label)
                : t('notice.moved').replace('{group}', label),
            isError: false,
          })
          clearMovedSelection(list)
          load()
        } catch (error) {
          reportError(error)
        }
      }

      /**
       * Dropping a block onto a row: adopt that row's group, then sit above or
       * below it. A multi-row drag stays in one piece and keeps its own order.
       */
      const dropOnRow = async (movedIds, target, after = false) => {
        const moving = (Array.isArray(movedIds) ? movedIds : [movedIds]).filter((id) => id && id !== target.id)
        if (moving.length === 0) return
        try {
          const group = String(target.group || '').trim()
          const leaving = moving.some((id) => {
            const row = sources.find((item) => item.id === id)
            return row && String(row.group || '').trim() !== group
          })
          if (leaving) {
            await apiPost('/datasources/bulk', { action: 'group', ids: moving, group })
          }
          const ids = reorderForDrop(sources.map((item) => item.id), moving, target.id, after)
          await apiPost('/datasources/reorder', { ids })
          setDragIds([])
          clearMovedSelection(moving)
          load()
        } catch (error) {
          reportError(error)
        }
      }

      const toggleGroup = (items) => {
        const ids = items.map((item) => item.id)
        const allChecked = ids.length > 0 && ids.every((id) => selected.includes(id))
        setPendingBulkDelete(false)
        setSelected((prev) => (allChecked ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]))
      }

      /** Everything the strip and the list need to know about health. */
      const failedSources = sources.filter(probeFailed)

      const visibleSources = sources.filter((source) => {
        if (filter === 'failed' && !probeFailed(source)) return false
        if (filter.indexOf('group:') === 0 && String(source.group || '').trim() !== filter.slice(6)) return false
        return sourceMatches(source, query)
      })

      const renderItem = (source) => {
        const probeInfo = source.lastProbe
        const failed = probeFailed(source)
        const checked = selected.includes(source.id)
        const dragging = dragIds.includes(source.id)
        const badge = kindBadge(source.kind)
        return h(
          'li',
          {
            className:
              'dbmcp-item' +
              (checked ? ' is-selected' : '') +
              (dragging ? ' is-dragging' : '') +
              (dropMark && dropMark.id === source.id ? (dropMark.after ? ' is-drop-after' : ' is-drop-before') : '') +
              (failed ? ' is-failed' : ''),
            key: source.id,
            onDragOver: (event) => {
              if (dragIds.length === 0 || dragging) return
              event.preventDefault()
              event.stopPropagation()
              /* Landing below the middle of a row means "after this one". */
              const rect = event.currentTarget.getBoundingClientRect()
              const after = event.clientY > rect.top + rect.height / 2
              if (!dropMark || dropMark.id !== source.id || dropMark.after !== after) {
                setDropMark({ id: source.id, after })
              }
            },
            onDragLeave: () => setDropMark((prev) => (prev && prev.id === source.id ? null : prev)),
            onDrop: (event) => {
              event.preventDefault()
              event.stopPropagation()
              const after = Boolean(dropMark && dropMark.id === source.id && dropMark.after)
              setDropMark(null)
              if (dragIds.length === 0 || dragging) return
              void dropOnRow(dragIds, source, after)
            },
          },
          h(
            'div',
            { className: 'dbmcp-item-row' },
            h(
              'span',
              {
                className: 'dbmcp-grip',
                title: t('group.dragHint'),
                draggable: true,
                onDragStart: (event) => {
                  /* Grabbing a checked row drags the whole checked block, so the
                     selection is the drag: one row, or all of them. */
                  const batch = checked ? selected.slice() : [source.id]
                  setDragIds(batch)
                  try {
                    event.dataTransfer.setData('text/plain', source.id)
                    event.dataTransfer.setData('application/x-dbmcp-rows', JSON.stringify(batch))
                    event.dataTransfer.effectAllowed = 'move'
                    const row = event.currentTarget.closest('.dbmcp-item')
                    if (row) event.dataTransfer.setDragImage(row, 16, 16)
                  } catch (error) {
                    /* some shells hand out a read-only dataTransfer; dragIds still carries the block */
                  }
                },
                onDragEnd: () => setDragIds([]),
              },
              h('span', { className: 'dbmcp-grip-dots', 'aria-hidden': 'true' }),
            ),
            h(
              'label',
              { className: 'dbmcp-item-pick', title: source.name || source.id },
              h('input', {
                type: 'checkbox',
                checked,
                onChange: () => toggleSelected(source.id),
                'aria-label': source.name || source.id,
              }),
            ),
            h(
              'span',
              {
                className: 'dbmcp-kind-badge',
                style: {
                  color: badge.color,
                  background: `color-mix(in srgb, ${badge.color} 12%, transparent)`,
                  borderColor: `color-mix(in srgb, ${badge.color} 26%, transparent)`,
                },
                title: source.kind,
              },
              badge.label,
            ),
            h(
              'div',
              { className: 'dbmcp-item-main' },
              renamingSource && renamingSource.id === source.id
                ? h(
                    'form',
                    {
                      className: 'dbmcp-item-rename',
                      onClick: (event) => event.stopPropagation(),
                      onSubmit: (event) => {
                        event.preventDefault()
                        void renameSource()
                      },
                    },
                    h(TextInput, {
                      value: renamingSource.name,
                      onChange: (value) => setRenamingSource({ id: source.id, name: value }),
                      autoFocus: true,
                      onKeyDown: (event) => {
                        if (event.key === 'Escape') setRenamingSource(null)
                      },
                    }),
                    h('button', { type: 'submit', className: 'dbmcp-btn is-small is-primary' }, t('group.save')),
                    h(
                      'button',
                      { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setRenamingSource(null) },
                      t('group.cancel'),
                    ),
                  )
                : h(
                    'div',
                    { className: 'dbmcp-item-name' },
                    h(
                      'span',
                      {
                        className: 'is-renamable',
                        title: t('group.renameHint'),
                        onDoubleClick: (event) => {
                          event.stopPropagation()
                          setRenamingSource({ id: source.id, name: source.name || source.id })
                        },
                      },
                      source.name || source.id,
                    ),
                    /* The engine already shows as the kind badge to the left of
                       the row, so the name line no longer repeats it. */
                    h(Switch, {
                      checked: source.readOnly === false,
                      label: source.readOnly === false ? t('sources.readwrite') : t('sources.readonly'),
                      title: source.readOnly === false ? t('action.lockSource') : t('action.unlockSource'),
                      disabled: busy,
                      onChange: () => {
                        void toggleReadOnly(source)
                      },
                    }),
                    // DDL is its own switch, right beside the writable one. It
                    // only means anything while the source is writable, so hide
                    // it entirely until the writable switch is turned on.
                    source.readOnly === false
                      ? h(Switch, {
                          checked: source.allowDdl === true,
                          label: t('sources.ddl'),
                          title: source.allowDdl === true ? t('sources.ddlHint') : t('sources.ddlBlockedHint'),
                          disabled: busy,
                          onChange: () => {
                            void toggleDdl(source)
                          },
                        })
                      : null,
                    source.secretBroken === true
                      ? h('span', { className: 'dbmcp-note is-broken' }, t('sources.secretBroken'))
                      : null,
                  ),
              h(
                'div',
                { className: 'dbmcp-item-meta' },
                source.target ? h('span', { className: 'dbmcp-item-target' }, source.target) : null,
                h(IdChip, { t, id: source.id, copied: copiedChip === source.id, onCopy: copyId }),
              ),
              failed
                ? null
                : h(
                    'div',
                    { className: 'dbmcp-probe ' + (probeInfo ? (probeInfo.ok ? 'is-ok' : 'is-error') : '') },
                    probeInfo ? '● ' + probeInfo.message : t('sources.neverProbed'),
                  ),
            ),
            h(
              'div',
              { className: 'dbmcp-item-actions', onClick: (event) => event.stopPropagation() },
              h(
                'button',
                { type: 'button', className: 'dbmcp-btn is-small is-plain', disabled: probing === source.id, onClick: () => probe(source) },
                probing === source.id ? t('action.testing') : t('action.test'),
              ),
              h('button', { type: 'button', className: 'dbmcp-btn is-small is-plain', onClick: () => setView({ mode: 'schema', source }) }, t('action.schema')),
              h('button', { type: 'button', className: 'dbmcp-btn is-small is-plain', onClick: () => setView({ mode: 'edit', source }) }, t('action.edit')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dbmcp-btn is-small is-plain is-danger',
                  onClick: () => remove(source),
                  onBlur: () => setPendingDelete((prev) => (prev === source.id ? null : prev)),
                },
                pendingDelete === source.id ? t('action.deleteConfirm') : t('action.delete'),
              ),
            ),
          ),
          failed
            ? h(
                'div',
                { className: 'dbmcp-item-failure' },
                h('span', { className: 'dbmcp-fail-tri', 'aria-hidden': 'true' }, '⚠'),
                h(
                  'span',
                  { className: 'dbmcp-fail-text' },
                  fmt(t('sources.failedLine'), { message: (probeInfo && probeInfo.message) || t('state.failed') }),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dbmcp-btn is-small is-plain',
                    title: t('action.copyErrorHint'),
                    onClick: (event) => {
                      event.stopPropagation()
                      void copyProbe(source)
                    },
                  },
                  copiedId === source.id ? t('action.copied') : t('action.copyError'),
                ),
              )
            : null,
        )
      }

      /** One group: a chevron, a select-all box and rename/delete, plus a drop zone. */
      const renderGroup = (name, items) => {
        const allChecked = items.length > 0 && items.every((item) => selected.includes(item.id))
        const renaming = editingGroup !== null && editingGroup.from === name
        const dropTarget = name
        const folded = collapsed.includes(name)
        return h(
          'section',
          {
            className: 'dbmcp-group' + (dragOverGroup === dropTarget ? ' is-over' : ''),
            key: name || '__none',
            onDragOver: (event) => {
              event.preventDefault()
              if (dragOverGroup !== dropTarget) setDragOverGroup(dropTarget)
            },
            onDragLeave: () => setDragOverGroup((prev) => (prev === dropTarget ? null : prev)),
            onDrop: (event) => {
              event.preventDefault()
              setDragOverGroup(null)
              let ids = dragIds
              try {
                const packed = event.dataTransfer.getData('application/x-dbmcp-rows')
                if (packed) ids = JSON.parse(packed)
              } catch (error) {
                /* fall back to the block remembered on dragstart */
              }
              setDragIds([])
              if (Array.isArray(ids) && ids.length > 0) void moveToGroup(ids, name)
            },
          },
          h(
            'header',
            { className: 'dbmcp-group-head' },
            h('input', {
              type: 'checkbox',
              className: 'dbmcp-group-pick',
              checked: allChecked,
              onChange: () => toggleGroup(items),
              title: t('group.selectAll'),
              'aria-label': t('group.selectAll'),
            }),
            h('button', {
              type: 'button',
              className: 'dbmcp-fold' + (folded ? '' : ' is-open'),
              'aria-expanded': !folded,
              'aria-label': name || t('group.unassigned'),
              title: folded ? t('group.expand') : t('group.collapse'),
              onClick: () => toggleFolded(name),
            }),
            renaming
              ? h(
                  'form',
                  {
                    className: 'dbmcp-group-edit',
                    onSubmit: (event) => {
                      event.preventDefault()
                      void renameGroup()
                    },
                  },
                  h(TextInput, {
                    value: editingGroup.name,
                    onChange: (value) => setEditingGroup({ from: name, name: value }),
                    autoFocus: true,
                    onKeyDown: (event) => {
                      if (event.key === 'Escape') setEditingGroup(null)
                    },
                  }),
                  h('button', { type: 'submit', className: 'dbmcp-btn is-small is-primary' }, t('group.save')),
                  h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setEditingGroup(null) }, t('group.cancel')),
                )
              : h(
                  'span',
                  {
                    className: 'dbmcp-group-name' + (name ? ' is-renamable' : ''),
                    title: name ? t('group.renameHint') : undefined,
                    onDoubleClick: () => {
                      if (name) setEditingGroup({ from: name, name })
                    },
                  },
                  name || t('group.unassigned'),
                ),
            h('span', { className: 'dbmcp-hint' }, t('group.count').replace('{n}', String(items.length))),
            name === '' || renaming
              ? null
              : h(
                  'span',
                  { className: 'dbmcp-group-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small is-plain is-danger',
                      onClick: () => void removeGroup(name),
                      onBlur: () => setPendingGroupDelete((prev) => (prev === name ? null : prev)),
                    },
                    pendingGroupDelete === name ? t('group.deleteConfirm') : t('group.delete'),
                  ),
                ),
          ),
          folded || items.length === 0
            ? folded
              ? null
              : h('div', { className: 'dbmcp-hint dbmcp-group-empty' }, t('group.empty'))
            : h('ul', { className: 'dbmcp-list' + (dragIds.length > 1 ? ' is-dragging-block' : '') }, items.map(renderItem)),
        )
      }

      const renderGroupCreate = () =>
        h(
          'form',
          {
            className: 'dbmcp-group-create',
            onSubmit: (event) => {
              event.preventDefault()
              void createGroup()
            },
          },
          h(TextInput, {
            value: groupDraft,
            onChange: setGroupDraft,
            placeholder: t('group.newPlaceholder'),
            title: t('group.new'),
          }),
          h('button', { type: 'submit', className: 'dbmcp-btn is-small', disabled: !groupDraft.trim() }, t('group.add')),
        )

      const renderList = () => {
        if (sources.length === 0 && groupNames.length === 0) {
          return h(
            'div',
            { className: 'dbmcp-empty' },
            h('strong', null, t('sources.empty.title')),
            h('p', null, t('sources.empty.body')),
          )
        }
        if (visibleSources.length === 0) {
          return h('div', { className: 'dbmcp-empty' }, h('strong', null, t('sources.noMatch')))
        }
        const buckets = new Map()
        for (const name of groupNames) buckets.set(name, [])
        for (const source of visibleSources) {
          const key = String(source.group || '').trim()
          if (!buckets.has(key)) buckets.set(key, [])
          buckets.get(key).push(source)
        }
        /* An empty group still earns its section: it is the drop target for "put this here". */
        const narrowing = filter !== 'all' || query.trim() !== ''
        const order = sectionOrder(groupNames, visibleSources, narrowing)
        const loose = buckets.get('') || []
        /* A single unnamed bucket with rows in it needs no heading. */
        if (order.length === 1 && !order[0] && loose.length > 0) {
          return h('ul', { className: 'dbmcp-list' + (dragIds.length > 1 ? ' is-dragging-block' : '') }, loose.map(renderItem))
        }
        return h(
          'div',
          { className: 'dbmcp-groups' },
          order.map((name) => renderGroup(name, buckets.get(name) || [])),
        )
      }

      const renderBulk = () => {
        if (selected.length === 0) return null
        const count = selected.length
        return h(
          'div',
          { className: 'dbmcp-bulk' },
          h('span', { className: 'dbmcp-bulk-count' }, t('bulk.selected').replace('{n}', String(count))),
          h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: () => runBulk('test') }, t('bulk.test')),
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: () => runBulk('readOnly', { readOnly: true }) },
            t('bulk.readonly'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dbmcp-btn is-small',
              disabled: busy,
              onClick: () => void runBulk('readOnly', { readOnly: false }),
            },
            t('bulk.readwrite'),
          ),
          h(
            'div',
            { className: 'dbmcp-bulk-group' },
            h(TextInput, {
              value: bulkGroup,
              onChange: setBulkGroup,
              placeholder: t('bulk.groupPlaceholder'),
              title: t('bulk.group'),
            }),
            h(
              'button',
              { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: () => runBulk('group', { group: bulkGroup }) },
              t('bulk.apply'),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dbmcp-btn is-small is-danger',
              disabled: busy,
              onClick: () => bulkDelete(),
              onBlur: () => setPendingBulkDelete(false),
            },
            pendingBulkDelete ? t('bulk.deleteConfirm').replace('{n}', String(count)) : t('bulk.delete'),
          ),
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setSelected([]) },
            t('bulk.clear'),
          ),
        )
      }

      const renderStatus = () =>
        h(StatusStrip, {
          t,
          data,
          sources,
          failedSources,
          groupNames,
          filter,
          setFilter,
          query,
          setQuery,
        })

      /** One row per supported outside client: detected, configured, one click away. */
      const renderClientRow = (client) =>
        h(
          'div',
          { className: 'dbmcp-client', key: client.id },
          h(
            'div',
            { className: 'dbmcp-client-main' },
            h('span', { className: 'dbmcp-client-name' }, client.label),
            h('span', { className: 'dbmcp-hint dbmcp-mono' }, client.file || ''),
          ),
          client.configured
            ? h('span', { className: 'dbmcp-pill is-open' }, t('clients.configured'))
            : h('span', { className: 'dbmcp-hint' }, client.exists ? t('clients.notConfigured') : t('clients.noFile')),
          h(
            'button',
            {
              type: 'button',
              className: 'dbmcp-btn is-small',
              disabled: clientBusy === client.id,
              onClick: () => configureClient(client),
            },
            clientBusy === client.id ? t('clients.working') : t('clients.configure'),
          ),
        )

      /** The HTTP card: the URL to paste, the port, and who is already wired up. */
      const renderClients = () =>
        h(
          Card,
          {
            title: t('clients.title'),
            aside: h(
              'span',
              { className: http && http.running ? 'dbmcp-pill is-open' : 'dbmcp-pill' },
              http && http.running ? t('clients.running') : t('clients.stopped'),
            ),
          },
          h('p', { className: 'dbmcp-hint' }, t('clients.hint')),
          h(
            'div',
            { className: 'dbmcp-endpoint' },
            h('code', { className: 'dbmcp-endpoint-url' }, (http && http.url) || (clients && clients.url) || '—'),
            h(
              'div',
              { className: 'dbmcp-endpoint-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dbmcp-btn is-small',
                  onClick: () => copyEndpoint((http && http.url) || (clients && clients.url) || ''),
                },
                copiedEndpoint ? t('clients.copied') : t('clients.copy'),
              ),
              h(
                'label',
                { className: 'dbmcp-port-label' },
                h('span', null, t('clients.port')),
                h('input', {
                  className: 'dbmcp-input dbmcp-port',
                  inputMode: 'numeric',
                  placeholder: String((settings && settings.httpPort) || 8765),
                  value: portDraft,
                  onChange: (event) => setPortDraft(event.target.value),
                }),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dbmcp-btn is-small',
                  disabled: busy,
                  onClick: () => controlHttp(http && http.running ? 'stop' : 'start'),
                },
                http && http.running ? t('clients.stop') : t('clients.start'),
              ),
            ),
          ),
          http && http.error ? h('p', { className: 'dbmcp-hint is-error' }, http.error) : null,
          h(
            'div',
            { className: 'dbmcp-clients' },
            (clients && clients.clients ? clients.clients : []).map(renderClientRow),
          ),
          h('p', { className: 'dbmcp-hint' }, t('clients.stdioNote')),
        )

      /** Which tools the agent can see at all; the Python server still serves all of them. */
      const renderTools = () =>
        h(
          Card,
          {
            title: t('tools.title'),
            aside: h(
              'span',
              { className: 'dbmcp-pill' },
              `${tools && tools.tools ? tools.tools.filter((tool) => tool.enabled !== false).length : 0} / ${tools && tools.tools ? tools.tools.length : 0}`,
            ),
          },
          h('p', { className: 'dbmcp-hint' }, t('tools.hint')),
          h('p', { className: 'dbmcp-hint is-scope' }, t('tools.dshOnly')),
          h(
            'div',
            { className: 'dbmcp-tools' },
            (tools && tools.tools ? tools.tools : []).map((tool) =>
              h(
                'div',
                {
                  key: tool.name,
                  className: tool.enabled ? 'dbmcp-tool' : 'dbmcp-tool is-off',
                  title: tool.description || tool.name,
                  /* The whole row flips, the way the old label did. The switch
                     stops its own click, so a click either lands on exactly one
                     control or on the row. */
                  onClick: () => {
                    if (!busy) void toggleTool(tool.name, tool.enabled === false)
                  },
                },
                h(Switch, {
                  checked: tool.enabled !== false,
                  title: tool.enabled !== false ? t('tools.disable') : t('tools.enable'),
                  disabled: busy,
                  onChange: (next) => toggleTool(tool.name, next),
                }),
                h(
                  'div',
                  { className: 'dbmcp-tool-main' },
                  h('code', { className: 'dbmcp-tool-name' }, tool.full || tool.name),
                  h('span', { className: 'dbmcp-tool-desc' }, firstLine(tool.description)),
                ),
              ),
            ),
          ),
          tools && tools.disabled && tools.disabled.length
            ? h('p', { className: 'dbmcp-hint' }, fmt(t('tools.offCount'), { n: tools.disabled.length }))
            : null,
        )

      /* The row counts and the long-text policy are not per-tool decisions, but
         they used to hang off the two rows that carry them — one lone select
         under a list of eight switches, and a number box parked far away from
         the name it belonged to. They now share one card of their own, one
         setting per line so each can say what it does. */
      const limitRules = (() => {
        const seen = new Map()
        for (const tool of tools && tools.tools ? tools.tools : []) {
          if (tool.limit && !seen.has(tool.limit.key)) seen.set(tool.limit.key, tool.limit)
        }
        return [...seen.values()]
      })()

      const limitName = (rule) =>
        rule.key === 'sampleRows'
          ? t('render.sampleRows')
          : rule.key === 'maxRows'
            ? t('render.maxRows')
            : rule.argument

      const limitHint = (rule) =>
        rule.key === 'sampleRows'
          ? fmt(t('render.sampleRowsHint'), { max: rule.max })
          : rule.key === 'maxRows'
            ? fmt(t('render.maxRowsHint'), { max: rule.max })
            : fmt(t('tools.limitHint'), { max: rule.max })

      const renderResults = () =>
        h(
          Card,
          { title: t('render.title') },
          h(
            'div',
            { className: 'dbmcp-render-fields' },
            limitRules.map((rule) =>
              h(
                'div',
                { key: rule.key, className: 'dbmcp-render-field' },
                h(
                  'label',
                  { className: 'dbmcp-render-head' },
                  h('span', { className: 'dbmcp-render-label' }, limitName(rule)),
                  h(
                    'span',
                    { className: 'dbmcp-render-input' },
                    h('input', {
                      type: 'number',
                      className: 'dbmcp-input dbmcp-limit',
                      min: rule.min,
                      max: rule.max,
                      step: 1,
                      value: limitDraft[rule.key] !== undefined ? limitDraft[rule.key] : rule.value,
                      'aria-label': fmt(t('tools.limitLabel'), { argument: rule.argument }),
                      disabled: busy,
                      onClick: (event) => event.stopPropagation(),
                      onChange: (event) => setLimitDraft({ ...limitDraft, [rule.key]: event.target.value }),
                      onBlur: () => commitLimit(rule),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          event.currentTarget.blur()
                        }
                      },
                    }),
                    h('span', { className: 'dbmcp-limit-unit' }, t('tools.rows')),
                  ),
                ),
                h('p', { className: 'dbmcp-render-hint' }, limitHint(rule)),
              ),
            ),
            h(
              'div',
              { className: 'dbmcp-render-field' },
              h(
                'label',
                { className: 'dbmcp-render-head' },
                h('span', { className: 'dbmcp-render-label' }, t('render.text')),
                h(
                  'select',
                  {
                    className: 'dbmcp-input dbmcp-textpolicy-select',
                    value: textPolicyDraft !== undefined ? textPolicyDraft : (tools && tools.textPolicy) || 'auto',
                    disabled: busy,
                    onClick: (event) => event.stopPropagation(),
                    onChange: (event) => setTextPolicyDraft(event.target.value),
                    onBlur: () => commitTextPolicy(),
                  },
                  h('option', { value: 'auto' }, t('render.textFragment')),
                  h('option', { value: 'full' }, t('render.textFull')),
                ),
              ),
              h('p', { className: 'dbmcp-render-hint' }, t('render.textHint')),
            ),
          ),
        )

      /* A conversation limit has no other screen: it is set by the agent through
         MCP, so the panel is the only place it can be read or removed. It lives
         on the Sources page next to the global write switch — both answer "who
         may touch which data". The table starts expanded rather than behind a
         click: whoever opens this page is here to check or lift a limit, and a
         collapsed card just makes them hunt for it. An empty list still shows
         the card, with one line saying nothing is limited. */
      const renderScopes = () => {
        const list = (scopes && scopes.sessions) || []
        const parked = (scopes && scopes.archived) || []
        const rules = list.reduce((sum, entry) => sum + ((entry.ids || []).length), 0)
        const empty = list.length === 0 && parked.length === 0
        const sources = (entry) =>
          (entry.ids || []).length === 0
            ? h('span', { className: 'dbmcp-scope-none' }, t('scopes.allSources'))
            : h(
                'div',
                { className: 'dbmcp-scope-sources' },
                (entry.ids || []).map((id) =>
                  h('span', { className: 'dbmcp-scope-chip', key: id, title: id }, id),
                ),
              )
        const row = (entry, isParked) =>
          h(
            'tr',
            {
              className: isParked ? 'dbmcp-scope-row is-parked' : 'dbmcp-scope-row',
              key: `${isParked ? 'a' : 'l'}:${entry.session}`,
            },
            /* The full id is what the user can match against their own records,
               so it wraps in its own column rather than being shortened. */
            h(
              'td',
              { className: 'dbmcp-scope-cell' },
              h('code', { className: 'dbmcp-scope-id', title: entry.session }, entry.session || '—'),
            ),
            h(
              'td',
              { className: 'dbmcp-scope-cell' },
              entry.title
                ? h('span', { className: 'dbmcp-scope-title', title: entry.title }, entry.title)
                : h('span', { className: 'dbmcp-scope-none' }, t('scopes.noTitle')),
            ),
            h('td', { className: 'dbmcp-scope-cell' }, sources(entry)),
            h(
              'td',
              { className: 'dbmcp-scope-cell is-action' },
              isParked
                ? h('span', { className: 'dbmcp-scope-tag' }, t('scopes.parked'))
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-scope-remove',
                      title: t('scopes.remove'),
                      'aria-label': t('scopes.remove'),
                      disabled: busy,
                      onClick: () => void removeScope(entry.session),
                    },
                    '×',
                  ),
            ),
          )
        const header = h(
          'tr',
          null,
          h('th', { className: 'dbmcp-scope-th is-id', scope: 'col' }, t('scopes.columnId')),
          h('th', { className: 'dbmcp-scope-th is-title', scope: 'col' }, t('scopes.columnTitle')),
          h('th', { className: 'dbmcp-scope-th is-sources', scope: 'col' }, t('scopes.columnSources')),
          h('th', { className: 'dbmcp-scope-th is-action', scope: 'col' }, ''),
        )
        return h(
          Card,
          {
            title: t('scopes.title'),
            aside: empty ? null : String(list.length),
            actions: empty
              ? null
              : h(
                  'div',
                  { className: 'dbmcp-inline' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small',
                      disabled: busy,
                      onClick: () => setScopesOpen(!scopesOpen),
                    },
                    scopesOpen ? t('scopes.hide') : t('scopes.show'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: clearScopes },
                    t('scopes.clear'),
                  ),
                ),
          },
          h(
            'p',
            { className: 'dbmcp-hint' },
            empty ? t('scopes.empty') : fmt(t('scopes.summary'), { n: list.length, rules }),
          ),
          empty || !scopesOpen
            ? null
            : h(
                'div',
                { className: 'dbmcp-scope-box' },
                h(
                  'table',
                  { className: 'dbmcp-scope-table' },
                  h('colgroup', null,
                    h('col', { style: { width: '40%' } }),
                    h('col', { style: { width: '28%' } }),
                    h('col', { style: { width: '26%' } }),
                    h('col', { style: { width: '48px' } }),
                  ),
                  h('thead', null, header),
                  h(
                    'tbody',
                    null,
                    list.map((entry) => row(entry, false)),
                    parked.length === 0
                      ? null
                      : h(
                          'tr',
                          { className: 'dbmcp-scope-note' },
                          h(
                            'td',
                            { className: 'dbmcp-scope-cell', colSpan: 4 },
                            fmt(t('scopes.parkedHint'), { n: parked.length }),
                          ),
                        ),
                    parked.map((entry) => row(entry, true)),
                  ),
                ),
              ),
        )
      }

      let body
      if (state.status === 'loading') {
        body = h('div', { className: 'dbmcp-empty' }, t('loading'))
      } else if (state.status === 'error') {
        body = h(
          'div',
          { className: 'dbmcp-error' },
          h('div', null, t('error.title')),
          h('code', null, state.error),
          h('button', { type: 'button', className: 'dbmcp-btn', onClick: load }, t('error.retry')),
        )
      } else if (view.mode === 'create') {
        body = h(Card, { title: null }, h(SourceForm, {
          t,
          draft: emptyDraft(),
          editing: null,
          takenIds: sources.map((item) => item.id),
          onSaved: save,
          onCancel: () => setView({ mode: 'list' }),
        }))
      } else if (view.mode === 'edit') {
        body = h(Card, {
          title: fmt(t('form.edit'), { name: view.source.name || view.source.id }),
          children: h(SourceForm, {
            t,
            draft: draftFromSource(view.source),
            editing: view.source,
            takenIds: sources.map((item) => item.id),
            onSaved: save,
            onCancel: () => setView({ mode: 'list' }),
          }),
        })
      } else if (view.mode === 'schema') {
        body = h(Card, { title: fmt(t('schema.title'), { name: view.source.name || view.source.id }) },
          h(
            'div',
            { className: 'dbmcp-view-bar' },
            h(
              'button',
              { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setView({ mode: 'list' }) },
              `← ${t('action.backToSources')}`,
            ),
            view.source.target ? h('span', { className: 'dbmcp-view-target' }, view.source.target) : null,
            h(IdChip, {
              t,
              id: view.source.id,
              copied: copiedChip === view.source.id,
              onCopy: copyId,
            }),
          ),
          h(SchemaView, {
            t,
            source: view.source,
            onBack: () => setView({ mode: 'list' }),
          }),
        )
      } else if (view.mode === 'import') {
        body = h(Card, { title: null }, h(ImportView, {
          t,
          existingIds: sources.map((item) => item.id),
          onImported: (payload) => {
            const count = (payload.imported || []).length
            const skippedCount = (payload.skipped || []).length
            const message =
              skippedCount > 0
                ? t('notice.importedSkipped').replace('{n}', String(count)).replace('{m}', String(skippedCount))
                : fmt(t('notice.imported'), { n: count })
            finish(message, false)
          },
          onCancel: () => setView({ mode: 'list' }),
        }))
      } else {
        body = h(
          'div',
          { className: 'dbmcp-grid is-single' },
          tab === 'list' ? renderStatus() : null,
          tab === 'list'
            ? h(
                Card,
                { title: null },
                h(
                  'header',
                  { className: 'dbmcp-list-head' },
                  h('h2', { className: 'dbmcp-card-title' }, t('tab.list')),
                  renderGroupCreate(),
                  h(WriteSwitch, {
                    t,
                    allowWrite: Boolean(settings && settings.allowWrite),
                    busy,
                    onWrite: toggleWrite,
                  }),
                  h('span', { className: 'dbmcp-list-spacer' }),
                  h('span', { className: 'dbmcp-pill' }, t('sources.count').replace('{n}', String(sources.length))),
                  h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: load }, t('action.refresh')),
                ),
                renderBulk(),
                renderList(),
              )
            : null,
          tab !== 'list' ? null : renderScopes(),
          tab !== 'runtime'
            ? null
            : h(
            Card,
            {
              title: t('diag.title'),
              actions: h(
                'button',
                {
                  type: 'button',
                  className: 'dbmcp-btn is-small',
                  disabled: busy,
                  title: t('action.restartMcpHint'),
                  onClick: restartMcp,
                },
                t('action.restartMcp'),
              ),
            },
            h(
              'div',
              { className: 'dbmcp-rows' },
              h(Row, { label: t('diag.hostApi') }, h('span', { className: 'dbmcp-dot is-ok' }), t('state.connected')),
              h(Row, { label: t('diag.node') }, (data.host && data.host.node) || '-'),
              h(Row, { label: t('diag.plugin') }, `${data.plugin.name} ${data.plugin.version}`),
              h(Row, { label: t('diag.python') }, pythonLabel(t, data.python)),
              h(Row, { label: t('diag.runtimeDir') }, (data.runtime && data.runtime.dir) || '-'),
              h(
                Row,
                { label: t('diag.registry') },
                data.runtime && data.runtime.registryError
                  ? `${data.runtime.registryFile} — ${data.runtime.registryError}`
                  : (data.runtime && data.runtime.registryFile) || '-',
              ),
              h(Row, { label: t('diag.sources') }, String(sources.length)),
              h(
                Row,
                { label: t('diag.mcp') },
                `${data.mcp.serverName} · ${
                  data.mcp.wired
                    ? t('diag.mcpLive').replace('{count}', String((data.mcp.tools || []).length))
                    : data.mcp.phase === 'failed'
                      ? `${t('diag.mcpFailed')} ${data.mcp.error || ''}`.trim()
                      : t('diag.mcpPending')
                }`,
              ),
              h(
                Row,
                { label: t('diag.venv') },
                env && env.venvPython ? env.venvPython : h('span', { className: 'dbmcp-hint' }, t('diag.venvMissing')),
              ),
              h(
                Row,
                { label: t('diag.packages') },
                h(
                  'span',
                  { className: 'dbmcp-inline' },
                  h('span', { className: 'dbmcp-hint' }, (env && env.packages) || '—'),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small',
                      disabled: installing,
                      title: t('diag.venvHint'),
                      onClick: installDeps,
                    },
                    installing ? t('action.installing') : t('action.installDeps'),
                  ),
                ),
              ),
              data.mcp && data.mcp.phase === 'failed' && /tools`? service/.test(String(data.mcp.error || ''))
                ? h(Row, { label: t('diag.tip') }, h('span', { className: 'dbmcp-hint' }, t('diag.restartNeeded')))
                : null,
              h(Row, { label: t('diag.uptime') }, formatUptime(data.host && data.host.uptimeMs)),
            ),
          ),
          tab !== 'clients' ? null : renderClients(),
          tab !== 'tools' ? null : renderTools(),
          tab !== 'tools' ? null : renderResults(),
          tab !== 'audit'
            ? null
            : h(            Card,
            { title: t('audit.title'), aside: audit.entries.length ? String(audit.entries.length) : null },
            h(
              'div',
              { className: 'dbmcp-audit-list' },
              audit.entries.length === 0
                ? h('div', { className: 'dbmcp-empty' }, t('audit.empty'))
                : audit.entries.map((entry, index) =>
                    h(
                      'div',
                      { className: 'dbmcp-audit', key: `${entry.at || 'entry'}-${index}` },
                      h(
                        'span',
                        { className: 'dbmcp-audit-time', title: localStamp(entry.at) },
                        localClock(entry.at),
                      ),
                      h('span', { className: 'dbmcp-audit-tool' }, entry.tool || '?'),
                      h('span', { className: 'dbmcp-audit-client', title: t('audit.clientHint') }, entry.client || '?'),
                      h('span', { className: 'dbmcp-pill' }, entry.datasource || t('sources.default')),
                      h('span', { className: 'dbmcp-hint' }, `${entry.ms ?? 0}ms`),
                      h(
                        'span',
                        { className: entry.ok ? 'dbmcp-audit-ok is-ok' : 'dbmcp-audit-ok is-error' },
                        entry.ok ? t('audit.ok') : t('audit.err'),
                      ),
                      typeof entry.rows === 'number'
                        ? h('span', { className: 'dbmcp-hint' }, t('audit.rows').replace('{n}', String(entry.rows)))
                        : null,
                      entry.sql ? h('code', { className: 'dbmcp-audit-sql' }, entry.sql) : null,
                      entry.error ? h('code', { className: 'dbmcp-audit-sql is-error' }, entry.error) : null,
                    ),
                  ),
              h('p', { className: 'dbmcp-hint' }, t('audit.hint')),
              h('p', { className: 'dbmcp-hint' }, t('audit.tz').replace('{zone}', zoneLabel())),
              audit.file ? h('p', { className: 'dbmcp-hint' }, `${t('audit.file')}: ${audit.file}`) : null,
            ),
          ),
        )
      }

      /* Sub-views get the same full-width column the list uses: a bare Card in
         the panel's flex row would shrink to the intrinsic width of its inputs. */
      if (view.mode === 'create' || view.mode === 'edit' || view.mode === 'schema' || view.mode === 'import') {
        body = h('div', { className: 'dbmcp-grid is-single' }, body)
      }

      return h(
        'div',
        { className: 'dbmcp-page', style: palette },
        h('style', null, CSS),
        h(
          'header',
          { className: 'dbmcp-masthead' },
          h(
            'button',
            { type: 'button', className: 'dbmcp-back', onClick: backToChat },
            h('span', { className: 'dbmcp-back-caret', 'aria-hidden': 'true' }, '‹'),
            t('header.backToChat'),
          ),
          h('h1', null, t('panel.title')),
          h('span', { className: 'dbmcp-sub' }, t('panel.subtitle')),
          h('span', { className: 'dbmcp-masthead-spacer' }),
          h(
            'span',
            { className: 'dbmcp-pill' },
            h('span', { className: 'dbmcp-dot ' + (apiOk ? 'is-ok' : state.status === 'error' ? 'is-error' : '') }),
            apiOk ? t('state.connected') : state.status === 'loading' ? t('state.loading') : t('state.failed'),
          ),
          h(
            'a',
            {
              className: 'dbmcp-pill dbmcp-star',
              href: REPO_URL,
              target: '_blank',
              rel: 'noreferrer noopener',
              title: t('action.starHint'),
            },
            h('span', { className: 'dbmcp-star-mark', 'aria-hidden': 'true' }, '★'),
            t('action.star'),
          ),
          data && data.plugin ? h('span', { className: 'dbmcp-pill' }, `${data.plugin.name} ${data.plugin.version}`) : null,
        ),
        h(
          'nav',
          { className: 'dbmcp-tabs', role: 'tablist' },
          TABS.map((entry) =>
            h(
              'button',
              {
                key: entry.id,
                type: 'button',
                role: 'tab',
                'aria-selected': tab === entry.id,
                className: 'dbmcp-tab' + (tab === entry.id ? ' is-active' : ''),
                onClick: () => selectTab(entry.id),
              },
              tabLabel(t, entry.id),
            ),
          ),
        ),
        notice
          ? h(
              'div',
              { className: 'dbmcp-notice' + (notice.isError ? ' is-error' : '') },
              h('span', null, notice.message || notice),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setNotice(null) }, '×'),
            )
          : null,
        body,
      )
    }

    return {
      inject: ['slots', 'locale', 'layout', 'theme'],
      /** Parser and components exposed for the offline tests in dev/. */
      __test: {
        TABS,
        tabLabel,
        parseConnectionText,
        uniqueId,
        slugId,
        canonicalUrl,
        emptyDraft,
        draftFromSource,
        SourceForm,
        SchemaView,
        ImportView,
        groupTables,
        tableMatches,
        connectionMatches,
        localClock,
        localStamp,
        TextInput,
        Switch,
        nextReadOnly,
        Card,
        Breadcrumbs,
        MainPanel,
        IdChip,
        kindBadge,
        probeFailed,
        probeReport,
        reportTarget,
        StatusStrip,
        WriteSwitch,
        sourceMatches,
        sectionOrder,
        reorderForDrop,
        paletteOf,
        parseColor,
      },
      apply(ctx) {
        localeService = ctx.locale
        layoutService = ctx.layout || null
        themeService = ctx.theme || null
        /* Two ways the active theme can change under us: the service tells its
           own subscribers, and the host echoes a theme/change event. Listen to
           both; either one invalidates the cached palette. */
        const refreshPalette = () => {
          paletteKey = ''
          themeSubs.forEach((notify) => notify())
        }
        if (themeService && typeof themeService.subscribe === 'function') {
          ctx.effect(() => themeService.subscribe(refreshPalette))
        }
        if (typeof ctx.on === 'function') {
          ctx.effect(() => ctx.on('theme/change', refreshPalette))
        }
        ctx.effect(() => ctx.locale.register(NS, 'en', DICT.en))
        ctx.effect(() => ctx.locale.register(NS, 'zh', DICT.zh))

        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'db-mcp', order: 25, label: () => t('panel.title') },
            SidebarIcon,
          ),
        )

        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'db-mcp' }, MainPanel))
      },
    }
  },
})
