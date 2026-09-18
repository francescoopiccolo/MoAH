# MoAH NeMo Gym adapter

Adapter esterno, separato dal repository MoAH. Non importa codice interno di
MoAH: avvia un processo isolato tramite la CLI e traduce il rollout Gym in un
prompt Pi.

## Contratto

Ogni rollout:

1. riceve `RolloutInput`;
2. crea un workspace temporaneo;
3. scrive `moah.config.json` e i file del task;
4. esegue:

```text
node <moah-cli> baseline <profile> --mode json <prompt>
```

5. raccoglie transcript JSON, usage, tool calls e selezione;
6. termina il processo e rimuove il workspace.

## Variabili richieste

```text
MOAH_CLI      percorso assoluto della CLI MoAH, es. /repo/dist/src/cli.js
MOAH_CONFIG   percorso assoluto del moah.config.json da usare
```

## Uso smoke

```sh
npm run smoke
```

Lo smoke non chiama un LLM: valida solo lo schema e stampa un rollout di
esempio.
