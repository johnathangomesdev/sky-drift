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
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 70 : 56;           // FOV maior em tela vertical
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
  g.scale.setScalar(rand(3.5, 9));
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
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  body.add(mesh(B(1.72, 0.5, 3.0), red, 0, 0.55, 0));                 // carroceria
  body.add(mesh(B(1.3, 0.5, 1.4), red, 0, 1.05, -0.25));              // cabine
  body.add(mesh(B(1.33, 0.3, 1.1), glass, 0, 1.08, -0.25));           // janelas laterais
  body.add(mesh(B(1.12, 0.36, 0.04), glass, 0, 1.06, -0.96));         // vidro traseiro
  body.add(mesh(B(1.12, 0.36, 0.04), glass, 0, 1.06, 0.46));          // para-brisa
  for (const sx of [-0.14, 0.14]) {                                    // faixas brancas de corrida
    body.add(mesh(B(0.16, 0.02, 3.02), MAT.white, sx, 0.81, 0));
    body.add(mesh(B(0.16, 0.02, 1.42), MAT.white, sx, 1.31, -0.25));
    body.add(mesh(B(0.16, 0.5, 0.02), MAT.white, sx, 0.55, -1.51));
    body.add(mesh(B(0.16, 0.075, 0.39), MAT.white, sx, 1.24, -1.32));
  }
  body.add(mesh(B(1.62, 0.07, 0.38), red, 0, 1.24, -1.32));           // aerofólio
  for (const sx of [-0.55, 0.55]) body.add(mesh(B(0.08, 0.32, 0.12), MAT.black, sx, 1.02, -1.3));
  for (const sx of [-0.56, 0.56]) {
    body.add(mesh(B(0.42, 0.15, 0.04), basic(0xff7a1a), sx, 0.66, -1.52));   // lanternas
    body.add(mesh(B(0.36, 0.12, 0.04), basic(0xfff3c0), sx, 0.62, 1.52));    // faróis
  }
  body.add(mesh(B(1.6, 0.18, 0.1), MAT.black, 0, 0.36, -1.5));        // para-choque
  const ex = new THREE.CylinderGeometry(0.08, 0.08, 0.22, 10).rotateX(Math.PI / 2);
  for (const sx of [-0.18, 0.18]) body.add(mesh(ex, chrome, sx, 0.33, -1.58));  // escapamento duplo
  const wGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.32, 18).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.17, 0.17, 0.34, 10).rotateZ(Math.PI / 2);
  const wheels = [];
  for (const sx of [-0.84, 0.84]) for (const sz of [-0.95, 0.95]) {
    const w = mesh(wGeo, MAT.tire, sx, 0.36, sz);
    w.add(mesh(hub, chrome));
    body.add(w); wheels.push(w);
  }
  shadowAll(root);
  scene.add(root);
  return { root, body, wheels };
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
  let ctx = null, master = null, noiseBuf = null, engine = null, screech = null, muted = false;
  const VOL = 0.6;

  // Cria o contexto de áudio (precisa acontecer após um toque/clique do usuário)
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : VOL; master.connect(ctx.destination);

    // Ruído branco reutilizado em chiados e batidas
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Motor: dente-de-serra + quadrada (oitava abaixo) num filtro passa-baixa ressonante
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square';
    const sub = ctx.createGain(); sub.gain.value = 0.5;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 5;
    const g = ctx.createGain(); g.gain.value = 0;
    o1.connect(f); o2.connect(sub); sub.connect(f); f.connect(g); g.connect(master);
    o1.start(); o2.start();
    engine = { o1, o2, f, g };

    // Chiado de pneu: ruído em loop num passa-banda agudo, volume controlado
    const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 7;
    const sg = ctx.createGain(); sg.gain.value = 0;
    n.connect(bp); bp.connect(sg); sg.connect(master); n.start();
    screech = { g: sg, bp };
  }

  // Chamado todo quadro: rotação do motor e chiado acompanham o carro
  function update(speed, thr, braking, turn, active) {
    if (!ctx) return;
    const t = ctx.currentTime, sp = clamp(speed / MAX_SPEED, 0, 1);
    const freq = 42 + sp * 120 + thr * 30;                     // acelerando = tom sobe
    engine.o1.frequency.setTargetAtTime(freq, t, 0.06);
    engine.o2.frequency.setTargetAtTime(freq * 0.5, t, 0.06);
    engine.f.frequency.setTargetAtTime(250 + sp * 1300 + thr * 900, t, 0.06);
    engine.g.gain.setTargetAtTime(active ? 0.05 + thr * 0.09 + sp * 0.05 : 0, t, 0.08);

    let sc = 0;
    if (active) {
      if (braking) sc = Math.min(1, speed / 10);                             // freada
      sc = Math.max(sc, clamp((turn - 0.9) * 0.6, 0, 1) * Math.min(1, speed / 18));   // curva fechada
    }
    screech.g.gain.setTargetAtTime(sc * 0.22, t, 0.04);
    screech.bp.frequency.setTargetAtTime(1900 + sc * 900, t, 0.05);
  }

  // Rajada de ruído filtrado com decaimento (batidas)
  function noise(dur, freq, vol, type) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur);
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
    init, update,
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
const car = Object.assign(makeCar(), { px: 0, pz: 0, yaw: 0, turnRate: 0, s: 12, x: 0, speed: 0 });
const fallVel = new THREE.Vector3();

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
  car.body.rotation.x = -Math.atan2(c2.y - c1.y, 3) * along;
  car.body.rotation.z = clamp(car.turnRate * 0.05, -0.12, 0.12);                  // inclina ao virar
  car.wheels.forEach(w => w.rotation.x += car.speed * (dt || 0) / 0.36);
}

function updatePlaying(dt) {
  // O carro só anda com acelerador; soltando ele desacelera até parar
  const thr = throttle(), braking = isBraking();
  car.thr = thr; car.braking = braking && car.speed > 2;      // usados pelo som
  const target = Math.min(MAX_SPEED, BASE_SPEED + (level - 1) * SPEED_PER_LEVEL) * thr;
  if (thr > 0.05) hideHintSoon();
  if (car.speed < target) car.speed = Math.min(target, car.speed + ACCEL * dt);
  else car.speed = Math.max(target, car.speed - (braking ? BRAKE : COAST) * dt);

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
  placeCar(dt);

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
    flash('rgba(255,40,40,.8)'); shake = 0.9;
    Sound.crash();
    car.speed = 0; state = 'crashed'; stateT = 0;
  } else {                                  // batida leve: perde velocidade
    knock(o, car.speed * 0.9);
    car.speed *= o.slow;
    burst(p, o.type === 'cone' ? [0xff5a0a, 0xffffff] : [0x222222, 0x555555], 18, 5, 7, 0.7);
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
  if (state === 'falling' || state === 'over') {
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
  cl.position.set(c.x + c.fx * d + c.rx * side, rand(-42, -8) + (Math.abs(side) > 40 ? rand(0, 14) : 0), c.z + c.fz * d + c.rz * side);
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
  speedVal: $('speedVal'), hint: $('hint'), banner: $('banner'),
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
  resetPath();
  genEnd = 0; genLevel = 1; genLevelEnd = levelLen(1);
  level = 1; coins = 0; shake = 0;
  Object.assign(car, { s: 12, x: 0, speed: 0, turnRate: 0 });
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
$('soundBtn').addEventListener('click', () => {
  $('soundBtn').textContent = Sound.toggleMute() ? '🔇 SOM: DESLIGADO' : '🔊 SOM: LIGADO';
});
$('startBtn').addEventListener('click', startGame);
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
    updateHUD();
  }
  // Motor e pneus: só soam durante a corrida (silenciam na pausa, queda e fim)
  const active = state === 'playing';
  Sound.update(car.speed, active ? car.thr || 0 : 0, active && car.braking, Math.abs(car.turnRate), active);
  renderer.render(scene, camera);
}
function nearbyVisible(fn) { for (const seg of segments) { if (seg.start > car.s + 150) break; fn(seg); } }

// Inicia com a pista já montada atrás da tela inicial
resetWorld();
loop();
