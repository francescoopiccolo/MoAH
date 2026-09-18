# MoAH — Report comparativo preliminare

Data: 2026-09-18

Modello principale: `openai/gpt-4o-mini` via OpenRouter.

Suite: `lean-suite-v3`, 8 task, 5 ripetizioni per profilo.

## Confronto

| profilo | successo | latenza media | costo medio | router token |
|---|---:|---:|---:|---:|
| pi-default | 92.5% | 6.55s | $0.00010 | 0 |
| pi-full | 92.5% | 7.71s | $0.00021 | 0 |
| moah-auto | 97.5% | 9.02s | $0.00021 | 262.6 |
| moah-suggest | 90.0% | 9.10s | $0.00020 | 262.1 |
| moah-oracle | 87.5% | 6.82s | $0.00011 | 0 |
| opencode | 84.2% | 9.51s | $0.0018 | 0 |

## Cosa emerge

- `moah-auto` ha il successo più alto su questa suite.
- `pi-default` resta il più veloce ed economico quando i task sono semplici.
- `pi-full` ha lo stesso costo di MoAH, ma un successo inferiore.
- OpenCode è il più costoso e ha il successo più basso su questi task.

## Tesi

MoAH non cerca di essere più veloce di Pi su task banali.

La tesi è:

```text
Pi Agent + un piccolo router = quasi Pi come costo,
molto più leggero di OpenCode,
senza dover installare e attivare manualmente i tool già disponibili.
```

## Limiti

- Suite piccola e non ancora statisticamente definitiva.
- Il costo di OpenCode è stato catturato solo nell'ultimo esperimento.
- I verifier sono stati corretti durante le prove.
- Il vantaggio manuale vale per i tool già presenti nel set MoAH.

## Prossimi passi

- Rilanciare tutti i profili con gli ultimi verifier.
- Aggiungere task con più tool opzionali e cambio fase.
- Valutare un catalogo sintetico più ampio per stressare il router.
- Eventualmente aggiungere NeMo Gym come validazione esterna.
