# Verifiche del 14 settembre 2026

Aggiornamento successivo del 15 settembre: **48/48 test** e build superati; catalogo pubblico completo importato (5.513 pacchetti), 24 nuove prove reali su due modelli e due profili installati, tre nuove sequenze controllate sul profilo ricco e ripgrep upstream eseguito/rilasciato. Vedere [RICH-CATALOG-RESULTS.md](RICH-CATALOG-RESULTS.md) e [WORKFLOW-EVALUATION.md](WORKFLOW-EVALUATION.md). Le prove e i conteggi precedenti sotto sono conservati come storico.

Ultimo aggiornamento: **43/43 test** superati, build riuscita e nove sequenze aggiuntive con provider scriptato completate. Vedere [CONTROLLED-COMPARISON.md](CONTROLLED-COMPARISON.md) per la separazione fra contesto, memoria e caricamento a richiesta; queste prove non sostituiscono quelle con modello reale.

Aggiornamento del 15 settembre: **41/41 test automatici superati**, compilazione TypeScript riuscita, `websearch` e `webfetch` verificati con SDK differito. Dodici nuove prove OpenRouter riuscite, con memoria campionata e costi riconciliati: [seconda iterazione](BENCHMARK-ITERATION-2.md). I risultati sotto conservano il dettaglio delle verifiche precedenti.

Ambiente: Windows, Node 24.19.0, Pi 0.85.1. La selezione dei tool è affidata al modello principale tramite catalogo compatto e `moah_activate`. `Xenova/multilingual-e5-small` q8/DirectML rimane un aiuto opzionale alla ricerca. Dopo queste verifiche locali è stato eseguito il primo benchmark autenticato OpenRouter: vedere [BENCHMARK-RESULTS.md](BENCHMARK-RESULTS.md). Nessuna pubblicazione.

## Risultati

| Verifica | Esito |
| --- | --- |
| Compilazione TypeScript | Superata |
| Suite automatica dopo la correzione dei loop | **36/36** superati, circa 19,7 secondi |
| Suite benchmark dopo il filtro delle modalità | **5/5** superati, incluso un nuovo caso; circa 14,8 secondi |
| Avvio CLI originale `pi --help` | Superato tramite launcher Windows |
| `doctor` | Modello/catalogo presenti; `ddgr`, `pandoc`, `sh` disponibili |
| Ricerca neurale offline, misura precedente | **6/7** tool attesi nei primi due risultati; non misura il nuovo decisore |
| Tool upstream `websearch` | Ricerca pubblica completata, tre risultati restituiti |
| Tool upstream `webfetch` HTML | Pagina `https://pi.dev/` letta tramite conversione upstream |
| Build compilata | Demo `webfetch` eseguita da `dist/src/cli.js` con worker compilato |

La suite verifica il vero ciclo Pi con un provider simulato localmente, così da ispezionare gli schemi realmente ricevuti senza dipendere da risposte probabilistiche o credenziali:

- Cambio di fase con rimozione degli schemi e delle istruzioni precedenti, rilascio del processo e conservazione del piano prodotto.
- Una sola copia transitoria del catalogo per richiesta, assente dalla cronologia persistita.
- Scoperta paginata senza attivazione né caricamento dei pacchetti.
- Fallback lessicale se il modello semantico è indisponibile, senza esposizione automatica di tutti i tool.
- Selezioni sconosciute o oltre il budget che lasciano intatta la fase corrente.
- Esclusioni native di Pi e `--no-tools` applicate anche al catalogo e ai controlli.
- Reset dei tool opzionali alla nuova richiesta, mantenendo i risultati precedenti.
- Continuità fra richieste quando il reset viene esplicitamente disabilitato.
- Autorità delle restrizioni imposte da altre estensioni.
- Applicazione dell'attivazione dopo il completamento dell'intero batch in corso.
- Passaggio da `/moah dense` a `/moah sparse` con reset della fase.

Le asserzioni sul catalogo transitorio sono incluse nel primo scenario; esclusioni e `--no-tools` sono scenari separati. La fixture `plan_task` è solo un tool di test: non è un pacchetto Plan installato in produzione. Il provider controllato dimostra il funzionamento dell'integrazione, non quanto bene un modello reale decida di cambiare fase.

Altri test verificano caricamento solo su richiesta, riuso dello stesso PID, rilascio effettivo del processo, eviction e successivo PID diverso, conservazione di un pacchetto condiviso fra tool, protezione delle chiamate in corso durante il rilascio di fase, cancellazione senza replay, timeout, errore di avvio, invalidazione del catalogo e cache degli embedding.

I nuovi test verificano fallback nativo per gli hook, risoluzione di skills/prompt dalla radice del pacchetto, conservazione dello stato e dei comandi, selezione opzionale degli schemi nativi senza perdita di stato, riuso di un pacchetto già caricato da Pi e registrazione dei pacchetti mancanti. Il runner benchmark viene eseguito realmente attraverso tre processi CLI in cartelle separate: il provider locale controllato attiva i tool quando necessario, scrive un modulo e una verifica indipendente ne controlla il risultato. Questa prova non usa OpenRouter né misura la qualità di Qwen.

## Misura precedente della ricerca neurale: risultato completo

| Richiesta | Tool atteso | Primi due | Esito |
| --- | --- | --- | --- |
| Search the web for recent TypeScript releases | websearch | websearch, webfetch | Presente |
| Fetch the contents of https://pi.dev/docs/latest/extensions | webfetch | webfetch, read | Presente |
| Find all .ts files in this repository | find | ls, find | Presente |
| Search file contents for TODO | grep | find, ls | **Assente** |
| Read package.json | read | read, webfetch | Presente |
| Cerca sul web la documentazione di Pi e leggi la pagina ufficiale | websearch | webfetch, websearch | Presente |
| Elenca i file e le cartelle presenti nella directory | ls | ls, write | Presente |

Sono sette esempi funzionali su tool core più i due tool web, non una stima statistica di accuratezza. La metrica considera la classifica grezza dei primi due. Nella nuova architettura il set attivo viene deciso dal modello principale: questa metrica riguarda soltanto l'aiuto semantico di `moah_discover`.

Il report originale è generato in `.moah/router-smoke.json`. Durata totale osservata circa 20,6 secondi: prima decisione circa 7,7 secondi, alcune richieste successive ancora 3–4,5 secondi e le ultime circa 0,4–0,5 secondi. Le latenze non sono uniformi; non vengono presentate come benchmark stabile. Il test termina con codice 1 per rendere visibile il caso fallito.

## Memoria: cosa è stato misurato

Nelle due demo TypeScript i processi dei tool hanno riportato circa 305 MB (`websearch`) e 318 MB (`webfetch`) di RSS. Nella demo dalla build compilata il processo ha riportato circa 252 MB. Sono osservazioni in esecuzioni differenti, senza controllo sperimentale sufficiente per attribuire la differenza a una causa.

Prima del caricamento la cache era vuota; dopo la chiusura era nuovamente vuota. I test verificano inoltre che il PID terminato non sia più interrogabile. Il processo principale, il router, la VRAM, i figli temporanei dei tool e la cache del filesystem non sono compresi in questi valori.

## Valutazione ancora necessaria

Per misurare il vantaggio del progetto servono task di coding con un modello principale reale e confronti ripetuti sulle capability installate. Il runner `bench` prepara tre configurazioni:

1. `dense`: Pi con tutti i pacchetti caricati nativamente.
2. `resident`: MoAH con catalogo compatto e pacchetti residenti in Pi.
3. `streaming`: MoAH con lo stesso catalogo compatto e caricamento dei pacchetti compatibili tramite processi.

Usare identici modello, task, workspace iniziale e budget. Misurare successo prima del costo; registrare token effettivi e cache token del provider, inclusi catalogo e chiamate di scoperta/attivazione, latenza completa e picco di memoria dell'intero albero. Separare avvio freddo e cache calda. Per attribuire un vantaggio allo streaming dall'SSD occorre aggiungere misure I/O del sistema operativo: il semplice caricamento dei file non prova letture fisiche dal dispositivo.

Il codice e le prove dimostrano il meccanismo di integrazione. Non dimostrano ancora risparmio economico, mantenimento della qualità su larga scala o equivalenza di ogni estensione Pi durante l'eviction.
