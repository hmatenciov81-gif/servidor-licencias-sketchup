const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const app = express();

// Configuración
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'ADMIN123';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/licencias';

// Middleware
app.use(cors());
app.use(express.json());

// Cliente MongoDB
let db;
let licenciasCollection;
let activacionesCollection;

// Conectar a MongoDB
async function conectarMongoDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('licencias_db');
    licenciasCollection = db.collection('licencias');
    activacionesCollection = db.collection('activaciones');
    
    // Crear índices para búsquedas rápidas
    await licenciasCollection.createIndex({ clave: 1 }, { unique: true });
    await licenciasCollection.createIndex({ email: 1 });
    
    console.log('✅ Conectado a MongoDB Atlas');
    return true;
  } catch (error) {
    console.error('❌ Error al conectar MongoDB:', error);
    return false;
  }
}

function generarClave() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let clave = '';
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      clave += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (i < 3) clave += '-';
  }
  return clave;
}

function validarClave(clave) {
  const hash = crypto.createHash('sha256').update(clave).digest('hex');
  return hash.substring(0, 8);
}

// API: Página principal
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Servidor de Licencias</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
          background: #f5f5f5;
        }
        .container {
          background: white;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #333; }
        .endpoint {
          background: #f8f9fa;
          padding: 15px;
          margin: 10px 0;
          border-left: 4px solid #007bff;
          border-radius: 5px;
        }
        code {
          background: #e9ecef;
          padding: 2px 6px;
          border-radius: 3px;
        }
        .status {
          display: inline-block;
          padding: 5px 10px;
          border-radius: 5px;
          background: #d4edda;
          color: #155724;
          font-weight: bold;
          margin-left: 10px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔐 Servidor de Licencias</h1>
        <p>Servidor funcionando correctamente. <span class="status">✅ MongoDB Conectado</span></p>
        
        <h2>📡 Endpoints Disponibles:</h2>
        
        <div class="endpoint">
          <strong>POST /api/generar</strong><br>
          Generar nueva licencia (requiere clave admin)
        </div>
        
        <div class="endpoint">
          <strong>POST /api/activar</strong><br>
          Activar licencia con email y clave
        </div>
        
        <div class="endpoint">
          <strong>POST /api/validar</strong><br>
          Validar licencia existente
        </div>
        
        <div class="endpoint">
          <strong>GET /admin</strong><br>
          Panel de administración
        </div>
        
        <p><a href="/admin">→ Ir al Panel de Administración</a></p>
      </div>
    </body>
    </html>
  `);
});

// API: Generar licencia
app.post('/api/generar', async (req, res) => {
  try {
    const { email, nombre, clave_admin, tipo_licencia = 'anual' } = req.body;
    
    if (!email || !nombre || !clave_admin) {
      return res.json({ success: false, error: 'Faltan datos requeridos' });
    }
    
    if (clave_admin !== ADMIN_KEY) {
      return res.json({ success: false, error: 'Clave de administrador incorrecta' });
    }
    
    // Definir duración según tipo de licencia
    const tipos_licencia = {
      'prueba': { dias: 7, nombre: 'Prueba (7 días)' },
      'mensual': { dias: 30, nombre: 'Mensual' },
      'anual': { dias: 365, nombre: 'Anual' },
      'vitalicia': { dias: 36500, nombre: 'Vitalicia (100 años)' }
    };
    
    const tipo_config = tipos_licencia[tipo_licencia] || tipos_licencia['anual'];
    
    const clave = generarClave();
    const fecha_creacion = new Date();
    const fecha_expiracion = new Date(fecha_creacion.getTime() + (tipo_config.dias * 24 * 60 * 60 * 1000));
    
    const licencia = {
      email,
      nombre,
      clave,
      fecha_creacion,
      fecha_expiracion,
      activada: false,
      activa: true,
      tipo: tipo_config.nombre,
      duracion_dias: tipo_config.dias,
      max_activaciones: 1,
      activaciones: 0
    };
    
    // Guardar en MongoDB
    await licenciasCollection.insertOne(licencia);
    
    res.json({
      success: true,
      licencia: {
        email,
        nombre,
        clave,
        expira: fecha_expiracion.toISOString(),
        tipo: tipo_config.nombre
      }
    });
    
  } catch (error) {
    console.error('Error al generar licencia:', error);
    res.json({ success: false, error: error.message });
  }
});

// API: Activar licencia
app.post('/api/activar', async (req, res) => {
  try {
    const { email, clave_licencia, nombre } = req.body;
    
    if (!email || !clave_licencia) {
      return res.json({ valida: false, error: 'Email y clave son requeridos' });
    }
    
    const licencia = await licenciasCollection.findOne({ clave: clave_licencia });
    
    if (!licencia) {
      return res.json({ valida: false, error: 'Licencia no encontrada' });
    }
    
    if (licencia.email.toLowerCase() !== email.toLowerCase()) {
      return res.json({ valida: false, error: 'Email no coincide con la licencia' });
    }
    
    if (!licencia.activa) {
      return res.json({ valida: false, error: 'Licencia desactivada' });
    }
    
    const ahora = new Date();
    const expiracion = new Date(licencia.fecha_expiracion);
    
    if (ahora > expiracion) {
      return res.json({ valida: false, error: 'Licencia expirada' });
    }
    
    // Activar licencia
    await licenciasCollection.updateOne(
      { clave: clave_licencia },
      {
        $set: {
          activada: true,
          fecha_activacion: ahora
        },
        $inc: { activaciones: 1 }
      }
    );
    
    // Registrar activación
    await activacionesCollection.insertOne({
      clave: clave_licencia,
      email,
      nombre,
      fecha: ahora
    });
    
    res.json({
      valida: true,
      mensaje: 'Licencia activada correctamente',
      expiracion: licencia.fecha_expiracion,
      tipo: licencia.tipo
    });
    
  } catch (error) {
    console.error('Error al activar licencia:', error);
    res.json({ valida: false, error: error.message });
  }
});

// API: Validar licencia
app.post('/api/validar', async (req, res) => {
  try {
    const { email, clave_licencia } = req.body;
    
    if (!email || !clave_licencia) {
      return res.json({ valida: false, error: 'Email y clave son requeridos' });
    }
    
    const licencia = await licenciasCollection.findOne({ clave: clave_licencia });
    
    if (!licencia) {
      return res.json({ valida: false, error: 'Licencia no encontrada' });
    }
    
    if (licencia.email.toLowerCase() !== email.toLowerCase()) {
      return res.json({ valida: false, error: 'Email no coincide' });
    }
    
    if (!licencia.activa) {
      return res.json({ valida: false, error: 'Licencia desactivada' });
    }
    
    if (!licencia.activada) {
      return res.json({ valida: false, error: 'Licencia no activada' });
    }
    
    const ahora = new Date();
    const expiracion = new Date(licencia.fecha_expiracion);
    
    if (ahora > expiracion) {
      return res.json({ valida: false, error: 'Licencia expirada' });
    }
    
    res.json({
      valida: true,
      email: licencia.email,
      nombre: licencia.nombre,
      expiracion: licencia.fecha_expiracion,
      tipo: licencia.tipo,
      dias_restantes: Math.ceil((expiracion - ahora) / (1000 * 60 * 60 * 24))
    });
    
  } catch (error) {
    console.error('Error al validar licencia:', error);
    res.json({ valida: false, error: error.message });
  }
});

// API: Toggle activación/desactivación
app.post('/api/toggle-licencia', async (req, res) => {
  try {
    const { clave, accion, clave_admin } = req.body;
    
    if (clave_admin !== ADMIN_KEY) {
      return res.json({ success: false, error: 'Clave de administrador incorrecta' });
    }
    
    const nuevoEstado = accion === 'reactivar';
    
    const result = await licenciasCollection.updateOne(
      { clave },
      { $set: { activa: nuevoEstado } }
    );
    
    if (result.matchedCount === 0) {
      return res.json({ success: false, error: 'Licencia no encontrada' });
    }
    
    res.json({
      success: true,
      mensaje: accion === 'reactivar' 
        ? 'Licencia reactivada correctamente' 
        : 'Licencia desactivada correctamente'
    });
    
  } catch (error) {
    console.error('Error al toggle licencia:', error);
    res.json({ success: false, error: error.message });
  }
});

// Panel de administración
app.get('/admin', async (req, res) => {
  try {
    const licencias = await licenciasCollection.find({}).sort({ fecha_creacion: -1 }).toArray();
    
    const stats = {
      total: licencias.length,
      activas: licencias.filter(l => l.activada === true && l.activa !== false).length,
      porActivar: licencias.filter(l => l.activada === false).length,
      desactivadas: licencias.filter(l => l.activa === false).length
    };
    
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Panel Admin - Licencias</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 20px;
        }
        .container {
          max-width: 1400px;
          margin: 0 auto;
          background: white;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          padding: 40px;
        }
        h1 {
          color: #2d3748;
          margin-bottom: 10px;
          font-size: 32px;
        }
        .server-info {
          background: #f7fafc;
          padding: 15px;
          border-radius: 10px;
          margin-bottom: 30px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          font-size: 14px;
          color: #4a5568;
        }
        .refresh-button {
          background: #667eea;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s;
        }
        .refresh-button:hover {
          background: #5568d3;
          transform: translateY(-2px);
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin-bottom: 40px;
        }
        .stat-card {
          padding: 25px;
          border-radius: 12px;
          color: white;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .stat-card.blue { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .stat-card.green { background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); }
        .stat-card.yellow { background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%); }
        .stat-card.red { background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%); }
        .stat-label {
          font-size: 14px;
          opacity: 0.9;
          margin-bottom: 8px;
        }
        .stat-number {
          font-size: 36px;
          font-weight: bold;
        }
        h2 {
          color: #2d3748;
          margin: 30px 0 20px;
          font-size: 24px;
        }
        .form-group {
          margin-bottom: 20px;
        }
        label {
          display: block;
          margin-bottom: 8px;
          color: #4a5568;
          font-weight: 600;
        }
        input, select {
          width: 100%;
          padding: 12px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          font-size: 14px;
          transition: border 0.2s;
        }
        input:focus, select:focus {
          outline: none;
          border-color: #667eea;
        }
        button[type="submit"] {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 14px 30px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          width: 100%;
          margin-top: 10px;
        }
        button[type="submit"]:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        .result {
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
          display: none;
        }
        .result.success {
          background: #c6f6d5;
          border: 2px solid #48bb78;
          color: #22543d;
        }
        .result.error {
          background: #fed7d7;
          border: 2px solid #f56565;
          color: #742a2a;
        }
        .licencia-box {
          background: #f7fafc;
          padding: 15px;
          border-radius: 8px;
          margin: 15px 0;
        }
        .licencia-box strong {
          display: block;
          font-size: 18px;
          margin-bottom: 10px;
          color: #667eea;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 15px;
          font-size: 14px;
          background: white;
        }
        th, td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
        }
        th {
          background: #f7fafc;
          font-weight: bold;
          color: #2d3748;
          position: sticky;
          top: 0;
        }
        tr:hover {
          background: #f7fafc;
        }
        .badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: bold;
        }
        .badge-success { background: #c6f6d5; color: #22543d; }
        .badge-warning { background: #feebc8; color: #7c2d12; }
        .badge-danger { background: #fed7d7; color: #742a2a; }
        .copy-button {
          background: #667eea;
          color: white;
          border: none;
          padding: 4px 8px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          margin-left: 5px;
          transition: all 0.2s;
        }
        .copy-button:hover {
          background: #5568d3;
        }
        code {
          background: #f7fafc;
          padding: 4px 8px;
          border-radius: 4px;
          font-family: 'Courier New', monospace;
          font-size: 13px;
        }
        .table-wrapper {
          overflow-x: auto;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔐 Panel de Administración - Licencias</h1>
        
        <div class="server-info">
          <span>🌐 Servidor: ${process.env.RENDER_EXTERNAL_URL || 'localhost:' + PORT}</span>
          <span>🗄️ MongoDB: Conectado</span>
          <span>⏰ ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })}</span>
          <button class="refresh-button" onclick="location.reload()">🔄 Actualizar</button>
        </div>
        
        <div class="stats-grid">
          <div class="stat-card blue">
            <div class="stat-label">Total Licencias</div>
            <div class="stat-number">${stats.total}</div>
          </div>
          <div class="stat-card green">
            <div class="stat-label">✅ Activadas</div>
            <div class="stat-number">${stats.activas}</div>
          </div>
          <div class="stat-card yellow">
            <div class="stat-label">⏳ Por Activar</div>
            <div class="stat-number">${stats.porActivar}</div>
          </div>
          <div class="stat-card red">
            <div class="stat-label">❌ Desactivadas</div>
            <div class="stat-number">${stats.desactivadas}</div>
          </div>
        </div>
        
        <h2>➕ Generar Nueva Licencia</h2>
        <form id="generarForm">
          <div class="form-group">
            <label>📧 Email del Cliente:</label>
            <input type="email" id="email" required placeholder="cliente@example.com">
          </div>
          <div class="form-group">
            <label>👤 Nombre del Cliente:</label>
            <input type="text" id="nombre" required placeholder="Juan Pérez">
          </div>
          <div class="form-group">
            <label>📦 Tipo de Licencia:</label>
            <select id="tipo_licencia">
              <option value="prueba">🧪 Prueba (7 días)</option>
              <option value="mensual">📅 Mensual (30 días)</option>
              <option value="anual" selected>📆 Anual (365 días)</option>
              <option value="vitalicia">♾️ Vitalicia (Sin vencimiento)</option>
            </select>
          </div>
          <div class="form-group">
            <label>🔑 Clave Admin:</label>
            <input type="password" id="clave_admin" required placeholder="Ingrese clave de administrador">
          </div>
          <button type="submit">✨ Generar Licencia</button>
        </form>
        
        <div id="resultado" class="result"></div>
        
        <h2>📋 Listado de Licencias (${stats.total})</h2>
        ${licencias.length === 0 ? '<p style="color: #718096; font-style: italic;">No hay licencias generadas aún.</p>' : `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>📧 Email</th>
                  <th>👤 Nombre</th>
                  <th>🔑 Clave</th>
                  <th>📦 Tipo</th>
                  <th>📊 Estado</th>
                  <th>📅 Creada</th>
                  <th>⏰ Expira</th>
                  <th>⚙️ Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${licencias.map(lic => `
                  <tr>
                    <td>${lic.email}</td>
                    <td>${lic.nombre}</td>
                    <td>
                      <code>${lic.clave}</code>
                      <button class="copy-button" onclick="copiarTexto('${lic.clave}')">📋</button>
                    </td>
                    <td>${lic.tipo || 'Standard'}</td>
                    <td>
                      ${lic.activada === true ? '<span class="badge badge-success">✅ Activada</span>' : '<span class="badge badge-warning">⏳ Pendiente</span>'}
                      ${lic.activa === false ? '<span class="badge badge-danger">❌ Desactivada</span>' : ''}
                    </td>
                    <td>${new Date(lic.fecha_creacion).toLocaleDateString('es-PE')}</td>
                    <td>${new Date(lic.fecha_expiracion).toLocaleDateString('es-PE')}</td>
                    <td>
                      ${lic.activa !== false
                        ? `<button class="copy-button" style="background:#dc3545" onclick="toggleLicencia('${lic.clave}', 'desactivar')">❌ Desactivar</button>`
                        : `<button class="copy-button" style="background:#28a745" onclick="toggleLicencia('${lic.clave}', 'reactivar')">✅ Reactivar</button>`
                      }
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
      
      <script>
        document.getElementById('generarForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const email = document.getElementById('email').value;
          const nombre = document.getElementById('nombre').value;
          const tipo_licencia = document.getElementById('tipo_licencia').value;
          const clave_admin = document.getElementById('clave_admin').value;
          
          try {
            const response = await fetch('/api/generar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, nombre, tipo_licencia, clave_admin })
            });
            const data = await response.json();
            const resultado = document.getElementById('resultado');
            
            if (data.success) {
              resultado.className = 'result success';
              resultado.style.display = 'block';
              resultado.innerHTML = \`
                <h3>✅ Licencia Generada Exitosamente</h3>
                <div class="licencia-box">
                  <strong>📧 Email:</strong> \${data.licencia.email}<br>
                  <strong>👤 Nombre:</strong> \${data.licencia.nombre}<br>
                  <strong>🔑 Clave:</strong> <code>\${data.licencia.clave}</code>
                  <button class="copy-button" onclick="copiarTexto('\${data.licencia.clave}')">📋 Copiar</button><br>
                  <strong>📦 Tipo:</strong> \${data.licencia.tipo}<br>
                  <strong>📅 Expira:</strong> \${new Date(data.licencia.expira).toLocaleDateString('es-PE')}<br>
                </div>
              \`;
              document.getElementById('generarForm').reset();
              setTimeout(() => location.reload(), 3000);
            } else {
              resultado.className = 'result error';
              resultado.style.display = 'block';
              resultado.innerHTML = '<h3>❌ Error</h3><p>' + data.error + '</p>';
            }
          } catch (error) {
            const resultado = document.getElementById('resultado');
            resultado.className = 'result error';
            resultado.style.display = 'block';
            resultado.innerHTML = '<h3>❌ Error de Conexión</h3><p>' + error.message + '</p>';
          }
        });
        
        function copiarTexto(texto) {
          navigator.clipboard.writeText(texto).then(() => {
            alert('✅ Copiado al portapapeles: ' + texto);
          });
        }
        
        async function toggleLicencia(clave, accion) {
          const clave_admin = prompt('🔑 Ingrese la clave de administrador:');
          if (!clave_admin) return;
          
          const confirmar = confirm(
            accion === 'desactivar' 
              ? '⚠️ ¿Desactivar esta licencia? El cliente ya no podrá usar los plugins.'
              : '✅ ¿Reactivar esta licencia? El cliente podrá volver a usar los plugins.'
          );
          
          if (!confirmar) return;
          
          try {
            const response = await fetch('/api/toggle-licencia', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clave, accion, clave_admin })
            });
            
            const data = await response.json();
            
            if (data.success) {
              alert('✅ ' + data.mensaje);
              location.reload();
            } else {
              alert('❌ Error: ' + data.error);
            }
          } catch (error) {
            alert('❌ Error de conexión: ' + error.message);
          }
        }
      </script>
    </body>
    </html>
  `);
  } catch (error) {
    res.status(500).send('Error al cargar panel de administración: ' + error.message);
  }
});

// Iniciar servidor
async function iniciarServidor() {
  const conectado = await conectarMongoDB();
  
  if (!conectado) {
    console.error('❌ No se pudo conectar a MongoDB. Verifica la configuración.');
    process.exit(1);
  }
  
  app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🔐 SERVIDOR DE LICENCIAS INICIADO');
    console.log('='.repeat(60));
    console.log(`✅ Puerto: ${PORT}`);
    console.log(`📊 Panel: http://localhost:${PORT}/admin`);
    console.log(`🗄️ MongoDB: Conectado`);
    console.log('='.repeat(60));
  });
}

iniciarServidor();

process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada:', reason);
});
