# MoAH v1 — Baseline pre-ottimizzazione

## TL;DR

MoAH è un harness di coding autonomo derivato da Pi, con router API
automatico e residenza sparsa dei pacchetti su disco.

Nella baseline pre-ottimizzazione:

```text
Pi Vanilla
fresh tokens:     1.00x
processed tokens: 1.00x
E2E:              ~4.9 s

MoAH Streamed Prefetch
fresh tokens:     1.44x Pi
processed tokens: 1.30x Pi
E2E:              ~6.1 s

OpenCode
fresh tokens:     3.64x Pi
processed tokens: 6.96x Pi
E2E:              ~11.2 s
```

MoAH risparmia rispetto a OpenCode:

```text
~60% fresh tokens
~81% processed tokens
```

pagando rispetto a Pi:

```text
~44% fresh tokens
~30% processed tokens
```

Il vantaggio principale non è “essere più veloce di Pi”, ma:

1. automatizzare la selezione dei tool;
2. non mettere tutti i tool nel contesto del modello principale;
3. mantenere la maggior parte dell’efficienza di Pi;
4. aggiungere residenza dinamica e cache calda per i pacchetti opzionali.

---

## 1. Cosa fa MoAH automaticamente

Flusso reale:

```text
prompt utente
  -> router API
  -> selezione automatica dei tool utili
  -> attivazione degli schemi selezionati
  -> prefetch asincrono dei pacchetti streamable
  -> generazione del modello principale
  -> eventuale esecuzione nel worker
  -> risposta finale
```

Il router API è una chiamata separata e leggera. Il suo costo è incluso in
tutti i numeri MoAH.

Il modello principale non riceve mai:

```text
tutto il catalogo dei tool
il codice interno dei pacchetti
le istruzioni interne degli extension
```

Riceve solo:

```text
istruzioni di sistema
prompt utente
schemi dei tool attivi
storico necessario
```

---

## 2. Architettura validata

### Contesto e residenza sono separati

```text
KNOWN TO ROUTER
LOADED IN MEMORY
ACTIVE IN MODEL CONTEXT
EXECUTING
```

Un tool può essere:

```text
noto al router ma non residente
residente ma non attivo nel contesto
attivo nel contesto e residente
in esecuzione
```

Deselezionare uno schema dal contesto **non** elimina subito il worker dalla
RAM.

### Gerarchia di memoria

```text
Tier A — sempre residente
  runtime MoAH, core tools, estensioni native necessarie, metadata compatti

Tier B — worker cache calda
  uno o più processi child per pacchetti streamable

Tier C — filesystem/SSD
  pacchetti installati ma non residenti

Tier D — contesto del modello
  solo gli schemi selezionati per il turno
```

### Residenza dinamica

```text
COLD
  -> prefetch/demand
LOADING
  -> RESIDENT_SELECTED
  -> RESIDENT_IDLE
  -> EVICTING
  -> COLD
```

Il worker è il confine fisico di unload. Chiudere il processo libera il
pacchetto. La cache è limitata da:

```text
maxProcesses
residentBudgetMb
idleTtlMs
```

---

## 3. Classificazione dei pacchetti ufficiali

```text
EXACT_STREAMABLE
  hello.ts

EXECUTION_STREAMABLE_WITH_GENERIC_RENDERING
  structured-output.ts

CONTEXT_ADAPTER_STREAMABLE
  truncated-tool.ts / rg

NATIVE_REQUIRED
  question, questionnaire, todo, subagent, reload-runtime, sandbox,
  gondolin, ssh, hook/policy/resource extensions
```

La regola di sicurezza non è stata indebolita per migliorare i benchmark.

---

## 4. Primo request del modello principale

Attribuzione misurata:

| componente | Pi | MoAH | OpenCode |
|---|---:|---:|---:|
| tools esposti | 5 | 7 | 11 |
| system bytes | 2717 | 2665 | 12652 |
| user/history bytes | 122 | 122 | 126 |
| tool-schema bytes | 3124 | 5688 | 21913 |
| provider input | ~1165 | ~1558 | ~4937 |

Perché OpenCode è più grande di MoAH:

```text
~62% tool schemas
~38% system/harness instructions
```

Perché MoAH è più grande di Pi:

```text
principalmente tool schemas aggiuntivi
```

Il router è una chiamata separata, non è dentro il primo request del modello
principale.

---

## 5. Benchmark finale

### Sistemi

```text
A Pi Vanilla
D MoAH Streamed Prefetch
E OpenCode
```

### Task

```text
bugfix      5 trial
feature     5 trial
repository  3 trial
search      3 trial
multifile   3 trial
```

Totale:

```text
57 run
modello: openrouter/openai/gpt-4o-mini
```

### Risultati principali per task

#### Bugfix

| harness | successo | fresh median | processed median | E2E median |
|---|---:|---:|---:|---:|
| Pi | 5/5 | 1568 | 5024 | 4.949 s |
| MoAH | 5/5 | 2247 | 6577 | 6.334 s |
| OpenCode | 5/5 | 5569 | 35237 | 11.162 s |

#### Feature

| harness | successo | fresh median | processed median | E2E median |
|---|---:|---:|---:|---:|
| Pi | 5/5 | 1823 | 5076 | 4.632 s |
| MoAH | 5/5 | 2222 | 6668 | 6.121 s |
| OpenCode | 5/5 | 6092 | 42956 | 12.969 s |

#### Repository

| harness | successo | fresh median | processed median | E2E median |
|---|---:|---:|---:|---:|
| Pi | 2/3 | 12294* | 26562* | 57.9 s* |
| MoAH | 3/3 | 2284 | 5337 | 4.961 s |
| OpenCode | 1/3 | 5895 | 49031 | 9.990 s |

`*` Pi ha avuto un singolo run anomalo molto costoso.

#### Search

| harness | successo | fresh median | processed median | E2E median |
|---|---:|---:|---:|---:|
| Pi | 2/3 | 1471 | 3775 | 3.794 s |
| MoAH | 2/3 | 2745 | 6123 | 4.929 s |
| OpenCode | 2/3 | 5488 | 27952 | 7.638 s |

#### Multifile

| harness | successo | fresh median | processed median | E2E median |
|---|---:|---:|---:|---:|
| Pi | 3/3 | 1533 | 6269 | 5.388 s |
| MoAH | 3/3 | 2391 | 7587 | 6.426 s |
| OpenCode | 3/3 | 5471 | 35161 | 11.167 s |

### Aggregato sui run riusciti

| harness | successo | fresh median | processed median | E2E median |
|---|---:|---:|---:|---:|
| Pi | 17/19 | ~1572 | ~5060 | ~4.9 s |
| MoAH | 17/19 | ~2266 | ~6577 | ~6.1 s |
| OpenCode | 14/19 | ~5726 | ~35237 | ~11.2 s |

---

## 6. Interpretazione

Il risultato atteso è:

```text
Pi
  -> minimo riferimento

MoAH
  -> overhead modesto
  -> mantiene gran parte dell’efficienza di Pi
  -> aggiunge routing automatico e residenza dinamica

OpenCode
  -> harness maturo più grande
  -> contesto e replay molto maggiori
```

La misura supporta questa lettura, ma con varianza elevata su repository e
search.

Il beneficio più robusto è la **riduzione di contesto/token**, non la latenza.

---

## 7. Punti di forza rispetto alla selezione manuale

Con MoAH il developer non deve:

```text
leggere il catalogo
ricordare i nomi esatti dei tool
attivare manualmente gli schemi
decidere ogni volta quali extension servono
```

Il router lo fa automaticamente a ogni messaggio.

Questo evita:

```text
tutti i tool nel contesto
cataloghi giganti dentro il prompt
tool opzionali attivi anche quando inutili
```

E continua a risparmiare anche nelle sessioni successive: gli schemi
selezionati rimangono pochi e i pacchetti streamable già caricati possono
essere riusati dalla cache calda.

---

## 8. Limiti attuali

1. **Tool ufficiali streamable ancora pochi.**
   La classificazione è corretta, ma il beneficio di residenza dinamica è
   limitato con il catalogo attuale.

2. **Worker base ancora pesante.**
   Il processo child e l’import TypeScript costano più del codice del singolo
   pacchetto.

3. **Router aggiunge una chiamata.**
   Su task corti l’overhead del router è visibile rispetto a Pi.

4. **Varianza alta su task aperti.**
   Repository/search hanno mostrato traiettorie molto diverse.

5. **OpenCode non è stato modificato.**
   Il confronto è realistico, ma il suo payload esatto dipende dalla versione
   installata.

6. **RAM non è il focus principale di questa baseline.**
   L’efficienza token/contesto è il risultato primario.

7. **Multi-turn continuo non è incluso in questa baseline.**
   Va eseguito come conferma separata.

---

## 9. Prossime fasi

### Prima di ottimizzare

```text
1. confermare multi-turn
2. misurare RAM process-tree nelle tre condizioni
3. aggiungere package streamable ufficiali veri
4. ridurre il bootstrap del worker solo dopo aver misurato
5. migliorare la contabilità dei costi provider
```

### Ottimizzazioni candidate, non ancora eseguite

```text
worker runtime minimo MoAH-owned
meno SDK importato nel worker
prefetch più selettivo
cache policy semplice ma più osservabile
```

Nessuna di queste è stata applicata in questa baseline.

---

## 10. Claim pubblici

```text
ROBUST
- MoAH usa meno fresh token di OpenCode.
- MoAH processa molto meno contesto/cache di OpenCode.
- MoAH resta più vicino a Pi che a OpenCode nell’uso dei token.

PROMISING BUT NEEDS MORE DATA
- MoAH ha efficienza token vicina a Pi.
- MoAH è più veloce di OpenCode.
- MoAH preserva esattamente il success rate.

NOT SUPPORTED
- La sola spiegazione è la sparsità dei tool.
- MoAH non aggiunge overhead rispetto a Pi.
- Il vantaggio è identico su ogni task.
```

---

## 11. Conclusione architetturale

```text
MoAH v1 è un harness standalone derivato da Pi.

Non è più un wrapper/estensione di Pi.

Il router automatico evita di esporre tutti i tool.

La residenza dinamica permette di tenere i pacchetti su disco
e caricarli solo quando servono.

Il costo rispetto a Pi è misurabile.

Il risparmio rispetto a OpenCode è misurabile e robusto sui task
deterministici testati.
```

Questa baseline congela i risultati pre-ottimizzazione.
