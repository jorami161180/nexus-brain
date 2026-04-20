/**
 * Nexus Brain v2.5 — Unified Master Controller
 * Consolidates all agent logic, streaming, vision, and graph visualization.
 */

const API = window.location.hostname === 'localhost' ? 'http://localhost:3003' : '';

// ── HELPERS ──
const esc = (t) => t ? String(t).replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `fixed bottom-8 right-8 px-6 py-3 rounded-xl text-white font-bold text-sm shadow-2xl z-[1000] result-card ${type === 'error' ? 'bg-red-500' : 'bg-[#cc785c]'}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(10px)';
    t.style.transition = 'all 0.3s ease';
    setTimeout(() => t.remove(), 300);
  }, 3000);
}
window.toast = toast;

class NexusBrain {
  constructor(root) {
    this.root = root;
    this.activeTab = 'home';
    this.isLoading = false;
    this.chatHistory = [];
    this.currentImageBase64 = null;
    this.lastDeveloperFiles = null;
    this.lastAgentResult = null; // Store last output for saving
    this.selectedProject = null; // Globally active project
    this._pipelineProjects = [];
  }

  async init() {
    console.log('[Nexus] Unifying brain...');
    this.loadChatFromStorage();
    this.loadSelectedProject();
    this.bindEvents();
    this.checkHealth();
    this.switchTab('home');
    
    // Initial data loads
    this.loadRecentResearches();
  }

  loadChatFromStorage() {
    try {
      const saved = JSON.parse(localStorage.getItem('nexus_chat_history') || '[]');
      if (saved.length) this.chatHistory = saved;
    } catch {}
  }

  saveChatToStorage() {
    try {
      localStorage.setItem('nexus_chat_history', JSON.stringify(this.chatHistory.slice(-40)));
    } catch {}
  }

  loadSelectedProject() {
    try {
      const saved = localStorage.getItem('nexus_active_project');
      if (saved) {
        this.selectedProject = JSON.parse(saved);
        this.updateActiveProjectUI();
      }
    } catch {}
  }

  setActiveProject(project) {
    this.selectedProject = project;
    localStorage.setItem('nexus_active_project', JSON.stringify(project));
    this.updateActiveProjectUI();
    toast(`Proyecto "${project.name}" fijado como activo`);
  }

  clearActiveProject() {
    this.selectedProject = null;
    localStorage.removeItem('nexus_active_project');
    this.updateActiveProjectUI();
    toast('Proyecto desvinculado (Modo General)');
    this.renderProjectList(); // Refresh highlights
  }

  updateActiveProjectUI() {
    const badge = document.getElementById('active-project-badge');
    const nameEl = document.getElementById('active-project-name');
    if (this.selectedProject && badge && nameEl) {
      nameEl.textContent = `Proyecto: ${this.selectedProject.name}`;
      badge.classList.remove('hidden');
    } else if (badge) {
      badge.classList.add('hidden');
    }
  }

  async checkHealth() {
    try {
      const res = await fetch(`${API}/health`);
      const statusDot = document.getElementById('status-dot');
      const badge = document.getElementById('provider-badge');
      if (res.ok) {
        if (statusDot) statusDot.textContent = 'Online';
        if (badge) badge.textContent = '● Online';
      }
    } catch (e) {
      const statusDot = document.getElementById('status-dot');
      if (statusDot) {
        statusDot.textContent = 'Offline';
        statusDot.style.color = '#ef4444';
      }
    }
  }

  bindEvents() {
    // ... existing navigation, chat, capture events ...
    // Navigation
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        this.switchTab(link.dataset.tab);
      });
    });

    // Chat
    document.getElementById('send-btn')?.addEventListener('click', () => this.sendMessage());
    document.getElementById('chat-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
    });

    // Capture
    document.getElementById('cap-btn')?.addEventListener('click', () => this.runCapture());
    document.getElementById('cap-type')?.addEventListener('change', e => {
      const isImage = e.target.value === 'image';
      document.getElementById('image-upload-zone')?.classList.toggle('hidden', !isImage);
      const contentInput = document.getElementById('cap-content');
      if (contentInput) {
        contentInput.placeholder = isImage 
          ? "Describe qué quieres que analice de la imagen (opcional)..." 
          : "Pega o escribe el contenido a capturar...";
      }
    });

    // Capture Vision Handling
    const dropzone = document.getElementById('dropzone');
    const imageInput = document.getElementById('image-input');
    if (dropzone && imageInput) {
      dropzone.addEventListener('click', () => imageInput.click());
      imageInput.addEventListener('change', e => this.handleImageSelect(e.target.files[0]));
      dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('border-[#cc785c]'); });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('border-[#cc785c]'));
      dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('border-[#cc785c]');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) this.handleImageSelect(file);
      });
    }
    document.getElementById('remove-image')?.addEventListener('click', () => this.clearImage());

    // Researcher
    document.getElementById('res-btn')?.addEventListener('click', () => this.runResearch());

    // Writer
    document.getElementById('wri-btn')?.addEventListener('click', () => this.runWrite());

    // Memory
    document.getElementById('mem-btn')?.addEventListener('click', () => this.runMemoryQuery());
    document.getElementById('btn-refresh-graph')?.addEventListener('click', () => this.renderMemoryGraph());

    // Architect
    document.getElementById('arc-btn')?.addEventListener('click', () => this.runArchitect());

    // Developer
    document.getElementById('dev-btn')?.addEventListener('click', () => this.runDeveloper());

    // UI Helpers
    document.getElementById('btn-restart')?.addEventListener('click', () => window.location.reload(true));
    document.getElementById('btn-open-settings')?.addEventListener('click', () => this.openSettings());

    // Pipeline Steps Navigation
    document.querySelectorAll('[data-tab-nav]').forEach(el => {
      el.addEventListener('click', () => this.switchTab(el.dataset.tabNav));
    });

    // Voice / Mic
    document.getElementById('main-mic-btn')?.addEventListener('click', () => this.toggleVoice());

    // --- PROYECTOS BINDINGS ---
    document.getElementById('pipe-create-btn')?.addEventListener('click', () => this.createProject());
  }

  // ─── VOICE ENGINE (RESTORATION) ───
  initVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported in this browser.');
      return;
    }
    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'es-ES';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.isRecording = false;

    this.recognition.onstart = () => {
      this.isRecording = true;
      document.getElementById('voice-overlay')?.classList.add('active');
      document.getElementById('voice-status').textContent = 'Escuchando tu cerebro...';
    };

    this.recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        else interimTranscript += event.results[i][0].transcript;
      }
      const transcriptionEl = document.getElementById('voice-transcription');
      if (transcriptionEl) transcriptionEl.textContent = finalTranscript + interimTranscript;
    };

    this.recognition.onend = () => {
      if (this.isRecording) this.recognition.start(); // Auto-restart if still "active"
    };

    this.recognition.onerror = (e) => {
      console.error('Speech Error:', e.error);
      if (e.error === 'not-allowed') this.stopVoice();
    };
  }

  toggleVoice() {
    if (!this.recognition) this.initVoice();
    if (this.isRecording) this.stopVoice(true);
    else this.recognition.start();
  }

  stopVoice(shouldSend = false) {
    this.isRecording = false;
    this.recognition.stop();
    document.getElementById('voice-overlay')?.classList.remove('active');
    const text = document.getElementById('voice-transcription')?.textContent.trim();
    if (shouldSend && text && text !== '...') {
      this.switchTab('chat');
      const input = document.getElementById('chat-input');
      if (input) {
        input.value = text;
        this.sendMessage();
      }
    }
  }

  // ─── PROJECTS & PIPELINE (RESTORATION v2.0 FULL) ───
  
  get PIPELINE_META() {
    return [
      { key: 'idea',    num: 1, label: 'Idea',           desc: 'Define el problema y el objetivo del proyecto',     icon: 'lightbulb',     color: '#4CAF50', manual: true },
      { key: 'spec',    num: 2, label: 'Especificación', desc: 'Arquitectura técnica, stack, features y endpoints',  icon: 'architecture',  color: '#cc785c', manual: false, agent: 'Arquitecto' },
      { key: 'dev',     num: 3, label: 'Desarrollo',     desc: 'Genera el código fuente completo del proyecto',     icon: 'code',          color: '#2196F3', manual: false, agent: 'Developer' },
      { key: 'test',    num: 4, label: 'Testing',        desc: 'Valida render, CTAs, placeholders y responsive',     icon: 'bug_report',    color: '#FF9800', manual: false, agent: 'Testing' },
      { key: 'deploy',  num: 5, label: 'Deploy',         desc: 'Despliega la aplicación a Vercel',                  icon: 'rocket_launch', color: '#9C27B0', manual: false, agent: 'Deploy' },
      { key: 'live',    num: 6, label: 'En Producción',  desc: 'Verificar la app en producción y cerrar el ciclo',  icon: 'public',        color: '#00BCD4', manual: true },
    ];
  }

  async loadProjects() {
    const list = document.getElementById('pipe-list');
    if (!list) return;
    try {
      const res = await fetch(`${API}/api/pipeline`);
      const data = await res.json();
      this._pipelineProjects = Array.isArray(data) ? data : [];
      
      if (this._pipelineProjects.length === 0) {
        list.innerHTML = `<div class="text-center py-10"><p class="text-[0.6rem] text-[#333] font-black uppercase tracking-widest">No hay proyectos activos</p></div>`;
        return;
      }

      list.innerHTML = this._pipelineProjects.map(p => {
        const phases = p.phases || [];
        const doneCount = phases.filter(ph => ph.status === 'done').length;
        const pct = Math.round((doneCount / 6) * 100);
        const isActive = this.selectedProject && p.id === this.selectedProject.id;
        const indicatorColor = p.status === 'live' ? '#22c55e' : '#cc785c';

        return `
          <div onclick="window.nexus.openPipelineProject(${p.id})"
            class="group relative mb-2 p-4 rounded-xl border transition-all duration-300 cursor-pointer ${isActive ? 'bg-[#0f0f0f] border-[#cc785c]/40 shadow-lg' : 'border-[#1a1a1a] hover:border-[#333] hover:bg-[#0a0a0a]'}">
            ${isActive ? `<div class="absolute left-0 top-1/4 bottom-1/4 w-1 bg-[#cc785c] rounded-r-full"></div>` : ''}
            <div class="flex items-start justify-between mb-3">
              <div class="flex-1 min-w-0">
                <p class="text-xs font-black text-white truncate tracking-tight group-hover:text-[#cc785c] transition-colors">${esc(p.name)}</p>
                <p class="text-[0.6rem] text-[#444] font-mono mt-0.5">ID: ${p.id}</p>
              </div>
              <div class="flex items-center gap-1.5">
                <div class="w-1.5 h-1.5 rounded-full ${isActive ? 'animate-pulse' : ''}" style="background:${indicatorColor}"></div>
                <span class="text-[0.5rem] font-black uppercase tracking-widest" style="color:${indicatorColor}">${p.status?.toUpperCase() || 'READY'}</span>
              </div>
            </div>
            <div class="h-1 bg-[#080808] rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-700" style="width:${pct}%;background:${indicatorColor}"></div>
            </div>
          </div>`;
      }).join('');
    } catch (e) {
      console.error('Error loading projects:', e);
      list.innerHTML = `<div class="p-4 text-red-500 text-[0.6rem]">Error de conexión</div>`;
    }
  }

  async openPipelineProject(id) {
    const detail = document.getElementById('pipe-detail');
    if (!detail) return;
    detail.innerHTML = `<div class="flex items-center justify-center h-full"><span class="text-[#cc785c] text-xs animate-pulse">Sincronizando pipeline...</span></div>`;
    
    try {
      const res = await fetch(`${API}/api/pipeline/${id}`);
      const project = await res.json();
      this.selectedProject = project;
      
      // Actualizar Badge de Proyecto Activo en el Header
      const badge = document.getElementById('active-project-badge');
      const badgeName = document.getElementById('active-project-name');
      if (badge && badgeName) {
        badge.classList.remove('hidden');
        badgeName.textContent = `Proyecto: ${project.name}`;
      }

      this.loadProjects(); 
      this.renderPipelineDetail(project);
      
      // Sincronizar en el siguiente frame para asegurar que los elementos existan
      requestAnimationFrame(() => {
        this._preloadDeveloperContext();
        this._preloadArchitectContext();
      });
    } catch (e) {
      detail.innerHTML = `<div class="text-[#cc785c] text-xs p-8">Error: ${e.message}</div>`;
    }
  }

  renderPipelineDetail(p) {
    const detail = document.getElementById('pipe-detail');
    if (!detail) return;
    const phases = p.phases || [];
    const doneCount = phases.filter(ph => ph.status === 'done').length;
    const pct = Math.round((doneCount / 6) * 100);

    const phasesHtml = this.PIPELINE_META.map(meta => {
      const phase = phases.find(ph => ph.phase_key === meta.key) || { status: 'pending', output: '', notes: '' };
      return this.renderPhaseCard(p.id, meta, phase);
    }).join('');

    detail.innerHTML = `
      <div class="animate-fade-in space-y-8 p-8">
        <div class="bg-[#0c0c0c] border border-[#1a1a1a] rounded-3xl p-8 relative overflow-hidden">
          <div class="blueprint-grid opacity-20"></div>
          <div class="relative z-10 flex flex-col md:flex-row gap-8 items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-3 mb-4">
                <span class="px-2 py-0.5 rounded-md bg-[#cc785c]/10 text-[#cc785c] text-[0.55rem] font-black uppercase tracking-widest border border-[#cc785c]/20">Misión Activa</span>
                <span class="text-[0.6rem] text-[#444] font-mono">NODE_CLUSTER_${p.id}</span>
              </div>
              <h2 id="project-detail-name-${p.id}" class="text-4xl font-black text-white tracking-tighter cursor-pointer hover:bg-white/5 px-2 py-1 -ml-2 rounded" onclick="window.nexus.editProjectField('name', this, ${p.id})">${esc(p.name)}</h2>
              <p id="project-detail-summary-${p.id}" class="text-[#888] text-sm mt-3 leading-relaxed max-w-xl cursor-pointer hover:bg-white/5 px-2 py-1 -ml-2 rounded" onclick="window.nexus.editProjectField('summary', this, ${p.id})">${esc(p.summary || p.description || 'Sin descripción.')}</p>
            </div>
            <div class="flex flex-col gap-3 items-end">
              <div class="grid grid-cols-2 gap-3">
                <div class="metric-card">
                  <span class="metric-label">Progreso</span>
                  <span class="metric-value">${pct}%</span>
                </div>
                <div class="metric-card">
                  <span class="metric-label">Estado</span>
                  <span class="metric-value text-sm uppercase">${esc(p.status || 'Idea')}</span>
                </div>
              </div>
              <div class="flex gap-2 flex-wrap justify-end">
                <button onclick="window.nexus.openLandingPreview('${esc(p.name)}')"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#cc785c]/30 text-[#cc785c] text-[0.6rem] font-bold uppercase tracking-widest hover:bg-[#cc785c]/10 transition-all">
                  <span class="material-symbols-outlined text-sm">preview</span>Ver Landing
                </button>
                <a href="${API}/api/pipeline/${p.id}/export-zip" download
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#2196F3]/30 text-[#2196F3] text-[0.6rem] font-bold uppercase tracking-widest hover:bg-[#2196F3]/10 transition-all">
                  <span class="material-symbols-outlined text-sm">download</span>ZIP
                </a>
                <a href="${API}/api/pipeline/${p.id}/export" download
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#555]/30 text-[#666] text-[0.6rem] font-bold uppercase tracking-widest hover:bg-white/5 transition-all">
                  <span class="material-symbols-outlined text-sm">article</span>MD
                </a>
                <button onclick="window.nexus.sendToObsidian(${p.id}, this)"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#9C27B0]/30 text-[#9C27B0] text-[0.6rem] font-bold uppercase tracking-widest hover:bg-[#9C27B0]/10 transition-all">
                  <span class="material-symbols-outlined text-sm">book_2</span>Obsidian
                </button>
                <button onclick="window.nexus.deleteProject(${p.id}, this)"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-900/30 text-red-500 text-[0.6rem] font-bold uppercase tracking-widest hover:bg-red-900/20 transition-all">
                  <span class="material-symbols-outlined text-sm">delete</span>Eliminar
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
          ${phasesHtml}
        </div>
      </div>`;
  }

  renderPhaseCard(projectId, meta, phase) {
    const sc = {
      pending: { label: 'Inactivo',   color: '#222',    border: '#1a1a1a' },
      active:  { label: 'Ready',      color: meta.color, border: meta.color+'44' },
      running: { label: 'Procesando', color: meta.color, border: meta.color },
      error:   { label: 'Fallo',      color: '#ef4444',  border: '#ef444444' },
      done:    { label: 'Completado', color: '#4CAF50',  border: '#4CAF5044' },
    }[phase.status] || { label: 'Inactivo', color: '#222', border: '#1a1a1a' };

    const isDone    = phase.status === 'done';
    const isActive  = phase.status === 'active';
    const isRunning = phase.status === 'running';
    const isError   = phase.status === 'error';

    // Parse Output
    let outputHtml = '';
    if (phase.output) {
      try {
        const out = JSON.parse(phase.output);
        outputHtml = this.renderPhaseOutput(meta.key, out, projectId);
      } catch (e) {
        outputHtml = `<p class="text-[0.6rem] text-[#555] font-mono">${esc(phase.output)}</p>`;
      }
    }

    let actionHtml = '';
    if (isRunning) {
      actionHtml = `<div class="mt-4 pt-4 border-t border-white/5">
        <div class="flex items-center gap-2 text-xs text-[#888] mb-2">
          <span class="material-symbols-outlined text-sm animate-spin" style="color:${meta.color}">autorenew</span>
          <span class="progress-msg" id="progress-msg-${meta.key}">Agente Procesando...</span>
        </div>
        <div id="progress-log-${meta.key}" class="space-y-0.5 max-h-28 overflow-y-auto custom-scrollbar"></div>
      </div>`;
    } else if (isActive || isError) {
      if (isError) {
        let errMsg = '';
        if (phase.notes) {
          try { errMsg = JSON.parse(phase.notes)?.error || phase.notes; } catch { errMsg = phase.notes; }
        }
        actionHtml += `
          <div class="mb-3 p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
            <p class="text-[0.6rem] text-red-400 font-bold flex items-center gap-1 mb-1"><span class="material-symbols-outlined text-xs">error</span>Fase fallida</p>
            ${errMsg ? `<p class="text-[0.55rem] text-red-300/70 font-mono leading-relaxed break-all">${esc(errMsg.slice(0, 300))}</p>` : ''}
          </div>
          <button onclick="window.nexus.retryPhase(${projectId}, '${meta.key}', this)" class="w-full py-2.5 rounded-xl bg-red-500 text-black font-bold text-[0.65rem] uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all mb-4">Reintentar Protocolo Agente</button>`;
      }

      // Campos manuales (Disponibles tanto en Ready como en Fallo)
      const testFields = meta.key === 'test' ? `
        <div class="grid grid-cols-2 gap-2 mb-3">
          <input id="phase-bugs-test" type="number" placeholder="Bugs" class="bg-[#080808] border border-[#222] text-white rounded-lg px-3 py-2 text-xs focus:border-[#FF9800] outline-none"/>
          <input id="phase-coverage-test" type="text" placeholder="Cobertura %" class="bg-[#080808] border border-[#222] text-white rounded-lg px-3 py-2 text-xs focus:border-[#FF9800] outline-none"/>
        </div>` : '';
      const liveField = meta.key === 'live' ? `<input id="phase-url-live" type="text" placeholder="URL de producción..." class="w-full bg-[#080808] border border-[#222] text-white rounded-lg px-3 py-2 text-xs mb-3 focus:border-[#00BCD4] outline-none"/>` : '';
      
      const notesField = `<textarea id="phase-notes-${meta.key}" rows="2" placeholder="Notas o feedback de esta fase..." class="w-full bg-[#080808] border border-[#222] text-white rounded-lg px-3 py-2 text-xs mb-3 resize-none focus:border-[#cc785c] outline-none custom-scrollbar"></textarea>`;

      const approveBtn = `<button onclick="window.nexus.confirmPhase(${projectId}, '${meta.key}')" class="w-full py-2.5 rounded-xl font-bold text-[0.65rem] uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 mb-2" style="background:${meta.color}; color:black;">
          <span class="material-symbols-outlined text-sm">verified</span>Aprobar Fase (Manual)
        </button>`;

      const agentBtn = (!meta.manual && !isError) ? `<button onclick="window.nexus.runPhase(${projectId}, '${meta.key}', this)" id="run-btn-${meta.key}" class="w-full py-2.5 rounded-xl font-bold text-[0.65rem] uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 border border-${meta.color}/30 text-white hover:bg-${meta.color}/10" style="border-color:${meta.color}44;">
          <span class="material-symbols-outlined text-sm">play_arrow</span>Iniciar Protocolo Agente
        </button>` : '';

      actionHtml += `<div class="mt-4 pt-4 border-t border-white/5">
        ${testFields}${liveField}${notesField}
        ${approveBtn}
        ${agentBtn}
      </div>`;
    }

    const logsDisplay = isDone && phase.notes ? `<div class="mt-3 p-3 bg-[#080808] border border-[#1a1a1a] rounded-xl text-[0.65rem] text-[#888] leading-relaxed"><p class="text-[0.5rem] uppercase font-black text-[#333] mb-1">Logs de Fase</p>${esc(phase.notes)}</div>` : '';

    // Botones de re-ejecución para fases completadas
    if (isDone) {
      const devExtra = meta.key === 'dev' ? `
        <input id="phase-task-dev-redo" type="text" placeholder="Prompt para regenerar (opcional)..."
          class="w-full bg-[#080808] border border-[#222] text-white rounded-lg px-3 py-2 text-xs mb-2 focus:border-[#2196F3] outline-none"/>` : '';
      const liveRedoField = meta.key === 'live' ? `<input id="phase-url-live" type="text" placeholder="URL de producción..." class="w-full bg-[#080808] border border-[#222] text-white rounded-lg px-3 py-2 text-xs mb-2 focus:border-[#00BCD4] outline-none"/>` : '';
      actionHtml = `<div class="mt-4 pt-4 border-t border-white/5">
        ${devExtra}${liveRedoField}
        <button onclick="window.nexus.retryPhase(${projectId}, '${meta.key}', this)"
          class="w-full py-2 rounded-xl font-bold text-[0.6rem] uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 border"
          style="border-color:${meta.color}33;color:${meta.color};">
          <span class="material-symbols-outlined text-sm">restart_alt</span>Regenerar Fase
        </button>
      </div>`;
    }

    return `
      <div id="phase-card-${meta.key}" class="bg-[#0c0c0c] border p-6 rounded-3xl transition-all duration-300" style="border-color:${sc.border}">
        <div class="flex items-start justify-between mb-4">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-2xl flex items-center justify-center" style="background:${meta.color}10">
              <span class="material-symbols-outlined" style="color:${meta.color}">${meta.icon}</span>
            </div>
            <div>
              <p class="text-[0.55rem] font-bold text-[#444] uppercase tracking-widest">System Node 0${meta.num}</p>
              <h4 class="text-white font-bold tracking-tight">${meta.label}</h4>
            </div>
          </div>
          <span class="text-[0.55rem] font-bold uppercase px-2 py-1 rounded bg-[#1a1a1a]" style="color:${sc.color}">${sc.label}</span>
        </div>
        <p class="text-xs text-[#666] leading-relaxed mb-4">${meta.desc}</p>
        ${outputHtml}${logsDisplay}${actionHtml}
      </div>`;
  }

  renderPhaseOutput(key, out, projectId) {
    if (key === 'spec' && out.name) {
      return `<div class="bg-[#080808] border border-[#cc785c]/20 rounded-2xl p-4 mb-3 space-y-2">
        <p class="text-[0.5rem] font-black text-[#cc785c] uppercase tracking-widest">Blueprint de Arquitectura</p>
        <p class="text-xs text-white font-bold">${esc(out.name)}</p>
        <p class="text-[0.65rem] text-[#666] line-clamp-2">${esc(out.vision || out.summary)}</p>
      </div>`;
    }
    if (key === 'dev' && out.files) {
      return `<div class="bg-[#080808] border border-[#2196F3]/20 rounded-2xl p-4 mb-3 relative overflow-hidden group">
        <div class="absolute inset-0 bg-gradient-to-r from-[#2196F3]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
        <div class="relative z-10">
          <p class="text-[0.5rem] font-black text-[#2196F3] uppercase tracking-widest mb-2">Build de Desarrollo Completo</p>
          <div class="flex items-center justify-between mb-4">
            <span class="text-xs text-white font-bold">${out.files.length} archivos compilados</span>
            <span class="material-symbols-outlined text-[#2196F3]">code</span>
          </div>
          <div class="flex flex-col gap-2">
            <button onclick="window.nexus.runProjectPreview(${projectId})" class="w-full text-xs font-bold py-2.5 rounded-xl bg-[#2196F3] text-black shadow-[0_0_15px_rgba(33,150,243,0.3)] hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2">
              <span class="material-symbols-outlined text-sm">play_circle</span> Lanzar Vista Preliminar
            </button>
            <button onclick="window.nexus.switchTab('developer')" class="w-full text-[0.6rem] py-2 rounded-xl border border-[#2196F3]/30 text-[#2196F3] hover:bg-[#2196F3]/10 transition-all font-bold">Modificar en Developer Studio</button>
          </div>
        </div>
      </div>`;
    }
    if (key === 'test' && out.score !== undefined) {
      return `<div class="bg-[#080808] border border-[#FF9800]/20 rounded-2xl p-4 mb-3 flex items-center justify-between">
        <div>
          <p class="text-[0.5rem] font-black text-[#FF9800] uppercase tracking-widest">Reporte QA</p>
          <p class="text-xs text-white font-bold">Score de Calidad: <span class="text-[#FF9800]">${out.score}/100</span></p>
        </div>
        <span class="material-symbols-outlined text-[#FF9800] text-3xl opacity-80">verified_user</span>
      </div>`;
    }
    if (key === 'deploy' && (out.deployUrl || out.projectUrl || out.url)) {
      const deployUrl = out.deployUrl || out.url;
      const projectUrl = out.projectUrl;
      return `<div class="bg-[#080808] border border-[#00BCD4]/20 rounded-2xl p-4 mb-3 space-y-2">
        <p class="text-[0.5rem] font-black text-[#00BCD4] uppercase tracking-widest mb-1">Deploy en Vercel</p>
        ${deployUrl ? `<a href="${esc(deployUrl)}" target="_blank" class="block w-full text-center text-xs py-2.5 rounded-xl border border-[#00BCD4]/40 text-[#00BCD4] hover:bg-[#00BCD4]/10 transition-all font-bold flex justify-center items-center gap-2">
          <span class="material-symbols-outlined text-sm">rocket_launch</span> Ver Deploy
        </a>` : ''}
        ${projectUrl ? `<a href="${esc(projectUrl)}" target="_blank" class="block w-full text-center text-xs py-2.5 rounded-xl bg-[#00BCD4] text-black hover:opacity-90 transition-all font-bold flex justify-center items-center gap-2">
          <span class="material-symbols-outlined text-sm">open_in_new</span> Abrir en Producción
        </a>` : ''}
      </div>`;
    }
    if (key === 'live' && out.url) {
      return `<div class="bg-[#080808] border border-[#4CAF50]/30 rounded-2xl p-5 mb-3 relative overflow-hidden group">
        <div class="absolute inset-0 bg-gradient-to-br from-[#4CAF50]/10 to-transparent"></div>
        <div class="relative z-10 flex flex-col items-center">
          <div class="w-12 h-12 rounded-full bg-[#4CAF50]/20 flex items-center justify-center mb-3 text-[#4CAF50]">
            <span class="material-symbols-outlined text-2xl">public</span>
          </div>
          <p class="text-[0.6rem] font-black text-[#4CAF50] uppercase tracking-widest mb-1">Proyecto en Producción (LIVE)</p>
          <p class="text-[0.65rem] text-[#888] break-all max-w-full truncate mb-4">${esc(out.url)}</p>
          <a href="${esc(out.url)}" target="_blank" class="w-full text-center text-xs py-3 rounded-xl bg-[#4CAF50] text-black shadow-[0_0_20px_rgba(76,175,80,0.4)] hover:scale-[1.02] transition-all font-black flex justify-center items-center gap-2 uppercase tracking-wide">
            <span class="material-symbols-outlined text-sm">open_in_new</span> Ir a la Aplicación Pública
          </a>
        </div>
      </div>`;
    }
    return '';
  }

  async _runPhaseSSE(projectId, phaseKey, body, endpointSuffix = '') {
    const url = endpointSuffix ? `${API}/api/pipeline/${projectId}${endpointSuffix}` : `${API}/api/pipeline/${projectId}/run/${phaseKey}`;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.body) throw new Error('SSE no soportado');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop();
        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(chunk.slice(6));
            if (evt.type === 'progress') {
              const msgEl = document.getElementById(`progress-msg-${phaseKey}`);
              if (msgEl) msgEl.textContent = evt.message;
              const logEl = document.getElementById(`progress-log-${phaseKey}`);
              if (logEl && evt.message) {
                const line = document.createElement('p');
                line.className = 'text-[0.55rem] text-[#444] font-mono';
                line.textContent = `› ${evt.message}`;
                logEl.appendChild(line);
                logEl.scrollTop = logEl.scrollHeight;
              }
            } else if (evt.type === 'error') {
              toast(`Error en fase: ${evt.error}`, 'error');
              await this.openPipelineProject(projectId);
              return { success: false };
            } else if (evt.type === 'done') {
              toast(`Fase ${phaseKey.toUpperCase()} completada`);
              await this.openPipelineProject(projectId);
              return { success: true };
            }
          } catch (e) {}
        }
      }
    } catch (e) {
       toast(`Error de conexión: ${e.message}`, 'error');
       await this.openPipelineProject(projectId);
    }
    return { success: true };
  }

  async runPhase(projectId, key, btn) {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">autorenew</span> Iniciando...`;
    }
    // Lógica de redirección o ejecución directa
    if (key === 'spec' || key === 'dev' || key === 'test' || key === 'deploy') {
      await this._runPhaseSSE(projectId, key, {});
    } else if (key === 'idea') {
      this.switchTab('chat');
      document.getElementById('chat-input').value = `Ayúdame a refinar mi proyecto "${this.selectedProject.name}"`;
    }
  }

  async retryPhase(projectId, phaseKey, btn) {
    const taskInput = document.getElementById('phase-task-dev-redo');
    const task = taskInput ? taskInput.value.trim() : '';

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">autorenew</span> Reiniciando...`;
    }

    await fetch(`${API}/api/pipeline/${projectId}/phases/${phaseKey}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' })
    });
    await this.openPipelineProject(projectId);
    await this._runPhaseSSE(projectId, phaseKey, task ? { task } : {});
  }

  async confirmPhase(projectId, phaseKey) {
    const notesEl = document.getElementById(`phase-notes-${phaseKey}`);
    const bugsEl  = document.getElementById(`phase-bugs-test`);
    const covEl   = document.getElementById(`phase-coverage-test`);
    const urlEl   = document.getElementById(`phase-url-live`);

    await this._runPhaseSSE(projectId, phaseKey, {
      notes:    notesEl ? notesEl.value.trim() : '',
      bugs:     bugsEl  ? Number(bugsEl.value) : undefined,
      coverage: covEl   ? covEl.value.trim()   : '',
      url:      urlEl   ? urlEl.value.trim()   : ''
    }, `/phases/${phaseKey}/approve`);
  }

  openLandingPreview(projectName) {
    const slug = String(projectName).toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 50);
    const url = `${API}/workspace/${slug}/index.html`;
    const iframe = document.getElementById('preview-iframe');
    const overlay = document.getElementById('preview-overlay');
    if (!iframe || !overlay) return;
    iframe.src = url;
    const tabLink = document.getElementById('preview-newtab');
    if (tabLink) tabLink.href = url;
    overlay.classList.add('active');
  }

  async createProject() {
    const name = document.getElementById('pipe-name').value.trim();
    const description = document.getElementById('pipe-desc').value.trim();
    if (!name) return;
    this.setLoading('pipe-create-btn', true, 'Iniciando...');
    try {
      const res = await fetch(`${API}/api/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description })
      });
      if (res.ok) {
        const project = await res.json();
        document.getElementById('pipe-name').value = '';
        document.getElementById('pipe-desc').value = '';
        toast('Pipeline de proyecto inicializado');
        await this.loadProjects();
        const newId = project.id || project.projectId;
        if (newId) this.openPipelineProject(newId);
      }
    } catch (e) { toast('Error al crear proyecto', 'error'); }
    finally { this.setLoading('pipe-create-btn', false, 'Crear Pipeline'); }
  }

  async openSettings() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    try {
      const res = await fetch(`${API}/api/settings`);
      const data = await res.json();
      const grid = document.getElementById('settings-grid');
      if (!grid) return;

      grid.innerHTML = `
        <h3 class="text-xs font-black text-white uppercase tracking-widest mb-2">Configuración</h3>

        <!-- Obsidian -->
        <div class="p-4 bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl space-y-3 mb-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-base">📓</span>
              <span class="text-xs font-black text-white">Obsidian</span>
            </div>
            <button onclick="window.nexus.testObsidian(this)"
              class="text-[0.55rem] uppercase tracking-widest font-bold px-3 py-1 rounded-lg border border-[#222] text-[#666] hover:border-[#cc785c] hover:text-[#cc785c] transition-all">
              Probar conexión
            </button>
          </div>
          <div>
            <label class="text-[0.6rem] text-[#555] uppercase tracking-widest font-bold block mb-1">API Key (Obsidian Local REST API)</label>
            <div class="flex gap-2">
              <input id="setting-OBSIDIAN_API_KEY" type="text" placeholder="${data.OBSIDIAN_API_KEY ? 'Key guardada — pega nueva para reemplazar' : 'Pega tu API key aquí...'}"
                class="flex-1 bg-[#111] border border-[#222] text-white rounded-xl px-3 py-2 text-xs focus:border-[#cc785c] outline-none font-mono"/>
              <button onclick="window.nexus.saveSetting('OBSIDIAN_API_KEY', document.getElementById('setting-OBSIDIAN_API_KEY').value, this)"
                class="px-3 py-2 rounded-xl bg-[#cc785c] text-black text-xs font-bold hover:scale-[1.02] transition-all">Guardar</button>
            </div>
            <p class="text-[0.55rem] text-[#444] mt-1">Obsidian → Settings → Local REST API → API Key</p>
          </div>
          <div>
            <label class="text-[0.6rem] text-[#555] uppercase tracking-widest font-bold block mb-1">Puerto (default: 27123)</label>
            <input id="setting-OBSIDIAN_PORT" type="text" placeholder="27123"
              value="${data.OBSIDIAN_PORT || '27123'}"
              class="w-full bg-[#111] border border-[#222] text-white rounded-xl px-3 py-2 text-xs focus:border-[#cc785c] outline-none"
              onblur="window.nexus.saveSetting('OBSIDIAN_PORT', this.value)"/>
          </div>
        </div>

        <!-- Resto de keys (solo estado) -->
        ${Object.entries(data).filter(([k]) => !['OBSIDIAN_API_KEY','OBSIDIAN_PORT'].includes(k)).map(([k, v]) => `
          <div class="flex items-center justify-between p-3 bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl">
            <span class="text-xs font-bold text-[#dac1ba]">${k}</span>
            <span class="text-[0.6rem] font-mono ${v ? 'text-[#4CAF50]' : 'text-[#555]'}">${v ? '● Activo' : '○ Vacío'}</span>
          </div>`).join('')}`;
    } catch (e) { toast('Error cargando ajustes', 'error'); }
  }

  async saveSetting(key, value, btn) {
    if (!value?.trim()) return toast('El campo está vacío', 'error');
    try {
      await fetch(`${API}/api/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value })
      });
      toast(`${key} guardada`);
      if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = 'Guardar', 1500); }
    } catch { toast('Error guardando', 'error'); }
  }

  async deleteProject(projectId, btn) {
    if (!confirm('¿Eliminar este proyecto? Esta acción no se puede deshacer.')) return;
    try {
      const res = await fetch(`${API}/api/pipeline/${projectId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { toast('Proyecto eliminado', 'success'); this.loadProjects(); }
      else toast('Error al eliminar: ' + data.error, 'error');
    } catch (e) { toast('Error al eliminar', 'error'); }
  }

  async sendToObsidian(projectId, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="material-symbols-outlined text-sm animate-spin">autorenew</span>Enviando...`; }
    try {
      const res = await fetch(`${API}/api/pipeline/${projectId}/obsidian`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast(`Proyecto enviado a Obsidian: ${data.obsidian_path}`);
        if (btn) btn.innerHTML = `<span class="material-symbols-outlined text-sm">check</span>Enviado`;
      } else {
        toast(data.error || 'Error enviando a Obsidian', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = `<span class="material-symbols-outlined text-sm">book_2</span>Obsidian`; }
      }
    } catch (e) {
      toast('Error de conexión', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = `<span class="material-symbols-outlined text-sm">book_2</span>Obsidian`; }
    }
  }

  async testObsidian(btn) {
    if (btn) { btn.textContent = 'Probando...'; btn.disabled = true; }
    try {
      const res = await fetch(`${API}/api/obsidian/test`);
      const data = await res.json();
      if (data.connected) {
        toast('Obsidian conectado correctamente');
        if (btn) btn.textContent = '✓ Conectado';
      } else {
        toast(`Obsidian offline: ${data.reason}`, 'error');
        if (btn) { btn.textContent = '✗ Sin conexión'; btn.disabled = false; }
      }
    } catch { toast('Error de conexión', 'error'); if (btn) { btn.textContent = 'Probar conexión'; btn.disabled = false; } }
  }

  // Edit inline fields
  editProjectField(field, element, projectId) {
    if (element.querySelector('input')) return; // ya estamo editando
    const currentValue = element.textContent;
    const isTextarea = field === 'summary';
    element.innerHTML = isTextarea 
      ? `<textarea class="w-full bg-[#111] border border-[#cc785c] text-white rounded p-1 text-xs resize-none" rows="3" onblur="window.nexus.saveProjectField('${field}', this, ${projectId})">${currentValue}</textarea>`
      : `<input type="text" class="w-full bg-[#111] border border-[#cc785c] text-white rounded p-1 text-sm font-bold" value="${currentValue}" onblur="window.nexus.saveProjectField('${field}', this, ${projectId})" onkeypress="if(event.key==='Enter') this.blur()" />`;
    element.firstChild.focus();
  }

  async saveProjectField(field, inputElement, projectId) {
    const newValue = inputElement.value.trim();
    const parent = inputElement.parentElement;
    parent.textContent = newValue || 'Sin dato';
    
    try {
      await fetch(`${API}/api/pipeline/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: newValue })
      });
      toast(`Proyecto actualizado: ${field}`);
      if (this.selectedProject && this.selectedProject.id === projectId) {
        this.selectedProject[field] = newValue;
      }
    } catch(err) {
      toast('Error actualizando proyecto', 'error');
    }
  }

  // ── CORE METHODS ──

  switchTab(tab) {
    if (!tab) return;
    this.activeTab = tab;

    const TABS_TEXT = {
      chat:     { title: 'Chat con tu Cerebro Digital', sub: 'Groq · llama-3.1-8b-instant' },
      capture:  { title: 'Capturar Información',        sub: 'Agente de Captura + Clasificador' },
      research: { title: 'Investigar Temas',            sub: 'Agente Investigador' },
      write:    { title: 'Redactar Contenido',          sub: 'Agente Redactor' },
      projects:  { title: 'Pipeline de Proyectos',         sub: 'De la idea a producción — 6 fases' },
      memory:    { title: 'Memoria',                    sub: 'Tu cerebro digital — todo lo que has capturado' },
      home:      { title: 'Nexus Brain',                  sub: 'Pipeline de proyecto — de la idea a producción' },
      architect: { title: 'Arquitecto de Proyectos',     sub: 'Genera especificación técnica completa' },
      developer: { title: 'Developer IA',                sub: 'Genera código real a partir de la especificación' },
      history:   { title: 'Historial',                   sub: 'Todo lo guardado en tu cerebro digital' },
    };

    // Nav visual state
    document.querySelectorAll('.nav-link').forEach(l => {
      l.classList.toggle('active-nav', l.dataset.tab === tab);
      if (l.dataset.tab !== tab) l.classList.add('text-[#dac1ba]');
      else l.classList.remove('text-[#dac1ba]');
    });

    // Panel visibility
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
    
    // Header content
    const info = TABS_TEXT[tab];
    if (info) {
      document.getElementById('page-title').textContent = info.title;
      document.getElementById('page-sub').textContent   = info.sub;
    }

    // Lazy load logic
    if (tab === 'projects') this.loadProjects();
    if (tab === 'memory') this.renderMemoryGraph();
    if (tab === 'history') this.loadHistory();

    // Pre-cargar contexto del proyecto seleccionado en los tabs de agentes
    if (tab === 'developer' && this.selectedProject) {
      this._preloadDeveloperContext();
    }
    if (tab === 'architect' && this.selectedProject) {
      this._preloadArchitectContext();
    }
  }

  _preloadDeveloperContext() {
    const p = this.selectedProject;
    if (!p) return;

    requestAnimationFrame(() => {
      const taskEl = document.getElementById('dev-task');
      const specEl = document.getElementById('dev-spec');

      if (taskEl) {
        taskEl.value = `Desarrolla la landing page para el proyecto "${p.name}"`;
      }

      // Cargar spec de la fase spec si existe
      const specPhase = p.phases?.find(ph => ph.phase_key === 'spec' && ph.status === 'done');
      if (specEl && specPhase?.output) {
        try {
          const specData = JSON.parse(specPhase.output);
          specEl.value = specData.vision || specData.summary || specData.name || '';
        } catch {}
      }
    });

    // Si la fase dev está completada, mostrar el código existente (sin delay)
    const devPhase = p.phases?.find(ph => ph.phase_key === 'dev' && ph.status === 'done');
    if (devPhase?.output) {
      try {
        const devData = JSON.parse(devPhase.output);
        const files = Array.isArray(devData) ? devData : (devData.files || []);
        if (files.length) {
          this.lastDeveloperFiles = files;
          const resultEl = document.getElementById('dev-result');
          if (resultEl) {
            resultEl.classList.remove('hidden');
            resultEl.innerHTML = `
              <div class="bg-[#111] p-5 rounded-2xl border border-[#2196F3]/30">
                <p class="text-[0.5rem] font-black text-[#2196F3] uppercase tracking-widest mb-3">Build Existente — ${p.name}</p>
                <div class="flex gap-2 mb-4">
                  <button onclick="if(window.openLivePreview) window.openLivePreview(window.nexus.lastDeveloperFiles)" class="flex-1 bg-[#2196F3] text-black text-xs py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5">
                    <span class="material-symbols-outlined text-sm">play_circle</span> Vista Previa
                  </button>
                  <button onclick="window.nexus.runDeveloper()" class="flex-1 border border-[#2196F3]/30 text-[#2196F3] text-xs py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5">
                    <span class="material-symbols-outlined text-sm">refresh</span> Regenerar
                  </button>
                </div>
                <p class="text-[0.6rem] text-[#555]">${files.length} archivo(s) generados · Haz clic en Vista Previa para verlos</p>
              </div>`;
          }
        }
      } catch {}
    }

    toast(`Proyecto "${p.name}" cargado en Developer Studio`, 'info');
  }

  _preloadArchitectContext() {
    const p = this.selectedProject;
    if (!p) return;

    requestAnimationFrame(() => {
      const nameEl = document.getElementById('arc-name');
      const descEl = document.getElementById('arc-desc');

      if (nameEl) nameEl.value = p.name || '';
      if (descEl) descEl.value = p.summary || p.description || '';
    });

    // Si ya existe spec, mostrarla (panel de abajo)
    const specPhase = p.phases?.find(ph => ph.phase_key === 'spec' && ph.status === 'done');
    if (specPhase?.output) {
      try {
        const specData = JSON.parse(specPhase.output);
        this.lastAgentResult = specData;
        const resultEl = document.getElementById('arc-result');
        if (resultEl) {
          resultEl.classList.remove('hidden');
          resultEl.innerHTML = `<div class="bg-[#111] p-6 rounded-2xl border border-[#cc785c]/30">
            <p class="text-[0.5rem] font-black text-[#cc785c] uppercase tracking-widest mb-2">Blueprint Existente — ${p.name}</p>
            <p class="text-xs text-white font-bold mb-1">${esc(specData.name || p.name)}</p>
            <p class="text-[0.65rem] text-[#888] leading-relaxed">${esc(specData.vision || specData.summary || 'Arquitectura completada.')}</p>
            <button onclick="window.nexus.runArchitect()" class="mt-4 w-full text-xs py-2 rounded-xl border border-[#cc785c]/30 text-[#cc785c] hover:bg-[#cc785c]/10 transition-all font-bold">Regenerar Arquitectura</button>
          </div>`;
        }
      } catch {}
    }

    toast(`Proyecto "${p.name}" cargado en Arquitecto`, 'info');
  }

  setLoading(btnId, state, text = 'Procesando...') {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = state;
    const label = btn.querySelector('span:not(.material-symbols-outlined)');
    if (label) label.textContent = text;
    btn.classList.toggle('opacity-50', state);
  }

  // ── CHAT SSE ENGINE ──

  async sendMessage() {
    const container = document.getElementById('chat-list');
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg || this.isLoading) return;

    this.addChatMessage('user', msg);
    this.chatHistory.push({ role: 'user', content: msg });
    input.value = '';
    this.isLoading = true;

    const bubble = this.addChatMessage('agent', '⏳ Procesando...');
    const textEl = bubble.querySelector('p');

    let accumulatedText = '';

    try {
      const res = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: msg, history: this.chatHistory.slice(-8) })
      });

      if (!res.ok) throw new Error(`Server Error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop();

        for (const block of blocks) {
          if (!block.trim()) continue;
          const lines = block.trim().split('\n');
          let event = '', data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            if (line.startsWith('data: '))  data  = line.slice(6).trim();
          }
          if (!event || !data) continue;

          try {
            const parsed = JSON.parse(data);
            if (event === 'token') {
              if (accumulatedText === '') textEl.textContent = '';
              accumulatedText += parsed.token;
              textEl.textContent = accumulatedText;
              bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
            } else if (event === 'orchestration') {
              this.showAgentActivity(container, bubble, parsed);
            } else if (event === 'final_data') {
              this.renderFinalChatResponse(textEl, parsed, accumulatedText, bubble);
            }
          } catch (e) { console.warn('SSE Parse Error:', e); }
        }
      }
    } catch (err) {
      textEl.textContent = `Error: ${err.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  addChatMessage(type, text) {
    const container = document.getElementById('chat-list');
    if (!container) return;
    const div = document.createElement('div');
    if (type === 'user') {
      div.className = 'flex flex-col items-end max-w-[85%] ml-auto mb-6';
      div.innerHTML = `
        <div class="bg-[#1c1c1c] p-5 rounded-lg text-[#e8e8e8] leading-relaxed shadow-lg">
          <p class="text-sm font-medium">${esc(text)}</p>
        </div>
        <span class="text-[0.65rem] uppercase tracking-widest font-bold text-[#dac1ba] mt-2 mr-1">Tú</span>`;
    } else {
      div.className = 'flex flex-col items-start max-w-[85%] mb-6';
      div.innerHTML = `
        <div class="flex items-center gap-2 mb-2 ml-1">
          <span class="w-5 h-5 rounded-full bg-[#cc785c] flex items-center justify-center text-[10px] text-black font-bold">NB</span>
          <span class="text-[0.65rem] uppercase tracking-widest font-bold text-[#dac1ba]">Nexus Intelligence</span>
        </div>
        <div class="bg-[#141414] p-6 rounded-lg text-[#e8e8e8] leading-relaxed border border-transparent hover:border-[#2a2a2a] transition-all">
          <p class="text-sm bubble-content">${this.formatText(text)}</p>
        </div>`;
    }
    container.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
    return div;
  }

  showAgentActivity(container, bubble, data) {
    const statusDiv = document.createElement('div');
    statusDiv.className = 'system-msg mb-4';
    statusDiv.innerHTML = `
      <div class="flex flex-col items-start max-w-[85%] mt-4">
        <div class="flex items-center gap-2 mb-2 ml-1">
          <span class="material-symbols-outlined text-[14px] text-[#cc785c]">settings</span>
          <span class="text-[0.6rem] uppercase tracking-widest font-bold text-[#cc785c]">Sistema - Orquestador</span>
        </div>
        <div class="bg-[#141414] p-4 rounded-lg border border-dashed border-[#cc785c]/30 text-[#dac1ba] w-full">
          <div class="agent-badge">
            <b class="text-sm">Agente: ${data.agent || 'Analista'}</b><br>
            <i class="text-xs opacity-70">${data.reasoning || 'Determinando estrategia...'}</i>
          </div>
        </div>
      </div>
    `;
    container.insertBefore(statusDiv, bubble);
  }

  renderFinalChatResponse(textEl, parsed, fallbackText, bubble) {
    const fdata = parsed.data || parsed;
    const answer = fdata.answer || fdata.summary || fdata.content || fallbackText;
    
    const findings = fdata.key_findings || [];
    const sources = (parsed.sources || fdata.sources || []).map(s => typeof s === 'string' ? s : s.title || s.url);
    const followUp = fdata.follow_up || [];

    textEl.innerHTML = `
      <div class="answer-text">${this.formatText(answer)}</div>
      ${findings.length ? `<div class="mt-4 border-t border-[#2a2a2a] pt-4"><h4 class="text-[0.6rem] font-bold text-[#cc785c] uppercase mb-2">Hallazgos</h4><ul class="space-y-1">${findings.map(f => `<li class="text-sm opacity-80 list-disc ml-4">${f}</li>`).join('')}</ul></div>` : ''}
      ${sources.length ? `<div class="mt-4 pt-4 border-t border-[#2a2a2a] opacity-60"><p class="text-[0.6rem] font-bold uppercase mb-1">Fuentes</p><div class="flex flex-wrap gap-2">${sources.map(s => `<span class="text-[0.65rem] bg-[#222] px-2 py-0.5 rounded">📍 ${s}</span>`).join('')}</div></div>` : ''}
    `;

    if (followUp.length) {
      const followArea = document.createElement('div');
      followArea.className = 'mt-4 flex flex-wrap gap-2';
      followArea.innerHTML = followUp.map(q => `<button class="text-[0.65rem] bg-[#1c1c1c] border border-[#2a2a2a] px-3 py-1 rounded-full hover:border-[#cc785c] transition-all">${q}</button>`).join('');
      followArea.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('chat-input').value = btn.textContent;
          this.sendMessage();
        });
      });
      textEl.appendChild(followArea);
    }

    bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
    this.chatHistory.push({ role: 'assistant', content: (answer || fallbackText).slice(0, 1000) });
    this.saveChatToStorage();
  }

  // ── AGENT ACTIONS ──

  async runCapture() {
    const content = document.getElementById('cap-content').value.trim();
    if (!content && !this.currentImageBase64) return;
    this.setLoading('cap-btn', true, 'Capturando...');
    try {
      const type = document.getElementById('cap-type').value;
      const res = await fetch(`${API}/api/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: document.getElementById('cap-title').value,
          content: content,
          imageBase64: this.currentImageBase64
        })
      });
      const data = await res.json();
      const resultEl = document.getElementById('cap-result');
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = this.renderCaptureCard(data.data || data);
      toast('Información capturada exitosamente');
    } catch (e) {
      toast('Error en captura: ' + e.message, 'error');
    } finally {
      this.setLoading('cap-btn', false, 'Capturar');
    }
  }

  async runResearch() {
    const query = document.getElementById('res-query').value.trim();
    if (!query) return;
    this.setLoading('res-btn', true, 'Investigando...');
    const resultEl = document.getElementById('res-result');
    resultEl.classList.add('hidden');
    try {
      const res = await fetch(`${API}/api/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, depth: document.getElementById('res-depth').value })
      });
      // (Simplified sync fetch for now, can be expanded to full SSE like chat above)
      const data = await res.json();
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `<div class="bg-[#111] p-6 rounded-2xl border border-[#2196F3]/30 shadow-2xl">
        <h3 class="text-xl font-bold text-white mb-2">Resultado de Investigación</h3>
        <p class="text-sm opacity-80 leading-relaxed">${this.formatText(data.data?.summary || data.summary || 'Completado.')}</p>
      </div>`;
    } catch (e) { toast('Error investigando: ' + e.message, 'error'); }
    finally { this.setLoading('res-btn', false, 'Investigar'); }
  }

  async runMemoryQuery() {
    const question = document.getElementById('mem-question').value.trim();
    if (!question) return;
    this.setLoading('mem-btn', true, 'Consultando...');
    try {
      const res = await fetch(`${API}/api/memory/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });
      const data = await res.json();
      const resultEl = document.getElementById('mem-result');
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `<div class="bg-[#111] p-6 rounded-2xl border border-[#9C27B0]/30 shadow-2xl">
        <p class="text-sm font-bold text-[#9C27B0] mb-2 uppercase tracking-widest">Memoria Digital</p>
        <p class="text-md text-white">${this.formatText(data.data?.answer || data.answer || 'No encontré nada relacionado.')}</p>
      </div>`;
    } catch (e) { toast('Error en memoria: ' + e.message, 'error'); }
    finally { this.setLoading('mem-btn', false, 'Consultar'); }
  }

  async runArchitect() {
    const vision = document.getElementById('arc-desc').value.trim();
    if (!vision) return;
    this.setLoading('arc-btn', true, 'Diseñando...');
    try {
      const res = await fetch(`${API}/api/architect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: document.getElementById('arc-name').value,
          platform: document.getElementById('arc-platform').value,
          vision 
        })
      });
      const data = await res.json();
      this.lastAgentResult = data.data || data;
      const resultEl = document.getElementById('arc-result');
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `<div class="bg-[#111] p-8 rounded-3xl border border-[#cc785c]/30 shadow-2xl relative">
        <h3 class="text-2xl font-black text-white mb-4 tracking-tighter">Especificación de Arquitectura</h3>
        <div class="prose-apple mb-8 opacity-80 leading-relaxed">${this.formatText(this.lastAgentResult.summary || this.lastAgentResult.answer || 'Arquitectura generada.')}</div>
        
        ${this.selectedProject ? `
          <div class="mt-6 pt-6 border-t border-white/5 flex justify-end">
            <button id="save-spec-btn" onclick="window.nexus.saveToProject('spec', window.nexus.lastAgentResult)" 
              class="flex items-center gap-2 bg-[#cc785c] text-black px-6 py-2.5 rounded-xl font-bold text-xs hover:scale-105 transition-all">
              <span class="material-symbols-outlined text-sm">save</span>
              <span>Guardar en Proyecto "${this.selectedProject.name}"</span>
            </button>
          </div>
        ` : ''}
      </div>`;
    } catch (e) { toast('Error en arquitecto: ' + e.message, 'error'); }
    finally { this.setLoading('arc-btn', false, 'Iniciar Ingeniería'); }
  }

  async runDeveloper() {
    const task = document.getElementById('dev-task').value.trim();
    if (!task) return;
    
    // Recuperar imagen activa del panel de captura para Visión
    let activeImage = null;
    const capturePreview = document.getElementById('capture-preview');
    if (capturePreview && capturePreview.src && capturePreview.src.startsWith('data:image')) {
      activeImage = capturePreview.src;
      toast('Imagen detectada como referencia visual', 'info');
    }
    
    this.setLoading('dev-btn', true, 'Programando...');
    try {
      const res = await fetch(`${API}/api/developer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          task,
          specification: document.getElementById('dev-spec').value,
          projectId: this.selectedProject?.id,
          projectName: this.selectedProject?.name,
          image: activeImage
        })
      });
      const data = await res.json();
      this.lastDeveloperFiles = data.data?.files || data.files || [];
      const resultEl = document.getElementById('dev-result');
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `
        <div class="bg-[#111] p-6 rounded-2xl border border-[#2196F3]/30 shadow-2xl">
          <div class="flex items-center gap-3 mb-4">
             <div class="w-10 h-10 rounded-xl bg-[#2196F3]/10 flex items-center justify-center">
                <span class="material-symbols-outlined text-[#2196F3]">dataset</span>
             </div>
             <div>
                <h3 class="text-sm font-bold text-white uppercase tracking-widest">Código Generado</h3>
                <p class="text-[0.6rem] text-[#555] font-black">${this.lastDeveloperFiles.length} ARCHIVOS COMPILADOS</p>
             </div>
          </div>
          
          <div class="flex gap-3 mb-6">
            <button id="preview-btn-real" class="flex-1 bg-[#2196F3] text-black py-3 rounded-xl font-bold text-xs hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2">
              <span class="material-symbols-outlined text-sm">play_circle</span>
              <span>Lanzar Vista Previa</span>
            </button>
            ${this.selectedProject ? `
              <button id="save-dev-btn" onclick="window.nexus.saveToProject('dev', window.nexus.lastDeveloperFiles)" 
                class="flex-1 border border-[#2196F3]/30 text-[#2196F3] py-3 rounded-xl font-bold text-xs hover:bg-[#2196F3]/10 transition-all flex items-center justify-center gap-2">
                <span class="material-symbols-outlined text-sm">save</span>
                <span>Guardar en ${this.selectedProject.name}</span>
              </button>
            ` : ''}
          </div>

          <div class="space-y-2">
            ${this.lastDeveloperFiles.map(f => `
              <div class="flex items-center justify-between p-2.5 bg-black/20 rounded border border-white/5 hover:border-white/10 transition-all">
                <div class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-[16px] text-[#555]">description</span>
                  <span class="text-[0.65rem] font-mono text-[#888]">${f.path}</span>
                </div>
                <span class="text-[0.55rem] text-[#333] uppercase font-bold">${f.content.length} B</span>
              </div>
            `).join('')}
          </div>
        </div>`;
      
      document.getElementById('preview-btn-real')?.addEventListener('click', () => {
        if (window.openLivePreview) window.openLivePreview(this.lastDeveloperFiles);
      });
    } catch (e) { toast('Error en developer: ' + e.message, 'error'); }
    finally { this.setLoading('dev-btn', false, 'Generar código'); }
  }

  // ── HELPERS & UTILS ──

  formatText(text) {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  renderCaptureCard(r) {
    const tags = (r.suggested_tags || []).map(t => `<span class="bg-[#1c1c1c] text-[#4CAF50] text-[10px] px-2 py-0.5 rounded border border-[#4CAF50]/10">#${t}</span>`).join('');
    return `
    <div class="bg-[#111] border border-[#222] rounded-2xl p-6 shadow-2xl animate-fade-in">
      <p class="text-[0.6rem] uppercase tracking-widest text-[#4CAF50] font-bold mb-2">Conocimiento Capturado</p>
      <h3 class="text-xl font-bold text-white mb-2">${esc(r.title || 'Inspiración')}</h3>
      ${r.summary ? `<p class="text-sm text-[#bbb] mb-4">${esc(r.summary)}</p>` : ''}
      <div class="flex flex-wrap gap-2">${tags}</div>
    </div>`;
  }

  async renderMemoryGraph() {
    const container = document.getElementById('memory-graph');
    if (!container) return;
    try {
      const res = await fetch(`${API}/api/memory/graph`);
      const data = await res.json();
      if (!data.success) return;
      const { nodes, links } = data;
      const svgContainer = document.getElementById('memory-graph-container');
      const width = svgContainer ? svgContainer.clientWidth : 800;
      const height = 400;
      d3.select("#memory-graph").selectAll("*").remove();
      const svg = d3.select("#memory-graph").attr("viewBox", [0, 0, width, height]);
      const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(100))
        .force("charge", d3.forceManyBody().strength(-300))
        .force("center", d3.forceCenter(width / 2, height / 2));
      const link = svg.append("g").attr("stroke", "#9C27B0").attr("stroke-opacity", 0.3).selectAll("line").data(links).join("line");
      const node = svg.append("g").attr("stroke", "#fff").selectAll("circle").data(nodes).join("circle").attr("r", 8).attr("fill", "#9C27B0").call(this.drag(simulation));
      simulation.on("tick", () => {
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        node.attr("cx", d => d.x).attr("cy", d => d.y);
      });
    } catch (e) { console.error('Graph fail:', e); }
  }

  drag(simulation) {
    return d3.drag()
      .on("start", (e) => { if (!e.active) simulation.alphaTarget(0.3).restart(); e.subject.fx = e.subject.x; e.subject.fy = e.subject.y; })
      .on("drag", (e) => { e.subject.fx = e.x; e.subject.fy = e.y; })
      .on("end", (e) => { if (!e.active) simulation.alphaTarget(0); e.subject.fx = null; e.subject.fy = null; });
  }

  handleImageSelect(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      this.currentImageBase64 = e.target.result;
      const preview = document.getElementById('image-preview');
      if (preview) {
        preview.src = this.currentImageBase64;
        document.getElementById('image-preview-container')?.classList.remove('hidden');
      }
    };
    reader.readAsDataURL(file);
  }

  clearImage() {
    this.currentImageBase64 = null;
    document.getElementById('image-preview-container')?.classList.add('hidden');
    const input = document.getElementById('image-input');
    if (input) input.value = '';
  }

  toggleVoice() {
    if (!this.recognition) this.initVoice();
    if (this.isRecording) this.stopVoice(true);
    else this.recognition.start();
  }

  async loadRecentResearches() {
    const list = document.getElementById('res-recent-list');
    if (!list) return;
    try {
      const res = await fetch(`${API}/api/research/recent`);
      const items = await res.json();
      if (!items.length) {
        list.innerHTML = '<span class="text-[0.65rem] text-[#333]">No hay búsquedas recientes</span>';
        return;
      }
      list.innerHTML = items.map(q => `
        <button class="text-[0.65rem] bg-[#1a1a1a] border border-[#2a2a2a] text-[#dac1ba] px-3 py-1 rounded-full hover:border-[#2196F3] transition-all" 
          onclick="document.getElementById('res-query').value = '${q.replace(/'/g, "\\'")}'; window.nexus.runResearch();">
          ${esc(q)}
        </button>
      `).join('');
    } catch (e) { console.warn('Recent research fail:', e); }
  }

  // --- HISTORY LOGIC ---
  async loadHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = '<div class="animate-pulse flex flex-col gap-4"><div class="h-16 bg-[#1a1a1a] rounded-xl"></div><div class="h-16 bg-[#1a1a1a] rounded-xl"></div></div>';
    try {
      const res = await fetch(`${API}/api/history/captures`);
      const data = await res.json();
      this._history = data;
      this.renderHistory();
    } catch (e) { toast('Error cargando historial', 'error'); }
  }

  renderHistory() {
    const list = document.getElementById('history-list');
    if (!list || !this._history) return;
    if (this._history.length === 0) {
      list.innerHTML = '<div class="text-center py-20 text-[#333] uppercase tracking-widest text-xs">El cerebro digital está vacío</div>';
      return;
    }
    list.innerHTML = this._history.map(h => `
      <div class="agent-card group hover:border-[#cc785c]/40 transition-all flex items-start gap-4 p-5 bg-[#141414]/30 backdrop-blur-md rounded-2xl border border-[#2a2a2a]">
        <div class="w-10 h-10 rounded-xl bg-[#cc785c]/10 border border-[#cc785c]/20 flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-[#cc785c] text-lg">${h.type === 'url' ? 'link' : h.type === 'image' ? 'image' : 'description'}</span>
        </div>
        <div class="flex-1">
          <div class="flex justify-between items-start">
            <h4 class="text-white font-bold text-sm mb-1 group-hover:text-[#cc785c] transition-colors">${esc(h.title || 'Sin título')}</h4>
            <span class="text-[0.6rem] text-[#555] font-mono">${new Date(h.created_at).toLocaleString()}</span>
          </div>
          <p class="text-[#888] text-xs line-clamp-2 leading-relaxed">${esc(h.summary || h.content || 'Sin contenido')}</p>
          <div class="mt-3 flex gap-2">
            ${(h.tags || '').split(',').filter(Boolean).map(t => `<span class="text-[0.55rem] bg-[#cc785c]/5 text-[#cc785c]/80 px-2 py-0.5 rounded border border-[#cc785c]/10">#${t.trim()}</span>`).join('')}
          </div>
        </div>
      </div>
    `).join('');
  }

  async runProjectPreview(id) {
    try {
      const res = await fetch(`${API}/api/pipeline/${id}`);
      const p = await res.json();
      const devPhase = p.phases.find(ph => ph.phase_key === 'dev' && ph.status === 'done');
      if (!devPhase || !devPhase.output) {
        toast('No hay archivos generados para este proyecto todavía.', 'error');
        return;
      }
      const devData = JSON.parse(devPhase.output);
      // devData puede ser { files: [...] } o directamente un array
      const files = Array.isArray(devData) ? devData : (devData.files || []);
      if (!files.length) {
        toast('No se encontraron archivos en esta fase de desarrollo.', 'error');
        return;
      }
      if (window.openLivePreview) window.openLivePreview(files);
      else toast('Error: Sistema de vista previa no inicializado', 'error');
    } catch (e) { toast('Error cargando preview: ' + e.message, 'error'); }
  }
}

export default NexusBrain;
