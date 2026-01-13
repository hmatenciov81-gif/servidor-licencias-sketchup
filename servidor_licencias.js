// ==============================================================================
// SERVIDOR SIMPLE DE LICENCIAS
// ==============================================================================
// Versión simplificada y fácil de instalar
// ==============================================================================

const express = require('express');
const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());

// Base de datos en memoria (temporal)
let licencias = {};
let activaciones = [];

console.log('\n' + '='.repeat(60));
console.log('INICIANDO SERVIDOR DE LICENCIAS...');
console.log('='.repeat(60) + '\n');

// ==============================================================================
// FUNCIONES AUXILIARES
// ==============================================================================

function generarClaveLicencia() {
  const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let partes = [];
  
  // Generar 3 bloques de 4 caracteres
  for (let i = 0; i < 3; i++) {
    let bloque = '';
    for (let j = 0; j < 4; j++) {
      bloque += caracteres[Math.floor(Math.random() * caracteres.length)];
    }
    partes.push(bloque);
  }
  
  // Calcular checksum
  const todos = partes.join('');
  const suma = todos.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const checksum = (suma % 10000).toString().padStart(4, '0');
  partes.push(checksum);
  
  return partes.join('-');
}

function validarClave(clave) {
  const regex = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[0-9]{4}$/;
  if (!regex.test(clave)) return false;
  
  const partes = clave.split('-');
  const suma = partes.slice(0, 3).join('').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const checksumEsperado = (suma % 10000).toString().padStart(4, '0');
  
  return partes[3] === checksumEsperado;
}

// ==============================================================================
// API - CREAR LICENCIA
// ==============================================================================

app.post('/api/admin/crear-licencia', (req, res) => {
  const { admin_key, email, nombre, empresa, tipo, duracion_dias } = req.body;
  
  // Verificar clave de administrador
  if (admin_key !== 'ADMIN123') {
    return res.json({ 
      success: false, 
      error: 'Clave de administrador incorrecta' 
    });
  }
  
  // Validar datos
  if (!email || !nombre) {
    return res.json({ 
      success: false, 
      error: 'Email y nombre son requeridos' 
    });
  }
  
  // Generar licencia
  const clave = generarClaveLicencia();
  const ahora = new Date();
  const expira = new Date(ahora);
  expira.setDate(expira.getDate() + (parseInt(duracion_dias) || 365));
  
  const licencia = {
    clave: clave,
    email: email,
    nombre: nombre,
    empresa: empresa || null,
    tipo: tipo || 'standard',
    fecha_creacion: ahora.toISOString(),
    fecha_expiracion: expira.toISOString(),
    activada: false,
    activa: true,
    max_activaciones: tipo === 'empresa' ? 10 : 1
  };
  
  licencias[clave] = licencia;
  
  console.log(`✓ Licencia creada: ${clave} para ${email}`);
  
  res.json({
    success: true,
    licencia: {
      clave: clave,
      email: email,
      nombre: nombre,
      empresa: empresa,
      tipo: tipo,
      expira: expira.toISOString(),
      max_activaciones: licencia.max_activaciones
    }
  });
});

// ==============================================================================
// API - ACTIVAR LICENCIA
// ==============================================================================

app.post('/api/activar', (req, res) => {
  const { email, clave_licencia, nombre, empresa, version } = req.body;
  
  console.log(`📥 Solicitud activación: ${email} - ${clave_licencia}`);
  
  // Validar datos
  if (!email || !clave_licencia || !nombre) {
    return res.json({ 
      valida: false, 
      error: 'Datos incompletos' 
    });
  }
  
  // Validar formato de clave
  if (!validarClave(clave_licencia)) {
    return res.json({ 
      valida: false, 
      error: 'Formato de clave inválido' 
    });
  }
  
  // Buscar licencia
  const lic = licencias[clave_licencia];
  
  if (!lic) {
    console.log(`❌ Licencia no encontrada: ${clave_licencia}`);
    return res.json({ 
      valida: false, 
      error: 'Licencia no encontrada' 
    });
  }
  
  // Verificar email
  if (lic.email !== email) {
    console.log(`❌ Email no coincide`);
    return res.json({ 
      valida: false, 
      error: 'Email no coincide' 
    });
  }
  
  // Verificar si está activa
  if (!lic.activa) {
    console.log(`❌ Licencia desactivada`);
    return res.json({ 
      valida: false, 
      error: 'Licencia desactivada' 
    });
  }
  
  // Verificar expiración
  if (new Date() > new Date(lic.fecha_expiracion)) {
    console.log(`❌ Licencia expirada`);
    return res.json({ 
      valida: false, 
      error: 'Licencia expirada' 
    });
  }
  
  // Registrar activación
  lic.activada = true;
  activaciones.push({
    clave_licencia: clave_licencia,
    email: email,
    nombre: nombre,
    empresa: empresa,
    version: version,
    fecha: new Date().toISOString()
  });
  
  console.log(`✅ Licencia activada: ${clave_licencia}`);
  
  res.json({
    valida: true,
    mensaje: 'Licencia activada correctamente',
    expiracion: lic.fecha_expiracion,
    tipo: lic.tipo
  });
});

// ==============================================================================
// API - VERIFICAR LICENCIA
// ==============================================================================

app.post('/api/verificar', (req, res) => {
  const { email, clave_licencia } = req.body;
  const lic = licencias[clave_licencia];
  
  if (!lic) {
    return res.json({ valida: false, error: 'Licencia no encontrada' });
  }
  
  if (lic.email !== email) {
    return res.json({ valida: false, error: 'Email no coincide' });
  }
  
  if (!lic.activa) {
    return res.json({ valida: false, error: 'Licencia desactivada' });
  }
  
  if (new Date() > new Date(lic.fecha_expiracion)) {
    return res.json({ valida: false, error: 'Licencia expirada' });
  }
  
  res.json({
    valida: true,
    expiracion: lic.fecha_expiracion,
    tipo: lic.tipo
  });
});

// ==============================================================================
// API - ESTADÍSTICAS
// ==============================================================================

app.post('/api/admin/estadisticas', (req, res) => {
  const { admin_key } = req.body;
  
  if (admin_key !== 'ADMIN123') {
    return res.json({ error: 'Acceso denegado' });
  }
  
  const lics = Object.values(licencias);
  const ahora = new Date();
  
  res.json({
    success: true,
    estadisticas: {
      total_licencias: lics.length,
      licencias_activas: lics.filter(l => l.activa).length,
      licencias_activadas: lics.filter(l => l.activada).length,
      licencias_expiradas: lics.filter(l => new Date(l.fecha_expiracion) < ahora).length,
      total_activaciones: activaciones.length
    }
  });
});

// ==============================================================================
// PÁGINAS WEB
// ==============================================================================

# Panel Admin Mejorado - Para agregar al servidor_licencias.js

## Para actualizar tu panel admin, reemplaza la ruta GET '/admin' con este código:

```javascript
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
      <title>Panel de Administración - Licencias</title>
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
        
        /* ESTADÍSTICAS */
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
          margin: 20px 0;
        }
        .stat-card {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .stat-card.green {
          background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
        }
        .stat-card.yellow {
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        }
        .stat-card.red {
          background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
        }
        .stat-card.blue {
          background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        }
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
          display: flex;
          align-items: center;
          gap: 10px;
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
        button:hover {
          background: #0056b3;
        }
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
        .copy-button {
          background: #28a745;
          padding: 5px 10px;
          font-size: 12px;
          margin-left: 10px;
        }
        .copy-button:hover {
          background: #218838;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 15px;
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
        .badge-success {
          background: #d4edda;
          color: #155724;
        }
        .badge-warning {
          background: #fff3cd;
          color: #856404;
        }
        .badge-danger {
          background: #f8d7da;
          color: #721c24;
        }
        .refresh-button {
          background: #6c757d;
          float: right;
        }
        .refresh-button:hover {
          background: #5a6268;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔐 Panel de Administración - Licencias</h1>
        
        <div class="server-info">
          🌐 Servidor: ${process.env.RENDER_EXTERNAL_URL || 'localhost:3000'} | 
          ⏰ Hora del servidor: ${new Date().toLocaleString('es-PE')}
          <button class="refresh-button" onclick="location.reload()">🔄 Actualizar</button>
        </div>
        
        <!-- ESTADÍSTICAS -->
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
        
        <!-- GENERAR LICENCIA -->
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
            <label>Clave Admin:</label>
            <input type="password" id="clave_admin" required placeholder="ADMIN123">
          </div>
          <button type="submit">Generar Licencia</button>
        </form>
        
        <div id="resultado" class="result"></div>
        
        <!-- LISTADO DE LICENCIAS -->
        <h2>📋 Listado de Licencias (${stats.total})</h2>
        ${licencias.length === 0 ? '<p>No hay licencias generadas aún.</p>' : `
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Nombre</th>
                <th>Clave</th>
                <th>Estado</th>
                <th>Creada</th>
                <th>Expira</th>
              </tr>
            </thead>
            <tbody>
              ${licencias.map(lic => `
                <tr>
                  <td>${lic.email}</td>
                  <td>${lic.nombre}</td>
                  <td>
                    <code>${lic.clave}</code>
                    <button class="copy-button" onclick="copiarTexto('${lic.clave}')">📋 Copiar</button>
                  </td>
                  <td>
                    ${lic.activada === true 
                      ? '<span class="badge badge-success">✅ Activada</span>' 
                      : '<span class="badge badge-warning">⏳ Pendiente</span>'}
                    ${lic.activa === false 
                      ? '<span class="badge badge-danger">❌ Desactivada</span>' 
                      : ''}
                  </td>
                  <td>${new Date(lic.fecha_creacion).toLocaleDateString('es-PE')}</td>
                  <td>${new Date(lic.fecha_expiracion).toLocaleDateString('es-PE')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
      
      <script>
        // Generar licencia
        document.getElementById('generarForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const email = document.getElementById('email').value;
          const nombre = document.getElementById('nombre').value;
          const clave_admin = document.getElementById('clave_admin').value;
          
          try {
            const response = await fetch('/api/generar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, nombre, clave_admin })
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
                  <button class="copy-button" onclick="copiarTexto('\${data.licencia.clave}')">📋 Copiar Clave</button><br>
                  <strong>📅 Expira:</strong> \${new Date(data.licencia.expira).toLocaleDateString('es-PE')}<br>
                </div>
                <p><strong>Envía estos datos al cliente.</strong></p>
              \`;
              
              // Limpiar formulario
              document.getElementById('generarForm').reset();
              
              // Recargar página después de 3 segundos
              setTimeout(() => location.reload(), 3000);
            } else {
              resultado.className = 'result error';
              resultado.style.display = 'block';
              resultado.innerHTML = '<strong>❌ Error:</strong> ' + data.error;
            }
          } catch (error) {
            const resultado = document.getElementById('resultado');
            resultado.className = 'result error';
            resultado.style.display = 'block';
            resultado.innerHTML = '<strong>❌ Error de conexión:</strong> ' + error.message;
          }
        });
        
        // Copiar al portapapeles
        function copiarTexto(texto) {
          navigator.clipboard.writeText(texto).then(() => {
            alert('✅ Clave copiada al portapapeles');
          });
        }
      </script>
    </body>
    </html>
  `);
});

// ==============================================================================
// INICIAR SERVIDOR
// ==============================================================================

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('✅ SERVIDOR INICIADO CORRECTAMENTE');
  console.log('='.repeat(60));
  console.log(`🌐 URL principal:    http://localhost:${PORT}`);
  console.log(`📊 Panel admin:      http://localhost:${PORT}/admin`);
  console.log(`🔑 Clave admin:      ADMIN123`);
  console.log('='.repeat(60));
  console.log('\n⚠️  NOTA: Esta versión usa memoria temporal');
  console.log('   Las licencias se borrarán al cerrar el servidor\n');
  console.log('Presione Ctrl+C para detener el servidor\n');

});
