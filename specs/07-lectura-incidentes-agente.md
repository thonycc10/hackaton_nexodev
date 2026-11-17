# SPEC 07 — Lectura de incidentes (jira_incidentes) por el agente

> **Status:** Approved
> **Depends on:** SPEC 02, SPEC 04, SPEC 06
> **Date:** 2026-11-13
> **Objective:** Exponer la tabla `nexo_dev_bcp.jira_incidentes` al agente con una tool de solo lectura, `buscar_incidentes`, para que ante un error en producción proponga la causa raíz y la solución de incidentes parecidos.

## Por qué existe esta spec

El README pide que el Agente 1 base los tickets en errores pasados (HTTP 500 en una API, picos de memoria o CPU en base de datos). La SPEC 06 dejó `jira_incidentes` cargada con 300 incidentes ficticios, pero ninguna tool la lee. `jira_tickets` solo trae solicitudes (`WO`) y cambios (`OCD`), sin solución ni evidencias; los incidentes sí traen severidad, evidencias, causa raíz y solución. Esta spec solo cubre la **lectura**. Crear tickets sigue pendiente en una spec aparte (el número 07 que mencionan `CLAUDE.md` y la SPEC 06 para la creación pasa a ser esta; la creación será la SPEC 08).

## Alcance

**Dentro:**

- Módulo `backend/src/tools/incidentes.js` con `buscarIncidentes`, solo lectura, consultas parametrizadas y tabla calificada (`nexo_dev_bcp.jira_incidentes`).
- Tool `buscar_incidentes` registrada como octava en `backend/src/tools/index.js`, con su definición para el modelo.
- Búsqueda full-text sobre la columna `busqueda` existente (`websearch_to_tsquery('spanish', ...)`, palabras unidas por `or`), como en `buscar_tickets_similares`.
- Filtros opcionales: `aplicativo`, `severidad`, `tipo_incidente`, `estado`, `grupo_resolutor`, `api_id` y `servicio`. Se combinan con AND.
- Ventana de 90 días sobre `creado_en` (`DIAS_VENTANA = 90`).
- Ajuste del prompt del sistema en `backend/src/agente.js`: ante un error o falla, el agente busca incidentes y también tickets similares, y propone la solución del incidente `Terminado`.
- `db/nexo_dev_bcp_incidentes.sql` pasa a ser parte obligatoria de la carga: `CLAUDE.md` deja de llamarlo opcional y el comando de recarga lo ejecuta siempre.
- Actualización de `CLAUDE.md` (tabla de tools, comandos, estado).

**Fuera de alcance (para otras specs):**

- Crear tickets o incidentes (SPEC 08).
- Endpoint REST (`/api/incidentes`) o cualquier ruta HTTP nueva: la tool consulta PostgreSQL directamente, como las otras siete.
- Modificar `db/nexo_dev_bcp_incidentes.sql` o `db/nexo_dev_bcp_postgresql.sql`.
- Cambios en `frontend/`, en `POST /api/chat`, en `sesiones.js` o en `server.js`.
- Escribir en `jira_incidentes`.
- Agente 2 de aprovisionamiento.
- Pruebas automáticas.

## Modelo de datos

No se agregan tablas ni columnas: se lee la tabla existente `nexo_dev_bcp.jira_incidentes` (300 filas, 2 por servicio de `portal_apis`, creada por `db/nexo_dev_bcp_incidentes.sql`).

Columnas que usa la tool: `codigo_incidente` (PK), `codigo_aplicacion`, `api_id`, `ambiente` (siempre `Producción`), `severidad`, `tipo_incidente`, `titulo`, `descripcion`, `evidencias`, `causa_raiz`, `solucion`, `grupo_resolutor`, `estado`, `url`, `creado_en`, `resuelto_en`, `busqueda`. El nombre del servicio sale de `portal_apis` (`nombre_servicio`, `endpoint`, `metodo_http`) con `JOIN` por `api_id`.

Valores cerrados: `severidad` (`Crítica`, `Alta`, `Media`, `Baja`); `tipo_incidente` (`error_http_5xx`, `latencia_timeout`, `memoria_bd`, `cpu_bd`, `conexiones_bd`, `certificado_vencido`, `autenticacion`, `despliegue_fallido`, `contrato_incompatible`, `integracion_mainframe`, `monitoreo`); `estado` (`Registrado`, `En Procesado`, `Terminado`); `grupo_resolutor` (los 6 de `jira_tickets`).

Contrato de la tool (máximo 5 filas, salida `{ total, resultados }`; `aplicativo` acepta código o nombre completo sin distinguir mayúsculas, vía `resolverAplicativo`):

```js
buscar_incidentes({ consulta, aplicativo?, severidad?, tipo_incidente?, estado?, grupo_resolutor?, api_id?, servicio? })
// -> { clave, aplicativo, api_id, servicio, endpoint, metodo_http, ambiente, severidad, tipo_incidente,
//      titulo, descripcion, evidencias, causa_raiz, solucion, estado, grupo_resolutor, url,
//      creado_en, resuelto_en, similitud }
//    clave = codigo_incidente; evidencias recortadas a 1000 caracteres y terminadas en "…" si se recortó;
//    solucion y causa_raiz son null mientras el incidente no esté Terminado;
//    solo incidentes con creado_en en los últimos 90 días; orden por ts_rank, creado_en y codigo_incidente descendentes.
```

Convenciones:

- `servicio` filtra por `portal_apis.nombre_servicio` con `ILIKE` (comodines escapados con `comodin` de `util.js`); `api_id` debe ser entero.
- Valor fuera de los cerrados, `aplicativo` inexistente o `api_id` no entero lanzan un error en español que lista los válidos, como en las otras tools.
- La búsqueda reutiliza `terminos`, `formatear` y `MAX_FILAS` de `tools/util.js`.
- La consulta del usuario nunca se concatena al SQL.
- Los incidentes son ficticios; el agente no los presenta como hechos reales de la empresa fuera de este MVP.

Comportamiento del agente:

- Cuando el usuario describe un error, falla o caída (por ejemplo "HTTP 500", "la base de datos tiene la memoria alta"), usa `buscar_incidentes` y también `buscar_tickets_similares`, aunque no se lo pidan, con palabras clave y filtros sin el nombre de la aplicación ni palabras genéricas.
- Presenta cada incidente en una lista Markdown con su clave en negrita, título, severidad, tipo, estado, aplicativo y servicio; si está `Terminado`, añade causa raíz y solución. Si no está `Terminado`, aclara que aún no tiene solución.
- Aclara que la búsqueda cubre los últimos 90 días.
- Descarta incidentes que solo coinciden en el nombre de la aplicación o en palabras genéricas, repite una vez sin filtros si no hay coincidencias y avisa que amplió el criterio. Si sigue sin haber, dice que no encontró incidentes similares y no menciona ninguna clave.
- Usa solo claves devueltas por la tool. Nunca inventa incidentes ni soluciones.
- Para necesidades de servicio (cargar un certificado, instalar un paquete) sigue usando solo `buscar_tickets_similares`; no busca incidentes.
- Si le piden crear un ticket, sigue explicando que esa función aún no está disponible.

## Plan de implementación

1. Cargar `db/nexo_dev_bcp_incidentes.sql` sobre la base y comprobar la tabla. Prueba: `psql` muestra 300 filas, `creado_en` entre 0 y 89 días y el índice `idx_jira_incidentes_busqueda`.
2. Crear `backend/src/tools/incidentes.js` con `buscarIncidentes` sin registrarla aún. Prueba: un script de `node` con `PGDATABASE=nexo_dev_bcp` comprueba la ventana de 90 días, el orden por similitud, cada filtro, el recorte de `evidencias`, que `solucion` sea null salvo en `Terminado` y que cada clave exista.
3. Registrar `buscar_incidentes` en `tools/index.js` con descripción corta y enumerados de los filtros cerrados. Prueba: `definiciones` contiene las 8 tools y `GET /api/salud` devuelve 200.
4. Ajustar el prompt en `backend/src/agente.js` con el comportamiento descrito, sin cambiar el flujo de tickets. Prueba: un script con `POST /api/chat` recorre las preguntas de los criterios contra Gemini.
5. Actualizar `CLAUDE.md`: incidentes obligatorios en la recarga, tool nueva en la tabla, estado de las specs y "lo que falta". Prueba: ejecutar los comandos de `CLAUDE.md` sobre una base vacía recrea las tablas, incluida `jira_incidentes`, dos veces seguidas.

## Criterios de aceptación

- [ ] `db/nexo_dev_bcp_incidentes.sql` y `db/nexo_dev_bcp_postgresql.sql` no tienen cambios respecto a git.
- [ ] `jira_incidentes` tiene 300 filas y todas tienen `creado_en` en los últimos 90 días.
- [ ] `definiciones` contiene exactamente las 7 tools anteriores más `buscar_incidentes`.
- [ ] `buscar_incidentes({ consulta: "memoria base de datos" })` devuelve entre 1 y 5 incidentes, todos con `creado_en` en los últimos 90 días, ordenados por similitud descendente, y cada `clave` existe en `jira_incidentes`.
- [ ] Con `tipo_incidente: "memoria_bd"`, `severidad: "Alta"` y `estado: "Terminado"`, todos los resultados cumplen los tres filtros.
- [ ] `aplicativo: "yape"` y `aplicativo: "Billetera Digital"` devuelven solo incidentes de `YAPE`.
- [ ] Con `api_id` de un servicio, todos los resultados tienen ese `api_id`; con `servicio` parcial, el `servicio` de cada resultado lo contiene.
- [ ] Los incidentes con `estado` distinto de `Terminado` traen `solucion: null` y `causa_raiz` sin definir como solución; los `Terminado` traen ambas con texto.
- [ ] Ningún `evidencias` supera 1001 caracteres.
- [ ] Valores inválidos (`severidad: "Gravísima"`, `tipo_incidente: "xyz"`, `estado: "Cerrado"`, `grupo_resolutor: "Otro"`, `aplicativo: "ABCD"`, `api_id: "abc"`) lanzan un error en español.
- [ ] La consulta `'; DROP TABLE jira_incidentes; --` se trata como texto, la tool no falla y la tabla conserva sus 300 filas.
- [ ] Ningún archivo que importe `tools/index.js` contiene `INSERT`, `UPDATE`, `DELETE` ni DDL.
- [ ] En el chat, "Tengo errores HTTP 500 en un servicio de MBBK" lista incidentes con claves que existen en `jira_incidentes`, y para los `Terminado` incluye causa raíz y solución.
- [ ] En el chat, "La base de datos de YAPE tiene la memoria al límite" menciona al menos un incidente de tipo `memoria_bd` con su solución, si existe uno `Terminado`.
- [ ] En el chat, una falla sin coincidencias ("El robot de la cafetería falla") no incluye ninguna clave de incidente.
- [ ] En el chat, "Necesito cargar un certificado de pruebas en YAPE" sigue listando tickets y no llama a `buscar_incidentes`.
- [ ] En el chat, "crea el ticket" explica que esa función aún no está disponible y no inserta ninguna fila.
- [ ] `POST /api/chat`, `frontend/`, `server.js` y `sesiones.js` no cambian, y no se agrega ninguna ruta HTTP.
- [ ] Los comandos de recarga de `CLAUDE.md`, ejecutados dos veces seguidas, dejan la base idéntica con las 8 tablas.
- [ ] `CLAUDE.md` describe `buscar_incidentes` y ya no llama opcional al script de incidentes.

## Decisiones

- **Sí:** tool nueva `buscar_incidentes`, separada de `buscar_tickets_similares`. Los incidentes tienen severidad, evidencias, causa raíz y solución; los tickets no. Mezclarlos confundiría al modelo y la salida.
- **No:** extender la tool de tickets con un parámetro `fuente`, ni fusionar ambas tablas en una consulta.
- **Sí:** «servicio backend» se entiende como un módulo de tool en `backend/src/tools/`, igual que las demás, que consulta PostgreSQL directamente. Lo confirmó el equipo.
- **No:** endpoint REST ni capa HTTP interna. Agregaría una ruta pública sin autenticación y otra capa sin beneficio para el agente.
- **Sí:** filtros `aplicativo`, `severidad`, `tipo_incidente`, `estado`, `grupo_resolutor`, `api_id` y `servicio`. Lo eligió el equipo: cubren cómo se pregunta por incidentes.
- **Sí:** devolver todo (evidencias recortadas a 1000 caracteres, causa raíz y solución) en una sola llamada, con ventana de 90 días sobre `creado_en`. Lo eligió el equipo, por consistencia con tickets y para evitar dos llamadas a una cuota de 15 solicitudes por minuto.
- **Sí:** el script de incidentes pasa a ser obligatorio en la recarga. La tool depende de la tabla, y un script opcional produciría errores de tabla inexistente.
- **Sí:** ante un error, el agente busca incidentes y también tickets similares. Los incidentes dan la solución y los tickets dan el seguimiento operativo.
- **Sí:** la creación de tickets pasa a la SPEC 08. Esta spec ocupa el número 07.
- **Sí:** búsqueda full-text sobre `busqueda`, con el mismo mecanismo de la SPEC 04 y el índice GIN ya existente.
- **Sí:** verificación manual con scripts de `node`, `psql` y `POST /api/chat`.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Las fechas simuladas dejan la ventana vacía pasados 90 días | Recargar la base con los comandos de `CLAUDE.md`, que ahora incluyen incidentes |
| Ocho tools aumentan los tokens por llamada y el gasto de la cuota gratuita | Descripciones cortas, máximo 5 filas y evidencias recortadas |
| El modelo confunde incidentes con tickets o llama a ambas tools siempre | El prompt define cuándo usar cada una; verificación con preguntas de ambos tipos |
| Dos llamadas a tools por mensaje acercan al límite de 15 solicitudes por minuto | Aceptado en el MVP; el error 502 de cuota ya se muestra al usuario |
| El agente presenta soluciones de incidentes ficticios como reales | El prompt no inventa soluciones y usa solo lo que devuelve la tool; los datos están documentados como ficticios |
| Un incidente `Registrado` o `En Procesado` sin solución se toma por resuelto | La tool devuelve `solucion: null` y el prompt exige avisar que aún no tiene solución |
| Recargar la base sin el script de incidentes deja la tool fallando | El comando de recarga lo incluye siempre y la tool devuelve un error claro si la tabla no existe |

## Lo que **no** está en esta spec

- Crear tickets o incidentes (SPEC 08).
- Un endpoint REST de incidentes.
- Modificar los archivos SQL entregados o los de incidentes.
- Cambios en `frontend/`, `server.js`, `sesiones.js` o `POST /api/chat`.
- Agente 2 de aprovisionamiento.
- Pruebas automáticas.
