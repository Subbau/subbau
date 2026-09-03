// Seznam skutečných údajů, které jsou v appce natvrdo a v ukázce nemají co dělat.
// Ukázku dostanou cizí stavební firmy — nesmí v ní být ani telefon, ani jméno
// odběratele, ani jeho DIČ.
//
// Kdyby v appce nějaký údaj přibyl, přidá se sem. Generátor pak ověří, že
// v hotové ukázce už žádný z nich není, a když ano, soubor nevyrobí.
//
// PSÁT SEM I KRÁTKÉ TVARY. Jména se v kódu objevují i v komentářích a
// v příkladech, kde je jen příjmení — kontrola na celý název by je minula.
// Delší tvary musí být v seznamu PŘED kratšími, ať výměna dá smysluplný text.
export const OSOBNI_UDAJE = [
  // jméno / číslo / adresa               →  co místo toho
  ['Bibiana Kissová',                        'Eva Nováková'],
  ['Jan Švamberk',                           'Josef Malý'],
  ['Patrik Vrchlavský',                      'Karel Zeman'],
  ['+420 608 884 873',                       '+420 777 111 222'],
  ['+420702518163',                          '+420777333444'],
  ['+420 702 518 163',                       '+420 777 333 444'],
  ['+420608884873',                          '+420777111222'],
  ['+49 151 456 224 66',                     '+49 151 000 000 00'],
  ['+4915145622466',                         '+4915100000000'],
  // německý odběratel — jméno, adresa, IČO i DIČ
  ['Treskower Zimmermann und Dachdecker GmbH', 'Bauunternehmen Hoffmann GmbH'],
  ['Ahornallee 9',                           'Musterstraße 1'],
  ['16818 Märkisch Linden/ OT Werder',        '80331 München'],
  ['DE198456703',                            'DE000000000'],
  ['198456703',                              '000000000'],
  // Samotné příjmení odběratele — je i v komentářích v kódu. Hlídá se
  // krátký tvar schválně: kdyby se hlídal jen celý název, zbytek by prošel.
  ['Treskower',                              'Hoffmann'],
  ['Märkisch Linden',                        'München'],
  // e-maily
  ['faktury@subbau.cz',                      'faktury@ukazka.cz'],
  ['info@subbau.cz',                         'info@ukazka.cz'],
];
