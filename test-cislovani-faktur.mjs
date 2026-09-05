// Zkouška číslování faktur: uživatel si napíše číslo, jak chce, a appka musí
// pokračovat ve STEJNÉM tvaru. Testuje se na kódu vytaženém z appky, ne na kopii.
import fs from 'fs'
const src = fs.readFileSync('nasazeni4/subbau_final.html','utf8')
const kus = (od, doo) => {
  const i = src.indexOf(od); const j = src.indexOf(doo, i)
  if (i < 0 || j < 0) throw new Error('nenašel jsem ' + od)
  return src.slice(i, j)
}
const kod = kus('function rozborCislaFaktury', 'async function dalsiCisloFaktury')
const { rozborCislaFaktury, vzorNaRok, slozCisloFaktury } =
  await import('data:text/javascript,' + encodeURIComponent(kod +
    '\nexport { rozborCislaFaktury, vzorNaRok, slozCisloFaktury }'))

// Napodobenina appky: z čísel, které pracovník už má, spočítá další.
// Stejný postup jako dalsiCisloFaktury, jen bez databáze.
function dalsi(historie, rok) {
  if (!historie.length) return String(rok) + '01'
  const vzor = vzorNaRok(rozborCislaFaktury(historie[historie.length - 1]), rok)
  if (!vzor) return String(rok) + '01'
  let nej = 0
  historie.forEach(c => {
    const r = rozborCislaFaktury(c)
    if (!r || r.pred !== vzor.pred || r.za !== vzor.za) return
    nej = Math.max(nej, parseInt(r.poc, 10) || 0)
  })
  return slozCisloFaktury(vzor, nej + 1)
}

const PRIPADY = [
  ['nikdy nefakturoval',            [],                                 2026, '202601'],
  ['dosavadní tvar rok+pořadí',     ['202601'],                         2026, '202602'],
  ['dosavadní tvar, devátá',        ['202601','202609'],                2026, '202610'],
  ['OTOČENO: pořadí a pak rok',     ['012026'],                         2026, '022026'],
  ['otočeno, přeskočená čísla',     ['012026','072026'],                2026, '082026'],
  ['s lomítkem, pořadí napřed',     ['01/2026'],                        2026, '02/2026'],
  ['s lomítkem, rok napřed',        ['2026/01'],                        2026, '2026/02'],
  ['s pomlčkou',                    ['2026-7'],                         2026, '2026-8'],
  ['písmeno a nuly',                ['F-0042'],                         2026, 'F-0043'],
  ['jen pořadí',                    ['7'],                              2026, '8'],
  ['přetečení šířky',               ['2026/99'],                        2026, '2026/100'],
  ['tečka, pořadí napřed',          ['5.2026'],                         2026, '6.2026'],
  ['nový rok začne znovu',          ['202612'],                         2027, '202701'],
  ['nový rok u otočeného tvaru',    ['122026'],                         2027, '012027'],
  ['nový rok s lomítkem',           ['12/2026'],                        2027, '01/2027'],
  ['změna tvaru se přebere',        ['202601','202602','03/2026'],      2026, '04/2026'],
  ['starý tvar se nepočítá do nového', ['202601','202699','01/2026'],   2026, '02/2026'],
  ['delší předpona',                ['SUBBAU-2026-005'],                2026, 'SUBBAU-2026-006'],
]

let chyb = 0
for (const [popis, hist, rok, cekam] of PRIPADY) {
  const mam = dalsi(hist, rok)
  const ok = mam === cekam
  if (!ok) chyb++
  console.log(`  ${ok?'✅':'❌'} ${popis.padEnd(34)} ${JSON.stringify(hist).padEnd(34)} → ${mam}${ok?'':'   ČEKAL JSEM '+cekam}`)
}

// Číslo se nesmí nikdy zopakovat: pustíme 300 faktur po sobě.
let hist = ['2026/01']
const videl = new Set(hist)
for (let i = 0; i < 300; i++) {
  const n = dalsi(hist, 2026)
  if (videl.has(n)) { console.log('  ❌ číslo ' + n + ' padlo dvakrát'); chyb++; break }
  videl.add(n); hist.push(n)
}
console.log(`  ${chyb?'❌':'✅'} 300 faktur po sobě, žádné číslo dvakrát (poslední ${hist[hist.length-1]})`)

console.log(chyb ? `\n❌ ${chyb} chyb` : '\n✅ ČÍSLOVÁNÍ POKRAČUJE PODLE ZADANÉHO TVARU')

// KONTROLNÍ VZOREK — ať vím, že tahle zkouška umí selhat.
console.log('\n════ kontrolní vzorek: rozbité počítadlo musí zkoušku shodit ════')
const rozbite = (h, r) => { const v = vzorNaRok(rozborCislaFaktury(h[h.length-1]), r); return slozCisloFaktury(v, 1) }
const kontrola = PRIPADY.filter(p => p[1].length).some(([,h,r,c]) => rozbite(h,r) !== c)
console.log(kontrola ? '  ✅ ano, zkouška by chybu odhalila' : '  ❌ POZOR: zkouška chybu neodhalí')
