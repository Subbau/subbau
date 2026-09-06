// Vykreslí všech 9 nových vzhledů se zkušebními daty a zkontroluje,
// že v každém jsou VŠECHNY povinné údaje daňového dokladu.
import fs from 'fs'
const src = fs.readFileSync(process.argv[2] || 'subbau_final.html','utf8')
const blok = /window\.SABLONY_FAKTUR = window\.SABLONY_FAKTUR \|\| \{\};[\s\S]*?(?=\nfunction renderInvoice)/.exec(src)[0]
globalThis.window = {}
eval(blok)
const S = window.SABLONY_FAKTUR

const L = {
  title:'FAKTURA · RECHNUNG · INVOICE', invoiceNo:'Číslo · Nr. · No.',
  supplier:'Dodavatel · Lieferant · Supplier', customer:'Odběratel · Kunde · Customer',
  contactInfo:'Kontakt', dateIssue:'Datum vystavení · Ausstellungsdatum · Date of issue',
  dueDate:'Datum splatnosti · Fälligkeitsdatum · Due date',
  supplyPeriod:'Období plnění · Leistungszeitraum · Period of supply',
  paymentInfo:'Platební informace · Zahlungsinformationen · Payment Information',
  paymentMethod:'Způsob platby', bankTransfer:'Bankovním převodem',
  variable:'Variabilní symbol · Verwendungszweck · VS', constant:'Konstantní symbol · KS',
  forPayment:'K úhradě · Zu zahlen · For payment', deliveryName:'Popis plnění · Leistungsbeschreibung · Description',
  qty:'Množství · Menge · Quantity', unit:'Jedn.', unitPrice:'Jedn. cena · Einzelpreis · Unit price',
  total:'Celkem · Gesamt · Total', vatNote:'Neplátce DPH · Kein USt · Not VAT registered',
  vatRow:'DPH · USt · VAT', vatReason:'Reverse charge',
  vatReasonSub:'Přenesená daňová povinnost · Steuerschuldnerschaft des Leistungsempfängers',
  totalAmount:'Celková částka · Gesamtbetrag · Total amount',
  cashPaid:'Uhrazeno v hotovosti · Bar erhalten · Paid in cash',
  alreadyPaid:'Zálohou předem', exchangeRate:'Kurz · Kurs · Rate',
  dueDays:'Splatnost · Fällig · Due: 7 dní/Tage/days', email:'Email', phone:'Telefon',
  id:'IČO · ID-Nr. · ID', vatId:'DIČ · USt-IdNr. · VAT ID', iban:'IBAN', swift:'SWIFT', symbol:'Symbol',
}
Object.assign(L,{number:L.invoiceNo,issued:L.dateIssue,issueDate:L.dateIssue,due:L.dueDate,
  days:L.dueDays,period:L.supplyPeriod,desc:L.deliveryName,description:L.deliveryName,
  price:L.unitPrice,amount:L.total,ic:L.id,ico:L.id,dic:L.vatId,payment:L.paymentInfo,
  vs:L.variable,ks:L.constant,toPay:L.forPayment,rate:L.exchangeRate,kurz:L.exchangeRate,
  czk:'Celkem v CZK · Gesamt in CZK · Total in CZK'})

const zaklad = {
  cislo:'202614', crmKod:'X12',
  datumVystaveni:'29.08.2026', datumSplatnosti:'05.09.2026', splatnostDni:7,
  obdobiOd:'24.08.2026', obdobiDo:'30.08.2026',
  dodavatel:{jmeno:'Karol Janečka',adresa:'Nádražní 12\n370 01 České Budějovice\nČesko',
             ic:'17398096',dic:'CZ17398096',email:'k@j.cz',telefon:'+420 777 111 222',platceDph:false},
  odberatel:{jmeno:'MMi Mario Markantelli',adresa:'Eschenweg 4\n87600 Kaufbeuren\nDeutschland',
             ic:'814135650',dic:'DE814135650'},
  iban:'CZ12 0600 0000 0002 5309 9571', swift:'AGBACZPP', vs:'202614', ks:'0308',
  jePolozkova:false, polozky:[],
  hodiny:'59.50', sazba:'23.00',
  popisPlneni:'Bricklaying work', popisPrekl:'Zednické práce', popisPod:'KW 35/2026', popisFont:'10pt',
  celkem:'1368.50', zaloha:'0.00', zalohaJe:false, zalohaPozn:'',
  kUhrade:'1368.50', czk:'33131,39', kurz:'24.21 CZK / 1 EUR',
  barva:'#9c3b22', podklad:'rgba(156,59,34,0.07)', linka:'rgba(156,59,34,0.35)', L,
}
const polozkova = {...zaklad, jePolozkova:true, polozky:[
  {popis:'Zdění příček',mnozstvi:'40',cena:'23.00',castka:'920.00'},
  {popis:'Úklid stavby',mnozstvi:'19.5',cena:'23.00',castka:'448.50'}]}
const seZalohou = {...zaklad, zalohaJe:true, zaloha:'300.00', kUhrade:'1068.50',
                   zalohaPozn:'vyplaceno 20.08.2026'}
const platce = {...zaklad, dodavatel:{...zaklad.dodavatel, platceDph:true},
                L:{...L, vatNote:'Plátce DPH · USt-pflichtig · VAT payer'}}

// Hustota sazby — appka ji počítá v renderInvoice podle toho, kolik toho na
// faktuře je. Bez ní by šablony dosadily undefined do rozměrů a faktura by se
// rozsypala, aniž by na ní chyběl jediný údaj.
function sHustotou(V) {
  const p = V.jePolozkova ? (V.polozky || []) : []
  const napln = V.jePolozkova
    ? p.reduce((s, x) => s + 1 + Math.floor(String(x.popis || '').length / 55), 0) : 1
  const st = napln >= 14 ? 3 : napln >= 7 ? 2 : napln >= 4 ? 1 : 0
  return { ...V,
    radekY: ['13px','7px','3px','2px'][st],
    pismoPolozky: ['12.5px','11px','9.5px','8.5px'][st],
    mezera: ['26px','16px','7px','5px'][st],
    husto: st > 0 }
}

const POVINNE = [
  ['nadpis', v=>v.L.title],['číslo faktury', v=>v.cislo],
  ['dodavatel', v=>v.dodavatel.jmeno],['IČO dodavatele', v=>v.dodavatel.ic],
  ['odběratel', v=>v.odberatel.jmeno],['IČO odběratele', v=>v.odberatel.ic],
  ['DIČ odběratele', v=>v.odberatel.dic],
  ['datum vystavení', v=>v.datumVystaveni],['datum splatnosti', v=>v.datumSplatnosti],
  ['období od', v=>v.obdobiOd],['období do', v=>v.obdobiDo],
  ['IBAN', v=>v.iban],['SWIFT', v=>v.swift],['VS', v=>v.vs],['KS', v=>v.ks],
  ['celkem', v=>v.celkem],['k úhradě', v=>v.kUhrade],
  ['CZK', v=>v.czk],['kurz', v=>v.kurz],
  ['reverse charge', v=>v.L.vatReason],['poznámka k DPH', v=>v.L.vatNote],
]
let chyb = 0
for (const n of [2,3,4,5,6,7,8,9,10]) {
  const f = S[n]
  if (!f) { console.log(`  ❌ vzhled ${n}: chybí`); chyb++; continue }
  let potize = []
  for (const [jm, syrove] of [['běžná',zaklad],['položková',polozkova],['se zálohou',seZalohou],['plátce DPH',platce]]) {
    const V = sHustotou(syrove)
    let h
    try { h = f(V) } catch(e){ potize.push(`${jm}: SPADLO ${e.message}`); continue }
    if (/undefined|NaN|\[object Object\]/.test(h)) potize.push(`${jm}: v HTML je undefined/NaN`)
    if (!h.includes('id="invoice-page"')) potize.push(`${jm}: chybí invoice-page`)
    if (!h.includes('id="invoice-body"')) potize.push(`${jm}: chybí invoice-body`)
    for (const [popis, ber] of POVINNE) {
      const hodnota = ber(V)
      if (hodnota && !h.includes(String(hodnota))) potize.push(`${jm}: chybí ${popis}`)
    }
    if (V.zalohaJe && !h.includes(V.zaloha)) potize.push(`${jm}: chybí záloha`)
    if (V.jePolozkova && !h.includes('920.00')) potize.push(`${jm}: chybí položka`)
  }
  if (potize.length) { chyb++; console.log(`  ❌ vzhled ${n}: ${potize.slice(0,3).join(' | ')}`) }
  else console.log(`  ✅ vzhled ${n}  (${Math.round(f(zaklad).length/1024)} kB HTML)`)
}
console.log(chyb ? `\n❌ ${chyb} vzhledů má potíže` : '\n✅ VŠECH 9 VZHLEDŮ JE V POŘÁDKU')
process.exit(chyb?1:0)
