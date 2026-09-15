# Disegno tecnico

La tesi verificabile è che il catalogo delle capability possa crescere mantenendo limitati sia gli schemi inviati al modello principale sia il codice residente dei pacchetti opzionali, senza peggiorare il successo dei task. Sono due risultati indipendenti da misurare: selezione del contesto e residenza dei processi.

## Percorso di una richiesta

1. Pi riceve il prompt. Per default MoAH azzera la selezione opzionale lasciando i tool permanenti e i controlli di catalogo.
2. L'hook `context` aggiunge una sola fotografia transitoria: schede compatte, tool attivi e istruzioni per sostituire il set. Questa fotografia non viene salvata nella sessione.
3. Il modello principale interpreta il task e chiama `moah_activate` con tutti i tool opzionali necessari per la fase. Può prima usare `moah_discover` per cercare o sfogliare il catalogo.
4. Il runtime valida nomi, permessi e budget. Prepara i pacchetti richiesti senza eseguire le loro funzioni. Un errore mantiene la selezione precedente.
5. Al termine dell'intero batch corrente, MoAH applica la nuova selezione e rilascia i processi inattivi non più necessari. Gli schemi completi appaiono nella richiesta LLM successiva; gli schemi e le istruzioni dei tool omessi escono.
6. Il modello principale esegue i tool selezionati attraverso il normale ciclo Pi. I proxy inoltrano le chiamate ai processi dei pacchetti e riportano risultati e aggiornamenti.
7. Durante lo stesso task, il modello può sostituire ancora il set o passare una lista vuota per liberare tutti i tool opzionali. La selezione è limitata da un massimo configurabile, indipendentemente dalla durata della conversazione.

E5 è un motore opzionale di ricerca semantica richiamato da `moah_discover`, non il decisore delle attivazioni. La ricerca restituisce solo nomi e riassunti, senza attivare o caricare i pacchetti. Una query vuota permette navigazione esaustiva e stabile. Se il modello locale non è disponibile, la ricerca passa a un ordinamento lessicale senza esporre tutto il catalogo come tool attivi.

Il pre-caricamento prepara il set richiesto esplicitamente dal modello principale. Non sono implementati predizione del prossimo stato, prefetch speculativo sovrapposto all'inferenza o apprendimento online.

## Confine con Pi

MoAH usa `before_agent_start` per il reset configurabile e `turn_end` per applicare una selezione pendente dopo le chiamate ai tool. In Pi 0.85.1 lo snapshot degli strumenti precede `turn_start`: modificare il set in quel punto arriverebbe con un turno di ritardo. Il tool di attivazione è sequenziale; una sola sostituzione può essere pendente nello stesso batch. Tutte le altre chiamate di quel batch usano lo snapshot originale, anche se il modello non segue l'istruzione di chiamare l'attivazione da sola.

Il catalogo viene aggiunto tramite `context`, senza sovrascrivere il system prompt. Pi ricostruisce autonomamente il prompt degli strumenti attivi. Il test verifica che un'istruzione appartenente alla fixture Plan sparisca dopo il cambio di fase, ma che il testo del piano resti nella cronologia. Le istruzioni di hook, skills o override esterni non fanno parte di questa gestione.

Il registry di Pi mantiene le restrizioni esplicite. Se un'altra estensione modifica il set attivo fra due decisioni di MoAH, quel nuovo set diventa autorevole anche rispetto ai tool prima nascosti. Il router non ricostruisce automaticamente il vecchio insieme. L'API non permette di dedurre l'intenzione di una modalità quando questa scrive esattamente lo stesso set già attivo; per restrizioni rigide usare l'allowlist/denylist nativa di Pi. Le modifiche apportate dopo lo snapshot della richiesta conservano i limiti temporali del ciclo Pi.

Una selezione con nomi sconosciuti, esclusi o oltre il budget fallisce senza modificare la fase attiva. Gli schemi non vengono mai accumulati per unione implicita. Un fallimento del caricamento viene restituito al modello principale. Il fallback lessicale della ricerca non ripara dipendenze mancanti del pacchetto.

Il primo esperimento con Qwen ha evidenziato chiamate ripetute a discovery e attivazione vuota. Un'attivazione identica al set corrente ora restituisce `unchanged`, senza caricare worker o pianificare una nuova fase. Dopo due richieste di controllo identiche senza uso intermedio di un tool operativo, quel controllo esce dagli schemi attivi; ritorna dopo un tool operativo o una nuova richiesta utente. La protezione distingue query, pagina e tipo di risorsa, quindi non limita la navigazione fra pagine diverse. Le restrizioni esterne di Pi restano autorevoli. Il catalogo ricorda di usare direttamente i tool già attivi e di rispondere quando il task è concluso.

La revisione successiva confronta gli ID delle capability restituite e il cursore successivo: formulazioni diverse della stessa ricerca non aggirano la protezione, mentre pagine con risultati diversi restano consultabili. Conta anche attivazioni invalide e ripristina i controlli solo dopo tool operativi riusciti. Il catalogo viene inserito prima dell'ultimo messaggio utente e accorciato; rimane una sola fotografia transitoria, senza riscrivere la cronologia persistita o il system prompt.

## Residenza fisica

Il padre conserva metadata, schemi e proxy dei tool in streaming. Il loro codice eseguibile e le loro dipendenze risiedono in processi figli solo quando caricati; le estensioni native rimangono nel processo Pi. L'unità di caricamento è il **pacchetto**, non il singolo tool: selezionare `webfetch` carica anche il codice di `websearch` appartenente allo stesso pacchetto.

Un normale import JavaScript non offre un unloading affidabile: per questo l'eviction termina l'intero processo. Con `releaseInactive:true`, a ogni confine di batch vengono rimossi i processi senza tool attivi. Se un altro tool selezionato appartiene allo stesso pacchetto, il processo resta in memoria. Con `releaseInactive:false`, resta invece disponibile per riuso fino a TTL, pressione RSS o capacità.

I processi occupati sono mantenuti fino alla conclusione delle chiamate, salvo cancellazione, timeout o chiusura della sessione. In caso di timeout/cancellazione il processo viene terminato senza ripetere la chiamata; se ospitava altre chiamate contemporanee, anche queste falliscono. Effetti già avvenuti nel mondo esterno non vengono annullati.

Il numero dei processi è limitato. Quando tutti gli slot sono occupati, una chiamata che richiede un ulteriore pacchetto riceve un errore esplicito di capacità; non esiste una coda di attesa illimitata. Il budget RSS rimuove i processi inattivi; i processi occupati possono superarlo. L'RSS non è una misura del picco totale dell'applicazione.

I file sono presenti nel filesystem locale: il sistema operativo può servirli dalla propria cache anziché effettuare letture fisiche dall'SSD. Questa implementazione non usa direct I/O, memory mapping di pesi, DMA o prefetch a blocchi di ds4. Non misura attualmente byte effettivamente letti dal dispositivo.

## Compatibilità e integrità

L'indice versione 2 conserva versione di Pi, specifiche dei pacchetti, hash del lockfile, modalità, motivazione e risorse risolte dal package manager Pi. Per lo streaming conserva il fingerprint dei sorgenti, escludendo `node_modules`, `.git` e `.moah`. Il lockfile verifica l'identità dichiarata delle dipendenze, ma non fa l'hash ricorsivo di tutti i file delle dipendenze transitive. Le definizioni in streaming registrate al caricamento devono coincidere con quelle indicizzate.

Le estensioni che richiedono API diverse da `registerTool` vengono mantenute native quando il probe rileva l'incompatibilità. Senza dichiarazione `stateless` il default è già nativo. Gli accessi non supportati al contesto del worker sono rifiutati all'esecuzione: il probe non prova assenza di stato o effetti collaterali nel codice arbitrario. Errori propri del pacchetto nativo restano gestiti da Pi.

Il rendering personalizzato resta fuori dal confine IPC. Per conservare stato, hook e UI si usa Pi nativo, senza eviction fisica. `context: preserve` mantiene anche i tool nativi attivi; `context: dynamic` consente, su scelta esplicita, di selezionarne gli schemi senza scaricare il codice. Se un pacchetto è già caricato da Pi, MoAH riusa quella registrazione.

Il registro vivo combina `getAllTools()` e `getCommands()` con le risorse dei pacchetti gestiti. Contiene identità, tipo, origine, modalità, disponibilità e azione nativa. Le capability non-tool non sono attivabili tramite `moah_activate`. I servizi interni e gli hook sono rappresentati dal pacchetto, senza promettere un inventario di ogni callback. L'autenticazione dei singoli servizi esterni rimane sconosciuta finché verificata dal pacchetto.

## Cosa serve per dimostrare la tesi

Il runner confronta tre configurazioni sugli stessi task: Pi nativo con gli schemi originali, MoAH con selezione e pacchetti residenti, MoAH con selezione e streaming. Così si distingue l'effetto della selezione da quello della residenza. Servono task rappresentativi delle capability installate, cambi di fase e recupero dopo una selezione errata. Il protocollo eseguibile e i suoi limiti sono in [BENCHMARK.md](BENCHMARK.md).

Le metriche da raccogliere sono successo del task, tool necessario presente nella selezione, ricerche/attivazioni, token e cache token del provider, costo effettivo, latenza completa, caricamenti/eviction e picco RAM/VRAM/I/O dell'intero albero dei processi. I trace `selection` misurano gli schemi, `catalog_context` misura i byte del catalogo transitorio; non sono token e non includono tutto il prompt né l'effetto sulla prompt cache del provider.

La cronologia delle chiamate, delle risposte di scoperta e dei risultati resta sotto la gestione di Pi. La nuova architettura limita il set attivo e il catalogo per richiesta; non promette contesto totale costante né costi inferiori senza benchmark.
