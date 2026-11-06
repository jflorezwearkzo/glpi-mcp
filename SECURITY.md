# Seguridad

## Reportar una vulnerabilidad

Escribe a **security@zylarion.io**. No abras issues públicos. Respondemos en máximo 3 días hábiles.

## Modelo (resumen)

- Tokens de GLPI solo por variables de entorno; el transporte HTTP escucha en `127.0.0.1` por defecto (la imagen Docker lo abre en `0.0.0.0` para el contenedor).
- Entradas de cada herramienta validadas con zod antes de llegar a GLPI.
- La imagen corre como usuario `node`, sin dependencias de desarrollo.

## En el repositorio

- `security.yml`: gitleaks, `npm audit` y Semgrep en cada PR, en `main` y cada lunes.
- Actions fijadas por SHA; Dependabot con espera de 7 días para versiones nuevas.
