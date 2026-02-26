const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const { MongoClient } = require('mongodb');
const app = express();

// Configuración
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'xion06D3ll09';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/licencias';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Servir archivos estáticos

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
          Generar nueva licencia Premium (requiere clave admin)
        </div>
        
        <div class="endpoint" style="border-left-color: #10b981;">
          <strong>POST /api/generar-light</strong><br>
          Generar licencia Light gratuita (sin clave admin)
        </div>
        
        <div class="endpoint">
          <strong>POST /api/activar</strong><br>
          Activar licencia con email y clave
        </div>
        
        <div class="endpoint">
          <strong>POST /api/verificar</strong><br>
          Verificar estado de licencia (validación continua)
        </div>
        
        <div class="endpoint">
          <strong>POST /api/validar</strong><br>
          Validar licencia existente
        </div>
        
        <div class="endpoint">
          <strong>POST /api/cambiar-dispositivo</strong><br>
          Liberar dispositivo para cambio de PC (requiere clave admin)
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

// API: Activar licencia (CON CONTROL DE DISPOSITIVOS - 1 PC por licencia)
app.post('/api/activar', async (req, res) => {
  try {
    const { email, clave_licencia, nombre, device_id, timestamp_cliente } = req.body;
    
    console.log(`[ACTIVAR] Email: ${email}, Device: ${device_id || 'NO ENVIADO'}`);
    
    if (!email || !clave_licencia) {
      return res.json({ valida: false, error: 'Email y clave son requeridos' });
    }
    
    if (!device_id) {
      return res.json({ valida: false, error: 'ID de dispositivo requerido' });
    }
    
    const licencia = await licenciasCollection.findOne({ clave: clave_licencia });
    
    if (!licencia) {
      console.log('[ACTIVAR] ❌ Licencia no encontrada');
      return res.json({ valida: false, error: 'Licencia no encontrada' });
    }
    
    if (licencia.email.toLowerCase() !== email.toLowerCase()) {
      console.log('[ACTIVAR] ❌ Email no coincide');
      return res.json({ valida: false, error: 'Email no coincide con la licencia' });
    }
    
    if (!licencia.activa) {
      console.log('[ACTIVAR] ❌ Licencia desactivada');
      return res.json({ valida: false, error: 'Licencia desactivada por el administrador' });
    }
    
    // ============================================
    // VERIFICAR EXPIRACIÓN (excepto licencias Light)
    // ============================================
    const ahora = new Date();
    
    if (licencia.tipo === 'Light (Gratuita)') {
      console.log('[ACTIVAR] 🆓 Licencia Light - sin expiración');
      // Las licencias Light no expiran, continuar
    } else {
      // Para licencias Premium: verificar expiración
      const expiracion = new Date(licencia.fecha_expiracion);
      
      if (ahora > expiracion) {
        console.log('[ACTIVAR] ❌ Licencia expirada');
        return res.json({ valida: false, error: 'Licencia expirada' });
      }
    }
    
    // ============================================
    // 🔒 NUEVA: DETECCIÓN DE MANIPULACIÓN DE FECHA
    // ============================================
    let alerta_fecha = null;
    if (timestamp_cliente) {
      const timestamp_servidor = Math.floor(Date.now() / 1000);
      const diferencia = Math.abs(timestamp_servidor - timestamp_cliente);
      const MAX_DIFERENCIA = 300; // 5 minutos de tolerancia
      
      if (diferencia > MAX_DIFERENCIA) {
        const horas_diferencia = Math.floor(diferencia / 3600);
        alerta_fecha = `Advertencia: Fecha del sistema parece incorrecta (${horas_diferencia}h de diferencia)`;
        
        console.log(`[ACTIVAR] ⚠️ Posible manipulación de fecha - Diferencia: ${horas_diferencia}h`);
        
        // Si la diferencia es MUY grande (>7 días), bloquear
        const dias_diferencia = diferencia / 86400;
        if (dias_diferencia > 7) {
          console.log(`[ACTIVAR] ❌ BLOQUEADO - Diferencia excesiva: ${dias_diferencia.toFixed(1)} días`);
          return res.json({ 
            valida: false, 
            error: 'Fecha del sistema incorrecta. Verifique la hora y fecha de su computadora e intente nuevamente.' 
          });
        }
      }
    }
    
    // ========================================================================
    // CONTROL DE DISPOSITIVOS: Solo 1 PC por licencia
    // ========================================================================
    if (licencia.device_id && licencia.device_id !== device_id) {
      console.log('[ACTIVAR] ❌ Licencia ya activada en otro dispositivo');
      console.log(`  Dispositivo registrado: ${licencia.device_id}`);
      console.log(`  Dispositivo intentando: ${device_id}`);
      
      return res.json({ 
        valida: false, 
        error: 'Esta licencia ya está activada en otra computadora.\n\nContacte al administrador para cambiar de dispositivo.'
      });
    }
    
    // Activar licencia y registrar dispositivo
    await licenciasCollection.updateOne(
      { clave: clave_licencia },
      {
        $set: {
          activada: true,
          fecha_activacion: ahora,
          device_id: device_id,
          device_name: nombre || 'PC de ' + email,
          ultima_validacion: ahora
        },
        $inc: { 
          activaciones: 1,
          contador_validaciones: 1
        },
        // 🔒 NUEVO: Guardar historial de validaciones
        $push: {
          historial_validaciones: {
            $each: [{
              fecha: ahora,
              ip: req.ip,
              timestamp_cliente: timestamp_cliente || null,
              timestamp_servidor: Math.floor(Date.now() / 1000),
              diferencia_segundos: timestamp_cliente ? Math.abs(Math.floor(Date.now() / 1000) - timestamp_cliente) : null,
              tipo: 'activacion',
              sospechoso: alerta_fecha ? true : false
            }],
            $slice: -100  // Mantener solo las últimas 100
          }
        }
      }
    );
    
    console.log('[ACTIVAR] ✅ Licencia activada correctamente');
    console.log(`  Dispositivo registrado: ${device_id}`);
    
    // Registrar activación en historial
    await activacionesCollection.insertOne({
      clave: clave_licencia,
      email,
      nombre,
      device_id,
      fecha: ahora,
      tipo: 'activacion'
    });
    
    res.json({
      valida: true,
      mensaje: 'Licencia activada correctamente',
      expiracion: licencia.fecha_expiracion,
      fecha_expiracion: licencia.fecha_expiracion ? licencia.fecha_expiracion.toISOString() : null,
      fecha_expiracion_legible: licencia.fecha_expiracion ? licencia.fecha_expiracion.toLocaleDateString('es-ES') : 'Sin expiración',
      tipo_licencia: licencia.tipo,
      tipo: licencia.tipo,
      dias_restantes: licencia.fecha_expiracion ? Math.ceil((new Date(licencia.fecha_expiracion) - ahora) / (1000 * 60 * 60 * 24)) : null,
      alerta_fecha: alerta_fecha  // 🔒 NUEVO: Avisar si hay problema con fecha
    });
    
  } catch (error) {
    console.error('Error al activar licencia:', error);
    res.json({ valida: false, error: error.message });
  }
});

// ============================================================================
// API: Verificar licencia (para validación continua desde el cliente)
// ============================================================================
app.post('/api/verificar', async (req, res) => {
  try {
    const { email, clave_licencia, timestamp_cliente } = req.body;
    
    console.log(`[VERIFICAR] Email: ${email}, Clave: ${clave_licencia ? clave_licencia.substring(0, 8) + '...' : 'N/A'}`);
    
    if (!email || !clave_licencia) {
      return res.json({ valida: false, error: 'Email y clave son requeridos' });
    }
    
    // Buscar licencia en MongoDB (case-insensitive en email)
    const licencia = await licenciasCollection.findOne({ 
      clave: clave_licencia,
      email: { $regex: new RegExp('^' + email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
    });
    
    if (!licencia) {
      console.log('[VERIFICAR] ❌ Licencia no encontrada');
      return res.json({ 
        valida: false,
        mensaje: 'Licencia no encontrada'
      });
    }
    
    // Verificar si está activa (campo activa)
    if (licencia.activa === false) {
      console.log('[VERIFICAR] ❌ Licencia desactivada por administrador');
      return res.json({ 
        valida: false,
        mensaje: 'Licencia desactivada por el administrador'
      });
    }
    
    // ============================================
    // 🔒 VERIFICAR SI ESTÁ BLOQUEADA (NUEVO)
    // ============================================
    if (licencia.bloqueada) {
      console.log('[VERIFICAR] 🔒 Licencia bloqueada por uso sospechoso');
      return res.json({
        valida: false,
        bloqueada: true,
        error: 'Licencia bloqueada por uso sospechoso',
        razon: licencia.razon_bloqueo || 'Actividad inusual detectada',
        contacto: 'soporte@hylideas.com',
        mensaje: 'Por favor contacte a soporte para resolver este problema'
      });
    }
    
    // ============================================
    // VERIFICAR EXPIRACIÓN (excepto licencias Light)
    // ============================================
    const ahora = new Date();
    
    if (licencia.tipo === 'Light (Gratuita)') {
      console.log('[VERIFICAR] 🆓 Licencia Light - sin expiración');
      // Las licencias Light no expiran, continuar
    } else {
      // Para licencias Premium: verificar expiración
      const expiracion = new Date(licencia.fecha_expiracion);
      
      if (ahora > expiracion) {
        console.log('[VERIFICAR] ❌ Licencia expirada');
        return res.json({ 
          valida: false,
          mensaje: 'Licencia expirada'
        });
      }
    }
    
    // ============================================
    // 🔒 NUEVA: DETECCIÓN DE MANIPULACIÓN DE FECHA
    // ============================================
    let alerta_fecha = null;
    let sospechoso = false;
    
    if (timestamp_cliente) {
      const timestamp_servidor = Math.floor(Date.now() / 1000);
      const diferencia = Math.abs(timestamp_servidor - timestamp_cliente);
      const MAX_DIFERENCIA = 300; // 5 minutos
      
      if (diferencia > MAX_DIFERENCIA) {
        const horas_diferencia = Math.floor(diferencia / 3600);
        alerta_fecha = `Advertencia: Fecha del sistema incorrecta (${horas_diferencia}h de diferencia)`;
        sospechoso = true;
        
        console.log(`[VERIFICAR] ⚠️ Posible manipulación - Diferencia: ${horas_diferencia}h`);
        
        // Si diferencia > 7 días, BLOQUEAR
        const dias_diferencia = diferencia / 86400;
        if (dias_diferencia > 7) {
          console.log(`[VERIFICAR] ❌ BLOQUEADO - Diferencia: ${dias_diferencia.toFixed(1)} días`);
          
          // Incrementar contador sospechoso
          await licenciasCollection.updateOne(
            { clave: clave_licencia },
            { $inc: { contador_sospechoso: 1 } }
          );
          
          return res.json({ 
            valida: false, 
            error: 'Fecha del sistema incorrecta. Verifique la hora y fecha de su computadora.' 
          });
        }
      }
    }
    
    // ============================================
    // 🔒 NUEVA: DETECCIÓN DE SALTOS DE TIEMPO HACIA ATRÁS
    // ============================================
    if (licencia.ultima_validacion) {
      const ultima = new Date(licencia.ultima_validacion);
      
      // Si la nueva validación es ANTERIOR a la última, hay manipulación
      if (ahora < ultima) {
        const horas_atras = Math.floor((ultima - ahora) / (1000 * 60 * 60));
        
        console.log(`[VERIFICAR] ❌ SALTO HACIA ATRÁS DETECTADO - ${horas_atras}h`);
        
        // Incrementar contador sospechoso
        await licenciasCollection.updateOne(
          { clave: clave_licencia },
          { $inc: { contador_sospechoso: 1 } }
        );
        
        return res.json({ 
          valida: false, 
          error: 'Se detectó manipulación de fecha del sistema. Contacte a soporte.' 
        });
      }
    }
    
    // Licencia válida y activa
    console.log('[VERIFICAR] ✅ Licencia válida y activa');
    
    // ============================================
    // ACTUALIZAR SEGÚN TIPO DE LICENCIA
    // ============================================
    if (licencia.tipo === 'Light (Gratuita)') {
      // ============================================
      // LIGHT: Actualización LIGERA sin historial
      // ============================================
      await licenciasCollection.updateOne(
        { clave: clave_licencia },
        { 
          $set: { ultima_validacion: ahora }
          // NO guardar historial para ahorrar espacio
        }
      );
      console.log('[VERIFICAR] 🆓 Light actualizada (sin historial)');
      
    } else {
      // ============================================
      // PREMIUM: Actualización completa con historial
      // ============================================
      await licenciasCollection.updateOne(
        { clave: clave_licencia },
        { 
          $set: { ultima_validacion: ahora },
          $inc: { 
            verificaciones_count: 1,
            contador_validaciones: 1,
            ...(sospechoso && { contador_sospechoso: 1 })
          },
          // 🔒 Guardar historial de validaciones
          $push: {
            historial_validaciones: {
              $each: [{
                fecha: ahora,
                ip: req.ip,
                timestamp_cliente: timestamp_cliente || null,
                timestamp_servidor: Math.floor(Date.now() / 1000),
                diferencia_segundos: timestamp_cliente ? Math.abs(Math.floor(Date.now() / 1000) - timestamp_cliente) : null,
                tipo: 'verificacion',
                sospechoso: sospechoso
              }],
              $slice: -100  // Mantener solo las últimas 100
            }
          }
        }
      );
      console.log('[VERIFICAR] ✅ Premium actualizada (historial guardado)');
    }
    
    // Calcular días restantes (solo para Premium)
    const dias_restantes = (licencia.fecha_expiracion && licencia.tipo !== 'Light (Gratuita)') 
      ? Math.ceil((new Date(licencia.fecha_expiracion) - ahora) / (1000 * 60 * 60 * 24))
      : null;
    
    return res.json({ 
      valida: true,
      mensaje: 'Licencia activa',
      email: licencia.email,
      nombre: licencia.nombre,
      tipo: licencia.tipo || 'Premium',
      expira: licencia.fecha_expiracion,
      fecha_expiracion: licencia.fecha_expiracion,
      dias_restantes: dias_restantes,
      alerta_fecha: alerta_fecha
    });
    
  } catch (error) {
    console.error('[VERIFICAR] ❌ Error:', error);
    res.status(500).json({ 
      valida: false,
      error: 'Error del servidor',
      mensaje: error.message 
    });
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

// ============================================================================
// API: Cambiar dispositivo de una licencia
// ============================================================================
app.post('/api/cambiar-dispositivo', async (req, res) => {
  try {
    const { clave, clave_admin } = req.body;
    
    console.log(`[CAMBIAR DISPOSITIVO] Clave: ${clave}`);
    
    if (!clave || !clave_admin) {
      return res.json({ success: false, error: 'Faltan datos requeridos' });
    }
    
    if (clave_admin !== ADMIN_KEY) {
      return res.json({ success: false, error: 'Clave de administrador incorrecta' });
    }
    
    const licencia = await licenciasCollection.findOne({ clave });
    
    if (!licencia) {
      return res.json({ success: false, error: 'Licencia no encontrada' });
    }
    
    // Limpiar device_id para permitir activación en nuevo dispositivo
    await licenciasCollection.updateOne(
      { clave },
      { 
        $unset: { device_id: "", device_name: "" },
        $set: { 
          dispositivo_cambiado: true,
          fecha_cambio_dispositivo: new Date()
        }
      }
    );
    
    console.log(`[CAMBIAR DISPOSITIVO] ✅ Dispositivo liberado para licencia: ${clave}`);
    
    res.json({ 
      success: true, 
      mensaje: 'Dispositivo liberado. El cliente puede activar en una nueva PC.'
    });
    
  } catch (error) {
    console.error('[CAMBIAR DISPOSITIVO] Error:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================================================
// 🆓 API: GENERAR LICENCIA LIGHT GRATUITA
// ============================================================================
app.post('/api/generar-light', async (req, res) => {
  try {
    const { email, nombre } = req.body;
    
    console.log(`[GENERAR-LIGHT] Email: ${email}, Nombre: ${nombre}`);
    
    // Validar datos requeridos
    if (!email || !nombre) {
      return res.json({ 
        success: false, 
        error: 'Email y nombre son requeridos' 
      });
    }
    
    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.json({ 
        success: false, 
        error: 'Email inválido' 
      });
    }
    
    // Verificar si ya tiene licencia Light
    const existente = await licenciasCollection.findOne({ 
      email: email.toLowerCase(),
      tipo: 'Light (Gratuita)'
    });
    
    if (existente) {
      console.log('[GENERAR-LIGHT] ✅ Licencia Light ya existe para este email');
      
      return res.json({
        success: true,
        licencia: {
          email: existente.email,
          nombre: existente.nombre,
          clave: existente.clave,
          tipo: 'Light (Gratuita)'
        },
        mensaje: 'Ya tienes una licencia Light asociada a este email. Revisa tu bandeja de entrada.'
      });
    }
    
    // Generar nueva clave Light
    function generarClaveLight() {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let clave = 'LIGHT-';
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 4; j++) {
          clave += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (i < 2) clave += '-';
      }
      return clave;
    }
    
    const clave = generarClaveLight();
    
    // ============================================================
    // LICENCIA LIGHT OPTIMIZADA - SIN HISTORIAL
    // ============================================================
    const licenciaLight = {
      email: email.toLowerCase(),
      nombre,
      clave,
      fecha_creacion: new Date(),
      fecha_expiracion: null,  // ← Sin expiración
      activada: false,
      activa: true,
      tipo: 'Light (Gratuita)',
      duracion_dias: null,
      max_activaciones: 1,
      activaciones: 0,
      device_id: null
      // NO incluir: historial_validaciones, contador_sospechoso, etc.
      // Esto optimiza el espacio: ~150 bytes por licencia
    };
    
    // Guardar en MongoDB
    await licenciasCollection.insertOne(licenciaLight);
    
    console.log(`[GENERAR-LIGHT] ✅ Licencia creada exitosamente: ${clave}`);
    
    // TODO: Opcional - Enviar email con la clave
    // await enviarEmailLicenciaLight(email, nombre, clave);
    
    res.json({
      success: true,
      licencia: {
        email: email.toLowerCase(),
        nombre,
        clave,
        tipo: 'Light (Gratuita)'
      },
      mensaje: '¡Licencia Light generada exitosamente! Guarda tu clave de activación.'
    });
    
  } catch (error) {
    console.error('[GENERAR-LIGHT] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error del servidor al generar licencia Light' 
    });
  }
});

// ============================================================================
// TELEMETRÍA: Registrar sesión
// ============================================================================
app.post('/api/telemetria/sesion', async (req, res) => {
  try {
    const { email, device_id } = req.body;
    
    if (!email) {
      return res.json({ success: false });
    }
    
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    
    // Actualizar o crear estadística del día
    await db.collection('estadisticas_diarias').updateOne(
      {
        email: email,
        fecha: hoy
      },
      {
        $inc: { sesiones: 1 },
        $set: { 
          device_id: device_id,
          ultima_actividad: new Date()
        }
      },
      { upsert: true }
    );
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('[TELEMETRIA SESION] Error:', error);
    res.json({ success: false });
  }
});

// ============================================================================
// TELEMETRÍA: Registrar uso de plugin
// ============================================================================
app.post('/api/telemetria/plugin', async (req, res) => {
  try {
    const { email, plugin, device_id } = req.body;
    
    if (!email || !plugin) {
      return res.json({ success: false });
    }
    
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    
    // Actualizar estadística del día
    const updateField = `plugins.${plugin}`;
    
    await db.collection('estadisticas_diarias').updateOne(
      {
        email: email,
        fecha: hoy
      },
      {
        $inc: { 
          [updateField]: 1,
          total_usos: 1
        },
        $set: { 
          device_id: device_id,
          ultima_actividad: new Date()
        }
      },
      { upsert: true }
    );
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('[TELEMETRIA PLUGIN] Error:', error);
    res.json({ success: false });
  }
});

// ============================================================================
// API: Obtener estadísticas de un cliente
// ============================================================================
app.get('/api/estadisticas/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    // Estadísticas de los últimos 30 días
    const hace30dias = new Date();
    hace30dias.setDate(hace30dias.getDate() - 30);
    
    const stats = await db.collection('estadisticas_diarias')
      .find({
        email: email,
        fecha: { $gte: hace30dias }
      })
      .sort({ fecha: -1 })
      .toArray();
    
    // Calcular totales
    let totalSesiones = 0;
    let totalUsos = 0;
    let pluginsMasUsados = {};
    
    stats.forEach(day => {
      totalSesiones += day.sesiones || 0;
      totalUsos += day.total_usos || 0;
      
      if (day.plugins) {
        Object.keys(day.plugins).forEach(plugin => {
          pluginsMasUsados[plugin] = (pluginsMasUsados[plugin] || 0) + day.plugins[plugin];
        });
      }
    });
    
    // Ordenar plugins por uso
    const pluginsOrdenados = Object.entries(pluginsMasUsados)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([plugin, usos]) => ({ plugin, usos }));
    
    res.json({
      email,
      periodo: '30 días',
      total_sesiones: totalSesiones,
      total_usos: totalUsos,
      promedio_sesiones_dia: (totalSesiones / 30).toFixed(1),
      plugins_mas_usados: pluginsOrdenados,
      ultima_actividad: stats[0]?.ultima_actividad || null,
      registros: stats.length
    });
    
  } catch (error) {
    console.error('[ESTADISTICAS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// API: Estadísticas globales (todos los clientes)
// ============================================================================
app.get('/api/estadisticas-globales', async (req, res) => {
  try {
    // Últimos 30 días
    const hace30dias = new Date();
    hace30dias.setDate(hace30dias.getDate() - 30);
    
    const stats = await db.collection('estadisticas_diarias')
      .find({ fecha: { $gte: hace30dias } })
      .toArray();
    
    // Calcular totales
    let totalSesiones = 0;
    let totalUsos = 0;
    let pluginsGlobal = {};
    let clientesActivos = new Set();
    
    stats.forEach(day => {
      totalSesiones += day.sesiones || 0;
      totalUsos += day.total_usos || 0;
      clientesActivos.add(day.email);
      
      if (day.plugins) {
        Object.keys(day.plugins).forEach(plugin => {
          pluginsGlobal[plugin] = (pluginsGlobal[plugin] || 0) + day.plugins[plugin];
        });
      }
    });
    
    // Top 10 plugins más usados
    const topPlugins = Object.entries(pluginsGlobal)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([plugin, usos]) => ({ plugin, usos }));
    
    res.json({
      periodo: '30 días',
      clientes_activos: clientesActivos.size,
      total_sesiones: totalSesiones,
      total_usos: totalUsos,
      promedio_sesiones_cliente: (totalSesiones / clientesActivos.size).toFixed(1),
      plugins_mas_usados: topPlugins
    });
    
  } catch (error) {
    console.error('[ESTADISTICAS GLOBALES] Error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================================================
// API: Verificar acceso (opcional)
// ============================================================================
app.post('/api/colecciones/verificar-acceso', async (req, res) => {
  try {
    const { email } = req.body;
    
    // Verificar que el cliente tenga licencia válida
    const licencia = await db.collection('licencias').findOne({ email });
    
    if (!licencia || licencia.estado !== 'activada') {
      return res.json({ 
        acceso: false, 
        mensaje: 'Necesitas una licencia activa' 
      });
    }
    
    res.json({ acceso: true });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
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
          <button class="refresh-button" onclick="location.href='/admin/estadisticas'" style="background:#667eea; margin-right: 10px;">📊 Ver Estadísticas</button>
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
                      ${lic.device_id 
                        ? `<button class="copy-button" style="background:#ff9800" onclick="cambiarDispositivo('${lic.clave}')">🔄 Cambiar PC</button>`
                        : ''
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
        
        async function cambiarDispositivo(clave) {
          const clave_admin = prompt('🔑 Ingrese la clave de administrador:');
          if (!clave_admin) return;
          
          const confirmar = confirm(
            '🔄 ¿Liberar dispositivo?\\n\\nEsto permitirá al cliente activar la licencia en otra computadora.'
          );
          
          if (!confirmar) return;
          
          try {
            const response = await fetch('/api/cambiar-dispositivo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clave, clave_admin })
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

// ============================================================================
// Página de Estadísticas
// ============================================================================
app.get('/admin/estadisticas', async (req, res) => {
 try {
    // Obtener estadísticas globales
    const hace30dias = new Date();
    hace30dias.setDate(hace30dias.getDate() - 30);
    
    const stats = await db.collection('estadisticas_diarias')
      .find({ fecha: { $gte: hace30dias } })
      .toArray();
    
    // Procesar datos
    let totalSesiones = 0;
    let totalUsos = 0;
    let pluginsGlobal = {};
    let clientesActivos = new Set();
    let clientesStats = {};
    
    stats.forEach(day => {
      totalSesiones += day.sesiones || 0;
      totalUsos += day.total_usos || 0;
      clientesActivos.add(day.email);
      
      // Stats por cliente
      if (!clientesStats[day.email]) {
        clientesStats[day.email] = {
          email: day.email,
          sesiones: 0,
          usos: 0,
          ultima_actividad: day.ultima_actividad
        };
      }
      clientesStats[day.email].sesiones += day.sesiones || 0;
      clientesStats[day.email].usos += day.total_usos || 0;
      
      if (day.ultima_actividad && day.ultima_actividad > clientesStats[day.email].ultima_actividad) {
        clientesStats[day.email].ultima_actividad = day.ultima_actividad;
      }
      
      if (day.plugins) {
        Object.keys(day.plugins).forEach(plugin => {
          pluginsGlobal[plugin] = (pluginsGlobal[plugin] || 0) + day.plugins[plugin];
        });
      }
    });
    
    // Ordenar TODOS los plugins por uso
    const todosPlugins = Object.entries(pluginsGlobal)
      .sort((a, b) => b[1] - a[1]);
    
    // Top clientes
    const topClientes = Object.values(clientesStats)
      .sort((a, b) => b.usos - a.usos)
      .slice(0, 10);
    
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Estadísticas - Plugins Exprés</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          background: #f7fafc;
          padding: 20px;
        }
        .container {
          max-width: 1400px;
          margin: 0 auto;
        }
        h1 {
          font-size: 28px;
          color: #2d3748;
          margin-bottom: 30px;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        .stat-card {
          background: white;
          padding: 25px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        .stat-label {
          font-size: 14px;
          color: #718096;
          margin-bottom: 8px;
        }
        .stat-number {
          font-size: 36px;
          font-weight: bold;
          color: #2d3748;
        }
        .section {
          background: white;
          padding: 25px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          margin-bottom: 20px;
        }
        h2 {
          font-size: 20px;
          color: #2d3748;
          margin-bottom: 20px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th, td {
          text-align: left;
          padding: 12px;
          border-bottom: 1px solid #e2e8f0;
        }
        th {
          background: #f7fafc;
          color: #4a5568;
          font-weight: 600;
          font-size: 13px;
        }
        tr:hover {
          background: #f7fafc;
        }
        .back-button {
          display: inline-block;
          padding: 10px 20px;
          background: #4299e1;
          color: white;
          text-decoration: none;
          border-radius: 6px;
          margin-bottom: 20px;
          transition: background 0.2s;
        }
        .back-button:hover {
          background: #3182ce;
        }
        .no-data {
          text-align: center;
          padding: 40px;
          color: #718096;
          font-style: italic;
        }
        .badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
        }
        .badge-top {
          background: #ffd700;
          color: #744210;
        }
        .percentage {
          color: #718096;
          font-size: 12px;
          margin-left: 10px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <a href="/admin" class="back-button">← Volver al Panel</a>
        
        <h1>📊 Estadísticas de Uso - Últimos 30 Días</h1>
        
        ${stats.length === 0 ? '<div class="no-data">No hay datos de telemetría aún. Los clientes comenzarán a generar estadísticas al usar los plugins.</div>' : `
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">👥 Clientes Activos</div>
            <div class="stat-number">${clientesActivos.size}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">🔄 Total Sesiones</div>
            <div class="stat-number">${totalSesiones}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">🎯 Total Usos</div>
            <div class="stat-number">${totalUsos}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">📈 Promedio/Cliente</div>
            <div class="stat-number">${clientesActivos.size > 0 ? (totalSesiones / clientesActivos.size).toFixed(1) : '0'}</div>
          </div>
        </div>
        
        ${todosPlugins.length > 0 ? `
        <div class="section">
          <h2>📊 Uso Detallado por Plugin (${todosPlugins.length} plugins)</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Plugin</th>
                <th>Total Usos</th>
                <th>% del Total</th>
              </tr>
            </thead>
            <tbody>
              ${todosPlugins.map(([plugin, usos], index) => {
                const porcentaje = ((usos / totalUsos) * 100).toFixed(1);
                const esTop3 = index < 3;
                return `
                  <tr>
                    <td>${index + 1}${esTop3 ? ' <span class="badge badge-top">TOP</span>' : ''}</td>
                    <td><strong>${plugin}</strong></td>
                    <td>${usos}</td>
                    <td><span class="percentage">${porcentaje}%</span></td>
                  </tr>
                `;
              }).join('')}
              <tr style="background: #f7fafc; font-weight: bold;">
                <td colspan="2">TOTAL</td>
                <td>${totalUsos}</td>
                <td><span class="percentage">100%</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        ` : ''}
        
        ${topClientes.length > 0 ? `
        <div class="section">
          <h2>⭐ Top 10 Clientes Más Activos</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Email</th>
                <th>Sesiones</th>
                <th>Usos de Plugins</th>
                <th>Última Actividad</th>
              </tr>
            </thead>
            <tbody>
              ${topClientes.map((cliente, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${cliente.email}</td>
                  <td>${cliente.sesiones}</td>
                  <td>${cliente.usos}</td>
                  <td>${cliente.ultima_actividad ? new Date(cliente.ultima_actividad).toLocaleString('es-PE') : 'N/A'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : ''}
        `}
      </div>
    </body>
    </html>
    `);
    
  } catch (error) {
    console.error('[ESTADISTICAS] Error:', error);
    res.status(500).send('Error al cargar estadísticas: ' + error.message);
  }
});

// ============================================================================
// ENDPOINTS INSTALADOR DE COLECCIONES
// ============================================================================

// Servir página HTML del instalador
app.get('/instalador', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instalador.html'));
});

// Descargar instalador desde Google Drive
app.get('/api/instalador/download', (req, res) => {
  const googleDriveId = '1C7bO2DcMgEn1mLVOK0KYm4uLrNfFSZ3v';
  const url = `https://drive.usercontent.google.com/download?id=${googleDriveId}&export=download&confirm=t`;
  
  console.log('[INSTALADOR] Redirigiendo descarga a Google Drive');
  res.redirect(url);
});

// Endpoint de colecciones (lista de colecciones disponibles)
app.get('/api/colecciones', (req, res) => {
  const colecciones = [
    {
      nombre: 'PELIKANO_2025_2026',
      titulo: 'Colores Pelikano 2025-2026',
      descripcion: '8 colores modernos de la colección 2025-2026',
      tamano: '3.5 MB',
      url: 'https://drive.usercontent.google.com/download?id=1xEK6qx48WGsuFvozPkVJpKtHjPiGzfKX&export=download&confirm=t'
    },
    {
      nombre: 'PELIKANO_2023_2024',
      titulo: 'Colores Pelikano 2023-2024',
      descripcion: '10 colores modernos de la colección 2023-2024',
      tamano: '2.75 MB',
      url: 'https://drive.usercontent.google.com/download?id=19Pp2UXIaHeHr5IYBXtgcMZ39VsK5rets&export=download&confirm=t'
    },
    {
      nombre: 'PELIKANO_2021_2022',
      titulo: 'Colores Pelikano 2021-2022',
      descripcion: '9 colores de la colección 2021-2022',
      tamano: '25.4 MB',
      url: 'https://drive.usercontent.google.com/download?id=1e5Y5bV97-dmMC6XX0ir1FtqxwtLfb54p&export=download&confirm=t'
    },
    {
      nombre: 'PELIKANO_2011_2020',
      titulo: 'Colores Pelikano 2011-2020',
      descripcion: '45 colores de la colección 2011-2020',
      tamano: '91.5 MB',
      url: 'https://drive.usercontent.google.com/download?id=1xje9NAYn6QpuFIGgp2rK1lMWNJAx5PDi&export=download&confirm=t'
    },
    {
      nombre: 'VESTO',
      titulo: 'Colores Vesto',
      descripcion: '26 colores',
      tamano: '8.33 MB',
      url: 'https://drive.usercontent.google.com/download?id=18iOfcVaEBqfxZoYxzViqvFmthHUF-zeu&export=download&confirm=t'
    }
    // Agrega más colecciones según las subas a Google Drive
    // IMPORTANTE: El campo "nombre" será el nombre de la carpeta en Materials
  ];
  
  res.json({ colecciones });
});

// ============================================================================
// 🆓 API: GENERAR LICENCIA LIGHT GRATUITA
// ============================================================================
app.post('/api/generar-light', async (req, res) => {
  try {
    const { email, nombre } = req.body;
    
    console.log(`[GENERAR-LIGHT] Email: ${email}, Nombre: ${nombre}`);
    
    // Validar campos requeridos
    if (!email || !nombre) {
      return res.json({ 
        success: false, 
        error: 'Email y nombre son requeridos' 
      });
    }
    
    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.json({ 
        success: false, 
        error: 'Email inválido' 
      });
    }
    
    // Verificar si ya tiene licencia Light
    const existente = await licenciasCollection.findOne({ 
      email: email.toLowerCase(),
      tipo: 'Light (Gratuita)'
    });
    
    if (existente) {
      console.log('[GENERAR-LIGHT] ✅ Licencia Light ya existe para este email');
      
      return res.json({
        success: true,
        licencia: {
          email: existente.email,
          nombre: existente.nombre,
          clave: existente.clave,
          tipo: 'Light (Gratuita)'
        },
        mensaje: 'Ya tienes una licencia Light registrada. Revisa tu email.'
      });
    }
    
    // Generar clave Light
    const clave = generarClaveLight();
    
    // Crear licencia Light optimizada (SIN historial para ahorrar espacio)
    const licenciaLight = {
      email: email.toLowerCase(),
      nombre,
      clave,
      fecha_creacion: new Date(),
      fecha_expiracion: null,  // Sin expiración
      activada: false,
      activa: true,
      tipo: 'Light (Gratuita)',
      duracion_dias: null,
      max_activaciones: 1,
      activaciones: 0,
      device_id: null
      // NO incluir: historial_validaciones, contador_sospechoso
      // Esto ahorra ~6 KB por licencia = capacidad de 3.4M licencias en MongoDB Free
    };
    
    // Guardar en MongoDB
    await licenciasCollection.insertOne(licenciaLight);
    
    console.log(`[GENERAR-LIGHT] ✅ Licencia creada: ${clave}`);
    
    // Opcional: Aquí puedes agregar código para enviar email
    // await enviarEmailLicenciaLight(email, nombre, clave);
    
    res.json({
      success: true,
      licencia: {
        email: email.toLowerCase(),
        nombre,
        clave,
        tipo: 'Light (Gratuita)'
      },
      mensaje: '¡Licencia Light generada exitosamente! Guarda tu clave de activación.'
    });
    
  } catch (error) {
    console.error('[GENERAR-LIGHT] ❌ Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error del servidor al generar licencia' 
    });
  }
});

// ============================================================================
// TAREA PROGRAMADA: Limpieza automática (cada 24 horas)
// ============================================================================
setInterval(async () => {
  try {
    const hace90dias = new Date();
    hace90dias.setDate(hace90dias.getDate() - 90);
    
    const resultado = await db.collection('estadisticas_diarias').deleteMany({
      fecha: { $lt: hace90dias }
    });
    
    console.log(`[LIMPIEZA] ✅ Eliminados ${resultado.deletedCount} registros antiguos (>90 días)`);
    
  } catch (error) {
    console.error('[LIMPIEZA] Error:', error);
  }
}, 24 * 60 * 60 * 1000); // Cada 24 horas

// ============================================================================
// ENDPOINTS DE ADMINISTRACIÓN Y MONITOREO
// ============================================================================

// 🔐 Función de autenticación para endpoints admin
function verificarAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || authHeader !== `Bearer ${ADMIN_KEY}`) {
    return res.status(401).json({ 
      error: 'No autorizado',
      mensaje: 'Credenciales de administrador requeridas'
    });
  }
  
  next();
}

// 📊 ENDPOINT: Resumen general
app.get('/api/admin/resumen', verificarAdmin, async (req, res) => {
  try {
    const totalLicencias = await licenciasCollection.countDocuments();
    
    const licenciasLight = await licenciasCollection.countDocuments({
      tipo: { $regex: /Light/i }
    });
    
    const licenciasPremium = totalLicencias - licenciasLight;
    
    // Licencias activas
    const licenciasActivas = await licenciasCollection.countDocuments({
      $or: [
        { fecha_expiracion: { $gt: new Date() } },
        { tipo: { $regex: /Light/i } }
      ]
    });
    
    // Actividad en últimos 7 días
    const hace7dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const actividadReciente = await licenciasCollection.countDocuments({
      ultima_actividad: { $gte: hace7dias }
    });
    
    res.json({
      resumen: {
        total_licencias: totalLicencias,
        activas: licenciasActivas,
        light: licenciasLight,
        premium: licenciasPremium,
        actividad_7dias: actividadReciente
      }
    });
  } catch (error) {
    console.error('[ADMIN/RESUMEN] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 🚨 ENDPOINT: Licencias sospechosas
app.get('/api/admin/sospechosas', verificarAdmin, async (req, res) => {
  try {
    // Obtener licencias con historial (limitado a 500)
    const licencias = await licenciasCollection
      .find({ historial_validaciones: { $exists: true, $ne: [] } })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    
    const sospechosas = [];
    
    for (const lic of licencias) {
      if (!lic.historial_validaciones || lic.historial_validaciones.length === 0) {
        continue;
      }
      
      // Contar devices únicos
      const devicesUnicos = new Set(
        lic.historial_validaciones.map(v => v.device_id)
      ).size;
      
      // REGLA 1: Más de 3 devices
      if (devicesUnicos > 3) {
        sospechosas.push({
          email: lic.email,
          clave: lic.clave,
          tipo: lic.tipo || 'Premium',
          devices_unicos: devicesUnicos,
          total_validaciones: lic.historial_validaciones.length,
          ultima_actividad: lic.ultima_actividad,
          razon: `Demasiados dispositivos (${devicesUnicos})`,
          nivel: 'ALTO',
          bloqueada: lic.bloqueada || false
        });
        continue;
      }
      
      // REGLA 2: Muchos devices en 7 días
      const hace7dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const devicesRecientes = new Set(
        lic.historial_validaciones
          .filter(v => new Date(v.timestamp) > hace7dias)
          .map(v => v.device_id)
      ).size;
      
      if (devicesRecientes > 2) {
        sospechosas.push({
          email: lic.email,
          clave: lic.clave,
          tipo: lic.tipo || 'Premium',
          devices_unicos: devicesUnicos,
          devices_7dias: devicesRecientes,
          total_validaciones: lic.historial_validaciones.length,
          ultima_actividad: lic.ultima_actividad,
          razon: `${devicesRecientes} dispositivos en 7 días`,
          nivel: 'MEDIO',
          bloqueada: lic.bloqueada || false
        });
      }
    }
    
    // Ordenar por nivel
    sospechosas.sort((a, b) => {
      const orden = { 'ALTO': 0, 'MEDIO': 1, 'BAJO': 2 };
      return orden[a.nivel] - orden[b.nivel];
    });
    
    res.json({
      total: sospechosas.length,
      licencias: sospechosas
    });
  } catch (error) {
    console.error('[ADMIN/SOSPECHOSAS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 🔒 ENDPOINT: Bloquear licencia
app.post('/api/admin/bloquear', verificarAdmin, async (req, res) => {
  try {
    const { clave, razon } = req.body;
    
    if (!clave) {
      return res.status(400).json({ error: 'Clave requerida' });
    }
    
    const resultado = await licenciasCollection.updateOne(
      { clave: clave },
      { 
        $set: { 
          bloqueada: true,
          razon_bloqueo: razon || 'Uso sospechoso detectado',
          fecha_bloqueo: new Date()
        }
      }
    );
    
    if (resultado.matchedCount === 0) {
      return res.status(404).json({ error: 'Licencia no encontrada' });
    }
    
    console.log(`[ADMIN] 🔒 Licencia bloqueada: ${clave}`);
    
    res.json({ 
      ok: true,
      mensaje: 'Licencia bloqueada exitosamente'
    });
  } catch (error) {
    console.error('[ADMIN/BLOQUEAR] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 🔓 ENDPOINT: Desbloquear licencia
app.post('/api/admin/desbloquear', verificarAdmin, async (req, res) => {
  try {
    const { clave } = req.body;
    
    if (!clave) {
      return res.status(400).json({ error: 'Clave requerida' });
    }
    
    const resultado = await licenciasCollection.updateOne(
      { clave: clave },
      { 
        $set: { bloqueada: false },
        $unset: { razon_bloqueo: "", fecha_bloqueo: "" }
      }
    );
    
    if (resultado.matchedCount === 0) {
      return res.status(404).json({ error: 'Licencia no encontrada' });
    }
    
    console.log(`[ADMIN] 🔓 Licencia desbloqueada: ${clave}`);
    
    res.json({ 
      ok: true,
      mensaje: 'Licencia desbloqueada exitosamente'
    });
  } catch (error) {
    console.error('[ADMIN/DESBLOQUEAR] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 📋 ENDPOINT: Detalle de licencia
app.get('/api/admin/licencia/:clave', verificarAdmin, async (req, res) => {
  try {
    const licencia = await licenciasCollection.findOne({ 
      clave: req.params.clave 
    });
    
    if (!licencia) {
      return res.status(404).json({ error: 'Licencia no encontrada' });
    }
    
    // Analizar historial
    const historial = licencia.historial_validaciones || [];
    const devicesUnicos = new Set(historial.map(v => v.device_id));
    
    const devicesList = Array.from(devicesUnicos).map(deviceId => {
      const validaciones = historial
        .filter(v => v.device_id === deviceId)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return {
        device_id: deviceId,
        primera_vez: validaciones[validaciones.length - 1]?.timestamp,
        ultima_vez: validaciones[0]?.timestamp,
        total_usos: validaciones.length
      };
    });
    
    res.json({
      licencia: {
        email: licencia.email,
        clave: licencia.clave,
        tipo: licencia.tipo || 'Premium',
        fecha_creacion: licencia.createdAt,
        fecha_expiracion: licencia.fecha_expiracion,
        activa: !licencia.fecha_expiracion || licencia.fecha_expiracion > new Date(),
        bloqueada: licencia.bloqueada || false,
        razon_bloqueo: licencia.razon_bloqueo
      },
      estadisticas: {
        devices_unicos: devicesUnicos.size,
        total_validaciones: historial.length,
        devices: devicesList
      },
      historial_completo: historial
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 50)
    });
  } catch (error) {
    console.error('[ADMIN/LICENCIA] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

console.log('✅ Endpoints de administración cargados');

// ============================================================================

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
    console.log(`📈 Estadísticas: http://localhost:${PORT}/admin/estadisticas`);
    console.log(`🗄️ MongoDB: Conectado`);
    console.log('='.repeat(60));
    
    // Ejecutar limpieza inicial después de 5 segundos
    setTimeout(async () => {
      try {
        const hace90dias = new Date();
        hace90dias.setDate(hace90dias.getDate() - 90);
        
        const resultado = await db.collection('estadisticas_diarias').deleteMany({
          fecha: { $lt: hace90dias }
        });
        
        if (resultado.deletedCount > 0) {
          console.log(`[LIMPIEZA INICIAL] ✅ Eliminados ${resultado.deletedCount} registros antiguos`);
        }
      } catch (error) {
        console.error('[LIMPIEZA INICIAL] Error:', error);
      }
    }, 5000);
  });
}

iniciarServidor();

process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada:', reason);
});
