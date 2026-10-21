# Guide d'installation de l'API

## Prérequis

Node.js 20 ou plus et `pnpm` :

```bash
corepack enable
pnpm install
pnpm dev
```

## Configuration

```yaml title="config/app.yml"
server:
  port: 8080
  cors: ["https://example.org"]
database:
  url: postgres://localhost:5432/hub
```

## Route principale

```ts title="src/routes/health.ts" lines
import { Router } from 'express';

export const health = Router();

health.get('/health', async (_req, res) => {
  const started = process.uptime();
  res.json({ ok: true, uptime: Math.round(started), version: process.env.APP_VERSION ?? 'dev' });
});
```

## Script Python

```python
def moyenne(notes: list[float]) -> float:
    """Moyenne pondérée simple."""
    if not notes:
        raise ValueError("liste vide")
    return sum(notes) / len(notes)

print(f"{moyenne([12, 15.5, 9]):.2f}")
```

## SQL

```sql
SELECT p.nom, COUNT(*) AS inscrits
FROM inscription i
JOIN programme p ON p.id = i.programme_id
WHERE i.date >= DATE '2026-09-01'
GROUP BY p.nom
ORDER BY inscrits DESC;
```

## Ligne très longue

```text
https://example.org/une/adresse/extremement/longue/qui/ne/doit/pas/deborder/de/la/page/imprimee/meme/si/elle/ne/contient/aucun/espace/pour/couper/la/ligne/proprement
```

## Langage inconnu

```brainfuck
++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.
```

Code en ligne : `const x = 42;` et `npm run build`.
