# Contesto, RAM e caricamento a richiesta — 15 settembre 2026

**Togliere tool dal contesto basta per ridurre gli schemi inviati al modello. Lo streaming aggiunge il controllo sulla memoria residente, con un costo quando il pacchetto deve essere caricato.** Le nove nuove prove separano queste due proprietà usando azioni prestabilite al posto di un modello a pagamento. La strategia di MoAH rimane selezione del contesto più streaming; la variante residente è il controllo sperimentale.

## Metodo

Il vero CLI Pi usa un provider locale che emette una sequenza deterministica di chiamate. Il pacchetto installato è sempre `pi-web-tools@1.6.0`; i tool sono originali, senza aggiunte fittizie. Il caso attivo usa `webfetch` per leggere `https://example.com/`, verifica la presenza di “Example Domain”, scrive un modulo e, in MoAH, rilascia i tool opzionali. Un verificatore Node controlla gli output. Ogni esecuzione ha file iniziali separati.

Il provider scriptato usa una pausa di 200 ms prima delle chiamate e 1.200 ms prima della risposta finale, per permettere il campionamento. Questi tempi non rappresentano latenza di un LLM. L'autenticazione del provider locale è fittizia e isolata; non sono state effettuate chiamate OpenRouter per questo esperimento. Il tool web effettua una lettura HTTP reale.

Gli hash degli schemi inviati da MoAH residente e streaming coincidono in ogni richiesta della medesima sequenza. Il provider conta byte JSON UTF-8, **non token**. Le piccole differenze di byte fra le due modalità derivano dai percorsi delle cartelle, mentre gli schemi risultano identici.

## Tool web installati ma inutilizzati

Due richieste al provider: scrittura tramite tool core e risposta finale.

| Modalità | Byte input complessivi | Byte schemi per richiesta | Picco working set osservato MiB |
| --- | ---: | ---: | ---: |
| Pi nativo | 20.375 | 6.290 | 251,5 |
| MoAH residente | 17.285 | 4.412 | 252,5 |
| MoAH streaming | 17.287 | 4.412 | 201,3 |

La selezione del contesto riduce l'input anche lasciando il pacchetto in RAM. Lo streaming non aggiunge una riduzione degli schemi; in questa prova evita circa 51 MiB di working set rispetto alla variante residente. È un risultato su un solo pacchetto e su questo ambiente, non una percentuale generale.

## Uso del web e rilascio immediato

Pi effettua tre richieste al provider; MoAH cinque, includendo attivazione e rilascio.

| Modalità | Byte input complessivi | Picco working set osservato MiB | Worker caricati/rilasciati |
| --- | ---: | ---: | --- |
| Pi nativo | 31.374 | 265,9 | Nativo |
| MoAH residente | 52.512 | 246,0 | Nativo |
| MoAH streaming | 52.517 | 428,9 | 1 / 1 |

Qui MoAH paga le richieste aggiuntive e lo streaming paga anche il processo del worker. Una sequenza breve che usa subito il solo pacchetto opzionale non è il caso favorevole alla strategia.

## Dopo il web: una fase lunga di codice

La terza sequenza aggiunge 24 scritture core dopo il rilascio. Tutte le modalità eseguono le medesime scritture, verificate individualmente. È un carico sintetico per isolare l'overhead: non prova che un agente reale sceglierebbe 24 chiamate separate.

| Modalità | Richieste al provider | Byte input complessivi | Picco working set osservato MiB |
| --- | ---: | ---: | ---: |
| Pi nativo | 27 | 373.539 | 274,2 |
| MoAH residente | 29 | 372.027 | 260,3 |
| MoAH streaming | 29 | 372.056 | 428,4 |

Nel confronto streaming–Pi l'extra input cumulativo passa da circa +21.197 byte prima delle scritture aggiuntive a +407 dopo 22 scritture, −538 dopo 23 e −1.483 dopo 24. Quindi il punto di pareggio di **questa sequenza** è circa 23 chiamate core. Dipende da catalogo, descrizioni, cronologia e granularità delle azioni; non è una soglia universale né una previsione del conto API.

Il picco include ancora la fase web. Dopo l'eviction, i 19 campioni successivi di MoAH streaming mostrano un working set compreso fra 229,5 e 231,1 MiB, media 230,5 MiB. Il picco totale e la memoria durante la fase successiva sono misure diverse.

## Implicazioni per la scelta dell'SSD

La gestione del contesto è utile indipendentemente dallo streaming. Mantenere codice residente evita i caricamenti ed è una buona baseline quando la RAM basta. Lo streaming ha un'ipotesi di vantaggio distinta: molti pacchetti installati, una piccola parte attiva e fasi abbastanza lunghe da recuperare l'overhead. Continuiamo a verificarla senza cambiare architettura o escludere estensioni native incompatibili con l'eviction.

L'implementazione carica file dal filesystem e termina processi; non distingue ancora letture dall'SSD fisico da letture servite dalla cache del sistema operativo. Il campionamento Windows può perdere picchi brevi e contare pagine condivise più volte. Questi numeri non dimostrano risparmi generali di RAM fisica, energia o token fatturati.

## Correzioni aggiuntive

- Il fingerprint dei pacchetti ora legge i file a blocchi, senza allocare in RAM l'intero contenuto di ogni file. Il test verifica compatibilità con gli hash precedenti e rilevazione delle modifiche.
- La cattura del benchmark preserva caratteri UTF-8 distribuiti fra chunk diversi dello stream; è coperta da un test specifico.
- **43/43 test** superati e compilazione TypeScript riuscita. Le nove sequenze controllate sono tutte riuscite.

## Riproduzione e artefatti

```powershell
.\scripts\run.ps1 bench-controlled
.\scripts\run.ps1 bench-controlled --tail-steps 24
```

Il numero di scritture può variare da 0 a 64. Con il valore predefinito vengono eseguite le sei condizioni brevi; un valore positivo esegue le tre condizioni con fase lunga. I risultati restano separati sotto `.moah/controlled-runs/`.

- [Sei prove brevi](.moah/controlled-runs/run-c1HxHJ/comparison.json).
- [Tre prove con fase lunga](.moah/controlled-runs/run-3LRJVZ/comparison.json).
- [Script](scripts/controlled-comparison.ts).

Il passo successivo è applicare lo stesso confronto a un catalogo reale più ricco e a task nuovi, poi verificare con modelli reali se il vantaggio sugli schemi sopravvive alle scelte dell'agente e alla cache del provider. I benchmark reali precedenti restano separati da queste sequenze sintetiche.

## Aggiornamento: profilo ricco, 15 settembre 2026

Il confronto è stato applicato a sette estensioni originali, con copia completa del catalogo pubblico di 5.513 pacchetti disponibile per la ricerca. Le estensioni installate sono quelle di `benchmarks/profiles/rich.json`: il catalogo pubblico non viene trattato come migliaia di tool attivi. Le nuove prove con Qwen e Gemini sono riportate separatamente in [RICH-CATALOG-RESULTS.md](RICH-CATALOG-RESULTS.md).

```powershell
.\scripts\run.ps1 bench-controlled --config benchmarks/profiles/rich.json --tail-steps 24
```

Artefatti: [.moah/controlled-runs/run-m6aD0f/comparison.json](.moah/controlled-runs/run-m6aD0f/comparison.json), con riepilogo in `summary.json`. Tre prove riuscite; hash degli schemi residente/streaming identici a ogni passo. Un caricamento e un rilascio del worker web, nessuna chiamata a modelli reali.

| Modalità | Richieste | Byte input JSON totali | Picco working set campionato MiB | Working set medio nella fase finale di codice MiB |
|---|---:|---:|---:|---:|
| Pi | 27 | 415.713 | 269,2 | 266,6 |
| MoAH residente | 29 | 414.692 | 265,5 | 230,7 |
| MoAH streaming | 29 | 414.721 | 415,8 | 176,1 |

La fase finale parte dalla richiesta che produce `step_1`, dopo la scrittura iniziale e, in MoAH, dopo il rilascio del web. Sono disponibili 17, 17 e 16 campioni rispettivamente. I timestamp sono quelli delle risposte Pi e dei campioni CIM; lo script `summarize-controlled.ts` rende ripetibile il calcolo. Nessun significato statistico viene attribuito a una sola esecuzione per modalità.

Con 24 scritture successive il risparmio dei byte totali è circa **0,24%**: la riduzione degli schemi viene quasi assorbita dal catalogo e dalle richieste aggiuntive. Residente e streaming differiscono di un byte per richiesta per i nomi delle workspace. Il vantaggio di memoria dopo il rilascio coesiste con un picco peggiore durante il caricamento. Non sono token fatturati né letture fisiche SSD.
