/**
 * War Council — Global Navigation Drawer
 * Include this script in any battle-log HTML page to get a consistent hamburger nav.
 * Auto-detects the current page and highlights it.
 */
(function () {
  const NAV_PAGES = [
    { href: '/command-center', color: '#00f0ff', label: 'Command Center', desc: 'Chat interface' },
    { href: '/', color: '#44ff88', label: 'Battle Log', desc: 'Event timeline' },
    { href: '/war-table', color: '#ffd700', label: 'War Table', desc: 'Council visualization' },
    { href: '/metrics-hud', color: '#a855f7', label: 'Metrics HUD', desc: 'System health' },
    { href: '/dag-theater', color: '#06b6d4', label: 'DAG Theater', desc: 'Pipeline execution' },
    { href: '/knowledge-graph-viz', color: '#10b981', label: 'Knowledge Graph', desc: 'Entity map' },
    { href: '/memory-archive', color: '#ec4899', label: 'Memory Archive', desc: 'Vector space' },
    { href: '/adaptive-thresholds', color: '#f59e0b', label: 'Adaptive Thresholds', desc: 'Confidence tuning' },
    { href: '/arbitration-court', color: '#ef4444', label: 'Arbitration Court', desc: 'Model debates' },
  ];

  function currentPath() {
    const p = window.location.pathname.replace(/\/$/, '') || '/';
    return p;
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .wc-nav-burger {
        position: fixed;
        top: 10px;
        left: 10px;
        z-index: 99999;
        width: 36px;
        height: 36px;
        border-radius: 8px;
        background: rgba(18, 18, 31, 0.92);
        border: 1px solid #2a2a4a;
        color: #8888aa;
        font-size: 18px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        box-shadow: 0 2px 12px rgba(0,0,0,0.4);
      }
      .wc-nav-burger:hover {
        color: #00f0ff;
        border-color: #00f0ff;
        box-shadow: 0 0 16px rgba(0, 240, 255, 0.2);
      }
      .wc-nav-burger.open {
        color: #ff4444;
        border-color: #ff4444;
      }

      .wc-nav-backdrop {
        position: fixed;
        inset: 0;
        z-index: 99998;
        background: rgba(0, 0, 0, 0.5);
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.25s, visibility 0.25s;
      }
      .wc-nav-backdrop.open {
        opacity: 1;
        visibility: visible;
      }

      .wc-nav-drawer {
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        z-index: 99999;
        width: 280px;
        background: #0d0d1a;
        border-right: 1px solid #2a2a4a;
        transform: translateX(-100%);
        transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
        box-shadow: 4px 0 24px rgba(0,0,0,0.6);
      }
      .wc-nav-drawer.open {
        transform: translateX(0);
      }

      .wc-nav-drawer-header {
        padding: 20px 16px 12px;
        border-bottom: 1px solid #1e1e2e;
      }
      .wc-nav-drawer-header h2 {
        font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
        font-size: 0.75rem;
        color: #e0e0f0;
        text-transform: uppercase;
        letter-spacing: 3px;
        margin: 0;
      }

      .wc-nav-links {
        flex: 1;
        overflow-y: auto;
        padding: 12px 8px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .wc-nav-link {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 8px;
        text-decoration: none;
        color: #b0b0cc;
        font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
        font-size: 0.8rem;
        transition: all 0.15s;
        border: 1px solid transparent;
      }
      .wc-nav-link:hover {
        background: rgba(0, 240, 255, 0.05);
        color: #e0e0f0;
        border-color: #2a2a4a;
      }
      .wc-nav-link.active {
        background: rgba(0, 240, 255, 0.08);
        color: #00f0ff;
        border-color: rgba(0, 240, 255, 0.3);
        box-shadow: 0 0 12px rgba(0, 240, 255, 0.08);
      }

      .wc-nav-link-icon {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .wc-nav-link-text {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .wc-nav-link-label {
        font-weight: 600;
        font-size: 0.78rem;
      }
      .wc-nav-link-desc {
        font-size: 0.62rem;
        color: #666;
      }
      .wc-nav-link.active .wc-nav-link-desc {
        color: rgba(0, 240, 255, 0.5);
      }

      /* Don't fight with war-table's fixed nav */
      .nav ~ .wc-nav-burger { top: 48px; }

      /* The fixed burger (36px + 10px margins) was covering page titles in the
         top-left ("War Council" rendered as "r Council"). Pad common header
         containers so titles clear it. */
      body > header, body > .header { padding-left: 56px !important; }
    `;
    document.head.appendChild(style);
  }

  function injectDOM() {
    const cur = currentPath();

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'wc-nav-backdrop';
    backdrop.addEventListener('click', toggleDrawer);

    // Drawer
    const drawer = document.createElement('nav');
    drawer.className = 'wc-nav-drawer';
    drawer.setAttribute('aria-label', 'War Council Navigation');
    drawer.innerHTML = `
      <div class="wc-nav-drawer-header">
        <h2>WAR COUNCIL</h2>
      </div>
      <div class="wc-nav-links">
        ${NAV_PAGES.map(p => {
          const isActive = (p.href === '/' && cur === '/') || (p.href !== '/' && cur.startsWith(p.href));
          return `<a class="wc-nav-link${isActive ? ' active' : ''}" href="${p.href}">
            <span class="wc-nav-link-icon" style="background:${p.color}"></span>
            <span class="wc-nav-link-text">
              <span class="wc-nav-link-label">${p.label}</span>
              <span class="wc-nav-link-desc">${p.desc}</span>
            </span>
          </a>`;
        }).join('')}
      </div>
    `;

    // Burger button
    const burger = document.createElement('button');
    burger.className = 'wc-nav-burger';
    burger.setAttribute('aria-label', 'Open navigation menu');
    burger.setAttribute('title', 'Navigation');
    burger.textContent = '☰';
    burger.addEventListener('click', toggleDrawer);

    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);
    document.body.appendChild(burger);

    // Keyboard shortcut: Escape closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) {
        toggleDrawer();
      }
    });
  }

  function toggleDrawer() {
    const drawer = document.querySelector('.wc-nav-drawer');
    const backdrop = document.querySelector('.wc-nav-backdrop');
    const burger = document.querySelector('.wc-nav-burger');
    const isOpen = drawer.classList.contains('open');
    drawer.classList.toggle('open');
    backdrop.classList.toggle('open');
    burger.classList.toggle('open');
    burger.textContent = isOpen ? '☰' : '✕';
    burger.setAttribute('aria-label', isOpen ? 'Open navigation menu' : 'Close navigation menu');
  }

  // Init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    injectStyles();
    injectDOM();
  }
})();
