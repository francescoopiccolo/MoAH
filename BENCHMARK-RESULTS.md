# Primo benchmark reale MoAH — 14–15 settembre 2026

**Il percorso principale funziona con un modello reale: selezione, caricamento del pacchetto web, esecuzione, rimozione degli schemi e terminazione del worker. Non è ancora dimostrato un vantaggio economico generale rispetto a Pi.**

Modello: `qwen/qwen3-coder-next`, tramite OpenRouter. Tutte le generazioni recuperate dall'API metadata risultano servite da **Parasail**. Pi 0.85.1, Windows, Node 24.19.0; ricerca semantica E5 disabilitata per isolare le decisioni del modello principale. Un pacchetto opzionale reale: `pi-web-tools` con due tool. Le configurazioni globali Pi sono ereditate.

## Risultati dopo la correzione

Sette prove riuscite su nove. Le due prove fallite hanno raggiunto il timeout di 120 secondi sul task della somma, dopo risposte parziali. Non è stata accertata la causa dell'attesa; non vengono attribuite automaticamente al router o al provider. Le due ultime condizioni web sono state completate separatamente dopo l'interruzione dell'esecuzione.

| Task | Modalità | Esito | Tempo s | Token input, inclusa cache | Token output | Costo osservato USD |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Somma | Pi nativo | Timeout | 120,18 | 5.905 | 171 | 0,00070940 |
| Somma | MoAH residente | Timeout | 120,22 | 8.840 | 229 | 0,00108080 |
| Somma | MoAH streaming | OK | 32,90 | 14.073 | 539 | 0,00192956 |
| Deduplicazione | Pi nativo | OK | 23,98 | 28.088 | 947 | 0,00312176 |
| Deduplicazione | MoAH residente | OK | 15,59 | 15.127 | 682 | 0,00208884 |
| Deduplicazione | MoAH streaming | OK | 16,50 | 17.243 | 662 | 0,00216356 |
| Ricerca web + codice | Pi nativo | OK | 19,78 | 70.402 | 706 | 0,00721784 |
| Ricerca web + codice | MoAH residente | OK | 49,03 | 344.137 | 1.330 | 0,03700204 |
| Ricerca web + codice | MoAH streaming | OK | 27,62 | 57.962 | 973 | 0,00713544 |

I token input sono la somma di input non in cache, cache letta e cache scritta riportati da Pi, sommati su tutte le chiamate del task: non rappresentano la dimensione di un singolo prompt. Il tempo comprende avvio, modello, strumenti e chiusura; la verifica indipendente è eseguita dopo. I costi sono verificati tramite l'[API metadata di OpenRouter](https://openrouter.ai/docs/api/api-reference/generations/get-generation), per gli ID presenti nei log. Nei timeout possono mancare richieste interrotte prima di ricevere un ID.

## Che cosa dimostra il task web

In streaming Qwen ha selezionato `webfetch`, letto entrambe le pagine richieste senza errori, scritto il report, disattivato i tool opzionali e implementato `clamp`. Il verificatore ha controllato comportamento del codice e presenza dei riferimenti; l'ispezione degli eventi conferma le due letture web effettive.

Il worker è stato caricato una volta, in circa **3,99 secondi**, e terminato per deselezione. L'RSS osservato del worker era circa **291–293 MiB**. Non è il risparmio netto dell'applicazione: il picco dell'intero albero, la VRAM e i byte fisicamente letti dall'SSD non sono misurati.

Gli schemi dei tool operativi passano da 1.528 byte (core) a 2.305 byte (core + webfetch) e tornano a 1.528 byte. Il totale disponibile era 3.726 byte. Questi conteggi escludono gli schemi dei controlli MoAH e il catalogo; i token della tabella includono invece il loro costo nel contesto realmente inviato.

Il costo del task web con streaming è quasi uguale a Pi: circa **$0,0071 contro $0,0072**, con circa 27,6 contro 19,8 secondi. La modalità residente usa 14 risposte del modello, contro 9 in streaming e 5 in Pi, e torna più volte su letture e attivazioni. Le azioni del modello sono diverse: questo singolo confronto non isola causalmente il beneficio dello streaming.

## Difetto trovato e corretto

Nel primo tentativo il modello ha ripetuto discovery e `moah_activate([])` senza progredire: 57 risposte fino al timeout. Abbiamo interrotto quella serie e conservato i risultati separatamente.

La correzione chiarisce che il catalogo è materiale di riferimento e che i tool già attivi si usano direttamente. Le attivazioni identiche restituiscono `unchanged`; dopo due richieste di controllo identiche senza un tool operativo intermedio, quel controllo viene temporaneamente rimosso dagli schemi. Torna dopo un tool operativo o una nuova richiesta. La paginazione su pagine distinte rimane disponibile. Questa protezione copre ripetizioni identiche; non dimostra l'assenza di ogni possibile loop.

Validazione: suite completa **36/36** dopo la correzione; successivamente suite benchmark **5/5** dopo l'aggiunta del filtro delle modalità, con un nuovo caso. Compilazione TypeScript superata.

## Costi e tracciabilità

- Nove condizioni riportate: **$0,06244924** osservati.
- Primo tentativo, due risultati registrati prima della correzione: **$0,03530872** osservati.
- Totale delle generazioni recuperate: **$0,09775796**, circa dieci centesimi di dollaro.

Questo totale non certifica l'intero addebito della chiave: i processi interrotti senza log completo possono avere richieste aggiuntive. La chiave è stata usata nell'ambiente dei processi, senza salvarla nei file del progetto.

Artefatti locali:

- [Prima serie, difetto iniziale](.moah/benchmark-runs/run-7Zsayy/results.json), [costi verificati](.moah/benchmark-runs/run-7Zsayy/openrouter-usage.json).
- [Sette risultati dopo la correzione](.moah/benchmark-runs/run-9qeq1H/results.json), [costi verificati](.moah/benchmark-runs/run-9qeq1H/openrouter-usage.json).
- [Due condizioni completate dopo l'interruzione](.moah/benchmark-runs/run-COjQ5Z/results.json), [costi verificati](.moah/benchmark-runs/run-COjQ5Z/openrouter-usage.json).

## Prossima verifica utile

Ripetere i confronti controllando provider effettivo, cache, ambiente e risultati, con task rappresentativi delle capability utilizzate. Prima di misurare un vantaggio su cataloghi più ricchi, ridurre discovery/attivazioni superflue e separare il costo delle decisioni del modello dal costo di caricamento. Per valutare l'SSD occorrono contatori di sistema e prove a cache fredda/calda. Questo esperimento conferma il meccanismo, non superiorità statistica, qualità generale o equivalenza di ogni estensione Pi durante l'eviction.
