-- Esquema de la base de datos nexodev (SPEC 01).
-- Es repetible: borra y recrea las tablas en cada ejecución.

DROP TABLE IF EXISTS soluciones_codigo CASCADE;
DROP TABLE IF EXISTS documentos CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS apis_proyectos CASCADE;

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
