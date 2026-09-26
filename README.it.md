# MoAH

MoAH è un **harness autonomo derivato da Pi Agent**, con un router API che
sceglie quali tool opzionali attivare per ogni messaggio utente. Il runtime
agente è incluso nel pacchetto: il comando `moah` avvia direttamente MoAH.

[Sito e metodi di installazione](https://francescoopiccolo.github.io/moah-website/)

Le estensioni ufficiali restano su disco; il router riceve solo descrizioni
sintetiche dei tool, non i system prompt o le istruzioni del loop agente. I
pacchetti stateless opzionali possono essere caricati in worker temporanei
quando il router li seleziona.

Vedi [REPORT.md](REPORT.md) per il confronto attuale con Pi e OpenCode.

## Flusso

```text
messaggio utente
   -> MoAH costruisce una lista compatta dai tool registrati in Pi
   -> un modello API restituisce una lista JSON di nomi tool
   -> Pi attiva tool base + tool scelti
   -> il modello principale risponde normalmente in streaming
```

`router.mode`:

- `auto`: MoAH applica da solo la scelta del router.
- `suggest`: MoAH aggiunge solo un suggerimento al messaggio e lascia i tool
  invariati; il modello può chiamare `moah_select` se serve.

## Installazione e avvio

Requisiti: Node >= 22.19 e npm. Il runtime derivato da Pi è già incluso in
MoAH e non deve essere installato o avviato separatamente.

```sh
npm install -g moah-ai
```

Con altri package manager:

```sh
pnpm add -g moah-ai@0.1.3
bun add -g moah-ai
```

Tutti i metodi richiedono Node.js >=22.19. Se pnpm non ha ancora configurato
la cartella dei comandi globali, esegui `pnpm setup` e apri un nuovo terminale.
Sul [sito](https://francescoopiccolo.github.io/moah-website/) trovi anche gli
installer PowerShell (Windows) e curl (macOS/Linux): richiedono Node.js e npm
già installati, usano una cartella personale e configurano il PATH dell'utente.
Codice degli installer e verifiche sono nella
[repo separata del sito](https://github.com/francescoopiccolo/moah-website).

Nel progetto su cui lavorare:

```sh
cd /percorso/del/progetto
moah
```

Al primo avvio MoAH chiede provider e modello di coding, API key e modello del
router. Le API key inserite vengono salvate in `~/.moah/credentials.json` e non
nel progetto. Configurazione, indicizzazione e avvio avvengono automaticamente.

## Configurazione

```json
{
  "baseline": { "enabled": true },
  "router": {
    "enabled": true,
    "mode": "auto",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "apiKeyEnv": "MOAH_ROUTER_API_KEY",
    "maxTools": 6,
    "baseTools": ["read", "bash", "powershell", "edit", "write"]
  },
  "packages": []
}
```

I `baseTools` restano attivi quando Pi li espone. I tool opzionali vengono
scoperti da `getAllTools()` di Pi: un pacchetto Pi nativo installato può essere
gestito allo stesso modo, una volta caricato da Pi.

## Tool di default

Tool base sempre attivi:

```text
read
bash
powershell
edit
write
```

Tool opzionali ufficiali disponibili al router:

```text
grep
find
ls
subagent
todo
question
questionnaire
structured_output
rg
reload_runtime
```

## Confronto attuale

| profilo | successo | latenza | costo |
|---|---:|---:|---:|
| pi-default | 100% | 8.18s | $0.00010 |
| pi-full | 97.5% | 8.61s | $0.00020 |
| moah-auto | 100% | 10.60s | $0.00021 |
| moah-suggest | 100% | 11.90s | $0.00020 |
| moah-oracle | 100% | 8.95s | $0.00012 |
| opencode | 76.9% | 10.28s | $0.00183 |

Vedi [REPORT.md](REPORT.md) per dettagli e limiti.

## Controlli dentro Pi

- `/moah` — stato, tool attivi e ultima decisione del router.
- `/moah dense` — espone tutti i tool opzionali.
- `/moah sparse` — rilascia tutti i tool opzionali.
- `moah_select({"tools": [...]})` — selezione/deselezione manuale nella
  conversazione.

## Comandi

```sh
moah
moah setup
moah init
moah index
moah route "Cerca sul web"
moah doctor
moah catalog
moah bench benchmarks/lean-smoke.json --dry-run
moah bench benchmarks/lean-smoke.json
moah pi
moah dense
```

`moah dense` avvia Pi originale con tutti i pacchetti disponibili in modo
nativo; in quella modalità il routing MoAH non è attivo.
