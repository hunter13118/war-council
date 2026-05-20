/**
 * <war-council-showcase> — Self-contained Web Component
 * 
 * A preview card for the War Council dashboard. Drop into any portfolio
 * or orchestrator app. Zero dependencies, pure vanilla custom element.
 * 
 * Usage:
 *   <script src="https://your-host:3737/showcase/war-council-card.js"></script>
 *   <war-council-showcase></war-council-showcase>
 * 
 * Attributes:
 *   href     — URL to navigate to on click (default: /war-table)
 *   api      — Base URL for health endpoint (default: same origin)
 *   target   — Link target (_blank, _self, etc. Default: _self)
 *   embed    — If present, navigates to /embed instead of /war-table
 */
class WarCouncilShowcase extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.fetchHealth();
  }

  get href() { return this.getAttribute('href') || (this.hasAttribute('embed') ? '/embed' : '/war-table'); }
  get api() { return this.getAttribute('api') || ''; }
  get target() { return this.getAttribute('target') || '_self'; }

  async fetchHealth() {
    try {
      const res = await fetch(`${this.api}/health`);
      const data = await res.json();
      this.updateStatus(data);
    } catch {
      this.updateStatus(null);
    }
  }

  updateStatus(data) {
    const el = this.shadowRoot.querySelector('.status');
    if (!data) {
      el.innerHTML = '<span class="dot offline"></span> Offline';
      return;
    }
    const modeIcons = { cloud: '☁️', local: '💻', hybrid: '🔀' };
    el.innerHTML = `
      <span class="dot online"></span> ${data.status === 'ready' ? 'Operational' : 'Degraded'}
      <span class="mode">${modeIcons[data.mode] || '⚡'} ${data.mode}</span>
      ${data.rag.vectorStore ? `<span class="chunks">🧠 ${data.rag.chunks} chunks</span>` : ''}
      <span class="models">${data.models?.length || 0} models</span>
    `;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
          border: 1px solid #30363d;
          border-radius: 12px;
          padding: 24px;
          cursor: pointer;
          transition: all 0.3s ease;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          color: #e6edf3;
          position: relative;
          overflow: hidden;
          max-width: 380px;
        }
        .card:hover {
          border-color: #f0883e;
          transform: translateY(-2px);
          box-shadow: 0 8px 32px rgba(240, 136, 62, 0.15);
        }
        .card::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle, rgba(240,136,62,0.03) 0%, transparent 70%);
          pointer-events: none;
        }
        .header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }
        .icon {
          font-size: 28px;
          filter: drop-shadow(0 0 8px rgba(240,136,62,0.5));
        }
        .title {
          font-size: 16px;
          font-weight: 700;
          color: #f0883e;
          letter-spacing: -0.5px;
        }
        .subtitle {
          font-size: 11px;
          color: #8b949e;
          margin-top: 2px;
        }
        .description {
          font-size: 12px;
          color: #8b949e;
          line-height: 1.5;
          margin-bottom: 16px;
        }
        .tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 16px;
        }
        .tag {
          font-size: 10px;
          padding: 3px 8px;
          border-radius: 12px;
          background: rgba(240,136,62,0.1);
          color: #f0883e;
          border: 1px solid rgba(240,136,62,0.2);
        }
        .status {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: #8b949e;
          padding-top: 12px;
          border-top: 1px solid #21262d;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }
        .dot.online { background: #3fb950; box-shadow: 0 0 6px rgba(63,185,80,0.5); }
        .dot.offline { background: #f85149; }
        .mode { color: #58a6ff; }
        .chunks { color: #7af8ca; }
        .models { color: #d2a8ff; }
        .arrow {
          position: absolute;
          top: 24px;
          right: 24px;
          font-size: 18px;
          color: #30363d;
          transition: all 0.3s ease;
        }
        .card:hover .arrow { color: #f0883e; transform: translateX(4px); }
      </style>
      <div class="card" onclick="this.getRootNode().host.navigate()">
        <span class="arrow">→</span>
        <div class="header">
          <span class="icon">⚔️</span>
          <div>
            <div class="title">War Council</div>
            <div class="subtitle">AI Agent Orchestration</div>
          </div>
        </div>
        <div class="description">
          Local-first AI war room — multi-model routing, RAG-augmented chat,
          real-time agent visualization, and tri-mode cloud/local/hybrid operation.
        </div>
        <div class="tags">
          <span class="tag">Ollama</span>
          <span class="tag">RAG</span>
          <span class="tag">MCP</span>
          <span class="tag">SSE</span>
          <span class="tag">WebSocket</span>
        </div>
        <div class="status">
          <span class="dot offline"></span> Checking...
        </div>
      </div>
    `;
  }

  navigate() {
    const url = this.href.startsWith('http') ? this.href : `${this.api}${this.href}`;
    if (this.target === '_blank') {
      window.open(url, '_blank');
    } else {
      window.location.href = url;
    }
  }
}

customElements.define('war-council-showcase', WarCouncilShowcase);
