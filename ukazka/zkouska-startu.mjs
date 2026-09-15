// Spustí skripty z ukazka.html v Node s napodobeninou stránky.
// Nehledá chyby v logice — hledá jedinou věc: shodí se skript hned při startu?
// Přesně to se stalo s `const { createClient } = supabase` a návštěvníkovi
// zůstala viset přihlašovací obrazovka.
import fs from 'fs'
import vm from 'vm'

import path from 'path'
import { fileURLToPath } from 'url'
const kde = path.dirname(fileURLToPath(import.meta.url))
const soubor = process.argv[2] || path.join(kde, '..', 'ukazka.html')
const html = fs.readFileSync(soubor, 'utf8')
const skripty = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1])
console.log('skriptů ve stránce:', skripty.length)

// --- napodobenina stránky ---
const prvky = {}
const prvek = (id) => {
  const p = {
    style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    children: [], childNodes: [], value: '', textContent: '', innerHTML: '', innerText: '',
    checked: false, disabled: false, options: [], files: [], id: id || '', className: '',
    appendChild(x){ return x }, removeChild(x){ return x }, remove(){}, insertBefore(x){ return x },
    setAttribute(){}, getAttribute: () => null, removeAttribute(){}, hasAttribute: () => false,
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true },
    querySelector: () => prvek(), querySelectorAll: () => [], closest: () => null,
    focus(){}, blur(){}, click(){}, scrollIntoView(){}, getBoundingClientRect: () => ({ top:0,left:0,width:0,height:0,bottom:0,right:0 }),
    insertAdjacentHTML(){}, cloneNode(){ return prvek() }, contains: () => false,
    getContext: () => ({ drawImage(){}, fillRect(){}, clearRect(){}, fillText(){}, beginPath(){}, stroke(){}, moveTo(){}, lineTo(){}, save(){}, restore(){}, scale(){}, translate(){}, setTransform(){}, putImageData(){}, getImageData: () => ({ data: [] }) }),
    toDataURL: () => 'data:,', play(){}, pause(){}, showPicker(){},
  }
  return p
}
const doc = {
  readyState: 'complete', title: '', cookie: '',
  // Prvky si pamatujeme podle id — jinak by každé zavolání vrátilo nový objekt
  // a nedalo by se zjistit, jestli appka nakonec zobrazila systém, nebo přihlášení.
  getElementById: (id) => (prvky[id] = prvky[id] || prvek(id)),
  querySelector: (s) => { const m = /^#([A-Za-z0-9_-]+)$/.exec(s || ''); return m ? (prvky[m[1]] = prvky[m[1]] || prvek(m[1])) : prvek() },
  querySelectorAll: () => [],
  getElementsByClassName: () => [], getElementsByTagName: () => [],
  createElement: () => prvek(), createTextNode: () => prvek(), createDocumentFragment: () => prvek(),
  _posluchaci: {},
  addEventListener(t, f){ (doc._posluchaci[t] = doc._posluchaci[t] || []).push(f) },
  removeEventListener(){}, dispatchEvent(){ return true },
  body: prvek(), head: prvek(), documentElement: prvek(), activeElement: null,
  execCommand(){}, hasFocus: () => true, visibilityState: 'visible', write(){}, open(){}, close(){},
}
const uloziste = () => ({ _d:{}, getItem(k){ return this._d[k] ?? null }, setItem(k,v){ this._d[k]=String(v) },
                          removeItem(k){ delete this._d[k] }, clear(){ this._d={} }, key: () => null, length: 0 })

const okno = {
  document: doc, location: { href:'https://ukazka/', search:'', hash:'', pathname:'/', origin:'https://ukazka', reload(){}, replace(){}, assign(){} },
  navigator: { userAgent:'node', language:'cs', onLine:true, serviceWorker:{ register: async()=>({}), ready: Promise.resolve({}), addEventListener(){}, controller:null },
               geolocation:{ getCurrentPosition(){}, watchPosition(){ return 1 }, clearWatch(){} }, clipboard:{ writeText: async()=>{} }, share: async()=>{}, vibrate(){} },
  localStorage: uloziste(), sessionStorage: uloziste(),
  addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true },
  // Krátká čekání necháváme běžet doopravdy (start appky na nich stojí),
  // dlouhá zkracujeme, ať zkouška netrvá minuty. Padesátivteřinovou pojistku,
  // která ukazuje přihlášení, ale zahodíme — jinak by test čekal na ni.
  setTimeout: (f, ms) => (ms >= 10000 ? 0 : setTimeout(() => { try { f && f() } catch (e) { chyby.push(['odloženě', e]) } }, Math.min(ms || 0, 5))),
  clearTimeout, setInterval: () => 0, clearInterval, requestAnimationFrame: (f)=>{ return 0 },
  fetch: async () => ({ ok:true, status:200, json: async()=>({}), text: async()=>'' }),
  alert(){}, confirm: () => true, prompt: () => null, print(){}, open: () => null, close(){},
  matchMedia: () => ({ matches:false, addEventListener(){}, addListener(){} }),
  innerWidth:1280, innerHeight:800, devicePixelRatio:1, scrollTo(){}, getComputedStyle: () => ({ display:'block', getPropertyValue: () => '' }),
  crypto: { getRandomValues: (a)=>{ for(let i=0;i<a.length;i++) a[i]=(i*37)%256; return a }, randomUUID: () => 'x' },
  URL, URLSearchParams, Blob: class { constructor(){} }, File: class {}, FileReader: class { readAsDataURL(){} },
  Image: class { constructor(){} }, AbortController, Intl, console,
  btoa: (s)=>Buffer.from(s,'binary').toString('base64'), atob: (s)=>Buffer.from(s,'base64').toString('binary'),
}
okno.window = okno
okno.self = okno
okno.globalThis = okno
okno.top = okno
okno.parent = okno

const chyby = []
const ctx = vm.createContext(okno)
const prvkyStav = (id) => { const p = prvky[id]; return p ? (p.style.display || '(nenastaveno)') : '(prvek nevznikl)' }

skripty.forEach((kod, i) => {
  try {
    new vm.Script(kod, { filename: `skript-${i}.js` }).runInContext(ctx, { timeout: 20000 })
    console.log(`  skript ${i} (${kod.length} B) — ✅ proběhl`)
  } catch (e) {
    chyby.push([`skript ${i}`, e])
    console.log(`  skript ${i} (${kod.length} B) — ❌ ${e.name}: ${e.message}`)
  }
})

console.log()
if (chyby.length) {
  console.log('❌ UKÁZKA BY SE NEROZJELA:')
  chyby.forEach(([kde, e]) => {
    console.log(`   ${kde}: ${e.name}: ${e.message}`)
    const r = String(e.stack||'').split('\n').find(x => x.includes('skript-'))
    if (r) console.log('     ' + r.trim())
  })
  process.exit(1)
}
console.log('✅ všechny skripty proběhly bez pádu')

// Rozjetý skript ještě neznamená použitelnou ukázku. Tohle jsou tři věci,
// bez kterých by návštěvník viděl přihlašovací okno nebo prázdné obrazovky.
const sb = ctx.sb
let vada = 0
const kontrola = (jm, ok, extra='') => { if(ok) console.log('   ✅',jm,extra); else {vada++;console.log('   ❌',jm,extra)} }

// Nastartuj appku tak, jak to udělá prohlížeč.
ctx.document.readyState = 'complete'
;(ctx.document._posluchaci['DOMContentLoaded'] || []).forEach(f => { try { f({}) } catch (e) { chyby.push(['DOMContentLoaded', e]) } })
await new Promise(r => setTimeout(r, 1500))   // ať doběhnou dotazy do paměti

const { data: { session } } = await sb.auth.getSession()
kontrola('ukázka je přihlášená', !!(session && session.user), session ? session.user.email : 'ŽÁDNÁ RELACE')

// TOHLE JE TA ROZHODUJÍCÍ KONTROLA: co appka nakonec ukázala?
// Appka po startu VÝSLOVNĚ nastaví #app na 'block' a #login na 'none'.
// Nenastavenou hodnotu proto nesmíme brát jako „je vidět" — to by prošlo
// i tehdy, když se appka vůbec nerozjela a nic nenastavila.
kontrola('systém je vidět', prvkyStav('app') === 'block', 'app.display=' + prvkyStav('app'))
kontrola('přihlašovací okno je schované', prvkyStav('login') === 'none', 'login.display=' + prvkyStav('login'))

const { data: lide } = await sb.from('profiles').select('*')
kontrola('jsou vymyšlení lidé', (lide||[]).length > 5, (lide||[]).length + ' profilů')

const { data: doch } = await sb.from('attendance').select('*, worker:profiles!worker_id(full_name)').limit(3)
kontrola('docházka i s vnořeným jménem',
  (doch||[]).length > 0 && doch[0].worker && doch[0].worker.full_name,
  (doch||[]).length ? doch[0].worker?.full_name : 'nic')

const { data: adm } = await sb.from('profiles').select('*').eq('role','admin').maybeSingle()
kontrola('je tam účet vedení', !!adm, adm ? adm.full_name : 'není')

if (vada) { console.log('\n❌ ukázka by se otevřela rozbitá'); process.exit(1) }
console.log('\n✅ UKÁZKA JE POUŽITELNÁ')
