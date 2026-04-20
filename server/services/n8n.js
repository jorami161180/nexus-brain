import fetch from 'node-fetch';

/**
 * Nexus N8N Webhook Service
 * 
 * Este módulo se encarga de enviar triggers (disparadores) a instancias locales de n8n
 * permitiendo a Nexus Brain ejecutar flujos de automatización externos (como mandar emails, 
 * mover archivos, postear en redes, etc).
 */

const N8N_HOST = process.env.N8N_HOST || 'http://127.0.0.1:5678';
const DEFAULT_WEBHOOK_PATH = '/webhook/nexus-trigger';

export async function triggerN8nWorkflow(payload, endpoint = DEFAULT_WEBHOOK_PATH) {
    const url = `${N8N_HOST}${endpoint}`;
    console.log(`[n8n] Disparando webhook hacia: ${url}`);
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Auth genérica por si configuraste seguridad en tu entorno n8n local
                'Authorization': `Bearer ${process.env.N8N_API_KEY || 'nexus-local'}`
            },
            body: JSON.stringify({
                source: 'Nexus Brain',
                timestamp: new Date().toISOString(),
                ...payload
            })
        });

        if (!response.ok) {
            console.warn(`[n8n] Webhook devuelto con status: ${response.status} ${response.statusText}`);
            return { success: false, status: response.status, error: 'Respuesta no afirmativa' };
        }

        let data = {};
        try { data = await response.json(); } catch(e) { /* si la respuesta viene vacía */ }
        
        console.log(`[n8n] Workflow disparado con éxito.`);
        return { success: true, data };
        
    } catch (error) {
        console.error(`[n8n] Error de conexión al disparar webhook: ${error.message}`);
        return { success: false, error: error.message };
    }
}
