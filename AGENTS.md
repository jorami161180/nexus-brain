# Nexus Brain — Contexto del Proyecto

## Qué es
Sistema de cerebro digital personal con 7 agentes de IA especializados, frontend en Vite y backend en Node.js/Express.

## Arquitectura
```
Frontend (Vite)  →  Express Server (puerto 3002)  →  Smart Router
                                                         ├── LM Studio (local, primario)
                                                         ├── Ollama (local, fallback)
                                                         └── Claude API (cloud, último recurso)
```

## Estructura de archivos clave
- `server/router.js` — Router inteligente multi-proveedor
- `server/lmstudio.js` — Cliente LM Studio
- `server/agents/orchestrator.js` — Orquestador (gemma-3-4b)
- `server/agents/capture.js` — Captura texto/URL/imagen (glm-4.6v)
- `server/agents/classifier.js` — Clasificador local (gemma-3-4b)
- `server/agents/memory.js` — Memoria Q&A (deepseek-r1)
- `server/agents/writer.js` — Redactor (qwen3.5-9b)
- `server/agents/projects.js` — Proyectos + GitHub (qwen2.5-coder)
- `server/agents/researcher.js` — Investigador web (deepseek-r1 + Tavily)
- `src/app.js` — Frontend completo con 5 tabs
- `src/styles/main.css` — Dark theme

## Stack
- **Frontend**: Vite + Vanilla JS
- **Backend**: Node.js + Express (ES modules)
- **IA Local**: LM Studio (puerto 1234) + Ollama (puerto 11434)
- **IA Cloud**: Claude API (Anthropic) como fallback
- **Automatización**: n8n (puerto 5678)
- **PKM**: Obsidian con Templater
- **Docker**: n8n + Ollama

## Modelos LM Studio activos
- `google/gemma-3-4b` — Orquestador, Clasificador
- `zai-org/glm-4.6v-flash` — Captura (vision)
- `deepseek/deepseek-r1-0528-qwen3-8b` — Memoria, Investigador
- `qwen/qwen3.5-9b` — Redactor
- `qwen/qwen2.5-coder-14b` — Proyectos

## Comandos
```bash
npm run dev          # Arranca frontend + backend
docker compose up -d # Arranca n8n + Ollama
```

## Puertos
- 5173 → Frontend Vite
- 3002 → API Server
- 1234 → LM Studio
- 11434 → Ollama
- 5678 → n8n
