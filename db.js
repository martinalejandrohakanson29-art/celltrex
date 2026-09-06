const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

let pool = null;
let isConnected = false;

if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
  });
} else if (process.env.PGHOST) {
  pool = new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'celltrex'
  });
}

async function query(text, params) {
  if (!pool) return null;
  return pool.query(text, params);
}

async function initDatabase() {
  if (!pool) {
    console.log('ℹ️  [DB] No se detectó DATABASE_URL. Operando en modo standalone (fallback JSON).');
    return false;
  }

    let client;
  try {
    client = await pool.connect();
    console.log('✅ [DB] Conexión establecida con PostgreSQL.');
    isConnected = true;

    // 1. Ejecutar schema.sql si es necesario
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await client.query(schemaSql);
      console.log('✅ [DB] Esquema DDL sincronizado en PostgreSQL.');
    }

    // 2. Verificar si hay tableros cargados, si está vacío cargar seed
    const resBoards = await client.query('SELECT COUNT(*) FROM boards');
    const boardCount = parseInt(resBoards.rows[0].count, 10);

    if (boardCount === 0) {
      console.log('🌱 [DB] Base de datos vacía. Iniciando carga automática de datos desde celltrex_dataset.json...');
      const datasetPath = path.join(__dirname, 'celltrex_dataset.json');
      if (fs.existsSync(datasetPath)) {
        const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

        // Crear Workspace principal
        const resWs = await client.query(
          "INSERT INTO workspaces (name, description) VALUES ('Celltrex Operaciones', 'Workspace principal de Celltrex S.A.') RETURNING id"
        );
        const wsId = resWs.rows[0].id;

        for (const b of dataset) {
          const resB = await client.query(
            "INSERT INTO boards (workspace_id, name, board_key, emoji, is_custom, form_config) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
            [wsId, b.name, b.key || ('b_' + b.id), b.emoji || '📋', false, JSON.stringify(b.formConfig || [])]
          );
          const boardDbId = resB.rows[0].id;

          // Mapear listas
          const listMap = new Map();
          for (const [idx, l] of b.lists.entries()) {
            const resL = await client.query(
              "INSERT INTO lists (board_id, name, position) VALUES ($1, $2, $3) RETURNING id",
              [boardDbId, l.name, l.pos || ((idx + 1) * 1000)]
            );
            listMap.set(l.id, resL.rows[0].id);
          }

          // Mapear labels
          const labelMap = new Map();
          for (const lbl of (b.labels || [])) {
            const resLbl = await client.query(
              "INSERT INTO labels (board_id, name, color) VALUES ($1, $2, $3) RETURNING id",
              [boardDbId, lbl.name, lbl.color || 'blue_dark']
            );
            labelMap.set(lbl.name, resLbl.rows[0].id);
          }

          // Mapear sitios
          const siteMap = new Map();
          for (const st of (b.sitios || [])) {
            const resSt = await client.query(
              "INSERT INTO sites (board_id, name, color) VALUES ($1, $2, $3) RETURNING id",
              [boardDbId, st.name, st.color || 'orange']
            );
            siteMap.set(st.name, resSt.rows[0].id);
          }

          // Insertar tarjetas
          for (const [cIdx, c] of (b.cards || []).entries()) {
            const targetListDbId = listMap.get(c.idList) || Array.from(listMap.values())[0];
            if (!targetListDbId) continue;

            const t = c.transferData || {};
            const resCard = await client.query(
              `INSERT INTO cards (
                list_id, title, description, position, is_paid,
                transfer_titular, transfer_cuit, transfer_cbu, transfer_monto_ars,
                transfer_fecha_desde, transfer_fecha_hasta, transfer_dias_reservados,
                due_date, custom_data
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
              [
                targetListDbId,
                c.name,
                c.desc || '',
                (cIdx + 1) * 1000,
                !!c.isPaid,
                t.titular || null,
                t.cuit || null,
                t.cbu || null,
                t.monto_ars ? Number(t.monto_ars) : null,
                t.fecha_desde || null,
                t.fecha_hasta || null,
                t.dias_reservados ? parseInt(t.dias_reservados, 10) : null,
                t.vencimiento || c.due || null,
                JSON.stringify(c.customFields || {})
              ]
            );
            const cardDbId = resCard.rows[0].id;

            // Relacionar labels
            for (const lbl of (c.labels || [])) {
              const lblDbId = labelMap.get(lbl.name);
              if (lblDbId) {
                await client.query("INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [cardDbId, lblDbId]);
              }
            }

            // Relacionar sitios
            for (const st of (c.sitios || [])) {
              const siteDbId = siteMap.get(st.name);
              if (siteDbId) {
                await client.query("INSERT INTO card_sites (card_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [cardDbId, siteDbId]);
              }
            }
          }
        }
        console.log('✅ [DB] Carga inicial de tableros y tarjetas completada con éxito.');
      }
    }

    return true;
  } catch (err) {
    console.error('❌ [DB] Error al inicializar PostgreSQL:', err.message);
    return false;
  } finally {
    if (client) client.release();
  }
}

module.exports = {
  query,
  initDatabase,
  get isConnected() {
    return isConnected;
  }
};
