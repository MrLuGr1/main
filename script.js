(() => {
  'use strict';

  const STORAGE_KEY = 'pixel-desk-projects-v1';
  const DELETED_IDS_KEY = 'pixel-desk-deleted-ids-v1';
  const ADMIN_SESSION_KEY = 'pixel-desk-admin-session-v1';
  const ADMIN_SESSION_TTL_MS = 30 * 60 * 1000;
  const PROJECT_SYNC_INTERVAL_MS = 15 * 1000;
  // This URL is public configuration, not a secret. Passwords and session tokens never go in source control.
  const API_BASE = (document.querySelector('meta[name="pixel-desk-api"]')?.content || '').trim().replace(/\/$/, '');
  const REMOVED_BUILTIN_IDS = new Set(['dos-tools-folder', 'dos-penetration-test', 'dos-request-spammer']);
  const REMOVED_DEMO_IDS = new Set(['demo-1', 'demo-2', 'demo-3', 'demo-4', 'demo-5', 'demo-6']);
  const REMOVED_TEST_IDS = new Set(['4c6e3b56-087f-435f-bd27-f17ab0ce0a38', '483dce28-6db4-4f01-8979-c5aea3fd8ce3']);
  const REMOVED_DEMO_NAMES = new Set(['portfolio', 'portfolio 2025', 'pixel garden', 'weather app', 'moodboard', 'study tracker', 'study stracker', 'tiny tools']);
  const categoryInfo = {
    web: { label: 'Web & aplikace', icon: 'web', iconClass: 'web' },
    design: { label: 'Design', icon: 'design', iconClass: 'design' },
    code: { label: 'Vývoj', icon: 'code', iconClass: 'code' },
    other: { label: 'Ostatní', icon: 'folder', iconClass: 'other' },
  };
  const starterProjects = [];
  // Offline fallback only. When the shared API responds, projects.json is the source of truth,
  // so an admin deletion is not undone by a hard-coded starter entry.
  const qrMakerFallback = { id: 'qr-maker', name: 'QR maker', description: 'Lokální generátor QR kódů pro odkazy, zprávy i platby.', url: 'QR_maker/index.html', category: 'web', favorite: false };

  function withQrMakerFallback(list) {
    return list.some(project => project.id === qrMakerFallback.id) ? list : [...list, qrMakerFallback];
  }

  function isRemovedDemoProject(project) {
    const normalizedName = typeof project?.name === 'string' ? project.name.trim().toLocaleLowerCase('cs') : '';
    return REMOVED_DEMO_IDS.has(project?.id) || REMOVED_DEMO_NAMES.has(normalizedName);
  }

  const grid = document.querySelector('#project-grid');
  const search = document.querySelector('#search');
  const dialog = document.querySelector('#project-dialog');
  const form = document.querySelector('#project-form');
  const categorySelect = document.querySelector('#project-category');
  let activeFilter = 'all';
  let activeFolder = null;
  let query = '';
  let toastTimer;
  let adminToken = '';
  let isAdmin = false;
  let editingProjectId = '';
  let faviconRequestId = 0;
  // Invalidates project-list requests that began before a successful mutation.
  let projectStateRevision = 0;
  let adminSessionExpiresAt = 0;
  let adminSessionTimer = 0;
  let restoringAdminSession = false;
  let formHasUnsavedChanges = false;
  let mutationInFlight = false;
  let confirmationResolver = null;
  let lastCloudflareSync = null;
  let syncError = false;
  let projectSyncChannel = null;
  try { projectSyncChannel = new BroadcastChannel('pixel-desk-projects-v1'); } catch { /* Polling still synchronizes private windows and unsupported browsers. */ }

  function updateSyncStatus() {
    const status = document.querySelector('#sync-status');
    if (!status) return;
    if (syncError) {
      status.textContent = 'Cloudflare sync: chyba';
      status.dataset.state = 'error';
      return;
    }
    status.dataset.state = lastCloudflareSync ? 'ok' : 'waiting';
    status.textContent = lastCloudflareSync
      ? `Cloudflare sync: ${new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(lastCloudflareSync)}`
      : 'Cloudflare sync: čeká…';
  }

  function markCloudflareSync() {
    lastCloudflareSync = new Date();
    syncError = false;
    updateSyncStatus();
  }

  function setSyncError() {
    syncError = true;
    updateSyncStatus();
  }

  function confirmAdminChange(title, message, confirmLabel = 'Potvrdit a uložit') {
    if (!isAdmin) return Promise.resolve(false);
    const confirmDialog = document.querySelector('#admin-confirm-dialog');
    document.querySelector('#confirm-title').textContent = title;
    document.querySelector('#confirm-message').textContent = message;
    document.querySelector('#accept-confirm').textContent = confirmLabel;
    return new Promise(resolve => {
      confirmationResolver = resolve;
      confirmDialog.showModal();
    });
  }

  function resolveConfirmation(accepted) {
    const resolve = confirmationResolver;
    confirmationResolver = null;
    if (resolve) resolve(accepted);
    const confirmDialog = document.querySelector('#admin-confirm-dialog');
    if (confirmDialog.open) confirmDialog.close();
  }

  // One local SVG set: no icon fonts, emoji rendering differences or external requests.
  function pixelIcon(kind) {
    const paths = {
      web: 'M3 4h18v16H3z M3 9h18 M7 6v1 M10 6v1 M7 13h10 M7 16h6',
      folder: 'M3 7V4h7l3 3h8v13H3z M3 10h18',
      design: 'M4 4h16v16H4z M4 15h4v-4h4v-4h8 M15 15h2v2h-2z',
      code: 'M9 6L3 12l6 6 M15 6l6 6-6 6',
      home: 'M3 11h3V8h3V5h6v3h3v3h3 M6 11v9h5v-6h2v6h5v-9',
      star: 'M10 3h4v6h7v4h-4v7l-5-3-5 3v-7H3V9h7z',
      sun: 'M8 8h8v8H8z M12 1v3 M12 20v3 M1 12h3 M20 12h3 M4 4l2 2 M18 18l2 2 M20 4l-2 2 M6 18l-2 2',
      moon: 'M10 3H6v3H3v12h3v3h12v-3h3v-4h-7v-3h-4z',
      lock: 'M7 10V4h10v6 M4 10h16v11H4z M12 14v3',
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'pixel-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', paths[kind] || paths.folder);
    svg.append(path);
    return svg;
  }
  document.querySelectorAll('[data-pixel-icon]').forEach(element => element.replaceChildren(pixelIcon(element.dataset.pixelIcon)));

  function readDeletedProjectIds() {
    try {
      const saved = JSON.parse(localStorage.getItem(DELETED_IDS_KEY) || '[]');
      return new Set(Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : []);
    } catch { return new Set(); }
  }

  function rememberDeletedProject(id) {
    const deleted = readDeletedProjectIds();
    deleted.add(id);
    try { localStorage.setItem(DELETED_IDS_KEY, JSON.stringify([...deleted])); }
    catch (error) { console.warn('Odstranění se nepodařilo uložit do místní ochrany seznamu.', error); }
  }

  function readProjects() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        const projects = JSON.parse(saved);
        if (Array.isArray(projects)) {
          const deletedIds = readDeletedProjectIds();
          const retained = projects.filter(project => !deletedIds.has(project?.id) && !REMOVED_BUILTIN_IDS.has(project?.id) && !REMOVED_TEST_IDS.has(project?.id) && !isRemovedDemoProject(project));
          if (retained.length !== projects.length) {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(retained)); } catch { /* The visible list is still cleaned for this session. */ }
          }
          const valid = retained.filter(isValidProject);
          return withQrMakerFallback([...valid, ...starterProjects.filter(project => !valid.some(savedProject => savedProject.id === project.id))]);
        }
      }
    } catch (error) {
      console.warn('Projekty se nepodařilo načíst z localStorage.', error);
    }
    return withQrMakerFallback(starterProjects);
  }

  function isValidProject(project) {
    return project && typeof project.id === 'string' && typeof project.name === 'string' &&
      typeof project.url === 'string' && categoryInfo[project.category] && !REMOVED_TEST_IDS.has(project.id) && !isRemovedDemoProject(project);
  }

  function validFaviconUrl(value) {
    if (typeof value !== 'string' || value.length > 1000) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }

  let projects = readProjects();

  function saveProjects() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      return true;
    } catch (error) {
      console.warn('Projekty se nepodařilo uložit do localStorage.', error);
      return false;
    }
  }

  async function apiRequest(path, options = {}) {
    if (!API_BASE) throw new Error('Zabezpečené API ještě není nakonfigurováno.');
    const isLogin = path === '/api/login';
    const isPublicRead = path === '/api/projects' && (!options.method || options.method === 'GET');
    if (!isLogin && !isPublicRead && (!isAdmin || !adminToken || !ensureAdminSession())) {
      throw new Error('Přihlášení správce vypršelo. Přihlas se znovu.');
    }
    const headers = new Headers(options.headers || {});
    if (options.body) headers.set('Content-Type', 'application/json');
    if (adminToken) headers.set('Authorization', `Bearer ${adminToken}`);
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      ...(options.method ? {} : { cache: 'no-store' }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `API vrátilo chybu ${response.status}.`);
      error.status = response.status;
      if (response.status === 401 && !isLogin) expireAdminSession();
      throw error;
    }
    return payload;
  }

  async function loadSharedProjects({ quiet = false } = {}) {
    if (!API_BASE) return;
    if (mutationInFlight) return;
    const requestRevision = projectStateRevision;
    try {
      const result = await apiRequest('/api/projects');
      // A slower initial GET must never undo a newer add/edit/delete response.
      if (requestRevision !== projectStateRevision || mutationInFlight) return;
      const deletedIds = readDeletedProjectIds();
      const custom = Array.isArray(result.projects) ? result.projects.filter(project => !deletedIds.has(project?.id) && isValidProject(project)) : [];
      projects = [...starterProjects, ...custom];
      saveProjects();
      markCloudflareSync();
      render();
    } catch (error) {
      console.warn('Sdílené projekty se nepodařilo načíst.', error);
      if (quiet) {
        setSyncError();
        return;
      }
      projects = withQrMakerFallback(projects);
      render();
      setSyncError();
      showToast('Sdílený seznam není dostupný; zobrazuji místní kopii.');
    }
  }

  function filteredProjects() {
    const scopedProjects = activeFolder
      ? projects.filter(project => project.parentId === activeFolder)
      : projects.filter(project => !project.parentId);
    return scopedProjects.filter(project => {
      const matchesFilter = activeFilter === 'all' ||
        (activeFilter === 'favorite' ? project.favorite : project.category === activeFilter);
      const needle = query.trim().toLocaleLowerCase('cs');
      const matchesQuery = !needle || `${project.name} ${project.description || ''} ${categoryInfo[project.category].label}`.toLocaleLowerCase('cs').includes(needle);
      return matchesFilter && matchesQuery;
    });
  }

  function render() {
    const shown = filteredProjects();
    grid.replaceChildren(...shown.map(makeCard));
    const empty = document.querySelector('#empty-state');
    empty.hidden = shown.length > 0;
    document.querySelector('#empty-title').textContent = query || activeFilter !== 'all' ? 'Žádné výsledky' : 'Žádné projekty';
    document.querySelector('#empty-copy').textContent = query || activeFilter !== 'all' ? 'Zkus jiné hledání nebo kategorii.' : 'Správce může přidat nový projekt.';
    document.querySelector('#all-count').textContent = projects.filter(project => !project.parentId).length;
    const count = `${shown.length} ${shown.length === 1 ? 'položka' : shown.length >= 2 && shown.length <= 4 ? 'položky' : 'položek'}`;
    document.querySelector('#bottom-count').textContent = count;
    document.querySelector('#status-count').textContent = count;
    const active = document.querySelector('.nav-item.active');
    const heading = activeFolder ? projects.find(project => project.id === activeFolder)?.name : active?.dataset.filter === 'favorite' ? 'Oblíbené' : active?.classList.contains('category-link') ? categoryInfo[active.dataset.filter].label : 'Všechny projekty';
    document.querySelector('#pane-heading').firstChild.textContent = heading || 'Všechny projekty';
    document.querySelector('#path-current').textContent = activeFolder ? projects.find(project => project.id === activeFolder)?.name || 'Projekty' : 'Projekty';
    document.querySelector('#folder-up').hidden = !activeFolder;
  }

  function makeCard(project) {
    const info = categoryInfo[project.category];
    const card = document.createElement('article');
    card.className = 'project-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', `${project.kind === 'folder' ? 'Otevřít složku' : project.kind === 'python' ? 'Zobrazit zdroj projektu' : 'Otevřít projekt'} ${project.name}`);

    const top = document.createElement('div');
    top.className = 'card-top';
    const icon = document.createElement('span');
    icon.className = `project-icon ${info.iconClass}`;
    icon.setAttribute('aria-hidden', 'true');
    const fallbackIcon = project.kind === 'folder' ? 'folder' : project.kind === 'python' ? 'code' : info.icon;
    const favicon = validFaviconUrl(project.iconUrl);
    if (favicon && project.kind !== 'folder' && project.kind !== 'python') {
      const image = document.createElement('img');
      image.src = favicon;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => { icon.replaceChildren(pixelIcon(fallbackIcon)); }, { once: true });
      icon.append(image);
    } else {
      icon.append(pixelIcon(fallbackIcon));
    }
    if (project.kind === 'folder') icon.classList.add('folder-icon');
    if (project.kind === 'python') icon.classList.add('python-icon');
    const favorite = document.createElement('span');
    favorite.className = 'project-favorite';
    favorite.textContent = '★';
    favorite.title = 'Oblíbený projekt';
    favorite.hidden = !project.favorite;
    top.append(icon, favorite);

    const name = document.createElement('h2');
    name.className = 'project-name';
    name.textContent = project.name;
    const description = document.createElement('p');
    description.className = 'project-description';
    description.textContent = project.description || 'Bez popisu';
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    const category = document.createElement('span');
    category.className = 'card-category';
    category.textContent = project.kind === 'folder' ? 'Složka' : isPythonFileProject(project) ? 'Python skript' : info.label;
    const open = document.createElement('span');
    open.className = 'card-open';
    open.textContent = project.kind === 'folder' ? '›' : isPythonFileProject(project) ? '⌕' : '↗';
    open.setAttribute('aria-hidden', 'true');
    footer.append(category, open);
    card.append(top, name, description, footer);
    // Admin controls are omitted from the public DOM entirely.
    if (isAdmin && !project.builtin) {
      const actions = document.createElement('div');
      actions.className = 'card-actions';
      const edit = document.createElement('button');
      edit.className = 'card-edit admin-only';
      edit.type = 'button';
      edit.textContent = 'Upravit';
      edit.setAttribute('aria-label', `Upravit projekt ${project.name}`);
      edit.addEventListener('click', event => {
        event.stopPropagation();
        if (isAdmin) showDialog(project);
      });
      const remove = document.createElement('button');
      remove.className = 'card-delete admin-only';
      remove.type = 'button';
      remove.textContent = 'Odebrat';
      remove.setAttribute('aria-label', `Odebrat projekt ${project.name}`);
      remove.addEventListener('click', async event => {
        event.stopPropagation();
        if (!isAdmin) return;
        if (remove.disabled) return;
        const accepted = await confirmAdminChange('Odebrat projekt', `Opravdu chceš trvale odebrat „${project.name}“ ze sdíleného seznamu?`, 'Odebrat projekt');
        if (!accepted || !isAdmin) return;
        remove.disabled = true;
        mutationInFlight = true;
        projectStateRevision += 1;
        try {
          const result = await apiRequest(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
          rememberDeletedProject(project.id);
          projectStateRevision += 1;
          projects = Array.isArray(result.projects)
            ? [...starterProjects, ...result.projects.filter(isValidProject)]
            : projects.filter(item => item.id !== project.id);
          saveProjects();
          markCloudflareSync();
          projectSyncChannel?.postMessage({ type: 'changed' });
          render();
          showToast('Projekt byl odebrán ze sdíleného seznamu.');
        } catch (error) {
          if (error.status === 404) {
            rememberDeletedProject(project.id);
            // The backend is already authoritative: remove stale UI even if another
            // tab or an earlier request deleted this item first.
            projectStateRevision += 1;
            projects = projects.filter(item => item.id !== project.id);
            saveProjects();
            render();
            showToast('Projekt už ve sdíleném seznamu není; zobrazení bylo synchronizováno.');
          } else {
            showToast(`Projekt se nepodařilo odebrat: ${error.message}`);
            remove.disabled = false;
          }
        } finally {
          mutationInFlight = false;
          loadSharedProjects({ quiet: true });
        }
      });
      actions.append(edit, remove);
      card.append(actions);
    }
    card.addEventListener('click', () => {
      if (project.kind === 'folder') {
        enterFolder(project.id);
      } else if (isPythonFileProject(project)) {
        showPythonTerminal(project);
      } else {
        openProject(project.url);
      }
    });
    card.addEventListener('keydown', event => {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (project.kind === 'folder') enterFolder(project.id);
        else if (isPythonFileProject(project)) showPythonTerminal(project);
        else openProject(project.url);
      }
    });
    return card;
  }

  function enterFolder(folderId) {
    activeFolder = folderId;
    activeFilter = 'all';
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.filter === 'all'));
    render();
  }

  function showPythonTerminal(project) {
    const filePath = project.url.trim();
    const sourceInput = document.querySelector('#project-source-file');
    const sourceOutput = document.querySelector('#project-source');
    document.querySelector('#terminal-title').textContent = project.name;
    document.querySelector('#terminal-project-path').textContent = `web\\${filePath.replaceAll('/', '\\')}`;
    sourceOutput.textContent = 'Načítání zdrojového souboru…';
    sourceInput.value = '';
    const inspector = document.querySelector('#project-source-dialog');
    inspector.showModal();
    const url = filePath;
    const status = document.querySelector('#project-source-status');
    const localDiskPath = /^[a-zA-Z]:[\\/]/.test(filePath) || /^\\\\/.test(filePath) || /^file:/i.test(filePath);
    if (location.protocol === 'file:' || localDiskPath) {
      showFallbackSource(project, location.protocol === 'file:'
        ? 'Přímé načítání lokálních souborů prohlížeč blokuje.'
        : 'Lokální cestu nelze načíst automaticky.');
      return;
    }
    status.textContent = 'Čtu zdroj pouze pro náhled…';
    fetch(url).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    }).then(source => {
      if (source.trim()) {
        setSource(source, filePath.split('/').at(-1));
        status.textContent = 'Zdrojový soubor načten · zvýraznění syntaxe aktivní.';
      } else {
        showFallbackSource(project, 'Originální soubor je prázdný.');
      }
    }).catch(error => {
      showFallbackSource(project, `Originál se nepodařilo načíst (${error.message}).`);
    });
  }

  function showFallbackSource(project, reason) {
    const filename = project.name + ' · ukázka';
    const example = `# Ukázka pro čtení — nejde o obsah originálního souboru.\n# Vyberte .py soubor tlačítkem výše pro zobrazení jeho skutečného obsahu.\n\ndef preview_source(filename):\n    return f"Zdrojový soubor: {filename}"\n`;
    setSource(example, filename);
    document.querySelector('#project-source-status').textContent = `${reason} Zobrazuji předpřipravenou ukázku; originál načti tlačítkem „Otevřít .py soubor“.`;
  }

  function isPythonFileProject(project) {
    return project.kind === 'python' || /\.py(?:[?#].*)?$/i.test(project.url.trim());
  }

  // Escape every source fragment before inserting only our own highlighting spans.
  function highlightPython(source) {
    const keywords = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
    const builtins = new Set('abs all any bool dict enumerate float int len list max min print range round set str sum tuple zip'.split(' '));
    const operators = new Set('= + - * / // % ** == != < > <= >= := += -= *= /= -> & | ^ ~'.split(' '));
    const pattern = /(#[^\r\n]*|(?:[rubfRUBF]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(?:0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?j?)\b|[A-Za-z_]\w*|[^\s])/g;
    const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    let output = '';
    let cursor = 0;
    for (const match of source.matchAll(pattern)) {
      const token = match[0];
      output += escape(source.slice(cursor, match.index));
      let type = '';
      if (token.startsWith('#')) type = 'comment';
      else if (/^(?:[rubfRUBF]{1,2})?["']/.test(token)) type = 'string';
      else if (/^(?:\d|\.\d)/.test(token)) type = 'number';
      else if (/^(?:True|False|None)$/.test(token)) type = 'constant';
      else if (keywords.has(token)) type = 'keyword';
      else if (builtins.has(token)) type = 'builtin';
      else if (operators.has(token)) type = 'operator';
      const safeToken = escape(token);
      output += type ? `<span class="tok-${type}">${safeToken}</span>` : safeToken;
      cursor = match.index + token.length;
    }
    return output + escape(source.slice(cursor));
  }

  function setSource(source, filename) {
    const output = document.querySelector('#project-source');
    output.innerHTML = source ? highlightPython(source) : '<span class="tok-comment"># (soubor je prázdný)</span>';
    output.scrollTop = 0;
    document.querySelector('#terminal-project-path').textContent = `web\\${filename}`;
  }

  function openProject(rawUrl) {
    const value = rawUrl.trim();
    if (!value || /^(?:javascript|data|file):/i.test(value) || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value)) {
      showToast('Lokální soubory nelze otevřít jako stránku. Vyber .py soubor v náhledu projektu.');
      return;
    }
    let url;
    try { url = new URL(value, location.href); } catch {
      showToast('Tento odkaz není možné otevřít.');
      return;
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      showToast('Odkaz musí být webová adresa HTTP nebo HTTPS.');
      return;
    }
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }

  function showToast(message) {
    const toast = document.querySelector('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function applyAdminMode() {
    document.body.dataset.adminMode = isAdmin ? 'true' : 'false';
    document.querySelectorAll('.admin-only').forEach(element => { element.hidden = !isAdmin; });
    const button = document.querySelector('#admin-toggle');
    button.replaceChildren(pixelIcon('lock'), document.createTextNode(isAdmin ? 'Odhlásit' : 'Admin Login'));
    document.querySelector('#access-label').textContent = isAdmin ? 'Správa projektů' : 'Prohlížení projektů';
    button.setAttribute('aria-label', isAdmin ? 'Odhlásit správce' : 'Přihlášení správce');
    button.title = isAdmin ? 'Odhlásit správce' : 'Přihlásit se jako správce';
  }

  function clearAdminSession() {
    clearTimeout(adminSessionTimer);
    adminSessionTimer = 0;
    adminSessionExpiresAt = 0;
    try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch { /* Storage can be disabled; token is still cleared in memory. */ }
  }

  function expireAdminSession() {
    if (!isAdmin) return;
    if (document.querySelector('#admin-confirm-dialog').open) resolveConfirmation(false);
    if (dialog.open) dialog.close();
    signOutAdmin(true);
  }

  function ensureAdminSession() {
    if (!isAdmin || !adminSessionExpiresAt || Date.now() >= adminSessionExpiresAt) {
      if (isAdmin) expireAdminSession();
      return false;
    }
    return true;
  }

  function scheduleAdminSessionExpiry() {
    clearTimeout(adminSessionTimer);
    const remaining = Math.max(0, adminSessionExpiresAt - Date.now());
    adminSessionTimer = setTimeout(() => {
      if (isAdmin) expireAdminSession();
      else {
        clearAdminSession();
        adminToken = '';
        restoringAdminSession = false;
      }
    }, remaining);
  }

  function startAdminSession(token, serverExpiresAt, lifetimeSeconds = 30 * 60) {
    const startedAt = Date.now();
    adminToken = token;
    isAdmin = true;
    const serverTtl = Number.isFinite(Number(lifetimeSeconds)) ? Number(lifetimeSeconds) * 1000 : ADMIN_SESSION_TTL_MS;
    const clientLimit = startedAt + Math.min(ADMIN_SESSION_TTL_MS, serverTtl);
    adminSessionExpiresAt = Number.isFinite(Number(serverExpiresAt)) && Number(serverExpiresAt) > startedAt
      ? Math.min(clientLimit, Number(serverExpiresAt))
      : clientLimit;
    try {
      sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ startedAt, expiresAt: adminSessionExpiresAt, token }));
    } catch { /* Session remains protected by its in-memory expiry and the Worker token expiry. */ }
    scheduleAdminSessionExpiry();
  }

  async function restoreAdminSession() {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(ADMIN_SESSION_KEY) || 'null'); }
    catch { saved = null; }
    const now = Date.now();
    const validLocalRecord = saved && typeof saved.token === 'string' && saved.token.length > 20 &&
      Number.isFinite(saved.startedAt) && Number.isFinite(saved.expiresAt) &&
      saved.expiresAt > now && saved.expiresAt > saved.startedAt &&
      saved.expiresAt - saved.startedAt <= ADMIN_SESSION_TTL_MS;
    if (!validLocalRecord || !API_BASE) {
      if (saved) clearAdminSession();
      return;
    }

    restoringAdminSession = true;
    adminToken = saved.token;
    adminSessionExpiresAt = saved.expiresAt;
    scheduleAdminSessionExpiry();
    try {
      const response = await fetch(`${API_BASE}/api/session`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      const serverExpiresAt = Number(payload.expiresAt);
      const validatedExpiry = Number.isFinite(serverExpiresAt) ? Math.min(adminSessionExpiresAt, serverExpiresAt) : 0;
      if (!response.ok || payload.valid !== true || validatedExpiry <= Date.now()) {
        clearAdminSession();
        adminToken = '';
        isAdmin = false;
        applyAdminMode();
        render();
        return;
      }
      adminSessionExpiresAt = validatedExpiry;
      try {
        sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ startedAt: saved.startedAt, expiresAt: validatedExpiry, token: saved.token }));
      } catch { /* Server-side expiry validation remains authoritative. */ }
      scheduleAdminSessionExpiry();
      isAdmin = true;
      applyAdminMode();
      render();
      markCloudflareSync();
      showToast('Správcovská relace byla obnovena.');
    } catch (error) {
      // Keep a locally unexpired signed token for this tab; the Worker will still
      // validate every write and reject it if the session is no longer valid.
      isAdmin = true;
      applyAdminMode();
      render();
      console.warn('Relaci správce se nepodařilo ověřit online.', error);
      showToast('Relace obnovena; API není dostupné pro ověření změn.');
    } finally {
      restoringAdminSession = false;
    }
  }

  function signOutAdmin(expired = false) {
    adminToken = '';
    isAdmin = false;
    clearAdminSession();
    applyAdminMode();
    render();
    showToast(expired ? 'Relace správce vypršela. Přihlas se znovu.' : 'Odhlášení správce proběhlo.');
  }

  function showDialog(project = null) {
    if (!isAdmin) return;
    formHasUnsavedChanges = false;
    document.querySelector('#load-favicon').disabled = false;
    form.reset();
    updateSelectIcon();
    editingProjectId = project?.id || '';
    document.querySelector('#dialog-title').textContent = project ? 'Upravit projekt' : 'Nový projekt';
    document.querySelector('#project-id').value = project?.id || '';
    document.querySelector('#project-name').value = project?.name || '';
    document.querySelector('#project-url').value = project?.url || '';
    document.querySelector('#project-description').value = project?.description || '';
    categorySelect.value = project?.category || 'web';
    document.querySelector('#project-favorite').checked = Boolean(project?.favorite);
    document.querySelector('#project-icon-url').value = validFaviconUrl(project?.iconUrl) || '';
    document.querySelector('#save-project-label').textContent = project ? 'Uložit změny' : 'Uložit projekt';
    updateSelectIcon();
    faviconRequestId += 1;
    updateFaviconPreview(document.querySelector('#project-icon-url').value);
    dialog.showModal();
    requestAnimationFrame(() => document.querySelector('#project-name').focus());
  }

  function updateSelectIcon() {
    document.querySelector('#select-emoji').replaceChildren(pixelIcon(categoryInfo[categorySelect.value].icon));
    if (!document.querySelector('#project-icon-url').value) updateFaviconPreview('');
  }

  function updateFaviconPreview(url) {
    const requestId = ++faviconRequestId;
    const preview = document.querySelector('#project-favicon-preview');
    const safeUrl = validFaviconUrl(url);
    const fallback = categoryInfo[categorySelect.value]?.icon || 'web';
    preview.replaceChildren(pixelIcon(fallback));
    if (!safeUrl) return;
    const image = document.createElement('img');
    image.alt = '';
    image.src = safeUrl;
    image.addEventListener('load', () => { if (requestId === faviconRequestId) preview.replaceChildren(image); }, { once: true });
    image.addEventListener('error', () => {
      if (requestId !== faviconRequestId) return;
      document.querySelector('#project-icon-url').value = '';
      document.querySelector('#favicon-status').textContent = 'Ikonu se nepodařilo načíst; použije se pixelová ikona.';
    }, { once: true });
  }

  async function fetchProjectFavicon() {
    const status = document.querySelector('#favicon-status');
    const button = document.querySelector('#load-favicon');
    let url;
    try {
      url = new URL(document.querySelector('#project-url').value.trim());
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
    } catch {
      document.querySelector('#project-icon-url').value = '';
      updateFaviconPreview('');
      status.textContent = 'Zadej platnou webovou adresu http:// nebo https://.';
      return;
    }
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`;
    const requestId = ++faviconRequestId;
    button.disabled = true;
    status.textContent = 'Načítám ikonu webu…';
    const image = new Image();
    image.onload = () => {
      if (requestId !== faviconRequestId) return;
      document.querySelector('#project-icon-url').value = faviconUrl;
      document.querySelector('#project-favicon-preview').replaceChildren(image);
      status.textContent = `Favicon načtena pro ${url.hostname}.`;
      button.disabled = false;
    };
    image.onerror = () => {
      if (requestId !== faviconRequestId) return;
      document.querySelector('#project-icon-url').value = '';
      updateFaviconPreview('');
      status.textContent = 'Načtení selhalo; použije se pixelová ikona.';
      button.disabled = false;
    };
    image.src = faviconUrl;
  }

  document.querySelector('#open-add').addEventListener('click', () => showDialog());
  document.querySelector('#empty-add').addEventListener('click', () => showDialog());
  document.querySelector('#load-favicon').addEventListener('click', fetchProjectFavicon);
  document.querySelector('#project-url').addEventListener('input', () => {
    faviconRequestId += 1;
    document.querySelector('#load-favicon').disabled = false;
    document.querySelector('#project-icon-url').value = '';
    updateFaviconPreview('');
    document.querySelector('#favicon-status').textContent = 'Pro tuto adresu lze načíst faviconu.';
  });
  const adminDialog = document.querySelector('#admin-dialog');
  const adminLoginForm = document.querySelector('#admin-login-form');
  const adminPassword = document.querySelector('#admin-password');
  const adminLoginStatus = document.querySelector('#admin-login-status');
  document.querySelector('#accept-confirm').addEventListener('click', () => resolveConfirmation(true));
  document.querySelector('#cancel-confirm').addEventListener('click', () => resolveConfirmation(false));
  document.querySelector('#close-confirm').addEventListener('click', () => resolveConfirmation(false));
  document.querySelector('#admin-confirm-dialog').addEventListener('cancel', event => {
    event.preventDefault();
    resolveConfirmation(false);
  });
  form.addEventListener('input', () => { if (isAdmin && dialog.open) formHasUnsavedChanges = true; });
  form.addEventListener('change', () => { if (isAdmin && dialog.open) formHasUnsavedChanges = true; });
  dialog.addEventListener('close', () => { formHasUnsavedChanges = false; });
  document.querySelector('#admin-toggle').addEventListener('click', () => {
    if (restoringAdminSession) return;
    if (isAdmin) {
      signOutAdmin();
      return;
    }
    adminLoginStatus.textContent = '';
    adminDialog.showModal();
    requestAnimationFrame(() => adminPassword.focus());
  });
  document.querySelector('#close-admin-dialog').addEventListener('click', () => adminDialog.close());
  document.querySelector('#cancel-admin-login').addEventListener('click', () => adminDialog.close());
  adminLoginForm.addEventListener('submit', async event => {
    event.preventDefault();
    adminLoginStatus.textContent = '';
    if (!adminLoginForm.reportValidity()) return;
    try {
      const result = await apiRequest('/api/login', { method: 'POST', body: JSON.stringify({ password: adminPassword.value }) });
      if (typeof result.token !== 'string' || !result.token) throw new Error('Server nevrátil platnou relaci.');
      startAdminSession(result.token, result.expiresAt, result.expiresIn);
      adminPassword.value = '';
      adminDialog.close();
      applyAdminMode();
      render();
      showToast('Správcovský režim aktivní.');
    } catch (error) {
      adminLoginStatus.textContent = error.message === 'Heslo není správné.' ? error.message : `Přihlášení se nepodařilo: ${error.message}`;
      adminPassword.value = '';
      adminPassword.focus();
    }
  });
  document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
  document.querySelector('#cancel-dialog').addEventListener('click', () => dialog.close());
  categorySelect.addEventListener('change', updateSelectIcon);
  search.addEventListener('input', () => { query = search.value; render(); });
  document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => {
    activeFolder = null;
    document.querySelector('.nav-item.active')?.classList.remove('active');
    item.classList.add('active');
    activeFilter = item.dataset.filter;
    render();
  }));
  document.querySelector('#folder-up').addEventListener('click', () => { activeFolder = null; render(); });
  document.querySelector('#close-terminal').addEventListener('click', () => document.querySelector('#project-source-dialog').close());
  document.querySelector('#cancel-terminal').addEventListener('click', () => document.querySelector('#project-source-dialog').close());
  document.querySelector('#project-source-file').addEventListener('change', async event => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const status = document.querySelector('#project-source-status');
    if (!file.name.toLocaleLowerCase().endsWith('.py')) {
      document.querySelector('#project-source').textContent = 'Vybraný soubor nemá příponu .py.';
      status.textContent = 'Vybraný soubor nemá příponu .py.';
      return;
    }
    status.textContent = `Načítám ${file.name}…`;
    try {
      setSource(await file.text(), file.name);
      status.textContent = `Načteno ${file.name} · pouze pro čtení.`;
    } catch (error) {
      document.querySelector('#project-source').textContent = 'Soubor se nepodařilo přečíst.';
      status.textContent = `Soubor se nepodařilo přečíst (${error.message}).`;
    }
  });
  document.querySelector('#view-toggle').addEventListener('click', event => {
    const list = document.querySelector('.projects-pane').classList.toggle('list-view');
    event.currentTarget.setAttribute('aria-label', list ? 'Přepnout na zobrazení ikon' : 'Přepnout na seznam');
    event.currentTarget.title = list ? 'Zobrazení seznamu' : 'Zobrazení ikon';
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!isAdmin || mutationInFlight) return;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const project = {
      id: editingProjectId || globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: String(data.get('name')).trim(),
      description: String(data.get('description') || '').trim(),
      url: String(data.get('url')).trim(),
      category: String(data.get('category')),
      favorite: data.get('favorite') === 'on',
      iconUrl: validFaviconUrl(String(data.get('iconUrl') || '')),
      parentId: (editingProjectId ? projects.find(item => item.id === editingProjectId)?.parentId : activeFolder) || undefined,
    };
    if (!project.name || !project.url) return;
    const wasEditing = Boolean(editingProjectId);
    const accepted = await confirmAdminChange(
      wasEditing ? 'Uložit úpravy projektu' : 'Přidat projekt',
      wasEditing ? `Uložit změny projektu „${project.name}“ do sdíleného seznamu?` : `Přidat „${project.name}“ do sdíleného seznamu?`,
    );
    if (!accepted || !isAdmin) return;
    mutationInFlight = true;
    projectStateRevision += 1;
    let savedResult;
    try {
      const method = editingProjectId ? 'PUT' : 'POST';
      const endpoint = editingProjectId ? `/api/projects/${encodeURIComponent(editingProjectId)}` : '/api/projects';
      savedResult = await apiRequest(endpoint, { method, body: JSON.stringify(project) });
    } catch (error) {
      mutationInFlight = false;
      showToast(`Projekt se nepodařilo uložit: ${error.message}`);
      loadSharedProjects({ quiet: true });
      return;
    }
    projectStateRevision += 1;
    if (Array.isArray(savedResult.projects)) {
      const deletedIds = readDeletedProjectIds();
      projects = [...starterProjects, ...savedResult.projects.filter(item => !deletedIds.has(item?.id) && isValidProject(item))];
    } else if (editingProjectId) {
      const index = projects.findIndex(item => item.id === editingProjectId);
      if (index >= 0) projects[index] = project;
    } else {
      projects.unshift(project);
    }
    saveProjects();
    markCloudflareSync();
    projectSyncChannel?.postMessage({ type: 'changed' });
    mutationInFlight = false;
    activeFilter = 'all';
    query = '';
    search.value = '';
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.filter === 'all'));
    render();
    formHasUnsavedChanges = false;
    dialog.close();
    showToast(editingProjectId ? 'Změny projektu byly uloženy.' : 'Projekt přidán do sdíleného rozcestníku.');
    editingProjectId = '';
    loadSharedProjects({ quiet: true });
  });

  // Small, square canvas particles keep the trail light and crisp at any screen size.
  function startPixelTrail() {
    const canvas = document.querySelector('#pixel-trail');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles = [];
    let lastSpawn = 0;
    let frame = 0;
    const colors = ['#6a9690', '#b8cbbf', '#d5bd80'];
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resize, { passive: true });
    resize();
    window.addEventListener('pointermove', event => {
      const now = performance.now();
      if (event.pointerType === 'touch' || matchMedia('(prefers-reduced-motion: reduce)').matches || now - lastSpawn < 24) return;
      lastSpawn = now;
      for (let i = 0; i < 2; i++) {
        particles.push({ x: event.clientX + (Math.random() - .5) * 9, y: event.clientY + (Math.random() - .5) * 9,
          vx: (Math.random() - .5) * .55, vy: (Math.random() - .5) * .65 - .15, life: 1,
          decay: .018 + Math.random() * .016, size: Math.random() > .75 ? 5 : 3, color: colors[Math.floor(Math.random() * colors.length)] });
      }
      if (!frame) frame = requestAnimationFrame(draw);
    }, { passive: true });
    function draw() {
      frame = 0;
      context.clearRect(0, 0, width, height);
      particles = particles.filter(particle => particle.life > 0);
      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += .008;
        particle.life -= particle.decay;
        context.globalAlpha = Math.max(0, particle.life) * .8;
        context.fillStyle = particle.color;
        context.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
      }
      context.globalAlpha = 1;
      if (particles.length) frame = requestAnimationFrame(draw);
    }
  }

  function updateClock() {
    document.querySelector('#clock').textContent = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  }

  const themeKey = 'pixel-desk-theme-v1';
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const dark = theme === 'dark';
    const button = document.querySelector('#theme-toggle');
    button.setAttribute('aria-label', dark ? 'Přepnout na světlý režim' : 'Přepnout na tmavý režim');
    button.title = dark ? 'Přepnout na světlý režim' : 'Přepnout na tmavý režim';
    document.querySelector('#theme-label').textContent = dark ? 'Světlý režim' : 'Tmavý režim';
    button.querySelector('.theme-icon').replaceChildren(pixelIcon(dark ? 'sun' : 'moon'));
    document.querySelector('meta[name="theme-color"]').content = dark ? '#101e26' : '#c7d5d8';
  }
  let currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  applyTheme(currentTheme);
  document.querySelector('#theme-toggle').addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
    try { localStorage.setItem(themeKey, currentTheme); }
    catch (error) { console.warn('Motiv se nepodařilo uložit.', error); }
  });

  const weatherFallback = { latitude: 50.0755, longitude: 14.4378, place: 'Praha · výchozí' };
  const weatherPlace = document.querySelector('#weather-place');
  const weatherTemperature = document.querySelector('#weather-temperature');
  const weatherHumidity = document.querySelector('#weather-humidity');

  function cityFromTimezone(timezone) {
    const city = (timezone || '').split('/').pop()?.replaceAll('_', ' ');
    const common = { Prague: 'Praha', Berlin: 'Berlín', Vienna: 'Vídeň', Bratislava: 'Bratislava', Budapest: 'Budapešť', Warsaw: 'Varšava', London: 'Londýn', Paris: 'Paříž', Rome: 'Řím' };
    return common[city] || city || 'Místní počasí';
  }

  async function reverseGeocode(latitude, longitude) {
    const endpoint = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    endpoint.search = new URLSearchParams({ latitude, longitude, localityLanguage: 'cs' });
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error('Pojmenování polohy se nezdařilo.');
    const data = await response.json();
    return data.city || data.locality || data.principalSubdivision;
  }

  async function loadWeather(latitude, longitude, knownPlace = '') {
    weatherPlace.textContent = knownPlace || 'Načítám počasí…';
    weatherTemperature.textContent = '--°';
    weatherHumidity.textContent = '--%';
    document.querySelector('#weather-symbol').textContent = '…';
    try {
      const params = new URLSearchParams({ latitude, longitude, current: 'temperature_2m,relative_humidity_2m', timezone: 'auto' });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      if (!response.ok) throw new Error('Počasí není dostupné.');
      const data = await response.json();
      if (!data.current || !Number.isFinite(data.current.temperature_2m) || !Number.isFinite(data.current.relative_humidity_2m)) throw new Error('Odpověď počasí nemá potřebné údaje.');
      const place = knownPlace || await reverseGeocode(latitude, longitude).catch(() => cityFromTimezone(data.timezone));
      weatherPlace.textContent = place;
      weatherTemperature.textContent = `${Math.round(data.current.temperature_2m)}°`;
      weatherHumidity.textContent = `${Math.round(data.current.relative_humidity_2m)}%`;
      document.querySelector('#weather-symbol').replaceChildren(pixelIcon('sun'));
    } catch (error) {
      console.warn('Počasí se nepodařilo načíst.', error);
      weatherPlace.textContent = 'Počasí nedostupné';
      document.querySelector('#weather-symbol').textContent = '☁';
    }
  }

  function useFallbackWeather() {
    weatherPlace.textContent = 'Poloha nedostupná · Praha';
    loadWeather(weatherFallback.latitude, weatherFallback.longitude, weatherFallback.place);
  }

  function requestLocalWeather() {
    weatherPlace.textContent = 'Zjišťuji polohu…';
    if (!navigator.geolocation) {
      useFallbackWeather();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => loadWeather(position.coords.latitude, position.coords.longitude),
      () => useFallbackWeather(),
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 600_000 },
    );
  }
  document.querySelector('#weather-refresh').addEventListener('click', requestLocalWeather);

  // Refresh when the visitor grants geolocation, then keep local weather current.
  if (navigator.permissions?.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(permission => {
      let refreshTimer;
      const syncPermission = () => {
        if (permission.state === 'granted') {
          requestLocalWeather();
          if (!refreshTimer) refreshTimer = setInterval(requestLocalWeather, 15 * 60 * 1000);
        } else if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = undefined;
        }
      };
      permission.addEventListener('change', syncPermission);
      if (permission.state === 'granted') syncPermission();
    }).catch(() => { /* Geolocation still works through the refresh button. */ });
  }

  // Low-resolution layers are painted once per resize/theme change. Only their
  // offsets change during parallax; no continuous animation runs while idle.
  function startPixelLandscape() {
    const canvas = document.querySelector('#pixel-landscape');
    const context = canvas.getContext('2d');
    if (!context) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const pane = document.querySelector('.projects-pane');
    let layers = [];
    let sky = '';
    let frame = 0;
    let lastTime = 0;
    let x = 0, y = 0, targetX = 0, targetY = 0, scroll = 0;
    const margin = 20;

    function build() {
      const scale = Math.max(4, Math.ceil(innerWidth / 640));
      canvas.width = Math.ceil(innerWidth / scale);
      canvas.height = Math.ceil(innerHeight / scale);
      context.imageSmoothingEnabled = false;
      const w = canvas.width + margin * 2;
      const h = canvas.height + margin * 2;
      const dark = document.documentElement.dataset.theme === 'dark';
      const palette = dark
        ? ['#101e26', '#2b4049', '#b9c9bc', '#364b53', '#293f46', '#1b3439', '#10292e']
        : ['#c7d5d8', '#dfe6e3', '#e9d7a7', '#a2b9b9', '#8aa5a3', '#6d8e89', '#4f736d'];
      sky = palette[0];
      layers = [];
      for (let i = 0; i < 4; i++) {
        const layer = document.createElement('canvas');
        layer.width = w; layer.height = h;
        const c = layer.getContext('2d');
        if (i === 0) {
          // Stepped clouds and sun/moon, kept in the open sky above the ridges.
          c.fillStyle = palette[2];
          const sx = Math.floor(w * .84), sy = Math.floor(h * .19);
          c.fillRect(sx + 3, sy, 12, 18); c.fillRect(sx, sy + 3, 18, 12);
          if (dark) { c.fillStyle = sky; c.fillRect(sx + 8, sy - 1, 12, 13); }
          c.fillStyle = palette[1];
          for (const [cx, cy, length] of [[.12,.14,36],[.48,.3,24],[.82,.39,42]]) {
            const px = Math.floor(cx * w), py = Math.floor(cy * h);
            c.fillRect(px, py + 4, length, 4);
            c.fillRect(px + 6, py, length - 14, 5);
          }
          if (dark) {
            c.fillStyle = '#7d979e';
            for (let j = 0; j < 32; j++) c.fillRect((j * 73 + 19) % w, (j * 29 + 7) % Math.floor(h * .48), 1, 1);
          }
        } else {
          c.fillStyle = palette[i + 2];
          // Deterministic stepped terrain: resize and theme changes never shuffle it.
          for (let px = 0; px < w; px += 2) {
            const wave = Math.sin(px / w * 9 + i * 2) * .07 + Math.sin(px / w * 21 + i) * .025;
            const top = Math.floor(h * (.53 + i * .11 + wave));
            c.fillRect(px, top, 2, h - top);
          }
          if (i >= 2) {
            c.fillStyle = palette[i + 3];
            const step = i === 3 ? 28 : 16;
            for (let px = 8; px < w; px += step) {
              // Keep the central valley open; trees frame the outer desk edges.
              if (i === 3 && px > w * .25 && px < w * .78) continue;
              const base = Math.floor(h * (.78 + i * .025) + Math.sin(px * .1) * 5);
              const size = i === 3 ? 20 : 10;
              c.fillRect(px + 4, base - size, 2, size + 8);
              for (let k = 0; k < 4; k++) c.fillRect(px + 3 - k * 2, base - size + 3 + k * 4, 4 + k * 4, 4);
            }
          }
        }
        layers.push(layer);
      }
      paint();
    }

    function paint() {
      context.fillStyle = sky;
      context.fillRect(0, 0, canvas.width, canvas.height);
      layers.forEach((layer, depth) => {
        const factor = depth + 1;
        context.drawImage(layer, Math.round(-margin + x * factor * 2), Math.round(-margin + y * factor + scroll * factor));
      });
    }

    function animate(now) {
      frame = 0;
      const dt = Math.min((now - (lastTime || now - 16)) / 1000, .05);
      lastTime = now;
      const blend = 1 - Math.exp(-10 * dt);
      x += (targetX - x) * blend; y += (targetY - y) * blend;
      const wantedScroll = reduced.matches ? 0 : Math.min(pane.scrollTop / 240, 2);
      scroll += (wantedScroll - scroll) * blend;
      paint();
      if (Math.abs(targetX - x) + Math.abs(targetY - y) + Math.abs(wantedScroll - scroll) > .002) schedule();
    }
    function schedule() { if (!frame && !document.hidden) frame = requestAnimationFrame(animate); }
    window.addEventListener('pointermove', event => {
      if (reduced.matches || event.pointerType === 'touch') return;
      targetX = event.clientX / innerWidth * 2 - 1;
      targetY = event.clientY / innerHeight * 2 - 1;
      schedule();
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { targetX = targetY = 0; schedule(); });
    pane.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', build, { passive: true });
    new MutationObserver(build).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    reduced.addEventListener('change', () => {
      cancelAnimationFrame(frame); frame = 0;
      x = y = targetX = targetY = scroll = 0; paint();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
      else { lastTime = 0; schedule(); }
    });
    build();
  }

  applyAdminMode();
  restoreAdminSession();
  loadSharedProjects();
  setInterval(() => { if (!document.hidden) loadSharedProjects({ quiet: true }); }, PROJECT_SYNC_INTERVAL_MS);
  projectSyncChannel?.addEventListener('message', event => {
    if (event.data?.type === 'changed') loadSharedProjects({ quiet: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadSharedProjects({ quiet: true });
  });
  window.addEventListener('focus', () => loadSharedProjects({ quiet: true }));
  window.addEventListener('beforeunload', event => {
    if (!isAdmin || (!formHasUnsavedChanges && !mutationInFlight)) return;
    event.preventDefault();
    event.returnValue = '';
  });
  updateSyncStatus();
  updateClock();
  setInterval(updateClock, 30_000);
  render();
  startPixelLandscape();
  startPixelTrail();
  requestLocalWeather();
})();

