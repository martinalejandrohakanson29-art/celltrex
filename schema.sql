-- ====================================================================
-- CELLTREX S.A. - ESQUEMA DE BASE DE DATOS POSTGRESQL 16
-- Modelo relacional para sistema Kanban con datos bancarios y transferencias
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Espacios de trabajo (Workspaces)
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tableros (Boards)
CREATE TABLE IF NOT EXISTS boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    board_key VARCHAR(100) NOT NULL UNIQUE,
    emoji VARCHAR(20) DEFAULT '📋',
    is_custom BOOLEAN DEFAULT FALSE,
    form_config JSONB DEFAULT '[]'::jsonb,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Listas / Columnas de Estados (Lists)
CREATE TABLE IF NOT EXISTS lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    position DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_closed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Tarjetas de Trabajo (Cards) con Datos de Transferencia y Reserva
CREATE TABLE IF NOT EXISTS cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    position DOUBLE PRECISION NOT NULL DEFAULT 0,
    due_date DATE, -- Opcional según configuración de tablero
    
    -- Bloque Datos para transferir (Opcional según configuración del tablero)
    transfer_titular VARCHAR(255),
    transfer_cuit VARCHAR(50),
    transfer_cbu VARCHAR(50),
    transfer_monto_ars NUMERIC(15,2),
    transfer_fecha_desde DATE,
    transfer_fecha_hasta DATE,
    transfer_dias_reservados INT,

    -- Estado de Pago (Pendiente / Pagado)
    is_paid BOOLEAN NOT NULL DEFAULT FALSE,

    is_closed BOOLEAN DEFAULT FALSE,
    custom_data JSONB DEFAULT '{}'::jsonb, -- Metadatos adicionales
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Recursos / Etiquetas (Labels / Resources)
CREATE TABLE IF NOT EXISTS labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(50) NOT NULL DEFAULT 'blue_dark',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Relación Tarjetas <-> Recursos (Card Labels)
CREATE TABLE IF NOT EXISTS card_labels (
    card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, label_id)
);

-- 7. Sitios (Sites)
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(50) NOT NULL DEFAULT '#00A8B5',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Relación Tarjetas <-> Sitios (Card Sites)
CREATE TABLE IF NOT EXISTS card_sites (
    card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, site_id)
);

-- 9. Archivos Adjuntos (Card Attachments)
CREATE TABLE IF NOT EXISTS card_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    is_image BOOLEAN DEFAULT FALSE,
    storage_path TEXT, -- Ruta en disco/S3 o URL relativa
    file_data TEXT,    -- Para almacenamiento base64 inicial si aplica
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices de alto rendimiento
CREATE INDEX IF NOT EXISTS idx_lists_board ON lists(board_id) WHERE NOT is_closed;
CREATE INDEX IF NOT EXISTS idx_cards_list ON cards(list_id) WHERE NOT is_closed;
CREATE INDEX IF NOT EXISTS idx_cards_due_date ON cards(due_date);
CREATE INDEX IF NOT EXISTS idx_cards_transfer_cuit ON cards(transfer_cuit);
CREATE INDEX IF NOT EXISTS idx_cards_is_paid ON cards(is_paid);
CREATE INDEX IF NOT EXISTS idx_cards_custom_data ON cards USING gin(custom_data);
CREATE INDEX IF NOT EXISTS idx_labels_board ON labels(board_id);
CREATE INDEX IF NOT EXISTS idx_sites_board ON sites(board_id);
CREATE INDEX IF NOT EXISTS idx_attachments_card ON card_attachments(card_id);

-- Función y disparadores para actualizar automáticamente updated_at
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS 
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
 LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp_boards
BEFORE UPDATE ON boards
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp_lists
BEFORE UPDATE ON lists
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp_cards
BEFORE UPDATE ON cards
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
