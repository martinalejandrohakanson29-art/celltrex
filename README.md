# Celltrex S.A. - Sistema Operativo Kanban

Sistema de gestión operativa estilo Trello personalizado para **Celltrex S.A.** Diseñado para despliegue en VPS propio con base de datos relacional PostgreSQL 16 y cliente SPA interactivo de alto rendimiento.

---

## 🚀 Características Principales

- **Tableros Operativos:**
  - 🛒 Compras
  - 🚗 Viáticos
  - 🏗️ Anticipos de Obra
  - 🏨 Hoteles, Cochera y Depósito
  - ➕ Creación dinámica de nuevos tableros desde el menú desplegable superior, menú lateral y pantalla de inicio.
- **Formato Kanban Interactivo:** Arrastre y suelta (Drag & Drop) de tarjetas entre columnas de estado.
- **Check de Estado de Pago:** Interruptor rápido en el extremo superior derecho de cada tarjeta (Pendiente en naranja / Pagado en verde).
- **Validaciones Condicionales:** Formulario de creación con reglas estrictas que impiden generar tarjetas si no se cumplen todos los requisitos del tablero.
- **Adjuntos de Archivos:** Soporte para subir, previsualizar y descargar fotos (JPG, PNG), documentos (PDF, Word), planillas (Excel, CSV) y textos (TXT).
- **Personalización de Campos:** Panel para configurar qué campos se solicitan en cada tablero y agregar campos personalizados a medida.
- **Exportación a Excel:** Descarga directa de cada tablero en formato CSV compatible con Excel en español (delimitador ';' y BOM UTF-8).
- **Branding Institucional:** Paleta corporativa (#0E4D5D Azul Petróleo, #00A8B5 Teal Vibrante) e isologotipo oficial integrado.

---

## 🛠️ Estructura del Proyecto

\\\
Celltrex/
├── index.html            # Aplicación web completa interactiva (SPA)
├── server.js             # Servidor HTTP local estático (Node.js sin dependencias)
├── schema.sql            # Esquema DDL normalizado para PostgreSQL 16
├── docker-compose.yml    # Configuración de despliegue contenerizado (PostgreSQL + Nginx)
├── celltrex_dataset.json # Dataset optimizado de tarjetas, listas y etiquetas iniciales
├── isologotipo.jpg       # Isologotipo oficial de la empresa
└── README.md             # Documentación general
\\\

---

## 💻 Ejecución Local

Para probar la aplicación en tu entorno local:

\\\ash
node server.js
\\\

Abre en tu navegador: **http://localhost:5050**

---

## 🌐 Despliegue en VPS (Docker & PostgreSQL)

Para desplegar en un servidor VPS con Docker:

\\\ash
docker-compose up -d
\\\

Se iniciará automáticamente el contenedor de **PostgreSQL 16** (puerto 5432) y el servidor web **Nginx** (puerto 80).
