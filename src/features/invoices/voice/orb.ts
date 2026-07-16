/* ======================================================================
   ELSIE ORB — TypeScript port of the Lemlin WebGL shader sphere
   (concierge/app/orb.js). Domain-warped fbm noise folded into silk,
   lit as a matte sphere, tinted to Elsie's brand slate-blue.

   ONE hidden WebGL master renders the sphere; every orb on screen is a
   cheap 2D canvas blitting from it each frame. Falls back silently to
   the CSS orb (see orb.css) when WebGL is unavailable or the GPU
   context is lost. Pauses when no orb is visible or while the user is
   scrolling; reduced motion renders a single frame.

   No window globals — use bootOrb(container) / tintOrb(hex) / destroyOrb().
   ====================================================================== */

const SIZE = 512

/** Elsie brand slate-blue — matches --brand (60 90 135) in src/index.css */
const DEFAULT_TINT = '#3C5A87'

const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'

const FRAG = [
  'precision mediump float;',
  'uniform vec2 u_res;',
  'uniform float u_t;',
  'uniform vec3 u_l,u_m,u_d,u_b,u_r;', // palette: light / mid / deep / bounce / rim

  'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
  'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
  ' return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}',
  'float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<3;i++){v+=a*noise(p);p=p*2.03+vec2(17.3,9.1);a*=.55;}return v;}',
  // ramp built from the tint colour
  'vec3 pal(float m){',
  ' vec3 c1=mix(u_l,u_m,.55);',
  ' vec3 c3=mix(u_m,u_d,.5);',
  ' if(m<.25)return mix(u_l,c1,m*4.);',
  ' if(m<.5)return mix(c1,u_m,(m-.25)*4.);',
  ' if(m<.75)return mix(u_m,c3,(m-.5)*4.);',
  ' return mix(c3,u_d,(m-.75)*4.);}',
  'void main(){',
  ' vec2 uv=(gl_FragCoord.xy*2.-u_res)/min(u_res.x,u_res.y);',
  ' float r=length(uv);',
  ' if(r>1.02)discard;',
  ' vec3 N=vec3(uv,sqrt(max(0.,1.-r*r)));',
  ' float t=u_t*1.5;', // the material boils and flows

  // silk: warp the noise field with itself, twice, and stir it
  ' vec2 sp=uv*.8;',
  ' float ang=t*.3;',
  ' sp=mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*sp;',
  ' vec2 q=vec2(fbm(sp*1.2+vec2(t*.55,0.)),fbm(sp*1.2+vec2(3.7,-t*.45)));',
  ' vec2 w=sp*1.5+2.5*q;',
  ' float m=fbm(w+vec2(-t*.5,t*.35));',
  // a few soft crests folded through the material
  ' float fil=1.-abs(2.*fract(m*1.35+t*.18)-1.);',
  ' fil=pow(fil,9.)*.32;',
  ' float mat_v=clamp(.18+m*.75,0.,1.);',
  ' vec3 base=pal(mat_v);',
  ' base+=u_l*fil*1.08;',
  // lighting: key top-left, specular, bounce, deep fresnel rim
  ' vec3 L=normalize(vec3(-.45,.62,.65));',
  ' float diff=clamp(dot(N,L),0.,1.);',
  ' float spec=pow(clamp(dot(reflect(-L,N),vec3(0.,0.,1.)),0.,1.),26.)*.45;',
  ' float bounce=clamp(dot(N,normalize(vec3(.55,-.7,.35))),0.,1.)*.3;',
  ' float fres=pow(1.-N.z,2.3);',
  ' vec3 col=base*(.52+.55*diff);',
  ' col+=mix(vec3(.99),u_l,.5)*spec;',
  ' col+=u_b*bounce*.5;',
  ' col=mix(col,u_r,fres*.6);',
  ' float edge=smoothstep(1.02,.985,r);',
  ' gl_FragColor=vec4(col*edge,edge);}', // premultiplied — straight alpha fringes in drawImage
].join('\n')

interface OrbClient {
  host: HTMLElement
  cv: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  vis: boolean
  io: IntersectionObserver | null
}

interface PaletteUniforms {
  l: WebGLUniformLocation | null
  m: WebGLUniformLocation | null
  d: WebGLUniformLocation | null
  b: WebGLUniformLocation | null
  r: WebGLUniformLocation | null
}

let master: HTMLCanvasElement | null = null
let gl: WebGLRenderingContext | null = null
let uT: WebGLUniformLocation | null = null
let uCol: PaletteUniforms | null = null
let raf: number | null = null
let t0: number | null = null
let clients: OrbClient[] = []
let currentTint = DEFAULT_TINT
let listenersOn = false

let RM = false
try {
  RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches
} catch {
  /* no matchMedia — assume motion is fine */
}

/* the orb loop must never fight touch scrolling: cap to ~25fps on
   mobile and pause entirely while the user is scrolling */
let MOBILE = false
try {
  MOBILE = window.matchMedia('(max-width:900px)').matches || 'ontouchstart' in window
} catch {
  /* ignore */
}
const MIN_DT = MOBILE ? 40 : 16
let lastDraw = 0
let scrolling = false
let scrollTimer: number | null = null

function onScroll() {
  scrolling = true
  if (scrollTimer != null) window.clearTimeout(scrollTimer)
  scrollTimer = window.setTimeout(() => {
    scrolling = false
    kick()
  }, 220)
}

function ensureListeners() {
  if (listenersOn) return
  listenersOn = true
  try {
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    window.addEventListener('touchmove', onScroll, { passive: true })
    window.addEventListener('wheel', onScroll, { passive: true })
    window.addEventListener('resize', kick) // re-sync backing stores after rotate/resize
  } catch {
    /* ignore */
  }
}

/* GPU context loss (routine on mobile under pressure): hand every orb
   back to its CSS fallback instead of blitting blank frames forever */
function fallbackToCSS() {
  if (raf != null) {
    try {
      cancelAnimationFrame(raf)
    } catch {
      /* ignore */
    }
  }
  raf = null
  gl = null
  uT = null
  uCol = null
  master = null
  clients.forEach((c) => {
    try {
      c.io?.disconnect()
      c.cv.parentNode?.removeChild(c.cv)
      delete c.host.dataset.glOn
      c.host.classList.remove('gl')
    } catch {
      /* ignore */
    }
  })
  clients = []
}

function initMaster(): boolean {
  if (gl) return true
  master = document.createElement('canvas')
  master.width = master.height = SIZE
  gl = master.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true })
  if (!gl) {
    gl = null
    return false
  }
  const g = gl
  master.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    fallbackToCSS()
  })
  function sh(type: number, src: string): WebGLShader | null {
    const s = g.createShader(type)
    if (!s) return null
    g.shaderSource(s, src)
    g.compileShader(s)
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) return null
    return s
  }
  const vs = sh(g.VERTEX_SHADER, VERT)
  const fs = sh(g.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) {
    gl = null
    return false
  }
  const pr = g.createProgram()
  if (!pr) {
    gl = null
    return false
  }
  g.attachShader(pr, vs)
  g.attachShader(pr, fs)
  g.linkProgram(pr)
  if (!g.getProgramParameter(pr, g.LINK_STATUS)) {
    gl = null
    return false
  }
  g.useProgram(pr)
  const buf = g.createBuffer()
  g.bindBuffer(g.ARRAY_BUFFER, buf)
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW)
  const loc = g.getAttribLocation(pr, 'a')
  g.enableVertexAttribArray(loc)
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0)
  g.uniform2f(g.getUniformLocation(pr, 'u_res'), SIZE, SIZE)
  uT = g.getUniformLocation(pr, 'u_t')
  uCol = {
    l: g.getUniformLocation(pr, 'u_l'),
    m: g.getUniformLocation(pr, 'u_m'),
    d: g.getUniformLocation(pr, 'u_d'),
    b: g.getUniformLocation(pr, 'u_b'),
    r: g.getUniformLocation(pr, 'u_r'),
  }
  setOrbColor(currentTint)
  g.viewport(0, 0, SIZE, SIZE)
  g.enable(g.BLEND)
  g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)
  return true
}

/* ---- tinting: the orb wears the given accent colour ---- */
function parseColor(s: string): [number, number, number] | null {
  const str = (s || '').trim()
  if (!str) return null
  const el = document.createElement('i')
  el.style.color = str
  document.documentElement.appendChild(el)
  const cs = getComputedStyle(el).color
  document.documentElement.removeChild(el)
  const m = cs.match(/(\d+),\s*(\d+),\s*(\d+)/)
  return m ? [+m[1] / 255, +m[2] / 255, +m[3] / 255] : null
}

function setOrbColor(str: string) {
  if (!gl || !uCol) return
  const c = parseColor(str)
  if (!c) return
  const l = c.map((x) => x + (1 - x) * 0.76) // near-white tint for speculars/crests
  const d = c.map((x) => x * 0.42) // deep shadow end of the ramp
  const b = c.map((x) => x + (1 - x) * 0.5) // bounce light
  const r = c.map((x) => x * 0.34) // fresnel rim
  gl.uniform3f(uCol.l, l[0], l[1], l[2])
  gl.uniform3f(uCol.m, c[0], c[1], c[2])
  gl.uniform3f(uCol.d, d[0], d[1], d[2])
  gl.uniform3f(uCol.b, b[0], b[1], b[2])
  gl.uniform3f(uCol.r, r[0], r[1], r[2])
  kick()
}

function anyVisible(): boolean {
  for (let i = 0; i < clients.length; i++) if (clients[i].vis) return true
  return false
}

function frame(now: number) {
  raf = null
  if (!gl || !anyVisible()) return
  if (scrolling) return // resume is kicked when scrolling settles
  if (now - lastDraw < MIN_DT) {
    raf = requestAnimationFrame(frame)
    return
  }
  lastDraw = now
  if (t0 == null) t0 = now
  gl.uniform1f(uT, (now - t0) / 1000)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  const d = Math.min(window.devicePixelRatio || 1, 2)
  for (let i = 0; i < clients.length; i++) {
    const c = clients[i]
    if (!c.vis) continue
    const w = c.cv.clientWidth
    const h = c.cv.clientHeight
    if (!w || !h) continue
    const W = Math.round(w * d)
    const H = Math.round(h * d)
    if (c.cv.width !== W || c.cv.height !== H) {
      c.cv.width = W
      c.cv.height = H
    }
    c.ctx.clearRect(0, 0, W, H)
    if (master) c.ctx.drawImage(master, 0, 0, SIZE, SIZE, 0, 0, W, H)
  }
  if (!RM) raf = requestAnimationFrame(frame) // reduced motion: one frame only
}

function kick() {
  if (raf == null && gl && !scrolling) raf = requestAnimationFrame(frame)
}

/**
 * Boot a live orb inside `container`. The container should carry the
 * `elsie-orb` class (from orb.css) — that IS the fallback when WebGL is
 * unavailable, so booting is always safe. Idempotent per container.
 */
export function bootOrb(container: HTMLElement): void {
  if (container.dataset.glOn) return
  ensureListeners()
  if (!initMaster()) return // no WebGL → the CSS orb simply stays
  const cv = document.createElement('canvas')
  cv.className = 'orb-blit'
  cv.setAttribute('aria-hidden', 'true')
  const ctx = cv.getContext('2d')
  if (!ctx) return
  container.appendChild(cv)
  const client: OrbClient = { host: container, cv, ctx, vis: true, io: null }
  try {
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((e) => {
          client.vis = e.isIntersecting
          if (client.vis) kick()
        })
      },
      { threshold: 0.02 }
    )
    io.observe(cv)
    client.io = io
  } catch {
    /* no IntersectionObserver — treat as always visible */
  }
  clients.push(client)
  container.dataset.glOn = '1'
  container.classList.add('gl')
  kick()
}

/** Re-tint every live orb. No argument restores the Elsie brand tint. */
export function tintOrb(hex?: string): void {
  currentTint = hex || DEFAULT_TINT
  setOrbColor(currentTint)
}

/**
 * Tear down the orb in `container` (or ALL orbs when omitted).
 * The render loop stops automatically once no clients remain.
 */
export function destroyOrb(container?: HTMLElement): void {
  const doomed = container ? clients.filter((c) => c.host === container) : [...clients]
  for (const c of doomed) {
    try {
      c.io?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      c.cv.parentNode?.removeChild(c.cv)
    } catch {
      /* ignore */
    }
    delete c.host.dataset.glOn
    c.host.classList.remove('gl')
  }
  clients = clients.filter((c) => !doomed.includes(c))
  if (!clients.length && raf != null) {
    cancelAnimationFrame(raf)
    raf = null
  }
}
