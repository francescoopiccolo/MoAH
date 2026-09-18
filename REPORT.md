# MoAH — Report comparativo preliminare

Data: 2026-09-18

Modello principale: `openai/gpt-4o-mini` via OpenRouter.

Suite: `lean-suite-v3`, 8 task, 5 ripetizioni per profilo.

## Confronto

| profilo | successo | latenza media | costo medio | router token |
|---|---:|---:|---:|---:|
| pi-default | 100% | 8.18s | $0.00010 | 0 |
| pi-full | 97.5% | 8.61s | $0.00020 | 0 |
| moah-auto | 100% | 10.60s | $0.00021 | 262.6 |
| moah-suggest | 100% | 11.90s | $0.00020 | 262.9 |
| moah-oracle | 100% | 8.95s | $0.00012 | 0 |
| opencode | 76.9% | 10.28s | $0.00183 | 0 |

## Cosa emerge

- `pi-default`, `moah-auto`, `moah-suggest` e `moah-oracle` raggiungono il 100% su questa suite.
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
