# Seconda iterazione — 15 settembre 2026

**Emergono vantaggi circoscritti quando i pacchetti installati non servono al task. Quando vengono usati, MoAH paga ancora memoria e chiamate aggiuntive.** Sono state eseguite dodici nuove prove reali, tutte riuscite, con Qwen3 Coder Next via OpenRouter; gli ID verificati risultano serviti da Parasail.

## Correzioni

- Catalogo transitorio più breve: nella configurazione provata passa da circa 1.783 a 990 byte iniziali. Viene collocato prima dell'ultima richiesta utente, conservando dopo di essa risposte e risultati dei tool.
- Ricerche con gli stessi risultati sono riconosciute anche se la query cambia. La navigazione fra pagine distinte rimane disponibile. Anche le attivazioni invalide alimentano il controllo delle ripetizioni; gli errori di un tool operativo non azzerano più il controllo.
- Log del benchmark scritti durante l'esecuzione, per conservare gli eventi anche se il processo viene interrotto.
- Campionamento Windows dell'albero dei processi: working set e private bytes, con timestamp e PID, invece di osservare soltanto il worker.
- Caricamento SDK differito, abilitato solo sul pacchetto web verificato. Gli helper mantengono le implementazioni upstream; gli altri pacchetti rimangono sulla modalità completa predefinita.

## Prima serie: contesto corretto, SDK completo

Due task, due ripetizioni, due modalità: **8/8 riuscite**, nessun timeout. Stessi pacchetti e capacità disponibili in Pi e MoAH; Pi tiene il pacchetto nativo caricato, MoAH lo carica solo quando selezionato. Nel task web entrambi ricevono l'istruzione di leggere 8.000 caratteri per pagina. Non sono stati aggiunti tool fittizi per favorire MoAH.

Medie di due esecuzioni:

| Task | Modalità | Input inclusa cache | Costo USD | Tempo s | Picco working set osservato MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| Deduplicazione | Pi | 19.636,5 | 0,002492 | 25,78 | 254,7 |
| Deduplicazione | MoAH streaming | 12.236 | 0,001653 | 16,77 | 204,1 |
| Web + codice | Pi | 75.763,5 | 0,007833 | 24,89 | 252,5 |
| Web + codice | MoAH streaming | 82.860 | 0,009047 | 36,46 | 507,0 |

Sul task che non usa i tool web, MoAH mostra circa **20% in meno di picco working set**, **38% in meno di input** e **34% in meno di costo** nella media osservata. La riduzione della memoria si ripete in entrambe le coppie; token e tempo dipendono anche dalle diverse azioni scelte dal modello. Due ripetizioni non bastano per generalizzare queste percentuali.

Sul task web, con SDK completo, MoAH è peggiore nelle medie di tutte queste metriche. Il processo aggiuntivo carica molte dipendenze dell'SDK già presenti nel processo Pi.

## Ottimizzazione del worker

Il pacchetto web importa `defineTool`, `formatSize` e `keyHint` dall'entry point generale di Pi. L'adapter `workerSdk: lazy` accede ai moduli originali dei primi due helper e carica il renderer `keyHint` soltanto quando invocato. Gli export nominati non specializzati ricorrono all'SDK completo. Il codice del pacchetto web non viene riscritto.

In quattro caricamenti isolati, alternando l'ordine:

| Modalità SDK | RSS del solo worker, MiB | Tempo di caricamento, s |
| --- | ---: | ---: |
| Completo, prova 1 | 279,7 | 7,55 |
| Differito, prova 1 | 167,4 | 3,48 |
| Differito, prova 2 | 167,2 | 3,18 |
| Completo, prova 2 | 280,8 | 7,49 |

Il confronto verifica l'uguaglianza dei metadata dei tool. `websearch` e `webfetch` sono stati poi eseguiti realmente con successo. Gli export di fallback e gli helper sono coperti da test. Il campione RSS del worker al caricamento non è il picco dell'intera applicazione.

Questa modalità è facoltativa e specifica alla versione Pi 0.85.1. Non è una sostituzione universale dell'SDK: pacchetti che richiedono inizializzazione globale o enumerazione del namespace mantengono `workerSdk: full`. Lo streaming incompatibile continua a ricadere sul caricamento nativo; nessun pacchetto viene escluso per ottenere questi risultati.

## Seconda serie: web con SDK differito

Altre quattro prove: **4/4 riuscite**, nessun timeout. Medie di due esecuzioni:

| Modalità | Input inclusa cache | Costo USD | Tempo s | Picco working set osservato MiB |
| --- | ---: | ---: | ---: | ---: |
| Pi | 39.578 | 0,004194 | 23,73 | 253,9 |
| MoAH streaming, SDK differito | 65.908,5 | 0,006925 | 33,40 | 383,3 |

Il picco osservato di MoAH scende da circa **507 a 383 MiB** fra le due serie, coerentemente con la riduzione misurata nel worker isolato. Rimane superiore a Pi: l'ottimizzazione riduce il costo, non rende vantaggioso questo task web.

In una prova Qwen ha cercato due volte `clamp` nel catalogo. Il controllo ha sospeso discovery, il modello è passato al codice e la verifica è riuscita. Questa è evidenza reale di recupero da una ripetizione; non dimostra che qualsiasi loop sia impossibile. Nell'ultima serie non ci sono state attivazioni senza cambiamenti, mentre resta spazio per ridurre ricerche inutili e chiamate di controllo.

## Misure e limiti

Il monitor esterno somma il working set dei processi rilevati da CIM, inclusi Pi, worker e figli temporanei. Può contare pagine condivise più volte e perdere processi o picchi molto brevi. Private bytes significa memoria privata impegnata, non RAM residente. Il monitor aggiunge overhead e il computer non era un ambiente prestazionale dedicato. I valori sono osservazioni ripetute, non benchmark hardware rigorosi.

I costi sono riconciliati per gli ID registrati con l'API metadata OpenRouter: **$0,04204864** per le prime otto prove e **$0,02223836** per le quattro successive, totale **$0,064287**. Le differenze di cache e di numero di chiamate sono incluse nei costi, ma non controllate sperimentalmente. Il provider effettivo è stato verificato, non bloccato nella richiesta. La verifica del report web controlla fonti e output atteso, senza una valutazione semantica esaustiva.

Il catalogo reale installato contiene un solo pacchetto opzionale con due tool. Queste prove non dimostrano vantaggi su centinaia di pacchetti. I byte fisicamente letti dall'SSD non sono misurati.

## Prossime verifiche che distinguono un vantaggio reale

1. Ripetere su task nuovi e su un catalogo reale più ricco, mantenendo esattamente le stesse installazioni nelle due modalità. I pacchetti nativi incompatibili con l'eviction restano presenti anche in MoAH.
2. Misurare separatamente task con capability opzionali inattive, una capability attiva e più capability simultanee. È il rapporto fra codice totale installato e codice effettivamente necessario che deve predire il vantaggio.
3. Confrontare richieste LLM equivalenti per isolare il costo di catalogo e schemi dalle scelte variabili del modello; verificare cache, provider e successo dei task prima di confrontare medie economiche.
4. Ridurre discovery superflue e il tempo di caricamento senza alterare i tool; verificare che il risparmio sopravviva su task non usati per modificare il prompt.
5. Per una tesi sull'SSD, aggiungere contatori I/O e prove a cache fredda/calda. Il caricamento dal filesystem e l'eviction, da soli, non provano accessi fisici al dispositivo.

## Artefatti

Validazione finale: **41/41 test** superati e compilazione TypeScript riuscita. I nuovi test coprono posizione del catalogo, ricerche equivalenti, attivazioni invalide ripetute, misurazione dell'albero dei processi e compatibilità dell'adapter SDK con i tool originali.

- [Prime otto prove](.moah/benchmark-runs/run-9XH9Kj/results.json), [audit costi](.moah/benchmark-runs/run-9XH9Kj/openrouter-usage.json).
- [Quattro prove con SDK differito](.moah/benchmark-runs/run-AoivVH/results.json), [audit costi](.moah/benchmark-runs/run-AoivVH/openrouter-usage.json).
- [Profilo isolato del worker](.moah/sdk-profile.json).
- Suite riproducibili: [phase-comparison.json](benchmarks/phase-comparison.json), [web-sdk-comparison.json](benchmarks/web-sdk-comparison.json). La configurazione attuale abilita l'SDK differito sul pacchetto web; impostare `workerSdk: full` e ricostruire l'indice per riprodurre la condizione precedente.
