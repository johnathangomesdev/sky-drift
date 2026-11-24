'use strict';
/* =====================================================================
   SKY DRIFT — demo jogável (Three.js r128)
   Pista laranja suspensa sobre as nuvens, carrinho sempre avançando,
   controle por arrasto horizontal (dedo ou mouse).

   Estrutura do arquivo:
     1. Configuração e utilitários
     2. Renderer, cena, câmera, luzes, céu e nuvens
     3. Materiais, texturas geradas por código e geometrias compartilhadas
     4. Caminho da pista (linha central) e consulta de "chão sólido"
     5. Construção da malha de cada segmento
     6. Modelos: carro, obstáculos, moedas, placas, linha de chegada
     7. Geração procedural dos segmentos (curvas, bifurcações, buracos)
     8. Efeitos (partículas, brilho, tremida, flash)
     9. Entrada (arrasto / mouse / teclado)
    10. Lógica do jogo (update, colisões, queda, níveis)
    11. HUD, telas e loop principal
   ===================================================================== */

/* ---------- 1. CONFIGURAÇÃO ---------- */
const HW = 4;              // meia largura da pista (largura total = 8)
const T = 1.3;             // espessura da pista
const DS = 1.5;            // passo da malha ao longo da pista
const CAR_HW = 0.8;        // meia largura do carro (colisão)
const CAR_HL = 1.3;        // meio comprimento do carro (colisão)
const FALL_TOL = 0.2;      // quanto o centro do carro pode passar da borda antes de cair
const TURN_SENS = 1.8;     // radianos de giro por "largura de tela" arrastada
const TURN_KEY = 1.6;      // radianos/segundo ao segurar ← →
const AHEAD = 360;         // quanto de pista gerar à frente
const BEHIND = 40;         // quanto manter atrás antes de apagar
const BASE_SPEED = 24, SPEED_PER_LEVEL = 3, MAX_SPEED = 46;   // velocidade máxima por nível
const ACCEL = 12, COAST = 12, BRAKE = 30;   // aceleração, desaceleração ao soltar, freio
const THROTTLE_PX = 0.12;                   // arrastar 12% da altura da tela para cima = acelerador no máximo
// Câmbio: velocidade (m/s) em que cada marcha chega ao giro máximo
const GEAR_TOP = [9, 15, 22, 30, 40, 50];
const IDLE_RPM = 0.16, SHIFT_UP = 0.93, SHIFT_DOWN = 0.8, SHIFT_TIME = 0.2;

const levelLen = L => 480 + 120 * (L - 1);
function levelStartOf(L) { let s = 0; for (let i = 1; i < L; i++) s += levelLen(i); return s; }

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- 2. RENDERER / CENA ---------- */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const HORIZON = 0xcdeeff;
scene.background = new THREE.Color(HORIZON);
scene.fog = new THREE.Fog(HORIZON, 90, 420);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1500);
scene.add(camera);                        // linhas de velocidade ficam presas à câmera
let baseFov = 70;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  baseFov = camera.fov = w < h ? 70 : 56;  // FOV maior em tela vertical (abre um pouco com a velocidade)
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Luzes: hemisférica (céu) + sol direcional com sombra que segue o carro
scene.add(new THREE.HemisphereLight(0xeaf6ff, 0xffd8b0, 0.8));
const sun = new THREE.DirectionalLight(0xfff1d6, 0.75);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 140 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);

// Céu: esfera com gradiente por cor de vértice
const sky = (() => {
  const R = 900, geo = new THREE.SphereGeometry(R, 32, 16);
  const top = new THREE.Color(0x1e88e5), hor = new THREE.Color(HORIZON), cols = [];
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.pow(clamp(p.getY(i) / R * 1.8, 0, 1), 0.6);
    const c = hor.clone().lerp(top, t); cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -1; scene.add(m); return m;
})();

// "Mar" de nuvens bem abaixo da pista
const cloudSea = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x6d8aa8 }));
cloudSea.rotation.x = -Math.PI / 2;
scene.add(cloudSea);

// Nuvens fofas: grupos de esferas low-poly reaproveitados
const puffGeo = new THREE.IcosahedronGeometry(1, 1);
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x7088a0, flatShading: true });
const clouds = [];
for (let i = 0; i < 46; i++) {
  const g = new THREE.Group();
  const n = randInt(4, 7);
  for (let j = 0; j < n; j++) {
    const m = new THREE.Mesh(puffGeo, cloudMat);
    m.position.set(rand(-2.2, 2.2), rand(-0.3, 0.8), rand(-1.2, 1.2));
    m.scale.setScalar(rand(0.9, 1.7));
    g.add(m);
  }
  g.scale.setScalar(rand(2.5, 6));
  scene.add(g); clouds.push(g);
}

/* ---------- 3. MATERIAIS, TEXTURAS E GEOMETRIAS ---------- */
const lam = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
const basic = color => new THREE.MeshBasicMaterial({ color });

// Gera uma textura desenhando num <canvas> (nada de imagens externas)
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
const texHazard = canvasTex(256, 48, (g, w, h) => {      // faixas pretas/amarelas
  g.fillStyle = '#ffc21a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1a1a1a';
  for (let x = -h; x < w + h; x += 44) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 22, h); g.lineTo(x + 22 + h, 0); g.lineTo(x + h, 0); g.fill(); }
  g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
});
const texChecker = canvasTex(256, 32, (g, w, h) => {     // xadrez da chegada
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 16, j * 16, 16, 16); }
});
const texForkSign = canvasTex(256, 256, (g) => {          // placa amarela de bifurcação
  g.translate(128, 128); g.rotate(Math.PI / 4);
  g.fillStyle = '#1a1a1a'; g.fillRect(-86, -86, 172, 172);
  g.fillStyle = '#ffc21a'; g.fillRect(-76, -76, 152, 152);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 16; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(128, 200); g.lineTo(128, 140); g.quadraticCurveTo(128, 112, 92, 84); g.moveTo(128, 140); g.quadraticCurveTo(128, 112, 164, 84); g.stroke();
  g.fillStyle = '#1a1a1a';
  g.beginPath(); g.moveTo(74, 66); g.lineTo(108, 70); g.lineTo(84, 100); g.fill();
  g.beginPath(); g.moveTo(182, 66); g.lineTo(148, 70); g.lineTo(172, 100); g.fill();
});
function turnSignTex(dir) {                                // placa redonda de curva (dir: -1 esq, 1 dir)
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#e3262b'; g.lineWidth = 22; g.beginPath(); g.arc(128, 128, 106, 0, Math.PI * 2); g.stroke();
    g.save(); g.translate(128, 128); g.scale(dir, 1);
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 20; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-20, 60); g.lineTo(-20, -5); g.quadraticCurveTo(-20, -30, 10, -30); g.lineTo(20, -30); g.stroke();
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.moveTo(15, -62); g.lineTo(62, -30); g.lineTo(15, 2); g.fill();
    g.restore();
  });
}
const texTurnL = turnSignTex(-1), texTurnR = turnSignTex(1);
const texDots = canvasTex(128, 128, (g, w, h) => {         // pintura rosa de bolinhas brancas
  g.fillStyle = '#ff5fa8'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff';
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.beginPath(); g.arc(x * 32 + (y % 2 ? 16 : 0) + 8, y * 32 + 16, 7, 0, Math.PI * 2); g.fill();
  }
});
texDots.wrapS = texDots.wrapT = THREE.RepeatWrapping;
texDots.repeat.set(2, 2);
const texPuff = canvasTex(64, 64, (g, w, h) => {           // bolinha macia (fumaça, chama, brilho)
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.65)');
  gr.addColorStop(0.7, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

// Pinturas disponíveis na garagem
const CAR_SKINS = [
  { id: 'red',    name: 'Vermelho Clássico', body: 0xe5262b, stripe: 0xffffff, css: '#e5262b' },
  { id: 'blue',   name: 'Azul Turbo',        body: 0x1f6fe5, stripe: 0xffffff, css: '#1f6fe5' },
  { id: 'green',  name: 'Verde Limão',       body: 0x46c21f, stripe: 0x1b1b1b, css: '#46c21f' },
  { id: 'yellow', name: 'Amarelo Táxi',      body: 0xffc21a, stripe: 0x1b1b1b, css: '#ffc21a' },
  { id: 'black',  name: 'Preto Noturno',     body: 0x23252b, stripe: 0xff8a00, css: '#23252b' },
  { id: 'pink',   name: 'Rosa Poá',          dots: true, bow: true,
    css: 'radial-gradient(circle at 30% 30%, #fff 0 4px, transparent 5px), radial-gradient(circle at 70% 65%, #fff 0 4px, transparent 5px), #ff5fa8' },
];

const MAT = {
  track: new THREE.MeshLambertMaterial({ vertexColors: true }),
  cone: lam(0xff5a0a), white: lam(0xffffff), black: lam(0x24262b), tire: lam(0x1e1f22), tireIn: lam(0x0c0c0d),
  red: lam(0xe3262b), yellow: lam(0xffbf1a), metal: lam(0x7d8592), lightHead: lam(0x1b2a22),
  hazard: lam(0xffffff, { map: texHazard }), checker: lam(0xffffff, { map: texChecker }),
  coin: lam(0xffc21a, { emissive: 0x7a4c00 }), star: lam(0xffe36b, { emissive: 0x8a6a00 }),
  amber: basic(0xffb020),
  signFork: lam(0xffffff, { map: texForkSign, transparent: true, alphaTest: 0.5 }),
  signL: lam(0xffffff, { map: texTurnL, transparent: true, alphaTest: 0.5 }),
  signR: lam(0xffffff, { map: texTurnR, transparent: true, alphaTest: 0.5 }),
};
// Lâmpadas do semáforo: material compartilhado, trocamos a cor para "acender"
const TL = [
  { mat: basic(0x3a0c0c), on: 0xff2a2a, off: 0x3a0c0c },
  { mat: basic(0x3a2c08), on: 0xffcc22, off: 0x3a2c08 },
  { mat: basic(0x0c3412), on: 0x35ff4a, off: 0x0c3412 },
];

// Geometrias compartilhadas entre todas as instâncias
const GEO = {
  coneBase: new THREE.BoxGeometry(0.95, 0.12, 0.95),
  cone: new THREE.ConeGeometry(0.42, 1.15, 16),
  band1: new THREE.CylinderGeometry(0.245, 0.3, 0.16, 16),
  band2: new THREE.CylinderGeometry(0.12, 0.17, 0.13, 16),
  tire: new THREE.CylinderGeometry(0.56, 0.56, 0.36, 20),
  tireIn: new THREE.CylinderGeometry(0.27, 0.27, 0.37, 14),
  coin: new THREE.CylinderGeometry(0.55, 0.55, 0.14, 24).rotateX(Math.PI / 2),
  post: new THREE.BoxGeometry(0.14, 1.35, 0.14),
  foot: new THREE.BoxGeometry(0.14, 0.08, 0.9),
  board: new THREE.BoxGeometry(2.7, 0.4, 0.08),
  lamp: new THREE.SphereGeometry(0.15, 12, 8),
  cart: new THREE.BoxGeometry(0.95, 0.25, 0.75),
  cartWheel: new THREE.CylinderGeometry(0.13, 0.13, 0.1, 10).rotateZ(Math.PI / 2),
  pole: new THREE.CylinderGeometry(0.07, 0.07, 1.6, 8),
  head: new THREE.BoxGeometry(0.52, 1.35, 0.42),
  bulb: new THREE.SphereGeometry(0.15, 12, 8),
  visor: new THREE.BoxGeometry(0.36, 0.04, 0.2),
  signPole: new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8),
  sign: new THREE.PlaneGeometry(1.4, 1.4),
  particle: new THREE.BoxGeometry(0.22, 0.22, 0.22),
  ring: new THREE.RingGeometry(0.5, 0.75, 24),
};
// Estrela em relevo das moedas
GEO.star = (() => {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.14 : 0.32, a = Math.PI / 2 + i * Math.PI / 5;
    i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false });
})();
// Bloco plástico de barreira (perfil "jersey") extrudado
GEO.jersey = (() => {
  const s = new THREE.Shape();
  [[-0.4, 0], [0.4, 0], [0.4, 0.15], [0.18, 0.42], [0.15, 1.0], [-0.15, 1.0], [-0.18, 0.42], [-0.4, 0.15]]
    .forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y));
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.86, bevelEnabled: false });
  g.rotateY(Math.PI / 2); g.translate(-0.43, 0, 0);
  return g;
})();

// Cores da pista
const C = {
  top1: new THREE.Color(0xff7c1c), top2: new THREE.Color(0xff8526), side: new THREE.Color(0xe35f0c),
  bot: new THREE.Color(0xb34805), line: new THREE.Color(0xfff6ea), curbY: new THREE.Color(0xffc21a),
  curbO: new THREE.Color(0xff6200), pillar: new THREE.Color(0xffbf1a), band: new THREE.Color(0x3b404b),
};

/* ---------- 4. CAMINHO DA PISTA ---------- */
// Linha central amostrada a cada 1 unidade: posição (x,y,z) e direção h.
const path = { x: [], y: [], z: [], h: [] };
const hillY = s => 2.2 * Math.sin(s * 0.018) + 1.2 * Math.sin(s * 0.041 + 1.3);   // ondulação suave
function resetPath() { path.x = [0]; path.z = [0]; path.h = [0]; path.y = [hillY(0)]; }

let segments = [];         // segmentos ativos (ordenados por início)

const curvAt = (seg, local) => seg.curv * Math.sin(Math.PI * local / seg.len);   // curva suave dentro do segmento

function extendPath(seg) {
  for (let i = seg.start; i < seg.end; i++) {
    const h0 = path.h[i], h1 = h0 + curvAt(seg, i + 0.5 - seg.start), hm = (h0 + h1) / 2;
    path.h[i + 1] = h1;
    path.x[i + 1] = path.x[i] + Math.sin(hm);
    path.z[i + 1] = path.z[i] + Math.cos(hm);
    path.y[i + 1] = hillY(i + 1);
  }
}

// Amostra a linha central em s: posição, vetor frente (f) e vetor direita (r)
function sample(s) {
  const n = path.x.length - 1;
  s = clamp(s, 0, n);
  let i = Math.floor(s); if (i >= n) i = n - 1;
  const t = s - i, L = a => a[i] + (a[i + 1] - a[i]) * t;
  const h = L(path.h);
  return { x: L(path.x), y: L(path.y), z: L(path.z), h, fx: Math.sin(h), fz: Math.cos(h), rx: -Math.cos(h), rz: Math.sin(h) };
}
function placeAt(obj, s, x, y) {
  const c = sample(s);
  obj.position.set(c.x + c.rx * x, c.y + (y || 0), c.z + c.rz * x);
  obj.rotation.y = c.h;
  scene.add(obj);
  return obj;
}

function segAt(s) {
  let lo = 0, hi = segments.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, g = segments[m];
    if (s < g.start) hi = m - 1; else if (s >= g.end) lo = m + 1; else return g;
  }
  return null;
}

// Envelope de transição: 0 = pista normal, 1 = trecho especial (bifurcação/estreito) formado
function plateau(seg, local) {
  const t = local / seg.len;
  return Math.min(smooth((t - 0.08) / 0.27), smooth((0.92 - t) / 0.27));
}
const forkEnv = (seg, local) => seg.fork ? plateau(seg, local) : 0;

function subtract(ivs, a, b) {
  const out = [];
  for (const [x0, x1] of ivs) {
    if (b <= x0 || a >= x1) { out.push([x0, x1]); continue; }
    if (a > x0) out.push([x0, a]);
    if (b < x1) out.push([b, x1]);
  }
  return out.filter(iv => iv[1] - iv[0] > 0.05);
}
// Intervalos laterais SÓLIDOS da pista em s (sem eles = buraco/vão → queda)
function intervalsAt(s, withHoles = true) {
  const seg = segAt(s);
  if (!seg) return [[-HW, HW]];
  const local = s - seg.start;
  let iv;
  if (seg.fork) {
    // Bifurcação: dois ramos estreitos centrados em ±5.4 com vão no meio
    const env = plateau(seg, local), c = 5.4, lw = seg.forkLW;
    const outer = HW + (c + lw - HW) * env, gap = (c - lw) * env;
    iv = gap > 0.03 ? [[-outer, -gap], [gap, outer]] : [[-outer, outer]];
  } else if (seg.narrow) {
    // Trecho estreito: a pista afina e pode serpentear para os lados
    const env = plateau(seg, local), n = seg.narrow;
    const w = HW + (n.w - HW) * env;
    const o = n.amp * env * Math.sin(Math.PI * 2 * n.waves * local / seg.len + n.phase);
    iv = [[o - w, o + w]];
  } else iv = [[-HW, HW]];
  if (withHoles) for (const h of seg.holes) if (local >= h.s0 && local < h.s1) iv = subtract(iv, h.x0, h.x1);
  return iv;
}

/* ---------- 5. MALHA DO SEGMENTO ---------- */
// Cada segmento vira UMA BufferGeometry com cores por vértice:
// laje laranja, zebras amarelo/laranja, faixa branca e pilares amarelos.
function buildTrackMesh(seg) {
  const pos = [], col = [];
  const quad = (a, b, c, d, color) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) col.push(color.r, color.g, color.b);
  };
  const at = (c, lat, up) => [c.x + c.rx * lat, c.y + up, c.z + c.rz * lat];
  // Prisma entre duas seções (A em sa, B em sb), larguras [a0,a1] → [b0,b1]
  function prism(cA, cB, a0, a1, b0, b1, yT, yB, cTop, cSide, cBot) {
    const a = at(cA, a0, yT), b = at(cA, a1, yT), c = at(cB, b1, yT), d = at(cB, b0, yT);
    const a2 = at(cA, a0, yB), b2 = at(cA, a1, yB), c2 = at(cB, b1, yB), d2 = at(cB, b0, yB);
    quad(a, b, c, d, cTop); quad(a2, d2, c2, b2, cBot);
    quad(b, b2, c2, c, cSide); quad(a, d, d2, a2, cSide);
    quad(a, a2, b2, b, cSide); quad(d, c, c2, d2, cSide);
  }

  const steps = Math.round(seg.len / DS);
  for (let k = 0; k < steps; k++) {
    const sa = seg.start + k * DS, sb = sa + DS, sm = sa + DS / 2;
    const cA = sample(sa), cB = sample(sb);
    const M = intervalsAt(sm), A0 = intervalsAt(sa + 0.01), B0 = intervalsAt(sb - 0.01);
    const same = A0.length === M.length && B0.length === M.length;
    const A = same ? A0 : M, B = same ? B0 : M;
    // Bordas "reais" (não de buraco) recebem zebra e faixa branca
    const edges = []; intervalsAt(sm, false).forEach(iv => edges.push(iv[0], iv[1]));
    const isEdge = v => edges.some(e => Math.abs(e - v) < 0.02);
    const top = (Math.floor(k / 2) % 2) ? C.top1 : C.top2;
    const curb = (Math.floor(k / 2) % 2) ? C.curbY : C.curbO;
    for (let j = 0; j < M.length; j++) {
      const [a0, a1] = A[j], [b0, b1] = B[j];
      prism(cA, cB, a0, a1, b0, b1, 0, -T, top, C.side, C.bot);
      // Zebras pintadas rente ao chão (sem mureta: dá para cair pela borda)
      if (isEdge(M[j][0])) {
        prism(cA, cB, a0, a0 + 0.45, b0, b0 + 0.45, 0.04, 0, curb, curb, curb);
        prism(cA, cB, a0 + 0.75, a0 + 0.95, b0 + 0.75, b0 + 0.95, 0.02, 0, C.line, C.line, C.line);
      }
      if (isEdge(M[j][1])) {
        prism(cA, cB, a1 - 0.45, a1, b1 - 0.45, b1, 0.04, 0, curb, curb, curb);
        prism(cA, cB, a1 - 0.95, a1 - 0.75, b1 - 0.95, b1 - 0.75, 0.02, 0, C.line, C.line, C.line);
      }
    }
  }
  // Pilares descendo até as nuvens
  for (let p = 8; p < seg.len - 3; p += 36) {
    const s = seg.start + p, c0 = sample(s), c1 = sample(s + 1.5);
    for (const iv of intervalsAt(s)) {
      if (iv[1] - iv[0] < 1.6) continue;
      const m = (iv[0] + iv[1]) / 2, pw = Math.min(0.7, (iv[1] - iv[0]) / 2 - 0.3);
      prism(c0, c1, m - pw - 0.25, m + pw + 0.25, m - pw - 0.25, m + pw + 0.25, -T, -T - 0.5, C.pillar, C.pillar, C.pillar);
      prism(c0, c1, m - pw, m + pw, m - pw, m + pw, -T - 0.5, -T - 1.4, C.band, C.band, C.band);
      prism(c0, c1, m - pw, m + pw, m - pw, m + pw, -T - 1.4, -80, C.pillar, C.pillar, C.pillar);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, MAT.track);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

/* ---------- 6. MODELOS ---------- */
function shadowAll(g) { g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g; }
function mesh(geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); return m; }

// --- Carro vermelho com faixas brancas (frente = +z) ---
function makeCar() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const red = lam(0xe5262b), glass = lam(0x1c2735, { emissive: 0x0a1420 }), chrome = lam(0xd5dbe2);
  const stripeMat = lam(0xffffff), stripes = [];
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const stripe = m => { m.material = stripeMat; stripes.push(m); return m; };
  body.add(mesh(B(1.72, 0.5, 3.0), red, 0, 0.55, 0));                 // carroceria
  body.add(mesh(B(1.3, 0.5, 1.4), red, 0, 1.05, -0.25));              // cabine
  body.add(mesh(B(1.33, 0.3, 1.1), glass, 0, 1.08, -0.25));           // janelas laterais
  body.add(mesh(B(1.12, 0.36, 0.04), glass, 0, 1.06, -0.96));         // vidro traseiro
  body.add(mesh(B(1.12, 0.36, 0.04), glass, 0, 1.06, 0.46));          // para-brisa
  for (const sx of [-0.14, 0.14]) {                                    // faixas brancas de corrida
    body.add(stripe(mesh(B(0.16, 0.02, 3.02), null, sx, 0.81, 0)));
    body.add(stripe(mesh(B(0.16, 0.02, 1.42), null, sx, 1.31, -0.25)));
    body.add(stripe(mesh(B(0.16, 0.5, 0.02), null, sx, 0.55, -1.51)));
    body.add(stripe(mesh(B(0.16, 0.075, 0.39), null, sx, 1.24, -1.32)));
  }
  body.add(mesh(B(1.62, 0.07, 0.38), red, 0, 1.24, -1.32));           // aerofólio
  for (const sx of [-0.55, 0.55]) body.add(mesh(B(0.08, 0.32, 0.12), MAT.black, sx, 1.02, -1.3));
  const tailMat = basic(0xff7a1a), glows = { tail: [], head: [] };
  const glow = (color, x, y, z, s, o) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texPuff, color, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.position.set(x, y, z); sp.scale.setScalar(s); body.add(sp); return sp;
  };
  for (const sx of [-0.56, 0.56]) {
    body.add(mesh(B(0.42, 0.15, 0.04), tailMat, sx, 0.66, -1.52));          // lanternas
    body.add(mesh(B(0.36, 0.12, 0.04), basic(0xfff3c0), sx, 0.62, 1.52));    // faróis
    glows.tail.push(glow(0xff3018, sx, 0.66, -1.6, 0.7, 0.35));
    glows.head.push(glow(0xfff0c0, sx, 0.62, 1.6, 0.75, 0.45));
  }
  body.add(mesh(B(1.6, 0.18, 0.1), MAT.black, 0, 0.36, -1.5));        // para-choque
  const ex = new THREE.CylinderGeometry(0.08, 0.08, 0.22, 10).rotateX(Math.PI / 2);
  for (const sx of [-0.18, 0.18]) body.add(mesh(ex, chrome, sx, 0.33, -1.58));  // escapamento duplo
  const wGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.32, 18).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.17, 0.17, 0.34, 10).rotateZ(Math.PI / 2);
  const wheels = [], front = [];
  for (const sx of [-0.84, 0.84]) for (const sz of [-0.95, 0.95]) {
    const w = mesh(wGeo, MAT.tire, sx, 0.36, sz);
    w.rotation.order = 'YXZ';                 // esterça (Y) e gira no eixo (X)
    w.add(mesh(hub, chrome));
    body.add(w); wheels.push(w);
    if (sz > 0) front.push(w);
  }
  // Laço no teto (só aparece na pintura "Rosa Poá")
  const bow = new THREE.Group(), bowMat = lam(0xe8175d);
  const loop = new THREE.SphereGeometry(0.24, 14, 10);
  for (const sx of [-1, 1]) {
    const l = mesh(loop, bowMat, sx * 0.24, 0, 0);
    l.scale.set(1.25, 0.8, 0.55); l.rotation.z = sx * 0.45;
    bow.add(l);
  }
  bow.add(mesh(new THREE.SphereGeometry(0.11, 10, 8), bowMat));
  bow.position.set(0, 1.45, -0.3);
  bow.visible = false;
  body.add(bow);

  shadowAll(root);
  scene.add(root);
  return { root, body, wheels, front, paint: red, stripeMat, stripes, bow, tailMat, glows };
}

// Aplica uma pintura da garagem ao carro e salva a escolha
function applySkin(id) {
  const k = CAR_SKINS.find(s => s.id === id) || CAR_SKINS[0];
  car.skin = k.id;
  if (k.dots) { car.paint.map = texDots; car.paint.color.setHex(0xffffff); }
  else { car.paint.map = null; car.paint.color.setHex(k.body); }
  car.paint.needsUpdate = true;
  car.stripes.forEach(m => m.visible = !!k.stripe);
  if (k.stripe) car.stripeMat.color.setHex(k.stripe);
  car.bow.visible = !!k.bow;
  try { localStorage.setItem('skydrift_skin', k.id); } catch (_) { }
  return k;
}

// --- Obstáculos de trânsito ---
function makeCone() {
  const g = new THREE.Group();
  g.add(mesh(GEO.coneBase, MAT.black, 0, 0.06, 0));
  g.add(mesh(GEO.cone, MAT.cone, 0, 0.695, 0));
  g.add(mesh(GEO.band1, MAT.white, 0, 0.55, 0));
  g.add(mesh(GEO.band2, MAT.white, 0, 0.9, 0));
  return g;
}
function makeTires() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const y = 0.19 + i * 0.37;
    g.add(mesh(GEO.tire, MAT.tire, 0, y, 0));
    g.add(mesh(GEO.tireIn, MAT.tireIn, 0, y, 0));
  }
  return g;
}
function makeJersey() {                     // barreira plástica vermelha e branca
  const g = new THREE.Group();
  [-0.9, 0, 0.9].forEach((x, i) => g.add(mesh(GEO.jersey, i % 2 ? MAT.white : MAT.red, x, 0, 0)));
  return g;
}
function makeHazard() {                     // cavalete preto/amarelo com lâmpadas âmbar
  const g = new THREE.Group();
  for (const x of [-1.28, 1.28]) {
    g.add(mesh(GEO.post, MAT.metal, x, 0.68, 0));
    g.add(mesh(GEO.foot, MAT.metal, x, 0.04, 0));
    const l = mesh(GEO.lamp, MAT.amber, x * 0.75, 1.55, 0); g.add(l);
  }
  g.add(mesh(GEO.board, MAT.hazard, 0, 0.6, 0));
  g.add(mesh(GEO.board, MAT.hazard, 0, 1.15, 0));
  return g;
}
function makeTrafficLight() {               // semáforo em carrinho amarelo
  const g = new THREE.Group();
  g.add(mesh(GEO.cart, MAT.yellow, 0, 0.3, 0));
  for (const x of [-0.45, 0.45]) for (const z of [-0.3, 0.3]) g.add(mesh(GEO.cartWheel, MAT.black, x, 0.13, z));
  g.add(mesh(GEO.pole, MAT.black, 0, 1.22, 0));
  g.add(mesh(GEO.head, MAT.lightHead, 0, 2.6, 0));
  [3.0, 2.6, 2.2].forEach((y, i) => {
    g.add(mesh(GEO.bulb, TL[i].mat, 0, y, -0.2));
    g.add(mesh(GEO.visor, MAT.lightHead, 0, y + 0.17, -0.3));
  });
  return g;
}
const OBST = {
  cone:   { make: makeCone,         hw: 0.45, hl: 0.45, heavy: false, slow: 0.72 },
  tires:  { make: makeTires,        hw: 0.6,  hl: 0.55, heavy: false, slow: 0.55 },
  jersey: { make: makeJersey,       hw: 1.35, hl: 0.4,  heavy: true },
  hazard: { make: makeHazard,       hw: 1.4,  hl: 0.3,  heavy: true },
  light:  { make: makeTrafficLight, hw: 0.5,  hl: 0.45, heavy: true },
};
function pickObstacle(L, lightOnly) {
  const w = [['cone', 4], ['tires', 3]];
  if (!lightOnly) { w.push(['jersey', 1.5 + 0.3 * L], ['hazard', 1.2 + 0.3 * L]); if (L >= 2) w.push(['light', 1.5]); }
  let r = Math.random() * w.reduce((a, b) => a + b[1], 0);
  for (const [k, v] of w) { if ((r -= v) <= 0) return k; }
  return 'cone';
}

// --- Moeda com estrela ---
function makeCoin() {
  const g = new THREE.Group(), spin = new THREE.Group(); g.add(spin);
  spin.add(mesh(GEO.coin, MAT.coin));
  const s1 = mesh(GEO.star, MAT.star, 0, 0, 0.05); spin.add(s1);
  const s2 = mesh(GEO.star, MAT.star, 0, 0, -0.05); s2.rotation.y = Math.PI; spin.add(s2);
  spin.children.forEach(m => m.castShadow = true);
  g.userData.spin = spin;
  return g;
}

// --- Placas decorativas e linha de chegada ---
function makeSign(mat) {
  const g = new THREE.Group();
  g.add(mesh(GEO.signPole, MAT.metal, 0, 1.3, 0));
  const p = mesh(GEO.sign, mat, 0, 2.9, -0.05); p.rotation.y = Math.PI; g.add(p);
  return shadowAll(g);
}
function makeFinish(seg, s) {
  // Faixa quadriculada no chão
  for (let j = 0; j < 2; j++) for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 0.8), (i + j) % 2 ? MAT.black : MAT.white);
    seg.objects.push(placeAt(m, s + j * 0.8, -HW + 0.4 + i * 0.8, 0.02));
  }
  // Pórtico
  const g = new THREE.Group();
  for (const x of [-HW - 0.2, HW + 0.2]) g.add(mesh(new THREE.BoxGeometry(0.45, 5.4, 0.45), MAT.yellow, x, 2.7, 0));
  g.add(mesh(new THREE.BoxGeometry(2 * HW + 0.9, 1.0, 0.3), MAT.checker, 0, 5.2, 0));
  seg.objects.push(placeAt(shadowAll(g), s, 0, 0));
}

/* ---------- 7. GERAÇÃO PROCEDURAL ---------- */
let genEnd = 0, genLevel = 1, genLevelEnd = levelLen(1);

function curveSign() {               // evita que a pista dê voltas sobre si mesma
  const h = path.h[path.h.length - 1];
  if (h > 0.6) return -1; if (h < -0.6) return 1;
  return Math.random() < 0.5 ? -1 : 1;
}

function generateNext() {
  const L = genLevel;
  let len, opts = {};
  const r = Math.random();
  const pFork = Math.min(0.22, 0.12 + 0.02 * L), pNarrow = Math.min(0.5, 0.3 + 0.04 * L);
  if (genEnd === 0) { len = 60; opts.safe = true; }        // reta inicial tranquila
  else if (r < pFork) {                                     // bifurcação com ramos estreitos
    len = 84 + 3 * randInt(0, 7); opts.fork = true; opts.curv = rand(-0.005, 0.005);
  } else if (r < pFork + pNarrow) {                         // trecho estreito / zigue-zague
    len = 66 + 3 * randInt(0, 10);
    opts.narrow = {
      w: Math.max(1.1, 2.1 - 0.1 * L) * rand(0.95, 1.1),    // meia largura no ponto mais estreito
      amp: Math.random() < 0.6 ? rand(0.8, Math.min(3, 1.2 + 0.3 * L)) : 0,
      waves: pick([0.5, 1, 1.5]), phase: pick([0, Math.PI]),
    };
    opts.curv = Math.random() < 0.5 ? curveSign() * rand(0.006, 0.014) : 0;
  } else {                                                  // pista larga, com curvas e buracos
    len = 45 + 3 * randInt(0, 8);
    opts.curv = Math.random() < 0.65 ? curveSign() * rand(0.008, 0.02) : 0;
    opts.holes = Math.random() < Math.min(0.55, 0.3 + 0.05 * L);
  }
  // Se o segmento passar do fim do nível, vira uma reta com a linha de chegada
  if (genEnd > 0 && genEnd + len > genLevelEnd - 15) {
    len = genLevelEnd + 30 - genEnd;
    opts = { finish: genLevelEnd, curv: 0 };
    genLevel++; genLevelEnd += levelLen(genLevel);
  }

  const seg = {
    start: genEnd, len, end: genEnd + len, level: L, curv: opts.curv || 0, fork: !!opts.fork,
    narrow: opts.narrow || null, forkLW: Math.max(1.3, 2.2 - 0.1 * L),
    blockSide: pick([-1, 1]), holes: [], objects: [], obstacles: [], coins: [],
  };
  segments.push(seg);
  extendPath(seg);
  clouds.forEach(cl => keepCloudBelowTrack(cl, seg.start, seg.end));   // pista nova não fica coberta
  if (opts.holes) makeHoles(seg);
  seg.mesh = buildTrackMesh(seg);

  // Placas de aviso
  if (seg.fork) seg.objects.push(placeAt(makeSign(MAT.signFork), seg.start + 2, -(HW - 0.25)));
  else if (Math.abs(seg.curv) > 0.011) seg.objects.push(placeAt(makeSign(seg.curv > 0 ? MAT.signL : MAT.signR), seg.start + 2, seg.curv > 0 ? HW - 0.25 : -(HW - 0.25)));

  if (opts.finish) makeFinish(seg, opts.finish);
  else if (!opts.safe) placeObstacles(seg);
  placeCoins(seg);
  genEnd = seg.end;
}

// Buracos: sempre deixam pelo menos uma passagem
function makeHoles(seg) {
  const L = seg.level;
  const n = 1 + (L >= 3 && Math.random() < 0.5 ? 1 : 0) + (L >= 6 ? 1 : 0);
  let cursor = 12;
  for (let i = 0; i < n; i++) {
    const hl = 6 + DS * randInt(0, 4);
    const s0 = Math.round((cursor + rand(0, 8)) / DS) * DS;
    if (s0 + hl > seg.len - 10) break;
    const pats = ['left', 'right', 'center']; if (L >= 2) pats.push('bridge');
    const add = (x0, x1) => seg.holes.push({ s0, s1: s0 + hl, x0, x1 });
    switch (pick(pats)) {
      case 'left': add(-5, 0.3); break;            // metade esquerda some
      case 'right': add(-0.3, 5); break;           // metade direita some
      case 'center': add(-2, 2); break;            // buraco central, passa pelos lados
      case 'bridge': add(-5, -1.1); add(1.1, 5); break;   // só uma ponte estreita no meio
    }
    cursor = s0 + hl + 12;
  }
}
const nearHole = (seg, local, m) => seg.holes.some(h => local > h.s0 - m && local < h.s1 + m);

// Posição lateral de uma "faixa" (-1, 0, 1); na bifurcação segue o centro do ramo
function laneX(seg, local, lane) {
  if (seg.narrow) { const iv = intervalsAt(seg.start + local, false)[0]; return (iv[0] + iv[1]) / 2; }
  if (forkEnv(seg, local) > 0.02) {
    const ivs = intervalsAt(seg.start + local, false);
    if (ivs.length === 2) { const iv = lane < 0 ? ivs[0] : ivs[1]; return (iv[0] + iv[1]) / 2; }
  }
  return lane * 2.5;
}

function addObstacle(seg, type, local, x) {
  const d = OBST[type];
  const s = seg.start + local;
  const m = placeAt(shadowAll(d.make()), s, x, 0);
  seg.obstacles.push({ s, x, type, hw: d.hw, hl: d.hl, heavy: d.heavy, slow: d.slow, mesh: m, hit: false });
}

// Obstáculos são raros: o desafio principal é não cair da pista
function placeObstacles(seg) {
  if (seg.narrow) return;                         // trechos estreitos ficam livres
  const L = seg.level;
  const gap = Math.max(18, 30 - 1.5 * L), prob = Math.min(0.35, 0.12 + 0.03 * L);
  for (let p = 14; p < seg.len - 6; p += gap * rand(0.85, 1.2)) {
    if (Math.random() > prob || nearHole(seg, p, 6)) continue;
    const env = forkEnv(seg, p);
    if (env > 0.02 && env < 0.98) continue;        // nada na transição da bifurcação
    if (env >= 0.98) {                              // na bifurcação só um ramo tem obstáculos
      addObstacle(seg, pickObstacle(L), p, laneX(seg, p, seg.blockSide));
      continue;
    }
    addObstacle(seg, pickObstacle(L), p, laneX(seg, p, pick([-1, 0, 1])));
  }
}

function placeCoins(seg) {
  const trails = seg.len > 60 ? 2 : 1;
  for (let t = 0; t < trails; t++) {
    const start = rand(4, Math.max(5, seg.len - 26)), count = randInt(6, 10);
    const lanes = seg.fork ? [-seg.blockSide] : seg.narrow ? [0] : shuffle([-1, 0, 1]);
    let best = null;
    for (const lane of lanes) {
      const ok = [];
      for (let i = 0; i < count; i++) {
        const p = start + i * 2.4;
        if (p >= seg.len - 1) break;
        const s = seg.start + p, x = laneX(seg, p, lane);
        const solid = intervalsAt(s).some(iv => x >= iv[0] + 0.5 && x <= iv[1] - 0.5);
        const blocked = seg.obstacles.some(o => Math.abs(o.s - s) < 3 && Math.abs(o.x - x) < o.hw + 1);
        const taken = seg.coins.some(c => Math.abs(c.s - s) < 1.5 && Math.abs(c.x - x) < 1.5);
        if (solid && !blocked && !taken) ok.push({ s, x });
      }
      if (!best || ok.length > best.length) best = ok;
    }
    for (const { s, x } of best) seg.coins.push({ s, x, mesh: placeAt(makeCoin(), s, x, 1.0), taken: false });
  }
}

function removeSeg(seg) {
  scene.remove(seg.mesh); seg.mesh.geometry.dispose();
  seg.objects.forEach(o => scene.remove(o));
  seg.obstacles.forEach(o => scene.remove(o.mesh));
  seg.coins.forEach(c => scene.remove(c.mesh));
}
function ensureTrack() { while (genEnd < car.s + AHEAD) generateNext(); }
function cleanupTrack() { while (segments.length && segments[0].end < car.s - BEHIND) removeSeg(segments.shift()); }

/* ---------- 8. EFEITOS ---------- */
const parts = [], partPool = [], pMats = {}, rings = [];
let flying = [];
const pMat = color => pMats[color] || (pMats[color] = basic(color));

function burst(pos, colors, n, spd, up, life) {
  for (let i = 0; i < n && parts.length < 320; i++) {
    const m = partPool.pop() || new THREE.Mesh(GEO.particle);
    m.material = pMat(pick(colors));
    m.position.copy(pos);
    scene.add(m);
    parts.push({ m, v: new THREE.Vector3(rand(-1, 1) * spd, rand(0.3, 1) * up, rand(-1, 1) * spd), life, max: life });
  }
}
function ringFx(pos) {                     // brilho expandindo ao pegar moeda
  const m = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: 0xfff1a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  m.position.copy(pos); m.lookAt(camera.position); scene.add(m);
  rings.push({ m, life: 0.4, max: 0.4 });
}
function updateEffects(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt; p.v.y -= 18 * dt;
    p.m.position.addScaledVector(p.v, dt);
    p.m.rotation.x += dt * 8; p.m.rotation.y += dt * 6;
    p.m.scale.setScalar(Math.max(0.01, p.life / p.max));
    if (p.life <= 0) { scene.remove(p.m); partPool.push(p.m); parts.splice(i, 1); }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.life -= dt;
    const k = 1 - r.life / r.max;
    r.m.scale.setScalar(1 + k * 2.5); r.m.material.opacity = 0.9 * (1 - k);
    if (r.life <= 0) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); }
  }
  for (let i = flying.length - 1; i >= 0; i--) {    // obstáculos arremessados
    const f = flying[i]; f.life -= dt; f.v.y -= 25 * dt;
    f.mesh.position.addScaledVector(f.v, dt);
    f.mesh.rotation.x += f.spin.x * dt; f.mesh.rotation.z += f.spin.z * dt;
    if (f.life <= 0) { scene.remove(f.mesh); flying.splice(i, 1); }
  }
  for (let i = puffs.length - 1; i >= 0; i--) {     // fumaça / chama / brilho
    const p = puffs[i]; p.life -= dt;
    const k = 1 - p.life / p.max;
    p.v.multiplyScalar(Math.exp(-p.drag * dt)); p.v.y += p.rise * dt;
    p.sp.position.addScaledVector(p.v, dt);
    p.sp.scale.setScalar(p.size * (1 + p.grow * k));
    p.sp.material.opacity = p.op * (1 - k) * (1 - k);
    if (p.c1) p.sp.material.color.copy(p.c0).lerp(p.c1, Math.min(1, k * 1.6));
    if (p.life <= 0) { scene.remove(p.sp); (p.add ? puffPoolAdd : puffPool).push(p.sp); puffs.splice(i, 1); }
  }
}

// Partículas macias (sprites): fumaça (normal) e chama/brilho (aditivo)
const puffs = [], puffPool = [], puffPoolAdd = [];
function puff(pos, o) {
  if (puffs.length > 260) return;
  const add = !!o.add, pool = add ? puffPoolAdd : puffPool;
  const sp = pool.pop() || new THREE.Sprite(new THREE.SpriteMaterial({
    map: texPuff, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  sp.material.color.setHex(o.color);
  sp.material.rotation = rand(0, Math.PI * 2);
  sp.position.copy(pos);
  sp.scale.setScalar(o.size);
  scene.add(sp);
  const life = o.life * rand(0.8, 1.2);
  puffs.push({
    sp, add, life, max: life, size: o.size, grow: o.grow || 1.5, op: o.opacity || 0.6,
    v: o.v ? o.v.clone() : new THREE.Vector3(), drag: o.drag || 2.5, rise: o.rise || 0,
    c0: o.color2 ? new THREE.Color(o.color) : null, c1: o.color2 ? new THREE.Color(o.color2) : null,
  });
}

// Marcas de pneu: plaquinhas escuras no chão, reaproveitadas em anel
const SKID_MAX = 280;
const skidGeo = new THREE.PlaneGeometry(0.3, 0.75).rotateX(-Math.PI / 2);
const skidMat = new THREE.MeshBasicMaterial({ color: 0x3a1c08, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const skids = []; let skidIdx = 0;
// Liga o ponto anterior (a) ao atual (b) com uma faixa contínua
function addSkid(a, b, y) {
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
  if (len < 0.05 || len > 4) return;
  let m = skids[skidIdx];
  if (!m) { m = skids[skidIdx] = new THREE.Mesh(skidGeo, skidMat); scene.add(m); }
  m.position.set((a.x + b.x) / 2, y + 0.05, (a.z + b.z) / 2);
  m.rotation.y = Math.atan2(dx, dz); m.scale.z = (len + 0.1) / 0.75; m.visible = true;
  skidIdx = (skidIdx + 1) % SKID_MAX;
}
function clearSkids() { skids.forEach(m => m.visible = false); skidPrev.length = 0; }

// Linhas de velocidade: riscos finos presos à câmera, voando para fora da tela
const streakMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false });
const streakGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
const streaks = [];
function resetStreak(m, anyZ) {
  const z = anyZ ? rand(-32, -6) : rand(-34, -26);
  const th = Math.tan(baseFov * Math.PI / 360) * -z, a = rand(0, Math.PI * 2), r = rand(0.55, 1.05);
  m.position.set(Math.cos(a) * r * th * camera.aspect, Math.sin(a) * r * th, z);
}
for (let i = 0; i < 44; i++) { const m = new THREE.Mesh(streakGeo, streakMat); m.renderOrder = 5; resetStreak(m, true); camera.add(m); streaks.push(m); }
function updateStreaks(dt) {
  const k = state === 'playing' ? clamp((car.speed - 18) / 24, 0, 1) : 0;
  streakMat.opacity += (k * 0.5 - streakMat.opacity) * Math.min(1, dt * 4);
  const vis = streakMat.opacity > 0.01;
  for (const m of streaks) {
    m.visible = vis;
    if (!vis) continue;
    m.position.z += car.speed * dt * 1.8;
    m.scale.z = 1.5 + car.speed * 0.14;
    if (m.position.z > -1) resetStreak(m, false);
  }
}

// Vinheta de velocidade (CSS)
const speedFxEl = document.getElementById('speedfx');
let speedFxOp = -1;
function updateSpeedFx() {
  const v = state === 'playing' ? Math.round(clamp((car.speed - 22) / 22, 0, 1) * 20) / 20 : 0;
  if (v !== speedFxOp) { speedFxOp = v; speedFxEl.style.opacity = v; }
}

let shake = 0;
const flashEl = document.getElementById('flash');
function restartAnim(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function flash(color) { flashEl.style.background = color; restartAnim(flashEl, 'on'); }

/* ---------- 9. ENTRADA ---------- */
let drag = null, hintTimer = 0;
const keys = { left: false, right: false, up: false, down: false };
// drag.y0 = ponto onde o dedo tocou: arrastar ACIMA dele acelera, ABAIXO freia.
canvas.addEventListener('pointerdown', e => {
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, y0: e.clientY };
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
});
canvas.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.y = e.clientY;
  const dx = e.clientX - drag.x; drag.x = e.clientX;
  // Arrasto horizontal gira o volante: direita vira para a direita (yaw diminui)
  if (state === 'playing') car.yaw -= dx / Math.min(window.innerWidth, 700) * TURN_SENS;
});
const endDrag = e => { if (drag && e.pointerId === drag.id) drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (e.target === canvas) e.preventDefault(); }, { passive: false });
// Teclado só como apoio para testes no computador
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = true;
  if (e.key === 'ArrowRight' || e.key === 'd') keys.right = true;
  if (e.key === 'ArrowUp' || e.key === 'w') { keys.up = true; e.preventDefault(); }
  if (e.key === 'ArrowDown' || e.key === 's') { keys.down = true; e.preventDefault(); }
  if (e.key === 'Escape' || e.key === 'p') togglePause();
});
window.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd') keys.right = false;
  if (e.key === 'ArrowUp' || e.key === 'w') keys.up = false;
  if (e.key === 'ArrowDown' || e.key === 's') keys.down = false;
});
window.addEventListener('blur', () => { keys.left = keys.right = keys.up = keys.down = false; drag = null; });

// Acelerador de 0 a 1: arrasto para cima (proporcional) ou seta ↑ (máximo)
function throttle() {
  let t = 0;
  if (drag) t = clamp((drag.y0 - drag.y) / (window.innerHeight * THROTTLE_PX), 0, 1);
  if (keys.up) t = 1;
  if (isBraking()) t = 0;
  return t;
}
// Freio: seta ↓ ou arrastar o dedo para BAIXO do ponto de toque
function isBraking() {
  return keys.down || (!!drag && drag.y - drag.y0 > window.innerHeight * 0.05);
}

/* ---------- SOM (Web Audio: tudo sintetizado, sem arquivos) ---------- */
const Sound = (() => {
  let ctx = null, master = null, noiseBuf = null, engine = null, screech = null, muted = false, silentEl = null;
  const VOL = 0.8;

  // WAV silencioso gerado em código (usado para "acordar" o áudio no iOS)
  function silentWav() {
    const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
    let s = ''; b.forEach(x => s += String.fromCharCode(x));
    return 'data:audio/wav;base64,' + btoa(s);
  }

  // Desbloqueia o áudio. Precisa ser chamado DENTRO de um toque/clique do usuário.
  function unlock() {
    // iOS: faz o som tocar mesmo com a chave lateral no modo silencioso
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) { }
    if (!silentEl) {
      try { silentEl = new Audio(silentWav()); silentEl.loop = true; silentEl.setAttribute('playsinline', ''); } catch (_) { }
    }
    if (silentEl && silentEl.paused) { const p = silentEl.play(); if (p && p.catch) p.catch(() => { }); }
    if (ctx && ctx.state !== 'running') ctx.resume();
    if (ctx) {                                   // toca um buffer vazio (necessário em Safari antigo)
      const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
    }
  }

  // Cria o contexto de áudio (precisa acontecer após um toque/clique do usuário)
  function init() {
    if (ctx) { unlock(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    unlock();
    master = ctx.createGain(); master.gain.value = muted ? 0 : VOL; master.connect(ctx.destination);

    // Ruído branco reutilizado em chiados e batidas
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Motor grave: duas dentes-de-serra levemente desafinadas + quadrada uma oitava abaixo,
    // saturação suave (ronco e harmônicos que o alto-falante do celular consegue tocar)
    // e passa-baixa. Uma LFO na metade da frequência pulsa o volume (explosões dos cilindros).
    const osc = type => { const o = ctx.createOscillator(); o.type = type; o.start(); return o; };
    const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const o1 = osc('sawtooth'), o2 = osc('sawtooth'), o3 = osc('square'), lfo = osc('sine');
    o2.detune.value = 14;
    const mix = gain(0.45), g2 = gain(0.7), sub = gain(0.8);
    o1.connect(mix); o2.connect(g2); g2.connect(mix); o3.connect(sub); sub.connect(mix);
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4); }
    shaper.curve = curve; shaper.oversample = '2x';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 2.2;
    const am = gain(0.75), lfoG = gain(0.25);
    lfo.connect(lfoG); lfoG.connect(am.gain);
    const cut = gain(1);                       // corte de giro na troca de marcha
    const g = gain(0);
    mix.connect(shaper); shaper.connect(f); f.connect(am); am.connect(cut); cut.connect(g); g.connect(master);
    engine = { o1, o2, o3, lfo, f, g, cut };

    // Chiado de pneu: ruído em loop num passa-banda, volume controlado
    const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 6;
    const sg = ctx.createGain(); sg.gain.value = 0;
    n.connect(bp); bp.connect(sg); sg.connect(master); n.start();
    screech = { g: sg, bp };
  }

  // Chamado todo quadro: rotação do motor e chiado acompanham o carro
  // rpm: 0..1 (giro do motor dentro da marcha), slip: 0..1 (pneu derrapando)
  function update(rpm, thr, slip, active) {
    if (!ctx) return;
    const t = ctx.currentTime;
    // Fundamental grave (≈45–135 Hz); a saturação gera os harmônicos que dão o "ronco"
    const freq = 38 + rpm * 97;
    engine.o1.frequency.setTargetAtTime(freq, t, 0.03);
    engine.o2.frequency.setTargetAtTime(freq, t, 0.03);
    engine.o3.frequency.setTargetAtTime(freq * 0.5, t, 0.03);
    engine.lfo.frequency.setTargetAtTime(freq * 0.5, t, 0.03);
    engine.f.frequency.setTargetAtTime(330 + rpm * 1000 + thr * 450, t, 0.05);
    engine.g.gain.setTargetAtTime(active ? 0.11 + thr * 0.12 + rpm * 0.05 : 0, t, 0.08);

    const sc = active ? slip : 0;
    screech.g.gain.setTargetAtTime(sc * 0.18, t, 0.04);
    screech.bp.frequency.setTargetAtTime(1300 + sc * 600, t, 0.05);
  }

  // Troca de marcha: corta o giro por um instante; na subida o escapamento estoura
  function shift(up) {
    if (!ctx) return;
    const t = ctx.currentTime, c = engine.cut.gain;
    c.cancelScheduledValues(t);
    c.setTargetAtTime(up ? 0.22 : 0.6, t, 0.015);
    c.setTargetAtTime(1, t + (up ? SHIFT_TIME * 0.8 : 0.08), 0.05);
    noise(0.05, 900, 0.18, 'bandpass');                     // "clac" do câmbio
    if (up) {
      noise(0.16, 520, 0.7, 'lowpass', 0.035);              // estouro do escapamento
      tone(62, 0.14, 'sine', 0.5, 38, 0.035);
      if (Math.random() < 0.55) noise(0.1, 650, 0.45, 'lowpass', 0.11);   // segundo estalo
    }
  }

  // Rajada de ruído filtrado com decaimento (batidas)
  function noise(dur, freq, vol, type, delay) {
    if (!ctx) return;
    const t = ctx.currentTime + (delay || 0);
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * Math.max(0, 0.95 - dur)); s.stop(t + dur);
  }
  // Tom simples com glissando opcional
  function tone(freq, dur, type, vol, freqEnd, delay) {
    if (!ctx) return;
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  return {
    init, update, unlock, shift,
    crash() { noise(0.9, 1000, 1.0); noise(0.35, 3500, 0.35, 'highpass'); tone(95, 0.5, 'sine', 0.9, 30); },
    bump()  { noise(0.2, 700, 0.6); tone(150, 0.16, 'sine', 0.6, 60); },
    coin()  { tone(988, 0.08, 'square', 0.1); tone(1319, 0.2, 'square', 0.1, null, 0.07); },
    fall()  { tone(650, 1.5, 'sine', 0.25, 110); },
    level() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.22, null, i * 0.1)); },
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : VOL; return muted; },
  };
})();

/* ---------- 10. LÓGICA DO JOGO ---------- */
let state = 'menu';            // menu | playing | paused | falling | crashed | over
let level = 1, coins = 0, stateT = 0;
// O carro se move LIVRE no mundo (px, pz, yaw). A pista não o guia:
// a cada quadro projetamos a posição na linha central para obter
// s (distância ao longo da pista) e x (deslocamento lateral) e checar o chão.
const CAR_RESET = { s: 12, x: 0, speed: 0, turnRate: 0, gear: 0, rpm: IDLE_RPM, shiftT: 0, thr: 0, braking: false, slip: 0, pitch: 0, pitchV: 0, fovKick: 0, skidAcc: 0, exhaustAcc: 0 };
const car = Object.assign(makeCar(), { px: 0, pz: 0, yaw: 0 }, CAR_RESET);
const fallVel = new THREE.Vector3();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
// Pontos no carro (coordenadas locais do corpo)
const EXHAUST = [new THREE.Vector3(-0.18, 0.33, -1.72), new THREE.Vector3(0.18, 0.33, -1.72)];
const REAR_WHEELS = [new THREE.Vector3(-0.84, 0.05, -0.95), new THREE.Vector3(0.84, 0.05, -0.95)];
const skidPrev = [];

/* ---------- Câmbio ---------- */
function updateGearbox(dt, thr) {
  const rpmIn = g => car.speed / GEAR_TOP[g];
  if (car.shiftT > 0) car.shiftT -= dt;
  else if (car.gear < GEAR_TOP.length - 1 && thr > 0.2 && rpmIn(car.gear) >= SHIFT_UP) shiftGear(1);
  else if (car.gear > 0 && rpmIn(car.gear - 1) < SHIFT_DOWN) shiftGear(-1);
  // Parado com acelerador o motor "ronca" um pouco acima da marcha lenta
  let target = Math.max(IDLE_RPM + thr * 0.14, rpmIn(car.gear));
  // Limitador de giro na última marcha
  if (target > 0.985) target = 0.985 + Math.sin(time * 55) * 0.02 * thr;
  const k = car.shiftT > 0 ? 16 : 9;
  car.rpm += (Math.min(1.02, target) - car.rpm) * Math.min(1, dt * k);
}
function shiftGear(dir) {
  car.gear += dir;
  car.shiftT = dir > 0 ? SHIFT_TIME : 0.1;
  Sound.shift(dir > 0);
  restartAnim(ui.gear, 'bump');
  if (dir > 0) {
    car.pitchV += 0.9;                         // carroceria "mergulha" no corte de giro
    car.fovKick = 3.5;
    exhaustFx(true);
  }
}
function exhaustFx(pop) {
  car.body.updateMatrixWorld(true);
  const back = tmpV2.set(-Math.sin(car.yaw), 0, -Math.cos(car.yaw));
  for (const e of EXHAUST) {
    const p = car.body.localToWorld(tmpV.copy(e));
    if (pop) {
      // Chama do escapamento: núcleo azulado → laranja, e fumaça escura
      for (let i = 0; i < 3; i++) puff(p, { color: 0xbfe0ff, color2: 0xff7a1a, add: true, size: 0.35, grow: 1.4, life: 0.16, opacity: 0.95, v: back.clone().multiplyScalar(rand(4, 9)).add(new THREE.Vector3(rand(-0.6, 0.6), rand(0, 0.6), 0)), drag: 9 });
      puff(p, { color: 0xffb040, add: true, size: 0.9, grow: 0.6, life: 0.12, opacity: 0.8 });
      puff(p, { color: 0x555a62, size: 0.45, grow: 2.6, life: 0.7, opacity: 0.45, v: back.clone().multiplyScalar(2), rise: 1.2 });
    } else {
      puff(p, { color: 0xd8dde4, size: 0.22, grow: 3, life: 0.55, opacity: 0.22 + car.thr * 0.2, v: back.clone().multiplyScalar(1.5).add(new THREE.Vector3(0, 0.4, 0)), rise: 0.8 });
    }
  }
}

function projectCar() {
  let s = car.s;
  for (let i = 0; i < 4; i++) {                       // Newton: anda em s até ficar "ao lado" do carro
    const c = sample(s), d = (car.px - c.x) * c.fx + (car.pz - c.z) * c.fz;
    s += d;
    if (Math.abs(d) < 0.001) break;
  }
  const c = sample(s);
  car.s = s;
  car.x = (car.px - c.x) * c.rx + (car.pz - c.z) * c.rz;
  return c;
}

function placeCar(dt) {
  const c = sample(car.s);
  car.root.position.set(car.px, c.y, car.pz);
  car.root.rotation.y = car.yaw;
  // Inclinação de subida/descida medida na direção em que o carro aponta
  const along = Math.cos(car.yaw - c.h);
  const c1 = sample(car.s - 1.5), c2 = sample(car.s + 1.5);
  car.body.rotation.x = -Math.atan2(c2.y - c1.y, 3) * along + car.pitch;
  car.body.rotation.z = clamp(car.turnRate * 0.05, -0.12, 0.12);                  // inclina ao virar
  car.wheels.forEach(w => w.rotation.x += car.speed * (dt || 0) / 0.36);
  const steer = clamp(car.turnRate * 0.28, -0.45, 0.45);
  car.front.forEach(w => w.rotation.y = steer);
}

// Mola da carroceria: empina ao acelerar, abaixa o nariz ao frear
function updateBody(dt, accelerating) {
  const target = car.braking ? 0.045 : accelerating ? -0.03 * car.thr : 0;
  car.pitchV += (target - car.pitch) * 140 * dt;
  car.pitchV *= Math.exp(-11 * dt);
  car.pitch = clamp(car.pitch + car.pitchV * dt, -0.08, 0.09);
  // Lanternas acendem forte na freada
  const b = car.braking;
  car.tailMat.color.setHex(b ? 0xff2a12 : 0xff7a1a);
  car.glows.tail.forEach(g => { g.material.opacity = b ? 1 : 0.35; g.scale.setScalar(b ? 1.25 : 0.7); });
}

function updatePlaying(dt) {
  // O carro só anda com acelerador; soltando ele desacelera até parar
  const thr = throttle(), braking = isBraking();
  car.thr = thr; car.braking = braking && car.speed > 2;      // usados pelo som
  const target = Math.min(MAX_SPEED, BASE_SPEED + (level - 1) * SPEED_PER_LEVEL) * thr;
  if (thr > 0.05) hideHintSoon();
  const accelerating = car.speed < target;
  // Durante a troca de marcha (subida) quase não há tração
  const accel = ACCEL * (car.shiftT > 0 && car.gear > 0 ? 0.2 : 1.12);
  if (accelerating) car.speed = Math.min(target, car.speed + accel * dt);
  else car.speed = Math.max(target, car.speed - (braking ? BRAKE : COAST) * dt);
  updateGearbox(dt, thr);

  // Direção: só muda pelo jogador (arrasto ou ← →). Nada de seguir a curva sozinho.
  const yawPrev = car.yaw;
  if (keys.left) car.yaw += TURN_KEY * dt;
  if (keys.right) car.yaw -= TURN_KEY * dt;
  car.turnRate += ((car.yaw - yawPrev) / dt - car.turnRate) * Math.min(1, dt * 10);

  // Anda em linha reta na direção em que o carro aponta
  car.px += Math.sin(car.yaw) * car.speed * dt;
  car.pz += Math.cos(car.yaw) * car.speed * dt;
  ensureTrack();
  projectCar();
  updateBody(dt, accelerating);
  placeCar(dt);

  // Derrapagem (freada forte ou curva fechada): chiado, fumaça e marcas no chão
  let slip = car.braking ? Math.min(1, car.speed / 10) : 0;
  slip = Math.max(slip, clamp((Math.abs(car.turnRate) - 0.9) * 0.6, 0, 1) * Math.min(1, car.speed / 18));
  car.slip = slip;
  if (slip > 0.25) {
    car.root.updateMatrixWorld(true);
    const y = sample(car.s).y;
    car.skidAcc += car.speed * dt;
    const smoke = car.skidAcc > 0.55;
    if (smoke) car.skidAcc = 0;
    REAR_WHEELS.forEach((w, i) => {
      const p = car.root.localToWorld(tmpV.copy(w));
      if (skidPrev[i]) addSkid(skidPrev[i], p, y);
      skidPrev[i] = p.clone();
      if (smoke) puff(p, { color: 0xf2f2f2, size: 0.5, grow: 3.2, life: 0.9, opacity: 0.35 * slip, v: new THREE.Vector3(rand(-1, 1), rand(0.6, 1.6), rand(-1, 1)), rise: 0.6 });
    });
  } else skidPrev.length = 0;
  // Fumacinha do escapamento acelerando
  car.exhaustAcc += dt * (accelerating ? 6 + car.thr * 10 : 2.5);
  if (car.exhaustAcc > 1) { car.exhaustAcc = 0; exhaustFx(false); }

  // Sem chão embaixo do centro do carro (ou fora da pista existente) → cai
  const onTrack = segAt(car.s) && intervalsAt(car.s).some(iv => car.x >= iv[0] - FALL_TOL && car.x <= iv[1] + FALL_TOL);
  if (!onTrack) { startFall(); return; }

  checkObstacles();
  if (state !== 'playing') return;
  checkCoins();

  // Fim do nível
  if (car.s >= levelStartOf(level) + levelLen(level)) {
    level++;
    showBanner(`NÍVEL ${String(level - 1).padStart(2, '0')} COMPLETO!`);
    Sound.level();
    burst(car.root.position.clone().add(new THREE.Vector3(0, 2, 0)), [0xff3b3b, 0xffc61a, 0x3fd629, 0x1e88e5, 0xffffff], 60, 7, 12, 1.2);
  }
  cleanupTrack();
}

function nearbySegments(fn) {
  for (const seg of segments) {
    if (seg.start > car.s + 4) break;
    if (seg.end < car.s - 4) continue;
    fn(seg);
  }
}

function checkObstacles() {
  nearbySegments(seg => {
    for (const o of seg.obstacles) {
      if (o.hit || state !== 'playing') continue;
      if (Math.abs(o.s - car.s) < CAR_HL + o.hl && Math.abs(o.x - car.x) < CAR_HW + o.hw) hitObstacle(o);
    }
  });
}

function knock(o, power) {                  // arremessa o obstáculo atingido
  const c = sample(o.s), side = Math.sign(o.x - car.x) || pick([-1, 1]);
  flying.push({
    mesh: o.mesh, life: 2,
    v: new THREE.Vector3(c.fx * power + c.rx * side * 5, 8, c.fz * power + c.rz * side * 5),
    spin: new THREE.Vector3(rand(-9, 9), 0, rand(-9, 9)),
  });
}

function hitObstacle(o) {
  o.hit = true;
  const p = o.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0));
  if (o.heavy) {                            // batida forte: fim de jogo
    knock(o, car.speed * 0.5);
    burst(p, [0xe3262b, 0xffffff, 0x333333, 0xff8a00, 0xffc21a], 50, 8, 10, 1.0);
    puff(p, { color: 0xffe2a0, add: true, size: 3.2, grow: 0.8, life: 0.25, opacity: 1 });          // clarão
    for (let i = 0; i < 10; i++) puff(p, { color: 0xff8a20, color2: 0x3a3a3e, size: rand(0.8, 1.4), grow: 2.5, life: 1.3, opacity: 0.7, v: new THREE.Vector3(rand(-4, 4), rand(1, 5), rand(-4, 4)), rise: 1.5, drag: 2 });
    flash('rgba(255,40,40,.8)'); shake = 0.9;
    Sound.crash();
    car.speed = 0; state = 'crashed'; stateT = 0;
  } else {                                  // batida leve: perde velocidade
    knock(o, car.speed * 0.9);
    car.speed *= o.slow;
    burst(p, o.type === 'cone' ? [0xff5a0a, 0xffffff] : [0x222222, 0x555555], 18, 5, 7, 0.7);
    for (let i = 0; i < 5; i++) puff(p, { color: 0xe8dccb, size: 0.7, grow: 2, life: 0.7, opacity: 0.45, v: new THREE.Vector3(rand(-3, 3), rand(0.5, 2.5), rand(-3, 3)), rise: 0.5 });
    flash('rgba(255,90,40,.55)'); shake = 0.35;
    Sound.bump();
    if (navigator.vibrate) navigator.vibrate(40);
  }
}

function checkCoins() {
  nearbySegments(seg => {
    for (const c of seg.coins) {
      if (c.taken || Math.abs(c.s - car.s) > 1.5 || Math.abs(c.x - car.x) > 1.3) continue;
      c.taken = true; coins++;
      Sound.coin();
      scene.remove(c.mesh);
      burst(c.mesh.position, [0xffc21a, 0xffe36b, 0xffffff], 14, 4, 6, 0.6);
      ringFx(c.mesh.position);
      puff(c.mesh.position, { color: 0xfff0a0, add: true, size: 1.6, grow: 0.7, life: 0.22, opacity: 0.9 });
      restartAnim(ui.coinPill, 'bump');
    }
  });
}

function startFall() {
  state = 'falling'; stateT = 0;
  // Continua na direção em que o carro apontava
  fallVel.set(Math.sin(car.yaw) * car.speed, 2, Math.cos(car.yaw) * car.speed);
  shake = 0.2;
  Sound.fall();
}
function updateFalling(dt) {
  stateT += dt;
  fallVel.y -= 32 * dt;
  car.root.position.addScaledVector(fallVel, dt);
  car.body.rotation.x += dt * 1.6; car.body.rotation.z += dt * 1.1;
  if (stateT > 1.7) gameOver('Você caiu da pista!');
}
function updateCrashed(dt) {
  stateT += dt;
  car.body.rotation.y += dt * 9 * Math.max(0, 1 - stateT);
  car.body.position.y = Math.max(0, Math.sin(stateT * 6) * 0.6 * (1 - stateT));
  if (stateT > 1.2) gameOver('Você bateu!');
}

/* ---------- Câmera ---------- */
// Câmera atrás do carro, girando junto com a direção DO CARRO (não da pista)
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
let camYaw = 0;
function updateCamera(dt, snap) {
  if (state === 'garage') {
    // Garagem: câmera gira em volta do carro (carro fica na parte de cima da tela)
    const p = car.root.position, a = time * 0.45;
    camPos.set(p.x + Math.sin(a) * 6.5, p.y + 2.8, p.z + Math.cos(a) * 6.5);
    camLook.set(p.x, p.y - 0.6, p.z);
  } else if (state === 'falling' || state === 'over') {
    camLook.lerp(car.root.position, 1 - Math.exp(-dt * 6));
  } else {
    camYaw += (car.yaw - camYaw) * (snap ? 1 : 1 - Math.exp(-dt * 5));
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const y = sample(car.s).y, ya = sample(car.s + 10).y;
    tmpA.set(car.px - fx * 9, y + 5.4, car.pz - fz * 9);
    tmpB.set(car.px + fx * 10, ya + 0.6, car.pz + fz * 10);
    const k = snap ? 1 : 1 - Math.exp(-dt * 7);
    camPos.lerp(tmpA, k); camLook.lerp(tmpB, k);
  }
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.x += rand(-1, 1) * shake * 0.5;
    camera.position.y += rand(-1, 1) * shake * 0.5;
    shake = Math.max(0, shake - dt * 1.6);
  }
  camera.lookAt(camLook);
  // FOV abre com a velocidade e dá um "tranco" em cada troca de marcha
  car.fovKick = Math.max(0, car.fovKick - dt * 12);
  const fov = baseFov + (state === 'playing' ? clamp(car.speed / MAX_SPEED, 0, 1) * 9 : 0) + car.fovKick;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov += (fov - camera.fov) * (snap ? 1 : Math.min(1, dt * 8)); camera.updateProjectionMatrix(); }

  // Céu, mar de nuvens e sol acompanham o jogador
  sky.position.copy(camera.position);
  const p = car.root.position;
  cloudSea.position.set(p.x, -60, p.z);
  sun.position.set(p.x - 14, p.y + 32, p.z + 20);
  sun.target.position.copy(p);
}

// Nuvens que ficaram para trás são reposicionadas à frente
function placeCloud(cl, near) {
  const c = sample(car.s);
  const d = near ? rand(-60, 320) : rand(220, 360), side = rand(-1, 1) * 220;
  cl.position.set(c.x + c.fx * d + c.rx * side, rand(-42, -10) + (Math.abs(side) > 60 ? rand(0, 14) : 0), c.z + c.fz * d + c.rz * side);
  keepCloudBelowTrack(cl, car.s - 30, genEnd);
}

// Se a nuvem estiver perto do traçado (entre s0 e s1), empurra ela para baixo
// da pista para nunca tapar o caminho.
function keepCloudBelowTrack(cl, s0, s1) {
  const sc = cl.scale.x, R = sc * 4, top = sc * 2.6;           // raio horizontal e topo aproximados
  const i0 = Math.max(0, Math.floor(s0)), i1 = Math.min(path.x.length - 1, Math.ceil(s1));
  for (let i = i0; i <= i1; i += 3) {
    const dx = cl.position.x - path.x[i], dz = cl.position.z - path.z[i];
    if (dx * dx + dz * dz > (R + 8) * (R + 8)) continue;
    const maxY = path.y[i] - T - 4 - top;                        // topo da nuvem abaixo da laje
    if (cl.position.y > maxY) cl.position.y = maxY;
  }
}
function updateClouds() {
  const c = sample(car.s);
  for (const cl of clouds) {
    const dx = cl.position.x - c.x, dz = cl.position.z - c.z;
    if (dx * c.fx + dz * c.fz < -70) placeCloud(cl, false);
  }
}

/* ---------- 11. HUD, TELAS E LOOP ---------- */
const $ = id => document.getElementById(id);
const ui = {
  coinPill: $('coinPill'), coinCount: $('coinCount'), levelText: $('levelText'), barFill: $('barFill'), barText: $('barText'),
  speedVal: $('speedVal'), gear: $('gearVal'), rpmFill: $('rpmFill'), hint: $('hint'), banner: $('banner'),
  start: $('startScreen'), pause: $('pauseScreen'), over: $('overScreen'),
};
const hudCache = {};
function setText(el, key, v) { if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; } }
function updateHUD() {
  setText(ui.coinCount, 'c', coins.toLocaleString('pt-BR'));
  setText(ui.levelText, 'l', `NÍVEL ${String(level).padStart(2, '0')}`);
  const prog = clamp((car.s - levelStartOf(level)) / levelLen(level), 0, 1);
  const pct = Math.floor(prog * 100) + '%';
  if (hudCache.p !== pct) { hudCache.p = pct; ui.barFill.style.width = pct; ui.barText.textContent = pct; }
  setText(ui.speedVal, 's', String(Math.round(car.speed * 3.6)));
  setText(ui.gear, 'g', String(car.gear + 1));
  const rpm = Math.round(clamp(car.rpm, 0, 1) * 50) * 2;
  if (hudCache.r !== rpm) {
    hudCache.r = rpm; ui.rpmFill.style.width = rpm + '%';
    ui.rpmFill.parentNode.classList.toggle('red', rpm >= 90);
  }
}
function showBanner(text) { ui.banner.textContent = text; restartAnim(ui.banner, 'show'); }
function showHint() { clearTimeout(hintTimer); hintTimer = 0; ui.hint.classList.add('show'); }   // some quando o jogador acelerar
function hideHintSoon() {
  if (!ui.hint.classList.contains('show') || hintTimer === 'hiding') return;
  clearTimeout(hintTimer); hintTimer = 'hiding';
  setTimeout(() => { ui.hint.classList.remove('show'); hintTimer = 0; }, 1500);
}

// Recorde salvo no navegador (opcional; ignora se o storage estiver bloqueado)
function loadBest() { try { return JSON.parse(localStorage.getItem('skydrift_best')) || { dist: 0, coins: 0 }; } catch (_) { return { dist: 0, coins: 0 }; } }
function saveBest(b) { try { localStorage.setItem('skydrift_best', JSON.stringify(b)); } catch (_) { } }
function bestText(b) { return b.dist ? `Recorde: ${b.dist} m · ${b.coins} moedas` : ''; }
$('bestStart').textContent = bestText(loadBest());

function gameOver(reason) {
  state = 'over';
  const dist = Math.floor(car.s);
  const best = loadBest();
  if (dist > best.dist) { best.dist = dist; best.coins = Math.max(best.coins, coins); saveBest(best); }
  else if (coins > best.coins) { best.coins = coins; saveBest(best); }
  $('overReason').textContent = reason;
  $('stCoins').textContent = coins;
  $('stDist').textContent = dist;
  $('stLevel').textContent = level;
  $('bestOver').textContent = bestText(best);
  ui.hint.classList.remove('show');
  ui.over.classList.add('show');
}

function resetWorld() {
  state = 'menu';                               // garante que a câmera volte para trás do carro
  segments.forEach(removeSeg); segments = [];
  flying.forEach(f => scene.remove(f.mesh)); flying = [];
  parts.forEach(p => { scene.remove(p.m); partPool.push(p.m); }); parts.length = 0;
  rings.forEach(r => scene.remove(r.m)); rings.length = 0;
  puffs.forEach(p => { scene.remove(p.sp); (p.add ? puffPoolAdd : puffPool).push(p.sp); }); puffs.length = 0;
  clearSkids();
  resetPath();
  genEnd = 0; genLevel = 1; genLevelEnd = levelLen(1);
  level = 1; coins = 0; shake = 0;
  Object.assign(car, CAR_RESET);
  updateBody(0, false);
  car.body.rotation.set(0, 0, 0); car.body.position.set(0, 0, 0);
  ensureTrack();
  const c0 = sample(car.s);                     // começa no centro, apontando ao longo da pista
  car.px = c0.x; car.pz = c0.z; car.yaw = c0.h;
  placeCar(0);
  updateCamera(0, true);
  clouds.forEach(cl => placeCloud(cl, true));
  updateHUD();
}

function startGame() {
  Sound.init();                                 // áudio só pode começar após um toque/clique
  resetWorld();
  [ui.start, ui.pause, ui.over].forEach(s => s.classList.remove('show'));
  state = 'playing';
  showHint();
}
function togglePause() {
  if (state === 'playing') { state = 'paused'; ui.pause.classList.add('show'); }
  else if (state === 'paused') { Sound.init(); state = 'playing'; ui.pause.classList.remove('show'); clock.getDelta(); }
}
// Todo toque na tela garante que o áudio está ativo (navegadores podem suspendê-lo)
['pointerdown', 'touchend', 'click', 'keydown'].forEach(ev =>
  window.addEventListener(ev, () => { if (state !== 'menu' && state !== 'garage') Sound.init(); }, { capture: true, passive: true }));
$('soundBtn').addEventListener('click', () => {
  $('soundBtn').textContent = Sound.toggleMute() ? '🔇 SOM: DESLIGADO' : '🔊 SOM: LIGADO';
});
/* ---------- Menu inicial → Garagem → Corrida ---------- */
const garage = $('garageScreen'), swatchBox = $('swatches');
let skinLoaded = 'red';
try { skinLoaded = localStorage.getItem('skydrift_skin') || 'red'; } catch (_) { }
function selectSkin(id) {
  const k = applySkin(id);
  $('skinName').textContent = k.name;
  [...swatchBox.children].forEach(b => b.classList.toggle('sel', b.dataset.id === k.id));
}
// Um botão redondo por pintura
CAR_SKINS.forEach(k => {
  const b = document.createElement('button');
  b.className = 'swatch'; b.dataset.id = k.id; b.style.background = k.css;
  b.setAttribute('aria-label', k.name);
  b.addEventListener('click', () => selectSkin(k.id));
  swatchBox.appendChild(b);
});
selectSkin(skinLoaded);

function openGarage() {
  Sound.init();
  resetWorld();
  [ui.start, ui.pause, ui.over].forEach(s => s.classList.remove('show'));
  garage.classList.add('show');
  state = 'garage';
}
function backToMenu() {
  garage.classList.remove('show');
  ui.start.classList.add('show');
  $('bestStart').textContent = bestText(loadBest());
  resetWorld();                                 // volta a câmera para trás do carro
}
$('startBtn').addEventListener('click', openGarage);
$('raceBtn').addEventListener('click', () => { garage.classList.remove('show'); startGame(); });
$('backBtn').addEventListener('click', backToMenu);
$('garageBtn').addEventListener('click', openGarage);
$('restartBtn').addEventListener('click', startGame);
$('restartBtn2').addEventListener('click', startGame);
$('resumeBtn').addEventListener('click', togglePause);
$('pauseBtn').addEventListener('click', togglePause);
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') togglePause(); });

// Loop principal
const clock = new THREE.Clock();
let time = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  if (state !== 'paused') {
    time += dt;
    if (state === 'playing') updatePlaying(dt);
    else if (state === 'falling') updateFalling(dt);
    else if (state === 'crashed') updateCrashed(dt);

    // Animações de ambiente: moedas girando, semáforos e lâmpadas piscando
    nearbyVisible(seg => seg.coins.forEach(c => { if (!c.taken) { c.mesh.userData.spin.rotation.y += dt * 3; c.mesh.position.y += Math.sin(time * 4 + c.s) * 0.004; } }));
    const phase = Math.floor(time / 1.2) % 3;               // verde → amarelo → vermelho
    TL.forEach((l, i) => l.mat.color.setHex(i === 2 - phase ? l.on : l.off));
    MAT.amber.color.setHex(Math.floor(time * 3) % 2 ? 0xffb020 : 0x7a4a00);

    updateEffects(dt);
    updateClouds();
    updateCamera(dt, false);
    updateStreaks(dt);
    updateSpeedFx();
    updateHUD();
  }
  // Motor e pneus: só soam durante a corrida (silenciam na pausa, queda e fim)
  const active = state === 'playing';
  Sound.update(car.rpm, active ? car.thr || 0 : 0, active ? car.slip : 0, active);
  renderer.render(scene, camera);
}
function nearbyVisible(fn) { for (const seg of segments) { if (seg.start > car.s + 150) break; fn(seg); } }

// Inicia com a pista já montada atrás da tela inicial
resetWorld();
loop();
