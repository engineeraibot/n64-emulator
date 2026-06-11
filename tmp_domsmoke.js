// tmp_domsmoke.js — browser-flow smoke test: run index.html's real load path
// (DOMContentLoaded -> script.js -> ROM auto-load -> cpu.run -> animate loop)
// under jsdom, with canvas.getContext('webgl') answered by the FakeGL stub.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('/tmp/gltest/node_modules/jsdom');
const { FakeGL } = require('./tmp_glsim');

const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/index.html?gl=' + (process.env.GL === '0' ? '0' : '1'), runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

// canvas: route 'webgl' to FakeGL; '2d' to a tiny stub (SW path not under test here)
const fakeGL = new FakeGL(640, 480);
window.HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === 'webgl') { fakeGL.drawingBufferWidth = this.width; fakeGL.drawingBufferHeight = this.height; return fakeGL; }
    if (type === '2d') return { fillRect(){}, drawImage(){}, putImageData(){}, set fillStyle(v){}, get fillStyle(){return '#000'}, imageSmoothingEnabled: false };
    return null;
};
// fetch: serve the ROM from disk
window.fetch = (url) => {
    const f = decodeURIComponent(String(url).replace(/^.*\//, ''));
    if (fs.existsSync(f)) { const b = fs.readFileSync(f); return Promise.resolve({ arrayBuffer: () => Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }); }
    return Promise.reject(new Error('404 ' + f));
};
// jsdom lacks ImageData (real browsers have it)
window.ImageData = window.ImageData || class ImageData { constructor(data, w, h) { this.data = data; this.width = w; this.height = h; } };
const errors = [];
window.addEventListener('error', (e) => errors.push('window.onerror: ' + e.message));
const realErr = console.error;
window.console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); };

// run the page's scripts as ONE script so top-level class declarations are
// shared (separate eval calls get separate lexical scopes, unlike <script> tags)
let all = '';
for (const m of html.matchAll(/<script src="([^"?]+)/g)) all += fs.readFileSync(m[1], 'utf8') + '\n';
try { dom.window.eval(all); } catch (e) { errors.push('eval: ' + e.message); }
dom.window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

// let the microtask/fetch + MessageChannel run loop spin for a while
setTimeout(() => {
    const cpu = window.cpu, rcp = window.rcp;
    console.log('after 6s: steps', cpu ? cpu.instructionCount : 'n/a',
        'f3d', rcp ? rcp.f3dTaskCount : 'n/a',
        'glr attached', !!(rcp && rcp.glr),
        'fakeGL draws', fakeGL.stats.draws);
    console.log('errors:', errors.length ? errors.join('\n') : 'NONE');
    process.exit(errors.length ? 1 : 0);
}, 6000);
