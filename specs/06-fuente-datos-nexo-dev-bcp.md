# SPEC 06 — Fuente de datos nexo_dev_bcp para el agente

> **Status:** Approved
> **Depends on:** SPEC 02, SPEC 04, SPEC 05
> **Date:** 2026-11-13
> **Objective:** Cambiar la fuente de datos del backend a la base nueva `nexo_dev_bcp`, cargada desde `db/nexo_dev_bcp_postgresql.sql`, y exponer sus 7 tablas al agente como tools de solo lectura.

## Por qué existe esta spec

El equipo entregó una estructura de datos nueva, `db/nexo_dev_bcp_postgresql.sql`, que reemplaza a los datos simulados de la SPEC 01. Es otro dominio: 3 aplicaciones bancarias (`YAPE`, `MBBK`, `TTIB`) con documentos operativos, tickets de solicitudes (`WO` y `OCD`), guardia de soporte, componentes de GitHub, servicios del portal de APIs e indicadores de pases. Esta spec cambia solo la **lectura**. Crear tickets sobre `jira_tickets` es una decisión de producto aparte y queda para la SPEC 07.

## Alcance

**Dentro:**

- Base de datos nueva y separada, `nexo_dev_bcp`, cargada con `db/nexo_dev_bcp_postgresql.sql` sin modificar el archivo. El archivo crea dentro de ella el esquema `nexo_dev_bcp`.
- Migración propia `db/nexo_dev_bcp_migracion.sql`, que se ejecuta después de cargar el archivo:
  - Agrega `jira_tickets.creado_en` con fechas simuladas repartidas en los últimos 90 días.
  - Agrega la columna `busqueda` (`tsvector` en español) y su índice GIN.
- Comandos de recarga de la base documentados en `CLAUDE.md`.
- `backend/.env` y `backend/.env.example` con `PGDATABASE=nexo_dev_bcp`.
- Siete tools de lectura sobre las siete tablas, con nombres y filtros definidos en el modelo de datos:
  - Tools que reemplazan a las actuales: `consultar_aplicativos` (`cvt`), `buscar_documentos` (`jira_confluence`), `buscar_componentes_github` (`github`, reemplaza a `buscar_soluciones_codigo`) y `buscar_tickets_similares` (`jira_tickets`).
  - Tools nuevas: `consultar_apis` (`portal_apis`), `consultar_guardia` (`jira_ops_genie`) y `consultar_indicadores` (`chama`).
- Ventana de recencia de 90 días en la búsqueda de tickets similares, ahora sobre `creado_en`.
- Prompt del sistema adaptado al dominio nuevo.
- Desregistro de `proponer_ticket` y `crear_ticket`: el agente deja de ofrecerlas y el código se conserva inactivo.
- Actualización de `CLAUDE.md`.

**Fuera de alcance (para otras specs):**

- Crear tickets sobre `jira_tickets` y asignar códigos `WO-` u `OCD-` (SPEC 07).
- Mostrar en el chat los diagramas PNG de `jira_confluence.imagen_png`.
- Borrar la base `nexodev`, las tablas de la SPEC 01 y los archivos `db/schema.sql` y `db/seed.sql`: quedan sin usar.
- Selector entre fuentes de datos antigua y nueva.
- Modificar `db/nexo_dev_bcp_postgresql.sql`.
- Cambios en `frontend/` y en el contrato de `POST /api/chat`.
- Agente 2 de aprovisionamiento.
- Búsqueda por similitud en documentos y componentes (siguen con `ILIKE`).
- Pruebas automáticas.

## Modelo de datos

El archivo entregado define el esquema `nexo_dev_bcp` con estas tablas. Todas se relacionan con `cvt` por `codigo_aplicacion`.

| Tabla            | Filas | Columnas que usa el agente                                                                                          |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| `cvt`            | 3     | `codigo_aplicacion` (PK), `nombre_aplicacion`, `descripcion`, `po`, `lt`, `tribe_leader`, `ttl`                      |
| `jira_confluence`| 273   | `documento_id`, `codigo_aplicacion`, `audiencia`, `tipo`, `titulo`, `contenido`, `url_origen`, `herramienta_plataforma`, `imagen_png` (solo para saber si existe) |
| `jira_tickets`   | 540   | `codigo_ticket` (PK), `codigo_aplicacion`, `tipo`, `ambiente`, `url`, `titulo`, `descripcion`, `grupo_resolutor`, `estado` |
| `jira_ops_genie` | 9     | `codigo_aplicacion`, `turno`, `soporte_1`, `soporte_2`, `soporte_3`                                                  |
| `github`         | 450   | `nombre_componente`, `codigo_aplicacion`, `tipo`, `codigo_componente`, `codigo_fuente`                               |
| `portal_apis`    | 150   | `api_id`, `codigo_aplicacion`, `nombre_servicio`, `endpoint`, `metodo_http`, `contrato` (JSONB)                      |
| `chama`          | 9     | `codigo_aplicacion`, `corte`, `estado_pases`, `indicador_pases`, `indicador_cfr`, `indicador_tmd`, `indicador_acce`  |

Valores cerrados: `jira_confluence.tipo` (`leccion_aprendida`, `regla_negocio`, `consideracion_interna`, `lineamiento`, `politica`, `mejor_practica`, `modelo_operativo`, `diagrama_arquitectura`, `diagrama_secuencia`); `jira_confluence.audiencia` (`equipo_responsable`, `otros_equipos`, `ambos`); `jira_tickets.tipo` (`WO`, `OCD`); `jira_tickets.estado` (`Registrado`, `En Procesado`, `Terminado`); `jira_tickets.grupo_resolutor` (`Seguridad`, `Control de Accesos`, `AgileOPS`, `Base de Datos`, `Soporte ITSM`, `Soporte Mainframe`); `github.tipo` (`componente`, `aprovisionamiento`, `contrato`); `chama.corte` en los datos actuales (`Actual`, `Mes anterior`, `Dos meses atrás`).

Migración propia (`db/nexo_dev_bcp_migracion.sql`), sobre la base ya cargada:

```sql
-- Fechas simuladas: el archivo entregado no trae fecha en jira_tickets.
ALTER TABLE nexo_dev_bcp.jira_tickets
    ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT now();
-- Reparte los tickets existentes en los últimos 90 días, de forma determinista según codigo_ticket.

ALTER TABLE nexo_dev_bcp.jira_tickets
    ADD COLUMN IF NOT EXISTS busqueda TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('spanish', coalesce(titulo, '') || ' ' || coalesce(descripcion, ''))
    ) STORED;
CREATE INDEX IF NOT EXISTS idx_jira_tickets_busqueda
    ON nexo_dev_bcp.jira_tickets USING GIN (busqueda);
```

Contrato de las tools (todas con máximo 5 filas y salida `{ total, resultados }`, como en la SPEC 02). El parámetro `aplicativo` acepta el código (`YAPE`) o el nombre (`Billetera Digital`) completo, sin distinguir mayúsculas.

```js
consultar_aplicativos({ aplicativo: "string (opcional)" })
// -> { codigo_aplicacion, nombre_aplicacion, descripcion, po, lt, tribe_leader, ttl }

buscar_documentos({ consulta, aplicativo?, tipo?, audiencia?, herramienta? })
// -> { documento_id, aplicativo, tipo, audiencia, titulo, contenido, herramienta_plataforma,
//      url_origen, tiene_diagrama }   // tiene_diagrama = imagen_png no es nula; nunca se devuelven los bytes

buscar_componentes_github({ consulta, aplicativo?, tipo? })
// -> { nombre_componente, aplicativo, tipo, codigo_componente, codigo_fuente }
//    codigo_fuente se recorta a 1000 caracteres y termina en "…" si se recortó

buscar_tickets_similares({ consulta, aplicativo?, estado?, tipo?, grupo_resolutor? })
// -> { clave, tipo, titulo, descripcion, aplicativo, ambiente, estado, grupo_resolutor, url, creado_en, similitud }
//    clave = jira_tickets.codigo_ticket (por ejemplo "WO-0000001101"); solo tickets de los últimos 90 días

consultar_apis({ aplicativo?, servicio?, metodo?, api_id? })
// -> { api_id, aplicativo, nombre_servicio, endpoint, metodo_http }
//    Con api_id devuelve además "contrato" (el OpenAPI de ese servicio). Sin api_id nunca lo incluye.

consultar_guardia({ aplicativo, turno? })
// -> { aplicativo, turno, soporte_1, soporte_2, soporte_3 }

consultar_indicadores({ aplicativo?, corte? })
// -> { aplicativo, corte, estado_pases, pases_30_dias, cfr_porcentaje, tmd_minutos, acce_porcentaje }
//    pases en 30 días, CFR y ACCE en %, TMD en minutos (según la cabecera del archivo)
```

Convenciones:

- Todas las consultas SQL son parametrizadas y usan nombres calificados (`nexo_dev_bcp.jira_tickets`), sin depender de `search_path`.
- Un valor fuera de los valores cerrados de un filtro lanza un error en español, igual que en las tools actuales. Un `aplicativo` que no existe en `cvt` también.
- `buscar_tickets_similares` conserva la lógica de la SPEC 04: `websearch_to_tsquery('spanish', ...)` con las palabras unidas por `or`, orden por `ts_rank` y luego por `creado_en` y `codigo_ticket` descendentes, ventana `DIAS_VENTANA = 90`. No devuelve solución ni evidencias, porque `jira_tickets` no las tiene.
- Los tickets de `jira_tickets` no traen solución. Para explicar cómo se resuelve algo, el agente usa `buscar_documentos` (modelos operativos) y `buscar_componentes_github`.
- Las columnas numéricas de `chama` se devuelven con nombres que incluyen la unidad.
- Las claves de ticket son los `codigo_ticket` reales. La regla `NEXO-<id>` de la SPEC 04 deja de usarse.
- Comportamiento del agente en el dominio nuevo:
  - Busca tickets similares siempre que el usuario describe un problema o una necesidad, y aplica `aplicativo` si lo menciona.
  - Presenta cada ticket en una lista Markdown con su clave en negrita, título, tipo, estado, grupo resolutor y aplicativo. Aclara que la búsqueda cubre los últimos 90 días y que los tickets no registran la solución.
  - Si con filtros no hay coincidencias, repite la búsqueda una vez sin ellos y avisa que amplió el criterio.
  - Usa solo claves devueltas por la tool. Nunca inventa tickets.
  - Si le piden crear un ticket, explica que esa función aún no está disponible.
- `sesiones.js`, `server.js` y los campos `turno`, `borrador` y `ticketsCreados` de la sesión no cambian: la SPEC 07 los reutiliza.
- El código de `proponer_ticket` y `crear_ticket` pasa a `backend/src/tools/creacion.js`, que `tools/index.js` no importa, con un comentario que explica que está inactivo hasta la SPEC 07.

## Plan de implementación

1. Crear la base `nexo_dev_bcp`, cargar `db/nexo_dev_bcp_postgresql.sql` sin modificarlo y escribir `db/nexo_dev_bcp_migracion.sql`. El backend sigue usando `nexodev` y funciona igual. Prueba: los conteos de las 7 tablas coinciden, `creado_en` está en los últimos 90 días, el índice GIN existe y el archivo SQL no cambió.
2. Crear los módulos de `consultar_aplicativos`, `consultar_guardia` y `consultar_indicadores` en `backend/src/tools/` sobre `cvt`, `jira_ops_genie` y `chama`, sin registrarlos aún. Prueba: un script de `node` con `PGDATABASE=nexo_dev_bcp` devuelve las filas esperadas y rechaza valores inválidos.
3. Crear los módulos de `buscar_documentos` y `buscar_componentes_github` sobre `jira_confluence` y `github`. Prueba: el script comprueba filtros, `tiene_diagrama`, que no se devuelvan bytes y el recorte del código fuente.
4. Crear el módulo de `consultar_apis` sobre `portal_apis`. Prueba: el script comprueba que sin `api_id` no hay contrato y que con `api_id` llega el OpenAPI de ese servicio.
5. Crear el módulo de `buscar_tickets_similares` sobre `jira_tickets`. Prueba: el script comprueba la ventana de 90 días, el orden por similitud, cada filtro y que las claves existan.
6. Cambiar el backend a la base nueva: `PGDATABASE=nexo_dev_bcp` en `.env` y `.env.example`, registrar en `tools/index.js` las 7 tools nuevas, quitar las antiguas y las de creación, y mover el código de creación a `creacion.js`. Prueba: `GET /api/salud` devuelve 200 y `definiciones` lista las 7 tools.
7. Reescribir el prompt del sistema en `backend/src/agente.js` para el dominio nuevo, con el comportamiento descrito. Prueba: un script con `POST /api/chat` recorre preguntas de cada tool contra Gemini.
8. Actualizar `CLAUDE.md` con la base nueva, los comandos de recarga, las tools y lo que quedó inactivo. Prueba: ejecutar los comandos de `CLAUDE.md` sobre una base vacía recrea los datos.

## Criterios de aceptación

- [ ] `db/nexo_dev_bcp_postgresql.sql` no tiene cambios respecto a su versión en git.
- [ ] La base `nexo_dev_bcp` existe y sus tablas tienen 3, 273, 540, 9, 450, 150 y 9 filas (`cvt`, `jira_confluence`, `jira_tickets`, `jira_ops_genie`, `github`, `portal_apis`, `chama`).
- [ ] Los comandos de recarga documentados dejan la base idéntica: se pueden ejecutar dos veces seguidas con el mismo resultado.
- [ ] Tras la migración, los 540 tickets tienen `creado_en` dentro de los últimos 90 días y hay al menos 60 días distintos.
- [ ] La columna `busqueda` y el índice `idx_jira_tickets_busqueda` existen, y `EXPLAIN` de la búsqueda con `SET enable_seqscan = off` usa ese índice.
- [ ] Con `PGDATABASE=nexo_dev_bcp`, `GET /api/salud` devuelve 200 con `base_datos: "ok"`.
- [ ] `definiciones` contiene exactamente `consultar_aplicativos`, `buscar_documentos`, `buscar_componentes_github`, `buscar_tickets_similares`, `consultar_apis`, `consultar_guardia` y `consultar_indicadores`.
- [ ] `proponer_ticket` y `crear_ticket` no están en `definiciones`, y ningún archivo que importe `tools/index.js` contiene `INSERT`, `UPDATE`, `DELETE` ni DDL.
- [ ] `consultar_aplicativos({ aplicativo: "Billetera Digital" })` y `({ aplicativo: "yape" })` devuelven la fila de `YAPE`.
- [ ] `buscar_documentos` con `tipo: "modelo_operativo"` y `aplicativo: "YAPE"` devuelve solo modelos operativos de `YAPE`.
- [ ] Los documentos de tipo `diagrama_arquitectura` traen `tiene_diagrama: true` y ninguna tool devuelve bytes de `imagen_png`.
- [ ] `buscar_componentes_github` con `tipo: "contrato"` devuelve solo contratos, y ningún `codigo_fuente` supera 1001 caracteres.
- [ ] `consultar_apis({ aplicativo: "MBBK" })` no incluye `contrato`, y `consultar_apis({ api_id: 1 })` devuelve exactamente un servicio con su `contrato`.
- [ ] `consultar_guardia({ aplicativo: "TTIB" })` devuelve los turnos de `TTIB`, y `consultar_indicadores({ aplicativo: "TTIB", corte: "Actual" })` devuelve `FREEZE`.
- [ ] `buscar_tickets_similares({ consulta: "certificado pruebas" })` devuelve entre 1 y 5 tickets, todos con `creado_en` en los últimos 90 días, ordenados por similitud descendente, y cada `clave` existe en `jira_tickets`.
- [ ] Con `estado: "Terminado"`, `tipo: "OCD"` y `grupo_resolutor: "Seguridad"`, todos los resultados cumplen el filtro.
- [ ] Valores inválidos (`estado: "Cerrado"`, `tipo: "XYZ"`, `grupo_resolutor: "Otro"`, `aplicativo: "ABCD"`) lanzan un error en español.
- [ ] La consulta `'; DROP TABLE jira_tickets; --` se trata como texto, la tool no falla y `jira_tickets` conserva sus 540 filas.
- [ ] En el chat, "¿Cómo doy de alta un aplicativo consumidor en YAPE?" responde con los pasos del modelo operativo correspondiente.
- [ ] En el chat, "¿Quién es el PO de MBBK?" responde "Lucía Mendoza", y "¿Cómo están los indicadores de pases de TTIB?" menciona `FREEZE`.
- [ ] En el chat, "Necesito cargar un certificado de pruebas en YAPE" lista tickets con claves que existen en `jira_tickets` y aclara que cubre los últimos 90 días.
- [ ] En el chat, una necesidad de las aplicaciones sin coincidencias ("Quiero cambiar el logo de la aplicación de YAPE") responde que no encontró tickets similares y no incluye ninguna clave de ticket, aunque la búsqueda devuelva tickets que solo comparten el nombre de la aplicación.
- [ ] En el chat, una petición ajena a las aplicaciones ("La impresora de la oficina no imprime") no incluye ninguna clave de ticket ni inventa tickets. El agente puede responder que no encontró tickets similares o que la petición queda fuera de `YAPE`, `MBBK` y `TTIB` y sugerir el canal de soporte que corresponda.
- [ ] En el chat, "crea el ticket" explica que esa función aún no está disponible y no inserta ninguna fila.
- [ ] `POST /api/chat`, `frontend/` y el esquema de la base `nexodev` no cambian.
- [ ] `CLAUDE.md` describe la base nueva, los comandos de recarga, las 7 tools y la creación inactiva.

## Decisiones

- **Sí:** dividir el trabajo en dos specs: 06 cambia la fuente de lectura y 07 reconstruye la creación. Son decisiones distintas y la creación exige decisiones de producto (códigos `WO-` u `OCD-`, grupo resolutor, falta de columnas de solución y evidencias).
- **No:** una sola spec con todo. Quedaba demasiado grande para verificarla de una vez.
- **Sí:** el backend deja de leer las tablas de la SPEC 01, que quedan en el repo sin usar. No se borra nada y la decisión es reversible.
- **No:** eliminarlas, ni un selector de fuente por variable de entorno. Lo primero pierde trabajo y lo segundo mantiene dos modelos de datos distintos.
- **Sí:** base de datos nueva y separada, `nexo_dev_bcp`, y recarga con `dropdb` y `createdb`. Lo eligió el equipo. Así el archivo entregado, que hace `CREATE SCHEMA` sin `DROP`, se carga siempre sobre una base vacía y no se modifica.
- **No:** el mismo `nexodev` con esquema aparte, ni editar el archivo para que sea repetible.
- **Sí:** exponer las 7 tablas, con tres tools nuevas: `consultar_apis`, `consultar_guardia` y `consultar_indicadores`. El README ya lista el portal de APIs como fuente, y la guardia y los indicadores responden preguntas operativas reales.
- **Sí:** nombres de tabla calificados con el esquema en cada consulta. No depende de `search_path`.
- **Sí:** agregar `creado_en` con una migración propia. Lo eligió el equipo, para poder mantener la ventana de recencia de 90 días del README. Es una columna que el archivo no trae.
- **Sí:** las fechas de los 540 tickets existentes son simuladas, repartidas de forma determinista en 90 días según `codigo_ticket`, como en la SPEC 01. La migración lo documenta, porque son datos inventados.
- **No:** fechas iguales para todos (el orden por fecha no aportaría) y fechas nulas (la ventana excluiría los 540 tickets).
- **Sí:** ventana de 90 días y filtros `aplicativo`, `estado`, `tipo` y `grupo_resolutor`. El filtro por `ambiente` no existe porque en estos datos `WO` equivale a QA y `OCD` a Producción.
- **Sí:** columna `busqueda` y su índice GIN en la migración. Mantiene el mismo mecanismo de la SPEC 04 con 540 filas, y la búsqueda no recorre la tabla entera.
- **Sí:** las claves de ticket son los `codigo_ticket` reales. La regla `NEXO-<id>` de la SPEC 04 se inventaba porque no había clave, y ya existe una.
- **Sí:** `consultar_apis` devuelve un resumen y el contrato OpenAPI solo cuando se pide un `api_id`. Lo eligió el equipo, por el costo en tokens de una cuota gratuita limitada.
- **Sí:** `codigo_fuente` recortado a 1000 caracteres, igual que las evidencias en la SPEC 04.
- **Sí:** de los diagramas PNG solo se informa que existen (`tiene_diagrama`). Mostrarlos exige cambios en la interfaz y en la API.
- **Sí:** renombrar `buscar_soluciones_codigo` a `buscar_componentes_github`. En el dominio nuevo `github` guarda componentes, aprovisionamiento y contratos, no soluciones. Es una decisión de nombre que no confirmó el equipo.
- **Sí:** `proponer_ticket` y `crear_ticket` se desregistran y su código se conserva inactivo en `creacion.js`. Lo eligió el equipo. Escribían en una tabla que no existe en la base nueva, y la SPEC 07 reutiliza su lógica de borrador y de confirmación por turno.
- **No:** borrar ese código. La SPEC 07 partiría de cero.
- **Sí:** `documentos` y `componentes` siguen con búsqueda `ILIKE`. Cambiarlos a full-text queda para otra spec.
- **Sí:** el agente puede redirigir una petición claramente ajena a las aplicaciones, como una impresora de oficina, en lugar de buscar tickets. Es mejor para el usuario que responder "no encontré tickets" sobre algo que no corresponde a este catálogo. Se ajustó el criterio de aceptación para aceptar ambas respuestas, siempre que no aparezcan claves inventadas.
- **Sí:** el prompt le pide al agente no poner el nombre de la aplicación ni palabras genéricas en las palabras clave, y descartar los tickets que solo coinciden en eso. La búsqueda une las palabras con `or`, y sin esa regla "cambiar el logo de YAPE" devolvía cinco tickets sin relación.
- **Sí:** verificación manual con scripts de `node`, `psql` y `POST /api/chat`, igual que en las specs anteriores.

## Riesgos

| Riesgo                                                                                          | Mitigación                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Las fechas simuladas relativas a la carga dejan la ventana vacía pasados 90 días                | Recargar la base con los comandos de `CLAUDE.md`. Documentarlo en la migración y en `CLAUDE.md` |
| Recargar la base borra la migración                                                             | La recarga documentada ejecuta siempre el archivo y luego la migración                          |
| Los 540 tickets son plantillas repetidas (por aplicación y perfil), y los resultados se parecen | Aceptado en el MVP. Las claves y los filtros permiten distinguirlos                              |
| Siete tools aumentan el tamaño de cada llamada al modelo y el gasto de la cuota gratuita        | Descripciones cortas, máximo 5 filas por tool y contrato solo bajo pedido                        |
| El modelo elige mal entre siete tools                                                           | Descripciones claras y verificación con una pregunta por cada tool                               |
| Un contrato OpenAPI o un código fuente muy largos consumen tokens                               | El contrato solo se devuelve por `api_id` y el código se recorta a 1000 caracteres              |
| Se pierde la creación de tickets hasta la SPEC 07                                               | El agente avisa que no está disponible. El código queda inactivo en `creacion.js`                |
| El agente sugiere tickets de tipo solicitud cuando el usuario describe un error real            | Aceptado: los datos nuevos no tienen incidentes. El prompt aclara el tipo de cada ticket        |
| `nexodev` queda con datos que nadie usa                                                         | Documentado en `CLAUDE.md`. Se puede eliminar en otra spec                                       |
| La clave real `WO-0000001101` y las claves `NEXO-` anteriores se confunden en el historial       | Las sesiones viven 30 minutos en memoria, así que no hay historial persistente de claves `NEXO-`  |
| El archivo entregado crece o cambia y la carga falla                                            | El archivo no se modifica y los conteos de los criterios detectan el cambio                      |

## Lo que **no** está en esta spec

- Crear tickets en `jira_tickets` (SPEC 07).
- Mostrar diagramas PNG en el chat.
- Borrar `nexodev`, sus tablas o los scripts de la SPEC 01.
- Un selector entre la fuente antigua y la nueva.
- Modificar `db/nexo_dev_bcp_postgresql.sql`.
- Cambios en `frontend/` y en `POST /api/chat`.
- Agente 2 de aprovisionamiento.
- Búsqueda full-text en documentos y componentes.
- Pruebas automáticas.
