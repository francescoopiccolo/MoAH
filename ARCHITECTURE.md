# Architettura

## Punti fermi

1. Pi resta il runtime e il loop agente.
2. MoAH carica i tool core Pi e le estensioni ufficiali `tool-bearing`.
3. A ogni messaggio utente, MoAH passa al router API il catalogo completo
   compresso: nome e descrizione sintetica.
4. Il router restituisce `{"tools":[...]}`.
5. MoAH applica la selezione con `pi.setActiveTools()`; Pi espone solo gli
   schemi attivi al modello principale.

Non esistono più embedding locali, ricerca semantica, catalogo pubblico,
processi worker o profili nativi ricaricati.

## Moduli

- `src/router.ts` — router API OpenAI-compatible, output JSON.
- `src/capabilities.ts` — controllo `moah_select`, validazione e descrizioni.
- `src/catalog.ts` — verifica del corpus locale e argomenti `-e`.
- `src/corpus.ts` — manifest ufficiale e set residente sicuro.
- `src/pi-extension.ts` — hook `input`, `session_start`, `/moah`, `moah_select`.

## Selezione e deselezione

La selezione è sostitutiva: `baseTools + optional`. Il tool `moah_select`
permette al modello di cambiare il set durante la conversazione. `router.mode`
può rendere la selezione automatica (`auto`) o solo suggerita (`suggest`).
