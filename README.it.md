# MoAH

MoAH è un fork snello di **Pi Agent**. Il loop agente, lo streaming, le
sessioni, i provider e il login restano quelli di Pi. MoAH aggiunge un solo
strato: un router API sceglie quali tool opzionali attivare per ogni messaggio
utente.

Niente embedding locali, ricerca semantica, crawler di pacchetti pubblici o
orchestrazione di processi worker. Le estensioni ufficiali restano su disco; il
router riceve solo descrizioni sintetiche dei tool, non i system prompt o le
istruzioni del loop agente.

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
