/**
 * Nexus Preview System v2.0
 * Abre la vista previa del HTML generado en un modal inline o en nueva pestaña.
 */

export function openLivePreview(files) {
  // Buscar archivo HTML principal — soporta .code (developer.js) o .content (legacy)
  const htmlFile = files.find(f => f.path?.endsWith('.html')) || files[0];
  const content = htmlFile ? (htmlFile.code || htmlFile.content || '') : '';

  if (!content.trim()) {
    alert('El proyecto no tiene código HTML generado todavía. Ejecuta primero la fase de Desarrollo.');
    return;
  }

  // Intentar mostrar en el overlay integrado si existe
  const overlay = document.getElementById('preview-overlay');
  const iframe  = document.getElementById('preview-iframe');

  if (overlay && iframe) {
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
    if (iframe._previewUrl) URL.revokeObjectURL(iframe._previewUrl);
    const blob = new Blob([content], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    iframe._previewUrl = url;
    iframe.src = url;
    const btn = document.getElementById('preview-newtab');
    if (btn) btn.href = url;
    return;
  }

  // Fallback: abrir en una nueva pestaña del navegador
  const blob = new Blob([content], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  if (!win) {
    // Si el navegador bloqueó la popup, mostrar el overlay inline dinámico
    _showInlineOverlay(content);
  }
}

function _showInlineOverlay(html) {
  // Crear un overlay de preview completo en el DOM si no existe
  let overlay = document.getElementById('nexus-preview-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'nexus-preview-modal';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;background:#000;
      display:flex;flex-direction:column;animation:fadeIn .2s ease;
    `;
    overlay.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:#0c0c0c;border-bottom:1px solid #1a1a1a;font-family:sans-serif;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="width:10px;height:10px;border-radius:50%;background:#4CAF50;box-shadow:0 0 8px #4CAF5066;"></span>
          <span style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:2px;">Vista Preliminar</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="preview-modal-desktop" onclick="document.getElementById('nexus-preview-iframe').style.width='100%'" style="font-size:10px;padding:4px 10px;border:1px solid #333;background:transparent;color:#888;border-radius:6px;cursor:pointer;">Escritorio</button>
          <button id="preview-modal-mobile" onclick="document.getElementById('nexus-preview-iframe').style.width='375px'" style="font-size:10px;padding:4px 10px;border:1px solid #333;background:transparent;color:#888;border-radius:6px;cursor:pointer;">Móvil</button>
          <button onclick="window.nexus_closePreview()" style="font-size:10px;padding:4px 14px;border:1px solid #cc785c44;background:#cc785c11;color:#cc785c;border-radius:6px;cursor:pointer;font-weight:700;">✕ Cerrar</button>
        </div>
      </div>
      <div style="flex:1;display:flex;justify-content:center;background:#111;overflow:auto;padding:0;">
        <iframe id="nexus-preview-iframe" style="flex:1;width:100%;border:none;background:white;" frameborder="0" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
      </div>`;
    document.body.appendChild(overlay);
  }

  // Inyectar el contenido HTML en el iframe via srcdoc
  const iframe = document.getElementById('nexus-preview-iframe');
  iframe.srcdoc = html;
  overlay.style.display = 'flex';

  window.nexus_closePreview = () => {
    overlay.style.display = 'none';
    iframe.srcdoc = '';
  };
}

export function closeLivePreview() {
  const overlay = document.getElementById('preview-overlay');
  const iframe  = document.getElementById('preview-iframe');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.classList.add('hidden');
  }
  if (iframe) {
    if (iframe._previewUrl) { URL.revokeObjectURL(iframe._previewUrl); iframe._previewUrl = null; }
    iframe.src = 'about:blank';
  }
  const modal = document.getElementById('nexus-preview-modal');
  if (modal) modal.style.display = 'none';
}

export function setPreviewDevice(device) {
  const win = document.querySelector('.preview-window');
  if (!win) return;
  win.classList.toggle('mobile', device === 'mobile');
  document.getElementById('btn-desktop')?.classList.toggle('active', device === 'desktop');
  document.getElementById('btn-mobile')?.classList.toggle('active', device === 'mobile');
}

// Exponer globalmente
window.openLivePreview  = openLivePreview;
window.closeLivePreview = closeLivePreview;
window.setPreviewDevice = setPreviewDevice;
