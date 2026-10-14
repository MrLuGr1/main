(() => {
  'use strict';

  const STORAGE_KEY = 'pixel-desk-projects-v1';
  // This URL is public configuration, not a secret. Passwords and session tokens never go in source control.
  const API_BASE = (document.querySelector('meta[name="pixel-desk-api"]')?.content || '').trim().replace(/\/$/, '');
  const REMOVED_BUILTIN_IDS = new Set(['dos-tools-folder', 'dos-penetration-test', 'dos-request-spammer']);
  const categoryInfo = {
    web: { label: 'Web & aplikace', icon: '🌐', iconClass: 'web' },
    design: { label: 'Design', icon: '🎨', iconClass: 'design' },
    code: { label: 'Vývoj', icon: '⌘', iconClass: 'code' },
    other: { label: 'Ostatní', icon: '🪴', iconClass: 'other' },
  };
  const starterProjects = [
    { id: 'demo-1', name: 'Portfolio 2025', description: 'Moje práce a malé experimenty.', url: 'https://example.com', category: 'design', favorite: true },
    { id: 'demo-2', name: 'Pixel Garden', description: 'Místo, kde rostou nové nápady.', url: 'https://example.com', category: 'web', favorite: false },
    { id: 'demo-3', name: 'Weather App', description: 'Počasí s trochou charakteru.', url: 'https://example.com', category: 'code', favorite: false },
    { id: 'demo-4', name: 'Moodboard', description: 'Barvy, tvary a inspirace.', url: 'https://example.com', category: 'design', favorite: false },
    { id: 'demo-5', name: 'Study Tracker', description: 'Každý den o kousek dál.', url: 'https://example.com', category: 'web', favorite: false },
    { id: 'demo-6', name: 'Tiny Tools', description: 'Malé nástroje pro každý den.', url: 'https://example.com', category: 'code', favorite: true },
  ];
  // Offline fallback only; the shared projects.json remains authoritative when the API is available.
  const qrMakerFallback = { id: 'qr-maker', name: 'QR maker', description: 'Lokální generátor QR kódů pro odkazy, zprávy i platby.', url: 'QR_maker/index.html', category: 'web', favorite: false };

  function withQrMakerFallback(list) {
    return list.some(project => project.id === qrMakerFallback.id) ? list : [...list, qrMakerFallback];
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

  function readProjects() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        const projects = JSON.parse(saved);
        if (Array.isArray(projects)) {
          const retained = projects.filter(project => !REMOVED_BUILTIN_IDS.has(project?.id));
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
      typeof project.url === 'string' && categoryInfo[project.category];
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
    const headers = new Headers(options.headers || {});
    if (options.body) headers.set('Content-Type', 'application/json');
    if (adminToken) headers.set('Authorization', `Bearer ${adminToken}`);
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `API vrátilo chybu ${response.status}.`);
    return payload;
  }

  async function loadSharedProjects() {
    if (!API_BASE) return;
    try {
      const result = await apiRequest('/api/projects');
      const custom = Array.isArray(result.projects) ? result.projects.filter(isValidProject) : [];
      projects = [...starterProjects, ...custom];
      saveProjects();
      render();
    } catch (error) {
      console.warn('Sdílené projekty se nepodařilo načíst.', error);
      projects = withQrMakerFallback(projects);
      render();
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
    document.querySelector('#empty-title').textContent = query || activeFilter !== 'all' ? 'Nic jsme nenašli.' : 'Tady je zatím volno.';
    document.querySelector('#empty-copy').textContent = query || activeFilter !== 'all' ? 'Zkus změnit hledání nebo vybrat jinou kategorii.' : 'Přidej první projekt a dej svým nápadům domov.';
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
    icon.textContent = project.kind === 'folder' ? '📁' : project.kind === 'python' ? '🐍' : info.icon;
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
    category.textContent = project.kind === 'folder' ? 'SLOŽKA · 2 PROJEKTY' : isPythonFileProject(project) ? 'PYTHON SKRIPT' : info.label;
    const open = document.createElement('span');
    open.className = 'card-open';
    open.textContent = project.kind === 'folder' ? '›' : isPythonFileProject(project) ? '⌕' : '↗';
    open.setAttribute('aria-hidden', 'true');
    footer.append(category, open);
    card.append(top, name, description, footer);
    // Do not create destructive controls in the public DOM at all.
    if (isAdmin && !project.builtin) {
      const remove = document.createElement('button');
      remove.className = 'card-delete admin-only';
      remove.type = 'button';
      remove.textContent = '× ODEBRAT';
      remove.setAttribute('aria-label', `Odebrat projekt ${project.name}`);
      remove.addEventListener('click', async event => {
        event.stopPropagation();
        if (!isAdmin) return;
        try {
          await apiRequest(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
          projects = projects.filter(item => item.id !== project.id);
          saveProjects();
          render();
          showToast('Projekt byl odebrán ze sdíleného seznamu.');
        } catch (error) {
          showToast(`Projekt se nepodařilo odebrat: ${error.message}`);
        }
      });
      card.append(remove);
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
    button.innerHTML = isAdmin ? '<span aria-hidden="true">▣</span> Admin · Odhlásit' : '<span aria-hidden="true">▣</span> Admin Login';
    button.setAttribute('aria-label', isAdmin ? 'Odhlásit správce' : 'Přihlášení správce');
    button.title = isAdmin ? 'Odhlásit správce' : 'Přihlásit se jako správce';
  }

  function signOutAdmin() {
    adminToken = '';
    isAdmin = false;
    applyAdminMode();
    render();
    showToast('Odhlášení správce proběhlo.');
  }

  function showDialog() {
    if (!isAdmin) return;
    form.reset();
    updateSelectIcon();
    dialog.showModal();
    requestAnimationFrame(() => document.querySelector('#project-name').focus());
  }

  function updateSelectIcon() {
    document.querySelector('#select-emoji').textContent = categoryInfo[categorySelect.value].icon;
  }

  document.querySelector('#open-add').addEventListener('click', showDialog);
  document.querySelector('#empty-add').addEventListener('click', showDialog);
  const adminDialog = document.querySelector('#admin-dialog');
  const adminLoginForm = document.querySelector('#admin-login-form');
  const adminPassword = document.querySelector('#admin-password');
  const adminLoginStatus = document.querySelector('#admin-login-status');
  document.querySelector('#admin-toggle').addEventListener('click', () => {
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
      adminToken = result.token;
      isAdmin = true;
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
    if (!isAdmin) return;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const project = {
      id: globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: String(data.get('name')).trim(),
      description: String(data.get('description') || '').trim(),
      url: String(data.get('url')).trim(),
      category: String(data.get('category')),
      favorite: data.get('favorite') === 'on',
      parentId: activeFolder || undefined,
    };
    if (!project.name || !project.url) return;
    try {
      await apiRequest('/api/projects', { method: 'POST', body: JSON.stringify(project) });
    } catch (error) {
      showToast(`Projekt se nepodařilo uložit: ${error.message}`);
      return;
    }
    projects.unshift(project);
    saveProjects();
    activeFilter = 'all';
    query = '';
    search.value = '';
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.filter === 'all'));
    render();
    dialog.close();
    showToast('Projekt přidán do sdíleného rozcestníku.');
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
    const colors = ['#8172e5', '#f2bf61', '#69c7a0', '#ec91b7', '#75b3e6'];
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
      if (event.pointerType === 'touch' || now - lastSpawn < 24) return;
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
    document.querySelector('#theme-label').textContent = dark ? 'SVĚTLÝ REŽIM' : 'TMAVÝ REŽIM';
    button.querySelector('.theme-icon').textContent = dark ? '☼' : '◐';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#141b29' : '#e9edf2';
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
      document.querySelector('#weather-symbol').textContent = '☀';
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

  applyAdminMode();
  loadSharedProjects();
  updateClock();
  setInterval(updateClock, 30_000);
  render();
  startPixelTrail();
  requestLocalWeather();
})();

