import './styles/main.css';
import NexusBrain from './app.js';
import './preview.js';

// Init unified brain on document body
const app = new NexusBrain(document.body);
window.nexus = app; // Expose globally for dynamic HTML handlers
app.init();
