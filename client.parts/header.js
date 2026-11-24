/**
 * dsh-db-mcp — Client half.
 *
 * A plain browser bundle loaded through window.__ModuleLoader__ (same shape as
 * the skill's UI template): no imports of Harness client packages, no iframes,
 * no DOM work outside the component tree, styles from --dsw-alias-* tokens only.
 *
 * The panel owns the data-source registry: create, edit, test, delete, and an
 * importer that reads DBeaver's workspace files. Querying is never done here —
 * the agent reaches these sources through the Python MCP server (P3).
 */
window.__ModuleLoader__.load({
  id: 'dsh-db-mcp',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement

    const NS = 'db-mcp'
    /** Top-level tabs of the panel. `sources` also hosts the create/edit/import/structure views. */
    const TABS = [
      { id: 'list' },
      { id: 'create' },
      { id: 'import' },
      { id: 'graph' },
      { id: 'trace' },
      { id: 'clients' },
      { id: 'runtime' },
      { id: 'tools' },
      { id: 'audit' },
    ]

    /** Tab labels stay literal so the i18n check can see every key. */
    function tabLabel(t, id) {
      if (id === 'create') return t('tab.create')
      if (id === 'import') return t('tab.import')
      if (id === 'graph') return t('tab.graph')
      if (id === 'trace') return t('tab.trace')
      if (id === 'runtime') return t('tab.runtime')
      if (id === 'clients') return t('tab.clients')
      if (id === 'tools') return t('tab.tools')
      if (id === 'audit') return t('tab.audit')
      return t('tab.list')
    }

    /** The tab that owns a view; the form and the schema browser live under a tab. */
    function tabOfMode(mode) {
      if (mode === 'create' || mode === 'edit') return 'create'
      if (mode === 'import') return 'import'
      if (mode === 'graph') return 'graph'
      if (mode === 'trace') return 'trace'
      if (mode === 'runtime') return 'runtime'
      if (mode === 'clients') return 'clients'
      if (mode === 'tools') return 'tools'
      if (mode === 'audit') return 'audit'
      return 'list'
    }
    const API = '/plugins/db-mcp/api'
    // Kept in step with `repository.url` in package.json: the masthead links here
    // for the docs, the issues and the star button alike.
    const REPO_URL = 'https://github.com/halcyon6669/dsh-db-mcp'
    const KINDS = ['sqlite', 'postgres', 'gauss', 'mysql', 'oracle']
    const DEFAULT_PORTS = { postgres: '5432', gauss: '5432', mysql: '3306', oracle: '1521' }

    /** Set by apply(); bind() reads the active locale at call time, so only the
     *  re-render subscription has to live on the component side. */
    let localeService = null
    let layoutService = null

