# Catalogo completo, profili installati e nuovi benchmark reali

Misure del 15 settembre 2026, Windows e Node 24.19.0, Pi originale 0.85.1. La copia locale del catalogo pubblico contiene **5.513 pacchetti su 111 pagine**. Nessuna voce viene esclusa dalla ricerca; questo non significa che 5.513 pacchetti siano stati installati insieme. Il [protocollo](WORKFLOW-EVALUATION.md) distingue il catalogo disponibile dalle configurazioni realmente eseguite.

Il profilo ricco comprende sette estensioni originali e nove tool attivi in Pi: quattro core, webfetch, websearch, rg, todo e question. Plan e bookmark aggiungono funzioni native; JSON Schema resta nel suo stato originale senza i flag che ne abilitano il tool. MoAH mantiene todo e question nativi, mentre web e ripgrep sono candidati allo streaming. Il catalogo pubblico viene cercato solo su richiesta, senza inserire tutte le descrizioni nel prompt.

## Qwen, profilo ricco

Artefatti: `.moah/benchmark-runs/run-Zubmji/`. Due ripetizioni per task e modalità, ordine ruotato, provider effettivo **Parasail** verificato tramite gli ID delle generazioni. Costi della tabella: media per tentativo, riconciliata con OpenRouter.

| Task | Modalità | Codice corretto | Secondi medi | Costo medio USD | Schemi medi, byte/richiesta | Working set massimo campionato, media MiB |
|---|---|---:|---:|---:|---:|---:|
| Inventario | Pi | 2/2 | 44,17 | 0,006175 | 7.852 | 275,2 |
| Inventario | MoAH residente | 2/2 | 44,80 | 0,006946 | 5.625 | 264,8 |
| Inventario | MoAH streaming | 2/2 | 52,46 | 0,006463 | 5.625 | 232,5 |
| Policy URL | Pi | 2/2 | 27,96 | 0,003483 | 7.852 | 279,6 |
| Policy URL | MoAH residente | 2/2 | 36,23 | 0,006558 | 6.437 | 274,3 |
| Policy URL | MoAH streaming | 2/2 | 48,58 | 0,007323 | 6.629 | 414,4 |

Tutti i dodici output superano i controlli funzionali. Una prova streaming sull'inventario ha incontrato tre risposte 429, recuperate da Pi: il criterio rigoroso senza errori del provider resta **11/12**, distinto dalla correttezza degli output **12/12**. Nessun timeout o pausa del controllo per ripetizioni.

Gli schemi sull'inventario si riducono di circa **28,4%**, ma MoAH non risparmia sul costo medio in questi task Qwen. Sulla policy URL lo streaming costa circa 2,10 volte Pi. I token cacheRead medi sulla policy sono 18.768 per Pi e 44.880 per streaming: la cache funziona anche in MoAH, ma non compensa le chiamate aggiuntive e il maggior volume complessivo. Sull'inventario lo streaming riduce la memoria osservata; durante il web il worker la aumenta.

Il verificatore URL iniziale aveva un errore di sintassi nell'escape di una regex. `results.json` e `suite.json` originali sono conservati. `reverified-results.json` contiene il ricontrollo degli stessi file con un'asserzione equivalente e sintatticamente corretta, senza altre chiamate LLM. Il runner ora controlla la sintassi dei verificatori prima di chiamare il provider. Non sono state corrette le soluzioni prodotte dagli agenti.

## Gemini, profilo ricco

Artefatti: `.moah/benchmark-runs/run-6KshA4/`. Una ripetizione per task e modalità; provider effettivo **Google**, audit OpenRouter completato.

| Task | Modalità | Esito | Secondi | Costo USD | CacheRead token |
|---|---|---|---:|---:|---:|
| Inventario | Pi | Riuscito | 33,31 | 0,010528 | 8.476 |
| Inventario | MoAH residente | Riuscito | 20,91 | 0,008313 | 13.622 |
| Inventario | MoAH streaming | Riuscito | 19,81 | 0,009697 | 8.277 |
| Policy URL | Pi | Codice non valido | 12,18 | 0,004665 | 1.423 |
| Policy URL | MoAH residente | Errore provider, lavoro incompleto | 16,78 | 0,003462 | 5.687 |
| Policy URL | MoAH streaming | Riuscito | 19,97 | 0,007837 | 0 |

Sull'inventario MoAH è più veloce e meno costoso in questa singola prova. Non basta per una conclusione statistica né per attribuire tutta la differenza agli schemi. Sul web i tentativi falliti non sono risultati equivalenti più economici: Pi ha modificato male il file e prodotto un `return` fuori dalla funzione; MoAH residente ha ricevuto `finish_reason: error` e non ha completato il secondo requisito. Questi output restano intatti.

## Qwen, configurazione intermedia

Artefatti: `.moah/benchmark-runs/run-9T7ggZ/`. Solo il pacchetto web installato nel profilo, stessi task e stesso modello Qwen. Una ripetizione, provider Parasail: **6/6 riuscite**, nessun errore del modello o timeout.

| Task | Modalità | Secondi | Costo USD | Schemi medi, byte/richiesta |
|---|---|---:|---:|---:|
| Inventario | Pi | 43,85 | 0,007115 | 6.290 |
| Inventario | MoAH residente | 35,49 | 0,004978 | 4.594 |
| Inventario | MoAH streaming | 38,03 | 0,006080 | 4.594 |
| Policy URL | Pi | 31,28 | 0,004819 | 6.290 |
| Policy URL | MoAH residente | 40,50 | 0,004657 | 5.344 |
| Policy URL | MoAH streaming | 44,88 | 0,006920 | 5.316 |

La configurazione intermedia modifica il risultato: sull'inventario MoAH risparmia in questa ripetizione; sul web il residente risparmia poco denaro ma richiede più tempo, mentre lo streaming costa di più. Non si può dedurre una relazione monotona fra numero di pacchetti e vantaggio: cambiano anche le scelte del modello. I massimi working set campionati del task web sono circa 258 MiB per Pi, 257 MiB residente e 400 MiB streaming.

## Limiti comuni

La cache è naturale, non forzata vuota o calda. I costi includono i tentativi falliti e gli ID osservati; errori prima dell'assegnazione di un ID non sono ricostruibili dall'audit. I tempi delle tabelle misurano l'intero processo agente, non la scelta umana o l'installazione iniziale. Le prime due suite registravano inoltre una preparazione dell'indice anche per Pi nativo: è contabilità interna del runner, esclusa dai tempi delle tabelle, e non un costo di installazione di Pi. Le suite successive evitano questo probe superfluo in modalità nativa.

Le misure di working set sommano processi e possono contare pagine condivise due volte; non sono misure esatte della RAM fisica o delle letture SSD. Solo due task e pochi pacchetti vengono effettivamente esercitati. La disponibilità dell'intero catalogo non trasforma questo test in una prova di 5.513 pacchetti attivi. Non sono stati misurati vantaggi nel tempo di scelta umano.

I benchmark reali precedenti, i nuovi benchmark reali e le sequenze sintetiche restano separati. La strategia resta selezione del contesto più caricamento su richiesta, con confronto residente per distinguere i due effetti.

## Completamento della verifica

Le 24 prove reali producono **22 output corretti**; **21 prove** soddisfano anche il criterio rigoroso di nessun errore del modello. Il caso aggiuntivo ha recuperato tre errori 429. Nessun timeout. Costo OpenRouter osservato complessivo: **0,15296683 USD** (Qwen ricco 0,073896; Gemini ricco 0,04450215; Qwen intermedio 0,03456868). Sono inclusi i tentativi falliti, non solo quelli riusciti.

Il confronto controllato sul profilo ricco ha completato tre sequenze con schemi identici fra residente e streaming; è documentato in [CONTROLLED-COMPARISON.md](CONTROLLED-COMPARISON.md). Nel tratto di codice dopo il rilascio del web, il working set medio campionato è 266,6 MiB per Pi, 230,7 per residente e 176,1 per streaming; il picco streaming resta più alto. Queste misure non sono aggregate con le prove LLM.

**48/48 test** automatici e compilazione TypeScript superati. Il tool ripgrep upstream è stato anche eseguito e rilasciato realmente, senza modello: `.moah/qualification/rich-o38eML/result.json`. Sono stati aggiunti controlli di completezza del catalogo, separazione fra pacchetti pubblici e tool installati, ricerca esatta dei nomi npm, metrica della preparazione e verifica sintattica preventiva dei valutatori. La ricerca CLI è paginata per evitare risposte enormi sul catalogo completo.

L'evidenza sostiene il controllo della memoria nelle fasi inattive e mostra alcuni casi di risparmio con modelli reali. Non sostiene ancora un vantaggio generale di costo o latenza. Per misurare il risparmio nella scelta delle estensioni serve applicare il protocollo con persone o un esperimento di scoperta separato: i task qui completati non prevedevano nuove installazioni.
