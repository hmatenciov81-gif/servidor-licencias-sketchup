const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const app = express();

// Configuración
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'ADMIN123';
const DB_FILE = './licencias.json';

// Middleware
app.use(cors());
app.use(express.json());

// Funciones de base de datos
function cargarBaseDatos() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error al cargar BD:', error);
  }
  return { licencias: {}, activaciones: [] };
}

function guardarBaseDatos(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return true;
  } catch (error) {
    console.error('Error al guardar BD:', error);
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
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔐 Servidor de Licencias</h1>
        <p>Servidor funcionando correctamente.</p>
        
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
app.post('/api/generar', (req, res) => {
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
      'vitalicia': { dias: 36500, nombre: 'Vitalicia (100 años)' } // 100 años = vitalicia
    };
    
    const tipo_config = tipos_licencia[tipo_licencia] || tipos_licencia['anual'];
    
    const db = cargarBaseDatos();
    const clave = generarClave();
    const fecha_creacion = new Date();
    const fecha_expiracion = new Date(fecha_creacion.getTime() + (tipo_config.dias * 24 * 60 * 60 * 1000));
    
    const licencia = {
      email,
      nombre,
      clave,
      fecha_creacion: fecha_creacion.toISOString(),
      fecha_expiracion: fecha_expiracion.toISOString(),
      activada: false,
      activa: true,
      tipo: tipo_config.nombre,
      duracion_dias: tipo_config.dias,
      max_activaciones: 1,
      activaciones: 0
    };
    
    db.licencias[clave] = licencia;
    guardarBaseDatos(db);
    
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
app.post('/api/activar', (req, res) => {
  try {
    const { email, clave_licencia, nombre } = req.body;
    
    if (!email || !clave_licencia) {
      return res.json({ valida: false, error: 'Email y clave son requeridos' });
    }
    
    const db = cargarBaseDatos();
    const licencia = db.licencias[clave_licencia];
    
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
    licencia.activada = true;
    licencia.fecha_activacion = ahora.toISOString();
    licencia.activaciones = (licencia.activaciones || 0) + 1;
    
    // Registrar activación
    db.activaciones.push({
      clave: clave_licencia,
      email,
      nombre,
      fecha: ahora.toISOString()
    });
    
    guardarBaseDatos(db);
    
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
app.post('/api/validar', (req, res) => {
  try {
    const { email, clave_licencia } = req.body;
    
    const db = cargarBaseDatos();
    const licencia = db.licencias[clave_licencia];
    
    if (!licencia || !licencia.activada) {
      return res.json({ valida: false });
    }
    
    if (licencia.email.toLowerCase() !== email.toLowerCase()) {
      return res.json({ valida: false });
    }
    
    const ahora = new Date();
    const expiracion = new Date(licencia.fecha_expiracion);
    
    res.json({
      valida: ahora <= expiracion && licencia.activa,
      expiracion: licencia.fecha_expiracion
    });
    
  } catch (error) {
    console.error('Error al validar licencia:', error);
    res.json({ valida: false });
  }
});

// API: Desactivar/Reactivar licencia
app.post('/api/toggle-licencia', (req, res) => {
  try {
    const { clave, accion, clave_admin } = req.body;
    
    if (!clave || !accion || !clave_admin) {
      return res.json({ success: false, error: 'Faltan datos requeridos' });
    }
    
    if (clave_admin !== ADMIN_KEY) {
      return res.json({ success: false, error: 'Clave de administrador incorrecta' });
    }
    
    const db = cargarBaseDatos();
    const licencia = db.licencias[clave];
    
    if (!licencia) {
      return res.json({ success: false, error: 'Licencia no encontrada' });
    }
    
    if (accion === 'desactivar') {
      licencia.activada = false;
      licencia.fecha_desactivacion = new Date().toISOString();
    } else if (accion === 'reactivar') {
      licencia.activada = true;
      licencia.fecha_reactivacion = new Date().toISOString();
    } else {
      return res.json({ success: false, error: 'Acción no válida' });
    }
    
    guardarBaseDatos(db);
    
    res.json({
      success: true,
      mensaje: `Licencia ${accion === 'desactivar' ? 'desactivada' : 'reactivada'} correctamente`,
      licencia: {
        clave: licencia.clave,
        email: licencia.email,
        activada: licencia.activada
      }
    });
    
  } catch (error) {
    console.error('Error al toggle licencia:', error);
    res.json({ success: false, error: error.message });
  }
});

// PANEL ADMIN MEJORADO
app.get('/admin', (req, res) => {
  const db = cargarBaseDatos();
  const licencias = Object.values(db.licencias || {});
  
  // Calcular estadísticas
  const stats = {
    total: licencias.length,
    activas: licencias.filter(l => l.activada === true).length,
    pendientes: licencias.filter(l => l.activada === false || !l.activada).length,
    desactivadas: licencias.filter(l => l.activa === false).length,
    porActivar: licencias.filter(l => (l.activada === false || !l.activada) && l.activa !== false).length
  };
  
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Panel Admin - Licencias</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: #f5f5f5;
          padding: 20px;
        }
        .container {
          max-width: 1400px;
          margin: 0 auto;
          background: white;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
          color: #333;
          margin-bottom: 10px;
          border-bottom: 3px solid #007bff;
          padding-bottom: 15px;
        }
        .server-info {
          background: #e7f3ff;
          padding: 10px 15px;
          border-radius: 5px;
          margin-bottom: 20px;
          font-size: 14px;
          color: #0056b3;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
          margin: 20px 0;
        }
        .stat-card {
          color: white;
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .stat-card.green { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
        .stat-card.yellow { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
        .stat-card.red { background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); }
        .stat-card.blue { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }
        .stat-number {
          font-size: 48px;
          font-weight: bold;
          margin: 10px 0;
        }
        .stat-label {
          font-size: 14px;
          opacity: 0.9;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        h2 {
          color: #555;
          margin: 30px 0 15px;
        }
        .form-group {
          margin: 15px 0;
        }
        label {
          display: block;
          margin-bottom: 5px;
          font-weight: bold;
          color: #555;
        }
        input, select {
          width: 100%;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 5px;
          font-size: 14px;
        }
        select {
          cursor: pointer;
        }
        button {
          background: #007bff;
          color: white;
          padding: 12px 25px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-size: 16px;
          margin-top: 10px;
        }
        button:hover { background: #0056b3; }
        .refresh-button {
          background: #6c757d;
          float: right;
          padding: 5px 15px;
          font-size: 12px;
        }
        .refresh-button:hover { background: #5a6268; }
        .copy-button {
          background: #28a745;
          padding: 5px 10px;
          font-size: 12px;
          margin-left: 10px;
        }
        .copy-button:hover { background: #218838; }
        .result {
          margin-top: 20px;
          padding: 15px;
          border-radius: 5px;
          display: none;
        }
        .success {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }
        .error {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }
        .licencia-box {
          background: #e7f3ff;
          padding: 15px;
          border-left: 4px solid #007bff;
          margin: 15px 0;
        }
        .licencia-box strong {
          display: block;
          font-size: 18px;
          margin-bottom: 10px;
          color: #007bff;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 15px;
          font-size: 14px;
        }
        th, td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #ddd;
        }
        th {
          background: #f8f9fa;
          font-weight: bold;
          color: #333;
        }
        .badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: bold;
        }
        .badge-success { background: #d4edda; color: #155724; }
        .badge-warning { background: #fff3cd; color: #856404; }
        .badge-danger { background: #f8d7da; color: #721c24; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔐 Panel de Administración - Licencias</h1>
        
        <div class="server-info">
          🌐 Servidor: ${process.env.RENDER_EXTERNAL_URL || 'localhost:' + PORT} | 
          ⏰ ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })}
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
            <label>Email del Cliente:</label>
            <input type="email" id="email" required placeholder="cliente@example.com">
          </div>
          <div class="form-group">
            <label>Nombre del Cliente:</label>
            <input type="text" id="nombre" required placeholder="Juan Pérez">
          </div>
          <div class="form-group">
            <label>Tipo de Licencia:</label>
            <select id="tipo_licencia">
              <option value="prueba">🧪 Prueba (7 días)</option>
              <option value="mensual">📅 Mensual (30 días)</option>
              <option value="anual" selected>📆 Anual (365 días)</option>
              <option value="vitalicia">♾️ Vitalicia (Sin vencimiento)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Clave Admin:</label>
            <input type="password" id="clave_admin" required placeholder="ADMIN123">
          </div>
          <button type="submit">Generar Licencia</button>
        </form>
        
        <div id="resultado" class="result"></div>
        
        <h2>📋 Listado de Licencias (${stats.total})</h2>
        ${licencias.length === 0 ? '<p>No hay licencias generadas aún.</p>' : `
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Nombre</th>
                <th>Clave</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Creada</th>
                <th>Expira</th>
                <th>Acciones</th>
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
                    ${lic.activada === true 
                      ? `<button class="copy-button" style="background:#dc3545" onclick="toggleLicencia('${lic.clave}', 'desactivar')">❌ Desactivar</button>`
                      : `<button class="copy-button" style="background:#28a745" onclick="toggleLicencia('${lic.clave}', 'reactivar')">✅ Reactivar</button>`
                    }
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
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
                <h3>✅ Licencia Generada</h3>
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
              resultado.innerHTML = '❌ Error: ' + data.error;
            }
          } catch (error) {
            const resultado = document.getElementById('resultado');
            resultado.className = 'result error';
            resultado.style.display = 'block';
            resultado.innerHTML = '❌ Error: ' + error.message;
          }
        });
        
        function copiarTexto(texto) {
          navigator.clipboard.writeText(texto).then(() => alert('✅ Copiado'));
        }
        
        async function toggleLicencia(clave, accion) {
          const clave_admin = prompt('Ingrese la clave de administrador:');
          if (!clave_admin) return;
          
          const confirmar = confirm(
            accion === 'desactivar' 
              ? '¿Desactivar esta licencia? El cliente ya no podrá usar los plugins.'
              : '¿Reactivar esta licencia? El cliente podrá volver a usar los plugins.'
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
            alert('❌ Error: ' + error.message);
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🔐 SERVIDOR DE LICENCIAS INICIADO');
  console.log('='.repeat(60));
  console.log(`✅ Puerto: ${PORT}`);
  console.log(`📊 Panel: http://localhost:${PORT}/admin`);
  console.log('='.repeat(60));
  
  if (!fs.existsSync(DB_FILE)) {
    guardarBaseDatos({ licencias: {}, activaciones: [] });
    console.log('✓ Base de datos inicializada');
  } else {
    const db = cargarBaseDatos();
    console.log(`✓ Licencias: ${Object.keys(db.licencias).length}`);
  }
  console.log('');
});

process.on('uncaughtException', (error) => {
  console.error('❌ Error:', error);
});
