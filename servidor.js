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

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Servidor de Licencias</title>
      <style>
        body { font-family: Arial; max-width: 800px; margin: 50px auto; padding: 20px; }
        h1 { color: #007bff; }
        .box { background: #f0f0f0; padding: 20px; border-radius: 10px; margin: 20px 0; }
        a { display: inline-block; background: #007bff; color: white; padding: 10px 20px; 
            text-decoration: none; border-radius: 5px; margin: 5px; }
      </style>
    </head>
    <body>
      <h1>🔐 Servidor de Licencias</h1>
      <div class="box">
        <h2>✅ Servidor Funcionando</h2>
        <p>Puerto: ${PORT}</p>
        <p>Estado: Activo</p>
      </div>
      <a href="/admin">📊 Panel de Administración</a>
      <div class="box">
        <h3>Licencias Activas: ${Object.keys(licencias).length}</h3>
        <h3>Activaciones: ${activaciones.length}</h3>
      </div>
    </body>
    </html>
  `);
});

app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Panel Admin</title>
      <style>
        body { font-family: Arial; max-width: 800px; margin: 30px auto; padding: 20px; }
        h1 { color: #007bff; }
        input, select { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; }
        button { background: #007bff; color: white; padding: 12px 30px; border: none; 
                border-radius: 5px; cursor: pointer; font-size: 16px; }
        button:hover { background: #0056b3; }
        .resultado { margin: 20px 0; padding: 20px; border-radius: 10px; display: none; }
        .success { background: #d4edda; color: #155724; }
        .error { background: #f8d7da; color: #721c24; }
        .clave-box { background: #e7f3ff; padding: 15px; border-left: 4px solid #007bff; margin: 15px 0; }
      </style>
    </head>
    <body>
      <h1>📊 Panel de Administración</h1>
      <form id="form">
        <input type="password" id="key" placeholder="Clave Admin (ADMIN123)" required>
        <input type="email" id="email" placeholder="Email del cliente" required>
        <input type="text" id="nombre" placeholder="Nombre completo" required>
        <input type="text" id="empresa" placeholder="Empresa (opcional)">
        <select id="tipo">
          <option value="standard">Standard (1 activación)</option>
          <option value="empresa">Empresa (10 activaciones)</option>
        </select>
        <input type="number" id="dias" value="365" placeholder="Duración (días)">
        <button type="submit">Crear Licencia</button>
      </form>
      <div id="resultado" class="resultado"></div>
      <script>
        document.getElementById('form').onsubmit = async (e) => {
          e.preventDefault();
          const resultado = document.getElementById('resultado');
          resultado.style.display = 'block';
          resultado.className = 'resultado';
          resultado.innerHTML = '⏳ Creando licencia...';
          
          try {
            const res = await fetch('/api/admin/crear-licencia', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({
                admin_key: document.getElementById('key').value,
                email: document.getElementById('email').value,
                nombre: document.getElementById('nombre').value,
                empresa: document.getElementById('empresa').value,
                tipo: document.getElementById('tipo').value,
                duracion_dias: parseInt(document.getElementById('dias').value)
              })
            });
            
            const data = await res.json();
            
            if (data.success) {
              const fecha = new Date(data.licencia.expira);
              resultado.className = 'resultado success';
              resultado.innerHTML = 
                '<h2>✅ Licencia Creada</h2>' +
                '<div class="clave-box">' +
                '<h3>🔑 ' + data.licencia.clave + '</h3>' +
                '<p><strong>Email:</strong> ' + data.licencia.email + '</p>' +
                '<p><strong>Nombre:</strong> ' + data.licencia.nombre + '</p>' +
                '<p><strong>Tipo:</strong> ' + data.licencia.tipo + '</p>' +
                '<p><strong>Expira:</strong> ' + fecha.toLocaleDateString() + '</p>' +
                '<p><strong>Activaciones:</strong> ' + data.licencia.max_activaciones + '</p>' +
                '</div>' +
                '<p><em>Copie esta clave y envíela al cliente</em></p>';
            } else {
              resultado.className = 'resultado error';
              resultado.innerHTML = '<h3>❌ Error</h3><p>' + data.error + '</p>';
            }
          } catch (error) {
            resultado.className = 'resultado error';
            resultado.innerHTML = '<h3>❌ Error</h3><p>' + error.message + '</p>';
          }
        };
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