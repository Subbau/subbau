#!/usr/bin/env python3
# Ověří, že každá funkce volaná z HTML atributu (onclick=, onchange=, …) v kódu
# opravdu existuje. ESLint je nevidí — HTML atributy nejsou JavaScript. Přesně
# tady se appka třikrát rozbila až u uživatelů: funkce se přejmenovala,
# tlačítko zůstalo.
#
#   python3 handlery.py <soubor.html> <vytazeny-kod.js>
import re, io, sys

if len(sys.argv) < 3:
    sys.stderr.write('použití: handlery.py soubor.html appka.js\n'); sys.exit(2)

html = io.open(sys.argv[1], encoding='utf-8', errors='replace').read().replace('\r', '')
kod = io.open(sys.argv[2], encoding='utf-8', errors='replace').read()

definovane = set()
for vzor in (r'\bfunction\s+([A-Za-z_$][\w$]*)',
             r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=',
             r'window\.([A-Za-z_$][\w$]*)\s*='):
    definovane.update(re.findall(vzor, kod))

VESTAVENE = {
    'alert', 'confirm', 'prompt', 'print', 'open', 'close', 'focus', 'blur',
    'setTimeout', 'setInterval', 'requestAnimationFrame', 'fetch',
    'encodeURIComponent', 'decodeURIComponent', 'parseInt', 'parseFloat',
    'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date',
    'event', 'this', 'window', 'document', 'console', 'navigator', 'location',
    'history', 'localStorage', 'sessionStorage', 'return', 'true', 'false', 'null',
}
KLICOVA = {
    'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'delete',
    'void', 'in', 'of', 'do', 'else', 'function', 'await', 'yield', 'instanceof',
}

atributy = re.findall(r'\son[a-z]+\s*=\s*(?:"([^"]*)"|\'([^\']*)\')', html, re.I)
atributy = [a or b for a, b in atributy]

chybi = {}
volani_celkem = 0
for kus in atributy:
    for jmeno in re.findall(r'(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(', kus):
        if jmeno in KLICOVA:
            continue
        volani_celkem += 1
        if jmeno in VESTAVENE or jmeno in definovane:
            continue
        chybi.setdefault(jmeno, 0)
        chybi[jmeno] += 1

if chybi:
    print('❌ HTML volá funkce, které v kódu nejsou (%d):' % len(chybi))
    for jmeno, kolik in sorted(chybi.items()):
        print('   %s()  — %dx' % (jmeno, kolik))
    sys.exit(1)

print('   handlerů z HTML: %d atributů, %d volání — všechna míří na existující funkci'
      % (len(atributy), volani_celkem))
