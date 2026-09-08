const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5050;

// Configuración de Multer para archivos adjuntos
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB límite por archivo
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir archivos estáticos
app.use('/uploads', express.static(uploadDir));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(__dirname));

// Healthcheck para Coolify
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: db.isConnected ? 'postgresql' : 'standalone_json',
    app: 'Celltrex Kanban'
  });
});

// ==========================================
// API REST: TABLEROS
// ==========================================

// Obtener todos los tableros con sus listas, tarjetas y etiquetas
app.get('/api/boards', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  if (!db.isConnected) {
    const datasetPath = path.join(__dirname, 'celltrex_dataset.json');
    if (fs.existsSync(datasetPath)) {
      const data = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
      return res.json({ success: true, source: 'standalone', data });
    }
    return res.json({ success: true, source: 'empty', data: [] });
  }

  try {
    // 1. Obtener tableros
    const boardsRes = await db.query('SELECT * FROM boards ORDER BY created_at ASC');
    const boards = [];

    for (const b of boardsRes.rows) {
      // Listas
      const listsRes = await db.query('SELECT * FROM lists WHERE board_id = $1 AND NOT is_closed ORDER BY position ASC', [b.id]);
      
      // Labels
      const labelsRes = await db.query('SELECT * FROM labels WHERE board_id = $1 ORDER BY name ASC', [b.id]);

      // Sitios
      const sitesRes = await db.query('SELECT * FROM sites WHERE board_id = $1 ORDER BY name ASC', [b.id]);

      // Tarjetas del tablero
      const cardsRes = await db.query(`
        SELECT c.*, 
          COALESCE(json_agg(DISTINCT jsonb_build_object('id', lbl.id, 'name', lbl.name, 'color', lbl.color)) FILTER (WHERE lbl.id IS NOT NULL), '[]') as labels,
          COALESCE(json_agg(DISTINCT jsonb_build_object('id', st.id, 'name', st.name, 'color', st.color)) FILTER (WHERE st.id IS NOT NULL), '[]') as sitios,
          COALESCE(json_agg(DISTINCT jsonb_build_object('id', att.id, 'name', att.filename, 'size', att.file_size, 'type', att.mime_type, 'isImage', att.is_image, 'dataUrl', att.storage_path)) FILTER (WHERE att.id IS NOT NULL), '[]') as attachments
        FROM cards c
        JOIN lists l ON c.list_id = l.id
        LEFT JOIN card_labels cl ON c.id = cl.card_id
        LEFT JOIN labels lbl ON cl.label_id = lbl.id
        LEFT JOIN card_sites cs ON c.id = cs.card_id
        LEFT JOIN sites st ON cs.site_id = st.id
        LEFT JOIN card_attachments att ON c.id = att.card_id
        WHERE l.board_id = $1 AND NOT c.is_closed
        GROUP BY c.id
        ORDER BY c.position ASC
      `, [b.id]);

      const formattedCards = cardsRes.rows.map(c => ({
        id: c.id,
        idList: c.list_id,
        name: c.title,
        desc: c.description,
        isPaid: c.is_paid,
        createdAt: c.created_at ? (c.created_at.toISOString ? c.created_at.toISOString() : c.created_at) : null,
        updatedAt: c.updated_at ? (c.updated_at.toISOString ? c.updated_at.toISOString() : c.updated_at) : null,
        labels: c.labels || [],
        sitios: c.sitios || [],
        attachments: (c.attachments || []).map(a => ({
          ...a,
          dataUrl: a.dataUrl ? (a.dataUrl.startsWith('http') || a.dataUrl.startsWith('data:') ? a.dataUrl : `/uploads/${path.basename(a.dataUrl)}`) : null
        })),
        transferData: {
          titular: c.transfer_titular,
          cuit: c.transfer_cuit,
          cbu: c.transfer_cbu,
          monto_noche: (c.custom_data && c.custom_data.monto_noche) ? c.custom_data.monto_noche : (c.transfer_dias_reservados ? Math.round((c.transfer_monto_ars || 0) / c.transfer_dias_reservados) : (c.transfer_monto_ars || 0)),
          monto_ars: c.transfer_monto_ars,
          fecha_desde: c.transfer_fecha_desde ? c.transfer_fecha_desde.toISOString().split('T')[0] : '',
          fecha_hasta: c.transfer_fecha_hasta ? c.transfer_fecha_hasta.toISOString().split('T')[0] : '',
          dias_reservados: c.transfer_dias_reservados,
          is_indefinite: !!(c.transfer_is_indefinite || (c.custom_data && c.custom_data.is_indefinite)),
          vencimiento: c.due_date ? c.due_date.toISOString().split('T')[0] : '',
          paymentTranches: (c.custom_data && c.custom_data.paymentTranches) ? c.custom_data.paymentTranches : null
        },
        customFields: c.custom_data || {}
      }));

      boards.push({
        id: b.id,
        key: b.board_key,
        name: b.name,
        emoji: b.emoji || '📋',
        isCustom: b.is_custom,
        formConfig: b.form_config || [],
        lists: listsRes.rows.map(l => ({ id: l.id, name: l.name, pos: l.position })),
        labels: labelsRes.rows.map(lbl => ({ id: lbl.id, name: lbl.name, color: lbl.color })),
        sitios: sitesRes.rows.map(st => ({ id: st.id, name: st.name, color: st.color })),
        cards: formattedCards
      });
    }

    res.json({ success: true, source: 'postgresql', data: boards });
  } catch (err) {
    console.error('Error fetching boards:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Crear nuevo tablero
app.post('/api/boards', async (req, res) => {
  const { name, emoji, lists, formConfig, isCustom } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre del tablero es requerido' });

  if (!db.isConnected) {
    return res.json({ success: true, message: 'Operando en modo local' });
  }

  try {
    const boardKey = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now();
    const resB = await db.query(
      'INSERT INTO boards (name, board_key, emoji, is_custom, form_config) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, boardKey, emoji || '📋', isCustom !== false, JSON.stringify(formConfig || [])]
    );
    const newBoard = resB.rows[0];

    const createdLists = [];
    const listNames = Array.isArray(lists) ? lists : ['Pendiente', 'En Proceso', 'Finalizado'];
    for (const [idx, lName] of listNames.entries()) {
      const resL = await db.query(
        'INSERT INTO lists (board_id, name, position) VALUES ($1, $2, $3) RETURNING *',
        [newBoard.id, typeof lName === 'object' ? lName.name : lName, (idx + 1) * 1000]
      );
      createdLists.push(resL.rows[0]);
    }

    res.json({ success: true, board: { ...newBoard, lists: createdLists } });
  } catch (err) {
    console.error('Error creating board:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Eliminar tablero
app.delete('/api/boards/:id', async (req, res) => {
  if (!db.isConnected) return res.json({ success: true });
  try {
    await db.query('DELETE FROM boards WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guardar configuración de campos del tablero
app.put('/api/boards/:id/config', async (req, res) => {
  if (!db.isConnected) return res.json({ success: true });
  try {
    const { formConfig } = req.body;
    await db.query('UPDATE boards SET form_config = $1 WHERE id = $2', [JSON.stringify(formConfig), req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API REST: TARJETAS
// ==========================================

// Crear tarjeta
app.post('/api/cards', async (req, res) => {
  if (!db.isConnected) return res.json({ success: true, cardId: 'c_' + Date.now() });

  const { listId, title, desc, isPaid, transferData, customFields, labels, sitios } = req.body;
  if (!listId || !title) return res.status(400).json({ error: 'listId y title son obligatorios' });

  try {
    const t = transferData || {};
    const resCard = await db.query(`
      INSERT INTO cards (
        list_id, title, description, is_paid,
        transfer_titular, transfer_cuit, transfer_cbu, transfer_monto_ars,
        transfer_fecha_desde, transfer_fecha_hasta, transfer_dias_reservados, transfer_is_indefinite,
        due_date, custom_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *
    `, [
      listId,
      title,
      desc || '',
      !!isPaid,
      t.titular || null,
      t.cuit || null,
      t.cbu || null,
      t.monto_ars ? Number(t.monto_ars) : null,
      t.fecha_desde || null,
      t.fecha_hasta || null,
      t.dias_reservados ? parseInt(t.dias_reservados, 10) : null,
      !!t.is_indefinite,
      t.vencimiento || null,
      JSON.stringify({
        ...(customFields || {}),
        is_indefinite: !!t.is_indefinite,
        monto_noche: t.monto_noche || 0,
        paymentTranches: t.paymentTranches || []
      })
    ]);

    const cardId = resCard.rows[0].id;

    // Asociar labels
    if (Array.isArray(labels)) {
      for (const l of labels) {
        let labelId = l.id;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(labelId);
        if (!isUuid && l.name) {
          const lRes = await db.query(
            `SELECT id FROM labels WHERE name = $1 AND board_id = (SELECT board_id FROM lists WHERE id = $2 LIMIT 1) LIMIT 1`,
            [l.name, listId]
          );
          if (lRes.rowCount > 0) labelId = lRes.rows[0].id;
          else labelId = null;
        }
        if (labelId) {
          await db.query('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cardId, labelId]);
        }
      }
    }

    // Asociar sitios
    if (Array.isArray(sitios)) {
      for (const s of sitios) {
        let siteId = s.id;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(siteId);
        if (!isUuid && s.name) {
          const sRes = await db.query(
            `SELECT id FROM sites WHERE name = $1 AND board_id = (SELECT board_id FROM lists WHERE id = $2 LIMIT 1) LIMIT 1`,
            [s.name, listId]
          );
          if (sRes.rowCount > 0) siteId = sRes.rows[0].id;
          else siteId = null;
        }
        if (siteId) {
          await db.query('INSERT INTO card_sites (card_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cardId, siteId]);
        }
      }
    }

    res.json({ success: true, card: resCard.rows[0] });
  } catch (err) {
    console.error('Error creating card:', err);
    res.status(500).json({ error: err.message });
  }
});

// Actualizar tarjeta (mover columna, estado pago, notas, campos)
app.put('/api/cards/:id', async (req, res) => {
  if (!db.isConnected) return res.json({ success: true });

  const { id } = req.params;
  const { listId, position, isPaid, title, desc, paymentTranches, transferData, customFields, labels, sitios } = req.body;

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!isUuid) {
    return res.status(400).json({ error: 'ID de tarjeta inválido para actualización (debe ser UUID)', needCreate: true });
  }

  const safeDate = (val) => {
    if (!val || typeof val !== 'string') return null;
    const trimmed = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    return null;
  };

  try {
    const updates = ['updated_at = NOW()'];
    const values = [id];
    let idx = 2;

    if (listId !== undefined) {
      updates.push(`list_id = $${idx++}`);
      values.push(listId);
    }
    if (position !== undefined) {
      updates.push(`position = $${idx++}`);
      values.push(position);
    }
    if (isPaid !== undefined) {
      updates.push(`is_paid = $${idx++}`);
      values.push(!!isPaid);
    }
    if (title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(title);
    }
    if (desc !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(desc || '');
    }

    // Consolidar todas las modificaciones JSON en un único patch para custom_data
    const customDataPatch = {};

    if (customFields && typeof customFields === 'object') {
      Object.assign(customDataPatch, customFields);
    }

    if (paymentTranches !== undefined) {
      customDataPatch.paymentTranches = paymentTranches;
    }

    if (transferData && typeof transferData === 'object') {
      if (transferData.titular !== undefined) {
        updates.push(`transfer_titular = $${idx++}`);
        values.push(transferData.titular || null);
      }
      if (transferData.cuit !== undefined) {
        updates.push(`transfer_cuit = $${idx++}`);
        values.push(transferData.cuit || null);
      }
      if (transferData.cbu !== undefined) {
        updates.push(`transfer_cbu = $${idx++}`);
        values.push(transferData.cbu || null);
      }
      if (transferData.fecha_desde !== undefined) {
        updates.push(`transfer_fecha_desde = $${idx++}`);
        values.push(safeDate(transferData.fecha_desde));
      }
      if (transferData.fecha_hasta !== undefined) {
        updates.push(`transfer_fecha_hasta = $${idx++}`);
        values.push(safeDate(transferData.fecha_hasta));
      }
      if (transferData.monto_ars !== undefined) {
        updates.push(`transfer_monto_ars = $${idx++}`);
        const mArs = parseFloat(transferData.monto_ars);
        values.push(isNaN(mArs) ? null : mArs);
      }
      if (transferData.dias_reservados !== undefined) {
        updates.push(`transfer_dias_reservados = $${idx++}`);
        const dRes = parseInt(transferData.dias_reservados, 10);
        values.push(isNaN(dRes) ? null : dRes);
      }
      if (transferData.is_indefinite !== undefined) {
        updates.push(`transfer_is_indefinite = $${idx++}`);
        values.push(!!transferData.is_indefinite);
        customDataPatch.is_indefinite = !!transferData.is_indefinite;
      }
      if (transferData.vencimiento !== undefined) {
        updates.push(`due_date = $${idx++}`);
        values.push(safeDate(transferData.vencimiento));
      }
      if (transferData.monto_noche !== undefined) {
        customDataPatch.monto_noche = Number(transferData.monto_noche) || 0;
      }
      if (transferData.paymentTranches !== undefined) {
        customDataPatch.paymentTranches = transferData.paymentTranches;
      }
    }

    if (Object.keys(customDataPatch).length > 0) {
      updates.push(`custom_data = COALESCE(custom_data, '{}'::jsonb) || $${idx++}::jsonb`);
      values.push(JSON.stringify(customDataPatch));
    }

    if (updates.length > 0) {
      await db.query(`UPDATE cards SET ${updates.join(', ')} WHERE id = $1`, values);
    }

    // Actualizar labels si se envían
    if (Array.isArray(labels)) {
      await db.query('DELETE FROM card_labels WHERE card_id = $1', [id]);
      for (const l of labels) {
        let labelId = l.id;
        const isUuidLbl = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(labelId);
        if (!isUuidLbl && l.name) {
          const lRes = await db.query(
            `SELECT id FROM labels WHERE name = $1 AND board_id = (SELECT l.board_id FROM lists l JOIN cards c ON c.list_id = l.id WHERE c.id = $2 LIMIT 1) LIMIT 1`,
            [l.name, id]
          );
          if (lRes.rowCount > 0) labelId = lRes.rows[0].id;
          else labelId = null;
        }
        if (labelId) {
          await db.query('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, labelId]);
        }
      }
    }

    // Actualizar sitios si se envían
    if (Array.isArray(sitios)) {
      await db.query('DELETE FROM card_sites WHERE card_id = $1', [id]);
      for (const s of sitios) {
        let siteId = s.id;
        const isUuidSt = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(siteId);
        if (!isUuidSt && s.name) {
          const sRes = await db.query(
            `SELECT id FROM sites WHERE name = $1 AND board_id = (SELECT l.board_id FROM lists l JOIN cards c ON c.list_id = l.id WHERE c.id = $2 LIMIT 1) LIMIT 1`,
            [s.name, id]
          );
          if (sRes.rowCount > 0) siteId = sRes.rows[0].id;
          else siteId = null;
        }
        if (siteId) {
          await db.query('INSERT INTO card_sites (card_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, siteId]);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating card:', err);
    res.status(500).json({ error: err.message });
  }
});

// Eliminar tarjeta
app.delete('/api/cards/:id', async (req, res) => {
  if (!db.isConnected) return res.json({ success: true });
  try {
    await db.query('DELETE FROM cards WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subir adjunto a una tarjeta
app.post('/api/cards/:id/attachments', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

  const isImage = /^image\//.test(req.file.mimetype);
  const relativePath = `/uploads/${req.file.filename}`;

  if (!db.isConnected) {
    return res.json({
      success: true,
      attachment: {
        id: 'att_' + Date.now(),
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype,
        isImage,
        dataUrl: relativePath
      }
    });
  }

  try {
    const resAtt = await db.query(`
      INSERT INTO card_attachments (card_id, filename, file_size, mime_type, is_image, storage_path)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [req.params.id, req.file.originalname, req.file.size, req.file.mimetype, isImage, relativePath]);

    const att = resAtt.rows[0];
    res.json({
      success: true,
      attachment: {
        id: att.id,
        name: att.filename,
        size: att.file_size,
        type: att.mime_type,
        isImage: att.is_image,
        dataUrl: relativePath
      }
    });
  } catch (err) {
    console.error('Error saving attachment:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API REST: SUGERENCIAS Y MEJORAS CONTINUAS
// ==========================================
app.get('/api/improvements', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  if (!db.isConnected) {
    const fallbackPath = path.join(__dirname, 'improvements.json');
    if (fs.existsSync(fallbackPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
        return res.json({ success: true, source: 'standalone', data });
      } catch (e) {}
    }
    return res.json({ success: true, source: 'empty', data: [] });
  }

  try {
    const r = await db.query('SELECT * FROM improvements ORDER BY created_at DESC');
    res.json({ success: true, source: 'postgresql', data: r.rows });
  } catch (err) {
    console.error('Error fetching improvements:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/improvements', async (req, res) => {
  const { title, description, author_name, author_email } = req.body;
  if (!title || !description) {
    return res.status(400).json({ success: false, error: 'Título y detalle requeridos' });
  }

  if (!db.isConnected) {
    const fallbackPath = path.join(__dirname, 'improvements.json');
    let data = [];
    if (fs.existsSync(fallbackPath)) {
      try { data = JSON.parse(fs.readFileSync(fallbackPath, 'utf8')); } catch(e) {}
    }
    const item = {
      id: 'imp_' + Date.now(),
      title: title.trim(),
      description: description.trim(),
      author_name: (author_name || 'Operador').trim(),
      author_email: (author_email || '').trim(),
      status: 'propuesta',
      created_at: new Date().toISOString()
    };
    data.unshift(item);
    fs.writeFileSync(fallbackPath, JSON.stringify(data, null, 2), 'utf8');
    return res.json({ success: true, source: 'standalone', data: item });
  }

  try {
    const r = await db.query(
      `INSERT INTO improvements (title, description, author_name, author_email, status)
       VALUES ($1, $2, $3, $4, 'propuesta') RETURNING *`,
      [title.trim(), description.trim(), (author_name || 'Operador').trim(), (author_email || '').trim()]
    );
    res.json({ success: true, source: 'postgresql', data: r.rows[0] });
  } catch (err) {
    console.error('Error creating improvement:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/improvements/:id', async (req, res) => {
  const id = req.params.id;
  if (!db.isConnected) {
    const fallbackPath = path.join(__dirname, 'improvements.json');
    if (fs.existsSync(fallbackPath)) {
      try {
        let data = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
        data = data.filter(i => i.id !== id);
        fs.writeFileSync(fallbackPath, JSON.stringify(data, null, 2), 'utf8');
      } catch(e) {}
    }
    return res.json({ success: true });
  }

  try {
    await db.query('DELETE FROM improvements WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting improvement:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`\n🚀 Servidor Celltrex S.A. en ejecución en: http://localhost:${PORT}`);
  await db.initDatabase();
});
