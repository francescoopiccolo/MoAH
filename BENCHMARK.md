# Confronto eseguibile con OpenRouter

Per iniziare è configurato `qwen/qwen3-coder-next`: un modello orientato al coding e all'uso di tool, con costi contenuti per ripetere esperimenti. Il 14 settembre 2026 OpenRouter riportava prezzi a partire da **$0,12/M token input e $0,80/M output**; provider e prezzi possono cambiare. [Pagina ufficiale](https://openrouter.ai/qwen/qwen3-coder-next).

## Avvio

```powershell
# Mostra modello, numero di prove e timeout; nessuna chiamata LLM
.\scripts\run.ps1 bench benchmarks/smoke.json --dry-run

# Avvia le nove prove; chiede la chiave localmente se manca
.\scripts\openrouter.ps1 bench

# Usa lo stesso modello in Pi interattivo
.\scripts\openrouter.ps1
```

La chiave viene chiesta con input nascosto nel terminale, mantenuta nell'ambiente del processo per l'esecuzione e poi rimossa/ripristinata. Non va incollata nella chat o nella configurazione MoAH. Se esiste già `OPENROUTER_API_KEY`, il launcher la usa. Le credenziali gestite da Pi possono essere usate lanciando direttamente `run.ps1 bench ...`.

Ogni prova può effettuare più chiamate al modello. Il timeout di 120 secondi limita la durata del processo, non costituisce un tetto monetario; un limite di credito sulla chiave OpenRouter può delimitare la spesa. Il runner non effettua richieste se Pi non trova credenziali per il provider.

## Cosa confronta

| Modalità | Schemi | Esecuzione dei pacchetti |
| --- | --- | --- |
| native | Comportamento originale di Pi | Tutti nativi |
| resident | Catalogo e selezione MoAH | Tutti nativi, tool compatibili selezionabili |
| streaming | Stessa selezione MoAH | Worker per pacchetti compatibili, altri nativi |

Il modello principale è identico. E5 è disabilitato in queste prove per isolare la selezione del modello principale. I pacchetti nativi che richiedono contesto permanente restano tali in tutte le condizioni. Ogni prova parte da una cartella separata con gli stessi file iniziali; l'ordine delle modalità ruota fra i task. Il runner usa il vero CLI Pi e verifica il risultato con un processo Node indipendente.

La suite iniziale contiene tre task: correggere una somma, implementare una deduplicazione e svolgere una ricerca sulla documentazione Pi seguita da una modifica di codice. Alcuni task hanno prompt successivi nella stessa esecuzione. I controlli verificano il codice prodotto; quello di ricerca controlla la presenza dei riferimenti richiesti, non l'accuratezza semantica completa del report.

## Risultati

Ogni esecuzione crea `.moah/benchmark-runs/run-*/results.json` e conserva workspace, suite, eventi Pi e stderr. Sono registrati:

- esito delle verifiche, errori del modello, timeout e codice di uscita;
- token input/output e cache riportati da Pi, costo stimato dal suo catalogo;
- durata totale del processo, tool chiamati, attivazioni, caricamenti ed eviction.

I valori mancanti sono `null`, non risparmi pari a zero. I messaggi riepilogativi non duplicano il conteggio usage. Il costo stimato non è la fattura OpenRouter: eventuali differenze di provider, cache e tariffe vanno confrontate con l'usage effettivo del servizio. Un fallimento restituisce codice CLI 1 e conserva i risultati delle prove.

Questi log sperimentali includono prompt e risultati dei tool, diversamente dai trace MoAH ordinari che contengono metadata. I processi e le cartelle separate non sono una sandbox; la configurazione globale Pi è ereditata.

## Stato e completamento sperimentale

La pipeline è verificata con un provider locale controllato e il primo benchmark OpenRouter è stato eseguito: **sette prove riuscite e due timeout**. Costi verificati, risultati e difetto corretto sono in [BENCHMARK-RESULTS.md](BENCHMARK-RESULTS.md). Le nove prove iniziali sono uno smoke test, non evidenza statistica di un vantaggio.

Una suite può specificare `modes: ["native", "resident"]` per completare solo condizioni mancanti in una nuova esecuzione. I risultati originali rimangono conservati. Per verificare i costi con una chiave nell'ambiente, eseguire `node --import tsx scripts/audit-openrouter.ts .moah/benchmark-runs/run-...`: legge solo metadata delle generazioni presenti nei log e produce `openrouter-usage.json`.

Per una conclusione attendibile occorre poi ripetere task rappresentativi dei pacchetti utilizzati, aumentare le ripetizioni, controllare provider effettivo e cache, e confrontare prima la qualità e poi costo e latenza. Non serve installare arbitrariamente altri pacchetti per completare la compatibilità: servono casi che esercitino quelli pertinenti all'uso reale.

`totalProcessPeakRss` e `physicalSsdReadBytes` restano esplicitamente `null`: il runner non misura un picco RSS esatto né le letture fisiche del dispositivo. Il nuovo campionamento dell'albero è descritto sotto. Per attribuire un vantaggio allo streaming SSD servono contatori di sistema e distinzione fra cache fredda e calda. I vantaggi osservati nella seconda iterazione valgono per i casi provati, non per qualsiasi catalogo o workload.

## Confronti successivi e memoria campionata

Nuove suite reali del 15 settembre: `benchmarks/rich-real.json` (Qwen, 12 prove), `benchmarks/rich-gemini-real.json` (Gemini, 6 prove), `benchmarks/intermediate-real.json` (Qwen con solo pacchetto web, 6 prove). Tutte usano due nuovi task e le tre modalità. `observeProvider` registra dimensioni e hash degli schemi per richiesta, e il runner conserva usage per risposta. `configFile` seleziona un profilo separato senza sostituire la configurazione dell'utente. I verificatori vengono controllati sintatticamente prima delle chiamate al modello.

`bench-controlled --config benchmarks/profiles/rich.json` ripete il confronto controllato sul profilo più ricco. Rimane un esperimento separato dalle prove reali. Il catalogo pubblico completo viene conservato nelle workspace e non viene confuso con il numero di pacchetti installati. Per metodo, copertura e misura del tempo umano vedere [WORKFLOW-EVALUATION.md](WORKFLOW-EVALUATION.md).

`bench-controlled` esegue lo stesso piano con provider locale scriptato nelle tre modalità. `bench-controlled --tail-steps 24` aggiunge una fase lunga di scritture core dopo il rilascio del web. Verifica gli hash degli schemi e registra byte delle richieste, non token. Metodo e risultati sono in [CONTROLLED-COMPARISON.md](CONTROLLED-COMPARISON.md).

`benchmarks/phase-comparison.json` confronta Pi e MoAH streaming su due task con due ripetizioni e ordine alternato: otto prove. Le due pagine web hanno un limite di lettura identico di 8.000 caratteri per pagina. `benchmarks/web-sdk-comparison.json` ripete il solo task web per verificare il caricamento SDK differito.

Con `measureMemory: true`, su Windows il runner avvia un osservatore CIM esterno all'albero misurato. Somma working set e private bytes dei processi Pi e discendenti, inclusi worker e processi temporanei rilevati. Attende 250 ms fra i rilevamenti; la query stessa aggiunge tempo. I file `memory-samples.jsonl` conservano timestamp e PID. Il monitor viene applicato a entrambe le condizioni e aggiunge overhead di sistema.

`memory.sampledPeakWorkingSetBytes` è il massimo osservato della somma dei working set: può contare pagine condivise più volte e perdere picchi brevi. `sampledPeakPrivateBytes` misura memoria privata impegnata, non RAM residente. Non sono equivalenti a un picco RSS esatto o alla RAM fisica totale della macchina. I vecchi campi non misurati restano `null`. Su sistemi diversi da Windows, o senza campioni, le misure rimangono sconosciute.

Gli eventi Pi e stderr vengono ora scritti durante l'esecuzione: un'interruzione non perde più tutte le risposte precedenti al termine del processo. I risultati finali continuano a essere salvati per ogni prova completata.
