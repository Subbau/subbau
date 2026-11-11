// Minimální SMTP klient bez závislostí (repozitář nemá package.json) — pro odesílání
// faktur z firemního mailboxu (Wedos). Podporuje implicitní TLS (port 465) i STARTTLS
// (port 587), přihlášení AUTH PLAIN / LOGIN a přílohy. CommonJS.
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const hlavicka = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
const adresa = (v) => { const m = String(v ?? '').match(/<([^<>\s]+@[^<>\s]+)>/); return hlavicka(m ? m[1] : v); };
const jeEmail = (v) => /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(String(v ?? '').trim());
const b64radky = (buf) => Buffer.from(buf).toString('base64').replace(/(.{76})/g, '$1\r\n');
// Hlavička s diakritikou: =?UTF-8?B?…?=
const kodujHlavicku = (v) => /^[\x20-\x7e]*$/.test(v) ? v : '=?UTF-8?B?' + Buffer.from(v, 'utf8').toString('base64') + '?=';

function sestavZpravu({ od, odJmeno, komu, predmet, text, priloha, odpoved, domena }) {
  const hranice = '=_sb_' + crypto.randomBytes(12).toString('hex');
  const h = [
    'From: ' + (odJmeno ? kodujHlavicku(hlavicka(odJmeno)) + ' <' + adresa(od) + '>' : adresa(od)),
    'To: ' + adresa(komu),
    'Subject: ' + kodujHlavicku(hlavicka(predmet)),
    'Date: ' + new Date().toUTCString().replace('GMT', '+0000'),
    'Message-ID: <' + crypto.randomBytes(12).toString('hex') + '@' + (domena || 'subbau.local') + '>',
    'MIME-Version: 1.0',
  ];
  if (odpoved && jeEmail(odpoved)) h.push('Reply-To: ' + adresa(odpoved));
  h.push('Content-Type: multipart/mixed; boundary="' + hranice + '"');
  let t = h.join('\r\n') + '\r\n\r\n';
  t += '--' + hranice + '\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64radky(Buffer.from(String(text || ''), 'utf8')) + '\r\n';
  if (priloha && priloha.obsah) {
    const nazev = hlavicka(priloha.nazev || 'faktura.pdf').replace(/["\\]/g, '_');
    t += '--' + hranice + '\r\nContent-Type: application/pdf; name="' + nazev + '"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="' + nazev + '"\r\n\r\n' + b64radky(priloha.obsah) + '\r\n';
  }
  t += '--' + hranice + '--\r\n';
  return t;
}

// Pošle jednu zprávu. Vyhodí Error s popisem kroku, kde to selhalo (bez hesla).
function posliSmtp(nastaveni, zprava) {
  const { host, port, user, pass, od, komu, kopie } = nastaveni;
  const implicitni = nastaveni.implicitniTls != null ? !!nastaveni.implicitniTls : port === 465;
  return new Promise((resolve, reject) => {
    let sock = null, buf = '', hotovo = false, cekajici = null;
    const konec = (err) => { if (hotovo) return; hotovo = true; clearTimeout(casovac); try { sock && sock.destroy() } catch (e) {} err ? reject(err) : resolve(true) };
    const casovac = setTimeout(() => konec(new Error('SMTP: vypršel čas (30 s)')), 30000);
    const naData = (d) => {
      buf += d.toString('utf8');
      for (;;) {
        const radky = buf.split('\r\n');
        // odpověď je hotová, když poslední úplný řádek nemá za kódem pomlčku
        let i = -1;
        for (let k = 0; k < radky.length - 1; k++) { if (/^\d{3} /.test(radky[k]) || /^\d{3}$/.test(radky[k])) { i = k; break } }
        if (i < 0) return;
        const odpoved = radky.slice(0, i + 1);
        buf = radky.slice(i + 1).join('\r\n');
        const kod = Number(odpoved[i].slice(0, 3));
        const c = cekajici; cekajici = null
        if (c) c({ kod, text: odpoved.join('\n') });
      }
    };
    const cti = () => new Promise((res) => { cekajici = res; naData(Buffer.alloc(0)) });
    const posli = (s) => sock.write(s + '\r\n');
    const krok = async (prikaz, ocekavane, popis) => {
      if (prikaz != null) posli(prikaz);
      const o = await cti();
      if (!ocekavane.includes(o.kod)) throw new Error('SMTP ' + popis + ': ' + o.text.slice(0, 160));
      return o;
    };
    const bezi = async () => {
      let o = await cti();
      if (o.kod !== 220) throw new Error('SMTP uvítání: ' + o.text.slice(0, 160));
      let ehlo = await krok('EHLO subbau.cz', [250], 'EHLO');
      if (!implicitni && /STARTTLS/i.test(ehlo.text)) {
        await krok('STARTTLS', [220], 'STARTTLS');
        sock.removeAllListeners('data');
        sock = tls.connect({ socket: sock, host, servername: host });
        sock.on('data', naData); sock.on('error', konec);
        await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej) });
        ehlo = await krok('EHLO subbau.cz', [250], 'EHLO po STARTTLS');
      } else if (!implicitni && !nastaveni.dovolBezTls) {
        throw new Error('SMTP: server nenabízí šifrování (STARTTLS) — heslo se neposílá');
      }
      if (user) {
        if (/AUTH[^\n]*PLAIN/i.test(ehlo.text)) {
          await krok('AUTH PLAIN ' + Buffer.from('\0' + user + '\0' + pass, 'utf8').toString('base64'), [235], 'přihlášení');
        } else {
          await krok('AUTH LOGIN', [334], 'AUTH LOGIN');
          await krok(Buffer.from(user, 'utf8').toString('base64'), [334], 'uživatel');
          await krok(Buffer.from(pass, 'utf8').toString('base64'), [235], 'přihlášení');
        }
      }
      await krok('MAIL FROM:<' + adresa(od) + '>', [250], 'MAIL FROM');
      await krok('RCPT TO:<' + adresa(komu) + '>', [250, 251], 'příjemce');
      if (kopie && jeEmail(kopie)) await krok('RCPT TO:<' + adresa(kopie) + '>', [250, 251], 'kopie');
      await krok('DATA', [354], 'DATA');
      // tečka na začátku řádku se zdvojí; konec zprávy je <CRLF>.<CRLF>
      sock.write(zprava.replace(/^\./gm, '..') + (zprava.endsWith('\r\n') ? '' : '\r\n') + '.\r\n');
      await krok(null, [250], 'odeslání');
      try { posli('QUIT') } catch (e) {}
    };
    const pripoj = () => {
      if (implicitni) { sock = tls.connect({ host, port, servername: host }); sock.once('secureConnect', () => bezi().then(() => konec(null), konec)) }
      else { sock = net.connect({ host, port }); sock.once('connect', () => bezi().then(() => konec(null), konec)) }
      sock.on('data', naData); sock.on('error', konec);
    };
    try { pripoj() } catch (e) { konec(e) }
  });
}

module.exports = { posliSmtp, sestavZpravu, jeEmail };
