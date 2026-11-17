# SPEC 01 — PostgreSQL con datos simulados de Jira, Confluence, Portal de APIs y GitHub

> **Status:** Approved
> **Depends on:** SPEC 00
> **Date:** 2026-11-13
> **Objective:** Crear la base de datos PostgreSQL `nexodev` con el esquema de cuatro tablas y datos semilla en español que simulan las fuentes de información del chatbot.

## Por qué existe esta spec

El MVP no se integra con plataformas reales (SPEC 00). Todo el agente lee y escribe en PostgreSQL. Las specs 02 a 05 dependen de los nombres de tablas y columnas que se fijan aquí.

## Alcance

**Dentro:**

- Base de datos `nexodev` en un PostgreSQL instalado localmente (versión 12 o superior).
- `db/schema.sql`: crea las cuatro tablas, sus restricciones y el índice de búsqueda.
- `db/seed.sql`: carga datos semilla en español.
- Búsqueda full-text nativa sobre tickets con el diccionario `spanish`.
- Volumen: unos 100 tickets y unas 15 filas en cada una de las otras tres tablas.
- Sección de comandos de base de datos en `CLAUDE.md`.

**Fuera de alcance (para otras specs):**

- API, backend y conexión desde código (SPEC 02).
- Consulta de tickets similares desde el agente (SPEC 04).
- Creación de tickets desde el chat (SPEC 05).
- Docker, Docker Compose y servicios cloud.
- Herramientas de migraciones (Flyway, Alembic, Prisma).
- Búsqueda con `pg_trgm` o `pgvector`.
- Búsqueda full-text en `documentos` y `soluciones_codigo`.
- Usuarios, roles y permisos de base de datos.

## Modelo de datos

Nombres de tablas y columnas en español, sin tildes. Los scripts crean las tablas en este orden por las claves foráneas.

```sql
-- Simula el Portal de APIs
CREATE TABLE apis_proyectos (
    id                  SERIAL PRIMARY KEY,
    nombre              TEXT NOT NULL UNIQUE,
    tipo                TEXT NOT NULL CHECK (tipo IN ('api', 'base_datos', 'aplicacion')),
    equipo_responsable  TEXT NOT NULL,
    descripcion         TEXT NOT NULL
);

-- Simula Jira
CREATE TABLE tickets (
    id                  SERIAL PRIMARY KEY,
    titulo              TEXT NOT NULL,
    detalle_problema    TEXT NOT NULL,
    equipo_responsable  TEXT NOT NULL,
    evidencias          TEXT,
    aplicativo_id       INTEGER NOT NULL REFERENCES apis_proyectos(id),
    ambiente            TEXT NOT NULL CHECK (ambiente IN ('certificacion', 'produccion')),
    detalle_solucion    TEXT,
    estado              TEXT NOT NULL DEFAULT 'abierto'
                        CHECK (estado IN ('abierto', 'en_progreso', 'resuelto', 'cerrado')),
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    busqueda            TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('spanish',
            coalesce(titulo, '') || ' ' ||
            coalesce(detalle_problema, '') || ' ' ||
            coalesce(detalle_solucion, ''))
    ) STORED
);
CREATE INDEX tickets_busqueda_idx ON tickets USING GIN (busqueda);

-- Simula Confluence
CREATE TABLE documentos (
    id          SERIAL PRIMARY KEY,
    titulo      TEXT NOT NULL,
    tipo        TEXT NOT NULL CHECK (tipo IN ('modelo_operativo', 'proyecto')),
    contenido   TEXT NOT NULL,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Simula GitHub
CREATE TABLE soluciones_codigo (
    id              SERIAL PRIMARY KEY,
    repositorio     TEXT NOT NULL,
    titulo          TEXT NOT NULL,
    descripcion     TEXT NOT NULL,
    aplicativo_id   INTEGER REFERENCES apis_proyectos(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Los seis campos del ticket definidos en el README se mapean así: detalle del problema (`detalle_problema`), equipo (`equipo_responsable`), evidencias (`evidencias`), aplicativo (`aplicativo_id`), ambiente (`ambiente`) y detalle de la solución (`detalle_solucion`).

Convenciones:

- Los datos semilla cubren los casos del README: error HTTP 500 en una API, alto consumo de memoria en una base de datos, alto consumo de CPU en una base de datos y problemas generales.
- Las fechas `creado_en` de los tickets semilla se reparten en los últimos 90 días respecto a la fecha de carga.
- Los tickets semilla usan los cuatro estados y ambos ambientes.

## Plan de implementación

1. Crear `db/schema.sql` con `DROP TABLE IF EXISTS ... CASCADE` y la tabla `apis_proyectos`. Prueba: `createdb nexodev && psql -d nexodev -f db/schema.sql` termina sin errores.
2. Agregar la tabla `tickets` con las restricciones `CHECK`, la columna `busqueda` y el índice GIN. Prueba: volver a ejecutar `schema.sql` sin errores.
3. Agregar las tablas `documentos` y `soluciones_codigo`. Prueba: `psql -d nexodev -c '\dt'` lista las cuatro tablas.
4. Crear `db/seed.sql` con unas 15 filas en `apis_proyectos`, entre APIs, bases de datos y aplicaciones. Prueba: `SELECT count(*) FROM apis_proyectos` devuelve al menos 15.
5. Agregar unas 15 filas en `documentos` y unas 15 en `soluciones_codigo`. Prueba: ambos conteos devuelven al menos 15.
6. Agregar unos 100 tickets en `tickets`, repartidos entre los cuatro casos del README, ambos ambientes y los cuatro estados. Prueba: `SELECT count(*) FROM tickets` devuelve al menos 100.
7. Agregar a `CLAUDE.md` los comandos de base de datos: crear la BD, cargar `schema.sql` y `seed.sql`, y consultar tickets por búsqueda. Prueba: ejecutar los comandos copiados desde `CLAUDE.md` sobre una BD vacía.

## Criterios de aceptación

- [ ] `createdb nexodev` seguido de `psql -d nexodev -f db/schema.sql -f db/seed.sql` termina con código de salida 0 sobre una instalación sin la base.
- [ ] Ejecutar `schema.sql` y `seed.sql` por segunda vez termina con código de salida 0 y deja el mismo número de filas.
- [ ] `psql -d nexodev -c '\dt'` lista exactamente `apis_proyectos`, `tickets`, `documentos` y `soluciones_codigo`.
- [ ] `tickets` tiene al menos 100 filas, y las otras tres tablas tienen al menos 15 filas cada una.
- [ ] Insertar un ticket con `ambiente = 'desarrollo'` falla por la restricción `CHECK`.
- [ ] Insertar un ticket con `estado = 'pendiente'` falla por la restricción `CHECK`.
- [ ] Insertar un ticket con un `aplicativo_id` inexistente falla por la clave foránea.
- [ ] `SELECT id, titulo FROM tickets WHERE busqueda @@ plainto_tsquery('spanish', 'error 500 api') LIMIT 5` devuelve al menos un ticket.
- [ ] La misma consulta con `'memoria base de datos'` devuelve al menos un ticket, y con `'cpu base de datos'` también.
- [ ] `EXPLAIN` de la consulta de búsqueda muestra uso de `tickets_busqueda_idx` cuando se ejecuta con `SET enable_seqscan = off`.
- [ ] Hay tickets en ambos ambientes y en los cuatro estados.
- [ ] `CLAUDE.md` contiene los comandos de base de datos y funcionan al copiarlos.

## Decisiones

- **Sí:** PostgreSQL instalado localmente. Es la preferencia del equipo y evita depender de Docker.
- **No:** Docker Compose y servicios cloud. Se pueden sumar en otra spec si el equipo lo pide.
- **Sí:** scripts SQL planos (`db/schema.sql` y `db/seed.sql`). El stack del backend sigue pendiente y los scripts no lo condicionan.
- **No:** herramientas de migraciones. Atarían la spec al stack elegido.
- **Sí:** `schema.sql` borra y recrea las tablas. Hace el proceso repetible y se descarta el contenido al recargar, algo aceptable con datos simulados.
- **Sí:** nombres de tablas del diagrama de la SPEC 00. No obliga a modificar esa spec.
- **Sí:** datos en español y diccionario `spanish`. Coincide con el idioma del README y del equipo.
- **Sí:** unos 100 tickets y unas 15 filas en las demás tablas. Los tickets son el foco de la búsqueda de similares.
- **Sí:** full-text search nativo con columna generada e índice GIN. No requiere extensiones.
- **No:** `pg_trgm` y `pgvector`. `pgvector` exige un modelo de embeddings y esa decisión de LLM está pendiente.
- **Sí:** `aplicativo_id` como clave foránea a `apis_proyectos`. Evita nombres de aplicativos inconsistentes.
- **Sí:** `evidencias` como `TEXT`. Entra directo en búsquedas y es sencillo de capturar desde el chat.
- **Sí:** ambientes `certificacion` y `produccion`, y estados `abierto`, `en_progreso`, `resuelto` y `cerrado`, validados con `CHECK`.
- **Sí:** columna `tipo` en `apis_proyectos` (`api`, `base_datos`, `aplicacion`). Los ejemplos del README piden comparar errores de APIs contra errores de bases de datos.
- **Sí:** base de datos `nexodev`, cargada con `psql`.

## Riesgos

| Riesgo                                                          | Mitigación                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Versión de PostgreSQL menor a 12 no soporta columnas generadas  | Documentar la versión mínima en `CLAUDE.md` y verificarla con `psql -V`     |
| El diccionario `spanish` no existe en una instalación mínima    | Verificar con `\dF` y documentarlo como requisito en `CLAUDE.md`            |
| Datos semilla poco variados hacen que la similitud no se pueda probar | Incluir al menos 10 tickets por cada caso del README, con redacción distinta |
| Recargar `schema.sql` borra tickets creados desde el chat       | Aceptado para el MVP. Se documenta en `CLAUDE.md`                           |

## Lo que **no** está en esta spec

- API, backend o código de conexión.
- Docker o servicios cloud.
- Migraciones versionadas.
- Búsqueda por trigramas o por embeddings.
- Búsqueda full-text en `documentos` y `soluciones_codigo`.
- Datos de Agente 2 (aprovisionamiento).
- Usuarios, roles y permisos.
