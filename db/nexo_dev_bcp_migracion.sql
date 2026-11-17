-- Migración propia de la base nexo_dev_bcp (SPEC 06).
-- Se ejecuta DESPUÉS de cargar db/nexo_dev_bcp_postgresql.sql, que no se modifica.
-- Es repetible: se puede ejecutar más de una vez sobre la misma base.

-- 1. Fecha de creación de los tickets.
--    El archivo entregado no trae ninguna fecha en jira_tickets. La búsqueda de tickets
--    similares necesita una para limitar los resultados a los últimos 90 días.
ALTER TABLE nexo_dev_bcp.jira_tickets
    ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Fechas SIMULADAS para los tickets existentes (no son datos reales).
--    Cada ticket recibe una antigüedad de 0 a 89 días y de 0 a 23 horas respecto al momento
--    de la carga. La antigüedad sale de un hash de codigo_ticket, así que es determinista:
--    el mismo ticket recibe siempre la misma antigüedad y los tickets de distintos tipos y
--    aplicaciones quedan mezclados. Como la fecha es relativa a la carga, pasados 90 días hay
--    que recargar la base para que la ventana de recencia no quede vacía.
UPDATE nexo_dev_bcp.jira_tickets
   SET creado_en = now() - make_interval(
         days  => (abs(('x' || substr(md5(codigo_ticket), 1, 8))::bit(32)::bigint) % 90)::int,
         hours => (abs(('x' || substr(md5(codigo_ticket), 9, 8))::bit(32)::bigint) % 24)::int
       );

-- 3. Búsqueda de texto completo en español sobre título y descripción.
ALTER TABLE nexo_dev_bcp.jira_tickets
    ADD COLUMN IF NOT EXISTS busqueda TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('spanish', coalesce(titulo, '') || ' ' || coalesce(descripcion, ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_jira_tickets_busqueda
    ON nexo_dev_bcp.jira_tickets USING GIN (busqueda);

-- 4. Tipo ITSM (SPEC 09).
--    El archivo entregado solo admite WO y OCD en jira_tickets.tipo. El agente también crea
--    tickets de tipo ITSM, así que se amplía el CHECK. El nombre del CHECK es el que genera
--    PostgreSQL para el archivo entregado. Es repetible.
ALTER TABLE nexo_dev_bcp.jira_tickets DROP CONSTRAINT IF EXISTS jira_tickets_tipo_check;
ALTER TABLE nexo_dev_bcp.jira_tickets
    ADD CONSTRAINT jira_tickets_tipo_check CHECK (tipo IN ('WO', 'OCD', 'ITSM'));
