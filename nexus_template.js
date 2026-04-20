<%*
/**
 * Nexus Engine: Project Initialization Script
 * Compatible with Obsidian Templater plugin.
 */

const n8nWebhookUrl = "http://localhost:5678/webhook/nexus-webhook";
const noteTitle = tp.file.title;
const sanitizedTitle = noteTitle.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
const projectId = Math.random().toString(36).substring(2, 9);
const stackType = await tp.system.suggester(["Next.js", "Vite", "Python", "Other"], ["nextjs", "vite", "python", "other"]);

if (!stackType) {
    new Notice("❌ Initialization cancelled.");
    return;
}

const payload = {
    nombre_proyecto: sanitizedTitle,
    id_proyecto: projectId,
    tipo_stack: stackType
};

new Notice("🚀 Sending project to Nexus Engine...");

try {
    const response = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        new Notice("✅ Project sent successfully! Check GitHub and n8n.");
    } else {
        const error = await response.text();
        new Notice("⚠️ Error: " + error);
        console.error("Nexus Engine Error:", error);
    }
} catch (err) {
    new Notice("❌ Connection failed. Is n8n running on port 5678?");
    console.error("Nexus Engine Connection Error:", err);
}
%>
