# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Spec-driven project: specs live in `specs/` and drive the code. `README.md` (Spanish) holds the original requirements.

- SPEC 00 (architecture diagrams) is done. SPEC 01 (PostgreSQL `nexodev` with simulated data) is superseded as the data source by SPEC 06; its files stay in the repo unused.
- SPEC 02 (Node.js backend with Gemini), SPEC 03 (chat web UI, `frontend/`), SPEC 04 (similar-ticket search) and SPEC 05 (ticket creation) are implemented.
- SPEC 06 moved the backend to the database `nexo_dev_bcp` (delivered in `db/nexo_dev_bcp_postgresql.sql`) and replaced the tools with seven read-only ones. Ticket creation (SPEC 05) was switched off in that spec.
- SPEC 07 added the eighth read-only tool, `buscar_incidentes`, over `jira_incidentes`. The incidents script is now part of the normal load.
- SPEC 08 rebuilt ticket creation on `jira_tickets` (`proponer_ticket` and `crear_ticket`). The backend now has ten tools and one write.
- SPEC 09 changed creation: the user picks the type (`WO`, `OCD`, `ITSM` or `INC`) and the environment (`QA` or `Producción`) separately; `INC` is saved in `jira_incidentes`, the others in `jira_tickets`; codes are `WO-0001`, `OCD-0001`, `ITSM-0001`, `INC-0001`. It replaces the `ITMS-XXXX` codes and the type-from-environment rule of SPEC 08.
- Not built yet: Agent 2 (provisioning).
- No automated tests and no linter. Verification is manual: `curl` and `psql` for the backend and database, the browser for the UI.

`.claude/skills/` and `.agents/skills/` hold installed skills (`caveman`, `spec`, `spec-impl`), pinned in `skills-lock.json`. `spec` / `spec-impl` are the intended workflow: write a spec, then implement from it.

## Commands

Database (PostgreSQL 12+; the backend reads the database `nexo_dev_bcp`). On this machine PostgreSQL runs in the Docker container `dbPostgres` (version 18) and there is no local `psql`. Full reload, which is also how to create it the first time:

```bash
docker exec dbPostgres dropdb -U postgres --if-exists nexo_dev_bcp
docker exec dbPostgres createdb -U postgres nexo_dev_bcp
docker exec -i dbPostgres psql -U postgres -d nexo_dev_bcp -v ON_ERROR_STOP=1 -q < db/nexo_dev_bcp_postgresql.sql
docker exec -i dbPostgres psql -U postgres -d nexo_dev_bcp -v ON_ERROR_STOP=1 -q < db/nexo_dev_bcp_migracion.sql
# 300 fictional production incidents (read by buscar_incidentes)
docker exec -i dbPostgres psql -U postgres -d nexo_dev_bcp -v ON_ERROR_STOP=1 -q < db/nexo_dev_bcp_incidentes.sql
```

- Never edit `db/nexo_dev_bcp_postgresql.sql`: it is the delivered file. It runs `CREATE SCHEMA nexo_dev_bcp` without a `DROP`, so it only loads into an empty database, which is why the reload drops and recreates the database.
- `db/nexo_dev_bcp_migracion.sql` (ours, repeatable) adds `jira_tickets.creado_en`, the `busqueda` full-text column with its GIN index, and the `ITSM` value in the `jira_tickets.tipo` CHECK. It re-simulates the `creado_en` of every ticket each time it runs. The delivered file has no dates, so `creado_en` is **simulated**: each ticket gets 0 to 89 days of age relative to the load, from a hash of `codigo_ticket`. After 90 days the search window is empty: reload.
- `db/nexo_dev_bcp_incidentes.sql` (ours, repeatable) creates `jira_incidentes`: 2 incidents per service of `portal_apis`, with severity, evidence, root cause and solution. Dates are also simulated and relative to the load. `ambiente` allows `QA` and `Producción` (the 300 loaded incidents are all in Producción).
- The old database `nexodev` and `db/schema.sql` / `db/seed.sql` (SPEC 01) still exist but nothing reads them.

Backend (Node 20.6+, port 3000):

```bash
cd backend
npm install
cp .env.example .env     # then fill LLM_API_KEY (Google AI Studio), PGUSER and PGPASSWORD; PGDATABASE is nexo_dev_bcp
npm start                # node --env-file=.env src/server.js
curl localhost:3000/api/salud
curl -X POST localhost:3000/api/chat -H 'Content-Type: application/json' \
  -d '{"mensaje":"¿Quién es el PO de MBBK?"}'
```

Web UI: after `npm start`, open **http://localhost:3000/**. The same Express process serves `frontend/` and the API, so there is no second server, no build step and no CORS.

The chat response returns a `sesion_id`. Send it back as `"sesion_id"` in the next request to keep the conversation. `SESION_TTL_SEGUNDOS` (optional, default 1800) shortens session expiry for testing. `backend/.env` is git-ignored.

## Architecture

The agent answers from PostgreSQL tables that simulate the real platforms (no real Jira, Confluence, GitHub or API portal calls in the MVP). They live in the schema `nexo_dev_bcp` and all relate to `cvt` through `codigo_aplicacion`. There are three applications: `YAPE` (Billetera Digital), `MBBK` (Mobile Banking) and `TTIB` (Transferencias Interbancarias).

| Table | Simulates | Tool |
| --- | --- | --- |
| `cvt` | Applications and their owners (PO, LT, tribe leader, TTL) | `consultar_aplicativos` |
| `jira_confluence` | Confluence: operating models, lessons learned, business rules, diagrams | `buscar_documentos` |
| `jira_tickets` | Jira: `WO`, `OCD` and `ITSM` tickets, in QA or Producción | `buscar_tickets_similares`, `proponer_ticket`/`crear_ticket` |
| `jira_ops_genie` | On-call and support people by shift | `consultar_guardia` |
| `github` | Components, provisioning configuration and contracts, with source code | `buscar_componentes_github` |
| `portal_apis` | API portal: services, endpoints and OpenAPI contracts (JSONB) | `consultar_apis` |
| `chama` | Release state and indicators by cut (pases, CFR, TMD, ACCE) | `consultar_indicadores` |
| `jira_incidentes` | Fictional production incidents per API service | `buscar_incidentes` |

Request flow in `backend/src/`: `server.js` (routes and the error handler, which returns `{ "error": "..." }` with 400, 429, 502 or 500) -> `agente.js` (tool-use loop, at most 5 tool rounds per message) -> `tools/`. `sesiones.js` keeps conversation history in memory (30 min idle expiry, 50 messages max) and stores only the text of each turn, not tool results; each session also holds `turno` (+1 per user message), `borrador` and `ticketsCreados`, used by ticket creation (SPEC 08). `db.js` is the shared `pg` pool.

Tools in `backend/src/tools/`, all read-only except `crear_ticket`, up to 5 rows each, returned as `{ total, resultados }`, with table names qualified (`nexo_dev_bcp.jira_tickets`) and parameterized queries:
- `index.js` registers the ten tools and builds the definitions sent to the model. `aplicaciones.js` holds `consultarAplicativos` and `resolverAplicativo`: every `aplicativo` parameter accepts the code or the full name, case-insensitive, and an unknown one raises an error that lists the valid ones.
- `confluence.js` (`buscar_documentos`) and `github.js` (`buscar_componentes_github`) search by words with `ILIKE`. Documents never return `imagen_png`, only `tiene_diagrama`. `codigo_fuente` is cut to 1000 characters.
- `portal-apis.js` (`consultar_apis`) returns a summary; the OpenAPI `contrato` comes only when `api_id` is given.
- `guardia.js`, `indicadores.js` (fields carry their unit: `pases_30_dias`, `cfr_porcentaje`, `tmd_minutos`, `acce_porcentaje`) and `jira-tickets.js` (below). `util.js` has the shared search helpers.
- `creacion.js` (`proponer_ticket`, `crear_ticket`) is the only module that writes to the database (see Ticket creation below).

The LLM is called through the `openai` SDK against an OpenAI-compatible endpoint. The provider, URL and model are set only by `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL`; today that is Gemini (`gemini-3.5-flash-lite`, free tier). The free tier allows **15 requests per minute** and a daily quota, and each chat message uses 2 to 3 model calls, so a quick demo can hit it: the backend then answers 502 "Se agotó la cuota del modelo". A model failure becomes a 502 (`ErrorModelo`). Tool names and inputs are a contract with the prompt. When the agent uses each tool is decided by the system prompt in `agente.js` plus the tool descriptions in `tools/index.js`; change both together.

Web UI in `frontend/` (plain HTML, CSS and JS, no framework or bundler): `index.html` (layout), `styles.css` (light theme only), `app.js` (all behavior) and `vendor/` (`marked-18.2.0.umd.js` and `purify-3.4.17.min.js`, copied in with the version in the file name; nothing loads from a CDN). `express.static` in `backend/src/server.js` serves only this folder, so never put secrets or non-public files in it.

- One conversation per screen. Assistant replies are Markdown rendered with `marked` and always sanitized with `DOMPurify`; user text goes in with `textContent`, never as HTML.
- The conversation is saved in `localStorage["nexodev:chat:v1"]` as `{ sesionId, mensajes: [{ rol, texto }] }` (`rol` is `user`, `assistant` or `aviso`). Only completed exchanges are saved, and any `localStorage` failure is ignored. Bump the `:v1` suffix if the format changes.
- If a reply carries a different `sesion_id` than the saved one, the backend dropped the session: the UI inserts an `aviso` bubble and keeps the visible history.
- Errors show the backend `error` text in a bubble with a **Reintentar** button that resends without duplicating the user bubble. **Nueva conversación** only clears the browser state; the backend session expires on its own.

Similar tickets (`buscar_tickets_similares`, `tools/jira-tickets.js`): searches `jira_tickets.busqueda` with `websearch_to_tsquery('spanish', ...)`, matching any of up to 6 words from the query, ordered by `ts_rank` and then by newest `creado_en` and `codigo_ticket`. Only tickets from the last 90 days count (`DIAS_VENTANA`, over the simulated `creado_en`). Optional filters `aplicativo`, `estado` (`Registrado`, `En Procesado`, `Terminado`), `tipo` (`WO`, `OCD`, `ITSM`) and `grupo_resolutor` (6 groups) combine with AND, and valid values are matched case-insensitively. The key is the real `codigo_ticket` (`WO-0000001101`). These tickets are routine requests and changes (load a certificate, install a package), not incidents, and they carry no solution or evidence. The system prompt makes the agent search whenever the user describes a problem or need, keep application names and generic words out of the query, drop tickets that only share the application name, retry once without filters if nothing matches, and never invent keys. It may redirect clearly out-of-scope requests (such as an office printer) without searching.

Incidents (`buscar_incidentes`, `tools/incidentes.js`): same full-text mechanism as tickets, over `jira_incidentes.busqueda` joined with `portal_apis` for the service. Window of 90 days over `creado_en`. Optional filters `aplicativo`, `severidad`, `tipo_incidente` (11 closed values), `estado`, `grupo_resolutor`, `api_id` and `servicio` (`ILIKE`). The key is `codigo_incidente` (`INC-100048`). `causa_raiz` and `solucion` come only when `estado` is `Terminado` (otherwise null), and `evidencias` is cut to 1000 characters. The prompt makes the agent query both tools (tickets and incidents) whenever the user describes a problem, need, error or outage, and before proposing a ticket; it proposes the solution of `Terminado` incidents and never invents keys or solutions. There is no HTTP endpoint for incidents: the tool queries PostgreSQL directly. The incidents are fictional and need the incidents script loaded.

Ticket creation (SPEC 08 and SPEC 09, `tools/creacion.js`): `proponer_ticket` validates the data and saves a draft in the session (`borrador`) without touching the database; `crear_ticket` takes no input and inserts that draft. It is the only writer in the backend (an `INSERT` into `jira_tickets` or `jira_incidentes`). The backend, not the prompt, enforces the confirmation: `crear_ticket` fails unless the user sent a message after the draft (`sesion.turno > borrador.turno`), and a session creates at most 3 tickets of any type. `server.js` drops a draft proposed in a turn that ended in an error. Data rules:
- `tipo` is `WO`, `OCD`, `ITSM` or `INC`, and `ambiente` is `QA` or `Producción`. They are independent: any type in any environment. The agent never infers the type; it asks. `WO`, `OCD` and `ITSM` go to `jira_tickets`; `INC` goes to `jira_incidentes`.
- `grupo_resolutor` is mandatory (6 groups); the agent proposes it from similar tickets and incidents and the user confirms it in the template.
- Tickets (`WO`, `OCD`, `ITSM`): `jira_tickets` has no solution or evidence columns, so `descripcion` holds three sections: `Problema:`, `Evidencias:` and `Solución propuesta:` ("Sin evidencias" / "Sin solución propuesta" when empty). `url` is null.
- Incidents (`INC`): also need `api_id` (a service of the same application, found with `consultar_apis`), `severidad` and `tipo_incidente`; these three fields are rejected with any other type. `evidencias` uses its own column and `descripcion` holds `Problema:` and `Solución propuesta:`. They are born `Registrado`, with `causa_raiz`, `solucion` and `resuelto_en` null (the table only allows them when `Terminado`). `creado_en` is set with an explicit `now()`: the column has no default.
- Codes are the type plus 4 digits, with its own counter per prefix: `WO-0001`, `OCD-0001`, `ITSM-0001`, `INC-0001` (max of the existing codes of that prefix with exactly 4 digits, plus one, under `pg_advisory_xact_lock`, up to 9999). The delivered codes (`WO-0000001101`, `OCD-01103`, `INC-100048`) have other widths and are never counted or touched. The old `ITMS-XXXX` codes of SPEC 08 are no longer generated; any that exist stay as they are.
- New rows have `estado` `Registrado` and `creado_en` now, so they show up in `buscar_tickets_similares` and `buscar_incidentes`.
- Reloading the database deletes the tickets and incidents created from the chat.

## Project goal (from README)

Claude-like web chat UI (plain HTML + JS) fronting AI agents that help developers with tickets. Focus: productivity, lower cost/time, fewer production failures, cross-area reuse.

Planned agents:
- **Agent 1 (ticket creator)**: Q&A flow that creates a Jira ticket for a problem/error in certification or production. Required ticket fields: problem detail, responsible team, evidence, application name, environment, solution detail. Must also suggest similar recent tickets and base new tickets on similar past errors (e.g. HTTP 500 in an API, DB memory/CPU spikes). Today it suggests similar tickets and incidents (`buscar_incidentes` reads the README examples in `jira_incidentes`) and creates tickets after the user confirms a template.
- **Agent 2 (provisioning support)**: guides provisioning of components: AKS, Azure SQL, Confluent Cloud topic, Redis, GitHub repo ready for CI/CD.

## Conventions

- README and domain language are Spanish; keep user-facing text, prompts, error messages and specs in Spanish unless told otherwise.
- Specs follow `.claude/skills/spec/template.md`. A spec must be `Approved` before `/spec-impl` runs it.
