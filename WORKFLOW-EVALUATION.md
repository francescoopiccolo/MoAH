# MoAH: catalogo completo e tempo necessario a completare il lavoro

## Cosa significa completo

Il catalogo pubblico è quello di https://pi.dev/packages, senza filtro di tipo o popolarità. `moah catalog-sync` percorre tutte le pagine in ordine alfabetico e conserva nome, versione pubblicata, descrizione, tipi e fonte di installazione. Verifica quantità e unicità delle voci, ricontrolla la prima pagina e pubblica atomicamente il risultato. Un errore lascia intatta la precedente copia.

Snapshot del 15 settembre 2026: **5.513 pacchetti, 111 pagine**, SHA-256 del contenuto `026197784b0a02fed5ef2cca84d505d47a363ed34d8d66c7cd4fb44003cb7dea`.
File: `.moah/public-catalog.json`. Non è una transazione atomica del sito: le versioni delle pagine intermedie potrebbero cambiare durante l'acquisizione. Il controllo garantisce copertura e assenza di duplicati nel risultato osservato, non un istante globale offerto da un'API di snapshot.

`moah_discover` con `scope: "public"` ricerca questa copia locale; con scope omesso continua a cercare le capacità installate. Nessun pacchetto pubblico viene presentato come tool già eseguibile. L'elenco pubblico comprende alternative, temi, skill, provider e funzioni interattive: non equivale a 5.513 tool compatibili da abilitare contemporaneamente. La descrizione pubblica non sostituisce la verifica di manifest, requisiti, credenziali e compatibilità.

Non cambiamo la strategia: Pi mantiene il suo ciclo di esecuzione; i pacchetti compatibili vengono caricati su richiesta e rilasciati; gli altri restano nativi. Il catalogo pubblico riguarda la scoperta. Lo streaming riguarda codice già installato. Il catalogo completo non viene riversato nel prompt.

## Configurazioni realistiche

| Configurazione | Cosa confronta |
|---|---|
| Pi di base | Il lavoro risolto con i tool originali, anche quando un'estensione non serve |
| Pi con poche estensioni scelte | Workflow intermedio, spesso il riferimento più realistico |
| Pi con un insieme più ricco | Stessi pacchetti e versioni del corrispondente MoAH |
| MoAH residente | Effetto della selezione degli schemi senza rilascio dei processi |
| MoAH streaming | Selezione identica, più costo e beneficio dei worker |

Le suite `intermediate-real.json`, `rich-real.json` e `rich-gemini-real.json` definiscono profili installati e task nuovi. Il profilo ricco include il pacchetto web, gli esempi originali ripgrep, todo, plan, question e bookmark di Pi 0.85.1, e `@nqbao/pi-json-schema@0.1.1`. Sono sette estensioni, non un campione spacciato per l'intero catalogo. La funzione JSON si abilita con i flag originali del pacchetto; questi task non li impostano. Plan, todo e UI mantengono il ciclo di vita nativo. Solo web e ripgrep sono candidati allo streaming nel profilo.

Il profilo intermedio riusa gli stessi task con il solo pacchetto web. L'osservatore del provider è identico nelle tre modalità e registra solo dimensioni, hash e nomi dei tool, senza testo dei payload o credenziali. Il catalogo pubblico è copiato integralmente nelle workspace MoAH; nessun pacchetto aggiuntivo viene eseguito perché compare nell'indice pubblico.

## Latenza di lavoro e impegno umano

La riflessione dell'utente è corretta: il tempo di esecuzione dell'agente è soltanto una parte del tempo fino al risultato verificato. Occorre includere individuazione del bisogno, ricerca, scelta del pacchetto, installazione, configurazione, riavvio/ricaricamento e recupero dagli errori. Non si devono però aggiungere arbitrariamente "secondi di pensiero" ai risultati di Pi.

Per una prova con persone registrare:

- tempo totale dal bisogno espresso al risultato verificato;
- tempo umano attivo: ricerca, scelta, comandi, configurazione e correzioni;
- attese di installazione, rete, caricamento e modello, annotando eventuali sovrapposizioni;
- numero di interventi, cambi di contesto, tentativi e successo finale;
- esperienza con Pi e familiarità con i pacchetti.

Il tempo totale viene misurato direttamente con due timestamp: non è la somma di durate sovrapposte. Il tempo umano attivo è una misura separata. I benchmark automatici lasciano questi campi **non misurati**, non zero.

Il launcher ora registra la durata dei comandi di gestione Pi, di sincronizzazione del catalogo e di indicizzazione in `.moah/workflow-events.jsonl`. Non registra argomenti o credenziali. `completed` indica che il comando è ritornato senza eccezione; non certifica che una dipendenza esterna sia configurata. `humanActiveMs` resta null. Le installazioni eseguite fuori da MoAH non sono automaticamente osservate.

Usare compiti equivalenti, ordine controbilanciato e partecipanti con diversi livelli di esperienza. Confrontare sia la prima installazione sia il riuso in progetti successivi. Se MoAH viene distribuito già predisposto, contabilizzare anche il suo download, configurazione e indicizzazione iniziale, ammortizzandoli su un numero dichiarato di task.

Pi può a sua volta essere predisposto con pacchetti, preset e selezione manuale dei tool; un agente può anche assistere l'installazione. Perciò il vantaggio di un catalogo ricercabile o di una distribuzione preconfigurata non va attribuito automaticamente all'SSD. Il risparmio di pensiero è un'ipotesi di usabilità da verificare.

## Cache e modelli reali

Queste prove mantengono la cache naturale del provider e ruotano l'ordine delle modalità. Non sono prove con cache forzatamente vuota o calda. OpenRouter può cambiare endpoint e applicare sticky routing; serve l'audit delle generazioni per conoscere il provider effettivo.

Per ogni risposta conservare input non in cache, cacheRead, cacheWrite, output e costo; osservare schemi e chiamate di attivazione nello stesso tratto della conversazione. Una riduzione dei byte degli schemi non dimostra una riduzione dei token totali o del costo. La selezione dinamica può interrompere il riuso di un prefisso; uno schema fisso più ampio può essere economico se viene riutilizzato dalla cache.

Rapportare successo, costo di tutti i tentativi, latenza fino al completamento, errori e timeout. Non eliminare i casi sfavorevoli a MoAH. I benchmark reali precedenti e le sequenze sintetiche restano separati. `preparationMs` misura l'indicizzazione per il caso: non include download, scelta umana o tutta la preparazione comune del profilo.

Riferimenti: [catalogo Pi](https://pi.dev/packages), [Pi e personalizzazione](https://pi.dev/), [cache OpenRouter](https://openrouter.ai/docs/guides/best-practices/prompt-caching).
