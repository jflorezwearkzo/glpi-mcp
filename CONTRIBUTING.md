# Cómo trabajamos en este repo

Estándar de desarrollo de Zylarion (el mismo de `zylarion-solutions/zylarion-web` y `zylarion-solutions/baas`).

## Ramas

| Rama | Para qué | Cómo se llega |
|---|---|---|
| `main` | Lo que está en producción. Cada merge a `main` debe dejar `main` publicable (npm y la imagen Docker). | Solo por PR |
| `feature/*`, `fix/*`, `security/*`, `chore/*`, `docs/*`, `refactor/*`, `test/*`, `ci/*` | Trabajo | Sale de `main` |

**Nunca se hace push directo a `main`.** Todo entra por Pull Request con el CI en verde
(regla de la rama en GitHub). Merge: squash.

## Ciclo

```bash
git switch main && git pull
git switch -c fix/algo
# … cambios …
npm run ci                       # lo mismo que corre GitHub
git commit -m "fix(alcance): descripción"
git push -u origin fix/algo      # PR → main
```

Títulos de PR en [Conventional Commits](https://www.conventionalcommits.org/es/): `feat`, `fix`,
`security`, `chore`, `docs`, `refactor`, `test`, `ci`, `perf`, `build`, `revert`, `release`.

## Qué valida cada PR

1. Título en Conventional Commits.
2. `npm run ci` en Node 22 y 24: tipos (`tsc`), pruebas (vitest) y build; además `docker build` de la imagen.
3. Seguridad (`security.yml`): secretos (gitleaks), dependencias (`npm audit`) y análisis estático (Semgrep). También cada lunes.
