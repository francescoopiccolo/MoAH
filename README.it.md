# MoAH — Pi con catalogo compatto e tool attivi per fase

MoAH avvia **Pi Agent 0.85.1 originale**. Il modello collegato a Pi riceve un catalogo compatto, sceglie le capability per la fase corrente e ne richiede l'attivazione. Solo i tool selezionati hanno gli schemi completi esposti. I pacchetti compatibili vengono caricati dal filesystem in processi separati e rilasciati quando non servono più.

Il ciclo agente, le sessioni, i provider e il login sono quelli di Pi. **La decisione appartiene al modello principale.** E5 locale è un aiuto opzionale per cercare nel catalogo: viene inizializzato soltanto se il modello richiede una ricerca semantica. Non viene eseguito automaticamente prima di ogni risposta e non sostituisce la selezione del modello principale.

## Come cambia il set attivo

Il modello usa `moah_activate({"tools":[...]})` con il set completo necessario per la fase successiva. L'operazione **sostituisce** i tool opzionali precedenti. Per esempio, dopo la ricerca:

```text
moah_activate({"tools":["websearch", "webfetch"]})
→ ricerca con i due tool web attivi
moah_activate({"tools":[]})
→ implementazione con i tool core permanenti; tool web disattivati
```

Le istruzioni e gli schemi dei tool disattivati escono dalla richiesta successiva. I risultati utili, incluso un eventuale piano, restano nella cronologia. Il catalogo è un singolo messaggio transitorio rigenerato per richiesta: non viene salvato ripetutamente nella sessione.

I tool già attivi si usano direttamente. Le attivazioni senza cambiamenti non ricaricano nulla; una protezione sospende un controllo dopo due richieste equivalenti senza lavoro operativo riuscito intermedio. Ricerche formulate diversamente ma con gli stessi risultati sono riconosciute come ripetizioni. Anche le attivazioni invalide vengono conteggiate. Il controllo ritorna dopo un tool operativo riuscito o una nuova richiesta utente. Il catalogo transitorio precede la richiesta utente, invece di presentarsi come ultimo messaggio dopo ogni tool.

Un pacchetto dedicato alla pianificazione seguirebbe lo stesso meccanismo se compatibile. Il progetto non include un nuovo tool Plan: il test di passaggio fra pianificazione e ricerca usa una fixture. Le modalità Plan che dipendono da hook, stato o prompt esterni restano estensioni native e non vengono scaricate automaticamente.

## Avvio su questo computer

Dipendenze, modello locale e catalogo sono già preparati. Da PowerShell, nella cartella del progetto:

```powershell
.\scripts\run.ps1 pi
```

Dentro Pi, usare `/login` se il provider desiderato non è ancora configurato, quindi scegliere il modello con `/model`. Il modello principale segue l'autenticazione e gli eventuali costi di Pi.

```powershell
# Verifica ambiente e prerequisiti
.\scripts\run.ps1 doctor

# Diagnostica la ricerca semantica locale; non attiva tool in Pi
.\scripts\run.ps1 route "Cerca sul web la documentazione di Pi"

# Esegue i tool upstream reali, senza chiamare un LLM principale
.\scripts\run.ps1 demo search "Pi coding agent documentation"
.\scripts\run.ps1 demo fetch "https://pi.dev/"

# Confronto: Pi originale con lo stesso pacchetto caricato nativamente
.\scripts\run.ps1 dense
```

Il launcher lavora nella cartella di questo progetto e inoltra gli argomenti a Pi. Usa il Node recente incluso nell'ambiente Codex quando disponibile, altrimenti il Node nel PATH. Non modifica il PATH persistente o le configurazioni globali di Pi.

## Installazione riproducibile

Richiede Node **>=22.19**, npm e, per i due tool web, Python e una shell `sh`. Su questo Windows il launcher trova già la shell Git inclusa nell'ambiente locale. Su un'altra macchina Windows installare Git for Windows e rendere disponibile `sh` nel PATH.

```powershell
.\scripts\setup-windows.ps1
```

Lo script esegue `npm ci`, prepara `.moah/venv` con `ddgr==2.2` e `pypandoc_binary==1.17`, indicizza il pacchetto configurato e prepara il modello locale se `router.enabled` è `true`. Non installa moduli Python globali. Le versioni npm sono fissate nel lockfile; i pesi del modello sono identificati dal repository Hugging Face, senza pin a un commit.

Con un ambiente Node già adeguato, i comandi standard sono:

```sh
npm ci
npm run moah -- setup
npm start
```

Fuori da Windows cambiare `router.device` in `cpu`, oppure disabilitare l'aiuto semantico con `router.enabled: false`, e rendere disponibili `ddgr`, `pandoc` e `sh` per i tool web. Il funzionamento verificato qui è Windows/DirectML; gli altri backend non sono stati validati.

`setup` autorizza il download del modello; le successive inferenze del router richiedono i file locali e non li riscaricano automaticamente. I tool web e il provider principale possono naturalmente usare la rete.

## Cosa è incluso

Il catalogo pubblico completo di Pi è disponibile offline dopo `./scripts/run.ps1 catalog-sync`: snapshot verificato di 5.513 pacchetti il 15 settembre 2026. `catalog-search <query>` lo ricerca dal terminale; il modello usa `moah_discover` con `scope: "public"`. Le voci pubbliche richiedono verifica dell'installazione e non diventano automaticamente tool attivi. La navigazione delle capacità installate resta invariata. Profili e metodo di confronto sono in [WORKFLOW-EVALUATION.md](WORKFLOW-EVALUATION.md).

| Componente | Implementazione |
| --- | --- |
| Harness | `@earendil-works/pi-coding-agent@0.85.1`, avviato attraverso `Pi.main` |
| Selezione | Modello principale tramite `moah_activate`, sostituzione del set opzionale |
| Catalogo | Nomi e descrizioni brevi, pagina iniziale e navigazione completa |
| Ricerca opzionale | `Xenova/multilingual-e5-small`, ONNX q8, DirectML, caricamento su richiesta |
| Scoperta | `moah_discover` cerca o sfoglia; restituisce schede senza attivare tool |
| Pacchetto upstream | `@bitcraft-apps/pi-web-tools@1.6.0`: `websearch`, `webfetch` |
| Caricamento | Un processo Node per pacchetto, codice upstream eseguito senza riscriverne i tool |
| Cache | LRU, timeout di inattività, limite processi, budget RSS osservato |
| Gestione errori | Selezioni invalide non cambiano la fase; ricerca lessicale se E5 fallisce; timeout e cancellazione |
| Osservabilità | JSONL locali con selezione, tempi, RSS e usage restituito da Pi |

I tool di base già attivi in Pi vengono preservati come candidati; quelli elencati in `pinnedTools` restano disponibili se consentiti da Pi. Gli altri tool nativi, come `grep`, `find` e `ls`, possono essere abilitati tramite le opzioni di Pi. Ad esempio:

```powershell
.\scripts\run.ps1 pi --tools read,bash,edit,write,grep,find,ls,websearch,webfetch,moah_activate,moah_discover
```

`--tools` è un'allowlist di Pi: includere i tool web e i controlli MoAH se li si vuole usare. `--exclude-tools` e `--no-tools` vengono rispettati.

La configurazione iniziale consente al massimo **6 tool opzionali attivi**, oltre ai permanenti e ai due controlli MoAH. Prima della prima selezione nessun tool opzionale è esposto. Ogni nuova richiesta utente riparte dai permanenti; il modello può selezionare di nuovo quelli utili. La sostituzione non deve attendere una nuova richiesta: può avvenire durante lo stesso task, a ogni cambio di fase.

| Impostazione in `moah.config.json` | Significato e default |
| --- | --- |
| `selection.maxActiveTools` | Massimo di tool opzionali attivi: 6 |
| `selection.catalogPageSize` | Schede per pagina: 40 |
| `selection.descriptionCharacters` | Caratteri massimi per descrizione: 200 |
| `selection.resetOnPrompt` | `true`: reset dei tool opzionali a ogni nuova richiesta utente |
| `selection.releaseInactive` | `true`: termina i processi inattivi non più necessari dopo il batch corrente |
| `router.enabled` | `true`: aiuto semantico su richiesta di `moah_discover`; `false`: sola ricerca lessicale e navigazione |
| `router.pinnedTools` | Tool permanenti, sempre subordinati alle restrizioni di Pi |

`router.topK` e `keepMargin` rimangono parametri della diagnostica neurale `route`; non determinano il set attivo scelto dal modello principale. La ricerca semantica restituisce risultati ordinati e paginabili. Per navigare tutto il catalogo usare `moah_discover({"query":"", "offset":0})`, quindi il `nextOffset` restituito.

Dentro Pi:

- `/moah`: stato del router, tool attivi e processi residenti.
- `/moah dense`: espone tutti i tool eleggibili mantenendo il caricamento a processi.
- `/moah sparse`: ritorna al catalogo compatto e azzera la fase opzionale.

Il comando esterno `dense` è invece il riferimento nativo: carica direttamente le estensioni in Pi senza MoAH.

## Compatibilità con i pacchetti Pi

MoAH mantiene il caricamento nativo di Pi per estensioni con stato, hook, comandi, UI e servizi. Questi pacchetti restano residenti e i loro tool attivi vengono preservati. Non serve escluderli perché non supportano lo streaming. Anche skills, prompt e temi vengono risolti dal package manager originale di Pi.

Il registro vivo raccoglie tool, comandi, skills e prompt esposti dalle API Pi, più pacchetti e temi dichiarati nella configurazione MoAH. `moah_discover` accetta il filtro `kind`; `/moah catalog` aggiorna la fotografia locale. Ogni voce distingue esecuzione nativa/streaming, disponibilità e azione corretta. Un comando slash o una skill non viene trasformato artificialmente in un tool. La registrazione non dimostra che credenziali o servizi esterni siano pronti.

Per installare qualsiasi pacchetto attraverso il gestore originale, nel progetto:

```powershell
.\scripts\run.ps1 install npm:@scope/pacchetto@1.2.3
.\scripts\run.ps1 list
.\scripts\run.ps1 config
```

Sono disponibili anche `remove` e `update`. I pacchetti installati così seguono inizialmente il comportamento nativo di Pi. Non vengono scaricati automaticamente tutti i pacchetti pubblicati online. Il catalogo remoto può contenere alternative, conflitti e dipendenze specifiche: la copertura riguarda le risorse effettivamente installate e abilitate dall'utente.

## Abilitare lo streaming per un pacchetto

Installare localmente una versione esatta del pacchetto, verificarne il comportamento e aggiungere a `moah.config.json`:

```json
{
  "id": "nome-pacchetto",
  "package": "@scope/pacchetto",
  "version": "1.2.3",
  "entry": "index.ts",
  "stateless": true
}
```

Poi eseguire `.\scripts\run.ps1 index`. L'indice versione 2 registra modalità e motivazione. Il default è `mode: "auto"`: senza contratto `stateless: true` il pacchetto rimane nativo; un probe incompatibile provoca il fallback nativo. `mode: "native"` forza Pi, mentre `mode: "stream"` richiede comunque contratto e probe. I pacchetti mancanti sono visibili come indisponibili senza impedire l'indicizzazione degli altri.

Versione e lockfile vengono controllati prima dell'uso; per i pacchetti in streaming viene verificato anche il fingerprint dei sorgenti. Il probe esegue il factory in un processo temporaneo: i pacchetti devono essere codice fidato. Le risorse native vengono risolte con le API originali, senza simulare il loro lifecycle.

**Compatibilità esplicita:** il caricamento a processi supporta estensioni che registrano tool senza dipendere dal ciclo di vita di Pi. Sono disponibili `ctx.cwd`, `ctx.hasUI: false`, il segnale di cancellazione e gli aggiornamenti dei risultati. Hook di sessione, comandi, stato persistente, `prepareArguments` e altre API richiedono il caricamento nativo in Pi. Il flag `stateless` dichiara un contratto, non lo dimostra automaticamente.

I renderer personalizzati del pacchetto non vengono trasferiti via IPC: in streaming Pi visualizza i risultati con il rendering generico. La cache di paginazione di `webfetch` può essere persa all'eviction e ricostruita scaricando nuovamente la pagina. Usare la modalità nativa quando occorre preservare queste proprietà.

Se Pi ha già caricato nativamente un pacchetto indicizzato per lo streaming, MoAH ne riusa i tool originali senza avviare un secondo processo. Conflitti di nomi fra pacchetti diversi restano errori espliciti.

Per i pacchetti nativi `context: "preserve"` è il default: mantiene i tool come in Pi. Solo dopo aver verificato che l'estensione lo consenta si può impostare `context: "dynamic"`: MoAH seleziona gli schemi per fase, mentre codice, stato, hook e UI rimangono residenti. Le istruzioni aggiunte direttamente da hook e skills seguono comunque Pi.

`workerSdk: "lazy"` è un'ottimizzazione facoltativa, abilitata qui solo per `pi-web-tools@1.6.0`. Carica gli helper originali `defineTool` e `formatSize` dai moduli Pi, differisce `keyHint` finché chiamato e ricorre all'SDK completo per altri export nominati. Non modifica i tool upstream. Il default degli altri pacchetti resta `full`; pacchetti che dipendono dall'inizializzazione globale dell'SDK o dall'enumerazione del namespace devono mantenerlo. L'adapter usa percorsi interni di Pi 0.85.1: va riverificato quando si aggiorna Pi.

## Modello principale e benchmark

La configurazione di partenza consigliata è **Qwen3 Coder Next su OpenRouter**. Il modello principale legge il catalogo e decide le attivazioni; non viene aggiunto un secondo LLM a pagamento. E5 resta una ricerca locale opzionale.

```powershell
# Avvio interattivo: richiede la chiave nel terminale, senza salvarla in un file
.\scripts\openrouter.ps1

# Controllo del piano, senza richieste al modello
.\scripts\run.ps1 bench benchmarks/smoke.json --dry-run

# 3 task × 3 configurazioni con verifica automatica dei risultati
.\scripts\openrouter.ps1 bench
```

Il protocollo confronta Pi nativo, MoAH con selezione e pacchetti residenti, MoAH con selezione e streaming. Dettagli, metriche e limiti in [BENCHMARK.md](BENCHMARK.md). Il primo confronto reale con OpenRouter ha registrato sette prove riuscite e due timeout; risultati, costi e correzione del loop di attivazione sono in [BENCHMARK-RESULTS.md](BENCHMARK-RESULTS.md).

La [seconda iterazione](BENCHMARK-ITERATION-2.md) aggiunge dodici prove riuscite, campionamento della memoria e un worker più leggero. Mostra un vantaggio di memoria quando il pacchetto web non serve, ma costi ancora superiori a Pi sul task web. Le misure sono preliminari e non vengono estese a cataloghi non provati.

Il [confronto controllato](CONTROLLED-COMPARISON.md) separa selezione del contesto e residenza del codice, senza un LLM a pagamento: schemi identici fra MoAH residente e streaming, nove sequenze riuscite e una misura del punto di pareggio su una fase lunga. I byte serializzati di questa prova non sono token fatturati.

## Verifiche e limiti misurati

```sh
npm run check
npm test
npm run build
npm run test:router
```

I test automatici usano processi reali e il vero SDK/ciclo agente di Pi. Un provider locale controllato permette di ispezionare il catalogo ricevuto, le attivazioni, gli schemi e le istruzioni che escono dal contesto, il reset fra richieste e la conservazione dei risultati. Il comando separato `test:router` esegue il modello neurale reale offline e riguarda soltanto l'aiuto semantico opzionale.

Lo smoke test neurale iniziale ha trovato il tool atteso nei primi due risultati in **6 casi su 7**. Il caso fallito è `Search file contents for TODO`: E5 ha preferito `find` e `ls` a `grep`. Il comando restituisce intenzionalmente codice 1 finché esiste un caso fallito; non misura la selezione del modello principale nella nuova architettura.

`websearch` e `webfetch` sono stati eseguiti con successo contro siti pubblici. Il benchmark con Qwen via OpenRouter verifica anche selezione e rilascio del pacchetto durante un task reale. È verificata la terminazione dei processi, non un vantaggio complessivo di RAM, latenza o costo.

Pi base non aggiunge automaticamente nuovi tool a ogni messaggio: la cronologia delle conversazioni e dei risultati cresce anche quando il set dei tool resta costante. MoAH limita gli schemi e le istruzioni dei tool opzionali; non elimina la cronologia né istruzioni di skills/hook caricati nativamente. Il costo del catalogo, delle attivazioni e l'effetto sulla prompt cache vanno inclusi nei confronti. Non è dimostrato un risparmio rispetto a Pi o ad altri harness.

Il budget memoria è **morbido**: usa l'RSS osservato al caricamento e al termine delle chiamate; non limita picchi durante l'esecuzione, processi discendenti, Pi, il modello router, VRAM o cache del sistema operativo. La terminazione su Windows comprende l'albero del processo. I processi non costituiscono una sandbox.

I dettagli del disegno sono in [ARCHITECTURE.md](ARCHITECTURE.md); risultati e protocollo di valutazione in [VALIDATION.md](VALIDATION.md).

L'ultima valutazione con catalogo pubblico completo, profili installati intermedi e ricchi, Qwen e Gemini è in [RICH-CATALOG-RESULTS.md](RICH-CATALOG-RESULTS.md): riporta anche casi sfavorevoli a MoAH, errori del provider e costi verificati. Il tempo di scelta umano resta una misura separata ancora da raccogliere.

## File locali e riferimenti

`.moah/` contiene catalogo, cache dei pesi/embedding, ambiente Python e trace. È esclusa da Git. I trace MoAH non registrano prompt, argomenti o contenuti dei risultati; le normali sessioni di Pi seguono invece le impostazioni di Pi. Non inserire credenziali in `moah.config.json`.

- [Pi e documentazione ufficiale](https://pi.dev/docs/latest)
- [Sorgenti Pi](https://github.com/earendil-works/pi)
- [Pacchetto web nel catalogo Pi](https://pi.dev/packages/@bitcraft-apps/pi-web-tools)
- [Sorgenti dei tool web](https://github.com/bitcraft-apps/pi-web-tools)
- [Modello E5 in formato ONNX](https://huggingface.co/Xenova/multilingual-e5-small)
- [ds4](https://github.com/antirez/ds4), riferimento concettuale per caricamento/cache; qui non vengono implementati offloading o quantizzazione dei pesi del modello principale.
