# Instrucciones para agentes en este repo (glpi-mcp)

- Idioma del código y docs: inglés en código, README y mensajes de la herramienta (es un servidor MCP público); los documentos del estándar (este archivo, CONTRIBUTING, SECURITY) en español.
- Nunca push directo a `main`: rama de trabajo + PR (ver CONTRIBUTING.md). Cada merge a `main` debe dejar `main` publicable (npm y la imagen Docker).
- Commits en Conventional Commits. **No** agregues líneas `Co-Authored-By` ni `Claude-Session` a los commits.
- Antes de abrir un PR: `npm run ci` debe pasar.
- No pongas secretos ni datos personales en código, pruebas o logs. Los secretos van en variables de entorno o en el gestor de la plataforma, nunca en el repo.
- Servidor MCP (stdio y Streamable HTTP en `/mcp`) para la API REST legada de GLPI y la High-Level API de GLPI 11+.
- Las credenciales de GLPI (app token, user token) llegan por variables de entorno (`.env.example`); nunca en el código, los tests ni los logs. Las respuestas de error no deben incluir tokens.
- Toda herramienta nueva valida su entrada con zod y lleva prueba en `test/`.
