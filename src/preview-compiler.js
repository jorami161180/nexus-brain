// Live Preview Compiler — extracted to avoid </script> parsing issues in index.html
window.openLivePreview = function openLivePreview(files) {
  const API = window.API || 'http://localhost:3002';
  const overlay = document.getElementById('preview-overlay');
  const iframe = document.getElementById('preview-iframe');
  
  // Find the primary HTML file
  let htmlFile = files.find(f => f.language === 'html' || f.path.endsWith('.html'));
  if (!htmlFile) {
    const firstFile = files[0];
    if (!firstFile) { alert('No hay archivos para previsualizar.'); return; }
    if (firstFile.language === 'javascript') {
      htmlFile = { code: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>' };
    } else if (firstFile.language === 'css') {
      htmlFile = { code: '<!DOCTYPE html><html><head></head><body><h1>CSS Preview</h1></body></html>' };
    } else {
      alert('No se puede previsualizar este tipo de archivo.');
      return;
    }
  }

  let fullSource = htmlFile.code;
  
  // Detect React/Tailwind usage
  const allCode = files.map(f => f.code || '').join('\n');
  const hasReact = allCode.includes('React') || allCode.includes('useState') || allCode.includes('import React');
  const hasTailwind = allCode.includes('className=') || allCode.includes('@tailwind');

  // Build CDN injections safely (no </script> literal in source)
  const sc = ['<', 'script'].join('');
  const scEnd = ['<', '/script>'].join('');

  let headInjections = '';
  if (hasTailwind && !fullSource.includes('tailwindcss.com')) {
    headInjections += `${sc} src="https://cdn.tailwindcss.com">${scEnd}\n`;
  }
  if (hasReact && !fullSource.includes('react.development.js')) {
    headInjections += `${sc} crossorigin src="https://unpkg.com/react@18/umd/react.development.js">${scEnd}\n`;
    headInjections += `${sc} crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js">${scEnd}\n`;
    headInjections += `${sc} src="https://unpkg.com/babel-standalone@6/babel.min.js">${scEnd}\n`;
  }

  if (headInjections) {
    if (fullSource.includes('</head>')) {
      fullSource = fullSource.replace('</head>', headInjections + '</head>');
    } else {
      fullSource = '<head>' + headInjections + '</head>\n' + fullSource;
    }
  }
  
  // Inject CSS files
  const cssFiles = files.filter(f => f.language === 'css' && f !== htmlFile);
  cssFiles.forEach(css => {
    const tag = '<style>' + css.code + '</style>';
    fullSource = fullSource.includes('</head>')
      ? fullSource.replace('</head>', tag + '</head>')
      : tag + '\n' + fullSource;
  });
  
  // Inject JS files
  const jsFiles = files.filter(f => f.language === 'javascript' && f !== htmlFile);
  jsFiles.forEach(js => {
    let code = js.code
      .replace(/import\s+.*?from\s+['"].*?['"];?/g, '')
      .replace(/export\s+default\s+/g, 'const App = ');
    
    if (hasReact && !code.includes('ReactDOM.') && !code.includes('createRoot')) {
      code += "\n\nconst root = ReactDOM.createRoot(document.getElementById('root'));\nroot.render(React.createElement(App));";
    }

    const openTag = hasReact ? `${sc} type="text/babel">` : `${sc}>`;
    const block = openTag + '\n' + code + '\n' + scEnd;

    fullSource = fullSource.includes('</body>')
      ? fullSource.replace('</body>', block + '</body>')
      : fullSource + '\n' + block;
  });

  // Render in sandbox iframe via blob URL
  const blob = new Blob([fullSource], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  iframe.src = url;
  overlay.classList.add('active');
};
