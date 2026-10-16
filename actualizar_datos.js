// Regenera data.js (y una copia ligera en CSV) a partir de "EncuestaSonora.xlsx", conservando
// solo los registros que caen dentro de las secciones del shapefile de Sonora (secciones_son.js,
// generado con convertir_secciones.py desde la carpeta SON).
//
// Uso, desde esta carpeta:
//   node actualizar_datos.js            -> procesa el Excel una vez
//   node actualizar_datos.js --vigilar  -> se queda escuchando y regenera cada vez que se guarda el Excel
//
// El Excel trae formulas INDEX/MATCH contra un libro externo (INE BdD Definitiva.xlsx) y Excel
// guarda una copia en cache de ese libro (varios GB) dentro del .xlsx. Por eso aqui NO se usa una
// libreria de Excel: se lee el .zip a mano y solo se descomprimen las partes necesarias
// (hoja, sharedStrings, workbook), tomando el ultimo valor calculado de cada celda.
// Funciona aunque el archivo este abierto en Excel.

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var RAIZ = __dirname;
var ARCHIVO_EXCEL = path.join(RAIZ, 'EncuestaSonora.xlsx');
var SALIDA_JS = path.join(RAIZ, 'data.js');
var SALIDA_CSV = path.join(RAIZ, 'EncuestaSonora.csv');
var CAPA_SECCIONES = path.join(RAIZ, 'secciones_son.js');

// Encabezado del Excel -> nombre de campo usado por los dashboards (index, dashboard, resumen).
// Se aceptan ambas formas de escribir los encabezados ("NombreCompleto" o "Nombre completo").
// Las preguntas se identifican por su numero ("1", "1." o "1 "); Gubernatura tambien por su nombre.
// campo: null -> la columna NO se publica (identificadores personales o datos innecesarios).
var MAPEO_COLUMNAS = [
  { prueba: /^n[uú]mero ?(de )?tel[eé]fono$/i, campo: 'Numero de Telefono' },
  { prueba: /^fecha de la llamada$/i, campo: 'Fecha de la llamada' },
  { prueba: /^1(?!\d)/, campo: 'Preferencia Partido' },
  { prueba: /^2(?!\d)|gubernatura/i, campo: 'Gubernatura' },
  { prueba: /^(id|ciudadano ?id)$/i, campo: 'ID' },
  { prueba: /^colonia$/i, campo: 'Colonia' },
  { prueba: /^(cp|c[oó]digo postal)$/i, campo: 'Codigo Postal' },
  { prueba: /^sexo$/i, campo: 'Sexo' },
  { prueba: /^nombre ?completo$/i, campo: 'Nombre completo' },
  { prueba: /^lat$/i, campo: 'Lat' },
  { prueba: /^lon$/i, campo: 'Lon' },
  { prueba: /^direcci[oó]n ?completa$/i, campo: 'Direccion Completa' },
  { prueba: /^nivel ?confianza$/i, campo: 'Nivel Confianza' },
  { prueba: /^origen ?tel[eé]fono$/i, campo: 'Compania Telefonica' },
  { prueba: /^edad/i, campo: 'Edad 2027' },
  { prueba: /^partido ?local$/i, campo: 'Partido Local' },
  { prueba: /^partido ?nacional$/i, campo: 'Partido Nacional' },
  { prueba: /^servidor ?p[uú]blico$/i, campo: 'Servidor Publico' },
  { prueba: /^beneficiario$/i, campo: 'Beneficiario' },
  { prueba: /^programa ?(local|estado)$/i, campo: 'Programa Estado' },
  { prueba: /^programa ?federal$/i, campo: 'Programa Federal' },
  { prueba: /^distrito ?federal$/i, campo: 'Distrito Federal' },
  { prueba: /^distrito ?local$/i, campo: 'Distrito Local' },
  { prueba: /^municipio$/i, campo: 'Municipio' },
  { prueba: /^secci[oó]n$/i, campo: 'Seccion' },
  { prueba: /^nombre ?municipio$/i, campo: 'Nombre Municipio' },
  // No se publican: identificadores oficiales y datos que no usa ninguna pagina
  { prueba: /^curp$/i, campo: null },
  { prueba: /^cve$/i, campo: null },
  { prueba: /^fecha ?nacimiento$/i, campo: null },
  { prueba: /^nombre ?entidad$/i, campo: null }
];
// Campos que deben venir en el Excel (si falta alguno se avisa en la consola)
var CAMPOS_REQUERIDOS = ['Numero de Telefono', 'Fecha de la llamada', 'Preferencia Partido', 'Gubernatura', 'ID',
  'Sexo', 'Nombre completo', 'Lat', 'Lon', 'Edad 2027', 'Distrito Federal', 'Distrito Local', 'Municipio',
  'Seccion', 'Nombre Municipio'];

var SEXO = { M: 'Mujer', F: 'Mujer', H: 'Hombre' };

// Rangos de edad (mismas etiquetas y colores que el proyecto original, mas 18–24)
var RANGOS_EDAD = [
  { hasta: 24, etiqueta: '18–24' },
  { hasta: 30, etiqueta: '25–30' },
  { hasta: 40, etiqueta: '31–40' },
  { hasta: 59, etiqueta: '41–59' },
  { hasta: 64, etiqueta: '60–64' },
  { hasta: Infinity, etiqueta: '65+' }
];

// Respuestas de las preguntas: se normalizan mayusculas/acentos para que "Lorenia Valles de MORENA"
// y "lorenia valles" cuenten como la misma opcion. Lo que no este aqui se deja tal cual.
var RESPUESTAS = {
  'Preferencia Partido': { pan: 'PAN', pri: 'PRI', morena: 'MORENA', mc: 'MC' },
  'Gubernatura': {
    'lorenia valles de morena': 'Lorenia Valles',
    'lorenia valles': 'Lorenia Valles',
    'antonio astiazaran del pan': 'Antonio Astiazarán',
    'antonio astiazaran': 'Antonio Astiazarán',
    'luis donaldo colosio de mc': 'Luis Donaldo Colosio',
    'luis donaldo colosio': 'Luis Donaldo Colosio'
  }
};
var PREGUNTAS = Object.keys(RESPUESTAS);

// ---------------- Lectura minima de .zip (solo las entradas que se piden) ----------------

function leerEntradasZip(archivo, nombresBuscados) {
  var fd = fs.openSync(archivo, 'r');
  try {
    var tam = fs.fstatSync(fd).size;
    var colaTam = Math.min(tam, 65557);
    var cola = Buffer.alloc(colaTam);
    fs.readSync(fd, cola, 0, colaTam, tam - colaTam);
    var eocd = -1;
    for (var i = colaTam - 22; i >= 0; i--) {
      if (cola.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('No parece un .xlsx valido (no se encontro el directorio del zip).');

    var cdTam = cola.readUInt32LE(eocd + 12);
    var cdOffset = cola.readUInt32LE(eocd + 16);
    // Zip64 (archivos de mas de 4 GB): el directorio real esta en el registro EOCD64
    if (cdOffset === 0xFFFFFFFF && eocd >= 20 && cola.readUInt32LE(eocd - 20) === 0x07064b50) {
      var eocd64 = Buffer.alloc(56);
      fs.readSync(fd, eocd64, 0, 56, Number(cola.readBigUInt64LE(eocd - 20 + 8)));
      cdTam = Number(eocd64.readBigUInt64LE(40));
      cdOffset = Number(eocd64.readBigUInt64LE(48));
    }
    var cd = Buffer.alloc(cdTam);
    fs.readSync(fd, cd, 0, cdTam, cdOffset);

    var resultado = {};
    var p = 0;
    while (p < cd.length && cd.readUInt32LE(p) === 0x02014b50) {
      var metodo = cd.readUInt16LE(p + 10);
      var compTam = cd.readUInt32LE(p + 20);
      var nomLen = cd.readUInt16LE(p + 28);
      var extraLen = cd.readUInt16LE(p + 30);
      var comLen = cd.readUInt16LE(p + 32);
      var localOffset = cd.readUInt32LE(p + 42);
      var nombre = cd.toString('utf8', p + 46, p + 46 + nomLen);
      var extra = cd.subarray(p + 46 + nomLen, p + 46 + nomLen + extraLen);
      var tamOriginal = cd.readUInt32LE(p + 24);
      p += 46 + nomLen + extraLen + comLen;
      if (nombresBuscados.indexOf(nombre) === -1) continue;

      // Campos Zip64 de la entrada: solo vienen los que en la cabecera valen 0xFFFFFFFF, en este orden
      for (var e = 0; e + 4 <= extra.length; e += 4 + extra.readUInt16LE(e + 2)) {
        if (extra.readUInt16LE(e) !== 0x0001) continue;
        var q = e + 4;
        if (tamOriginal === 0xFFFFFFFF) q += 8;
        if (compTam === 0xFFFFFFFF) { compTam = Number(extra.readBigUInt64LE(q)); q += 8; }
        if (localOffset === 0xFFFFFFFF) localOffset = Number(extra.readBigUInt64LE(q));
      }

      var cab = Buffer.alloc(30);
      fs.readSync(fd, cab, 0, 30, localOffset);
      var inicioDatos = localOffset + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
      var comp = Buffer.alloc(compTam);
      fs.readSync(fd, comp, 0, compTam, inicioDatos);
      resultado[nombre] = (metodo === 0 ? comp : zlib.inflateRawSync(comp)).toString('utf8');
    }
    return resultado;
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------- Lectura de la hoja (valores en cache) ----------------

function decodificarXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
    .replace(/&amp;/g, '&');
}

function leerSharedStrings(xml) {
  if (!xml) return [];
  var lista = [];
  var re = /<si>([\s\S]*?)<\/si>/g, m;
  while ((m = re.exec(xml))) {
    var texto = '';
    var reT = /<t[^>]*>([\s\S]*?)<\/t>/g, t;
    while ((t = reT.exec(m[1]))) texto += t[1];
    lista.push(decodificarXml(texto));
  }
  return lista;
}

function indiceColumna(ref) {
  var letras = ref.replace(/\d+/g, '');
  var n = 0;
  for (var i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64);
  return n - 1;
}

function leerFilas(xmlHoja, compartidos) {
  var filas = [];
  var reFila = /<row\b[^>]*>([\s\S]*?)<\/row>/g, mf;
  while ((mf = reFila.exec(xmlHoja))) {
    var fila = [];
    var reCelda = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, mc;
    while ((mc = reCelda.exec(mf[1]))) {
      var attrs = mc[1];
      var ref = /\br="([A-Z]+\d+)"/.exec(attrs);
      if (!ref) continue;
      var tipo = (/\bt="(\w+)"/.exec(attrs) || [])[1];
      var interior = mc[2] || '';
      var v = /<v>([\s\S]*?)<\/v>/.exec(interior);
      var valor = null;
      if (tipo === 'inlineStr') {
        var t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(interior);
        valor = t ? decodificarXml(t[1]) : null;
      } else if (v) {
        if (tipo === 's') valor = compartidos[+v[1]];
        else if (tipo === 'str' || tipo === 'e') valor = decodificarXml(v[1]);
        else if (tipo === 'b') valor = v[1] === '1';
        else valor = Number(v[1]);
      }
      if (tipo === 'e') valor = null; // #N/A, #REF!, etc.
      fila[indiceColumna(ref[1])] = valor;
    }
    filas.push(fila);
  }
  return filas;
}

// ---------------- Limpieza de cada registro ----------------

function sinAcentos(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function limpiarTexto(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  var t = v.trim();
  return t === '' || t.toUpperCase() === 'NULL' ? null : t; // la base de Sonora trae "NULL" como texto
}

function normalizarRespuesta(campo, v) {
  v = limpiarTexto(v);
  if (v === null) return '-'; // sin respuesta: mismo criterio que la base anterior
  var texto = String(v);
  var clave = sinAcentos(texto).toLowerCase().replace(/\s+/g, ' ');
  return RESPUESTAS[campo][clave] || texto;
}

function aEntero(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? v : n;
}

function rangoEdad(edad) {
  if (typeof edad !== 'number') return null;
  return RANGOS_EDAD.find(function (r) { return edad <= r.hasta; }).etiqueta;
}

function construirRegistro(encabezados, fila) {
  var r = {};
  encabezados.forEach(function (campo, i) {
    if (campo) r[campo] = limpiarTexto(fila[i] === undefined ? null : fila[i]);
  });

  PREGUNTAS.forEach(function (p) { r[p] = normalizarRespuesta(p, r[p]); });

  if (typeof r['Sexo'] === 'string') r['Sexo'] = SEXO[r['Sexo'].toUpperCase()] || r['Sexo'];
  ['Distrito Federal', 'Distrito Local', 'Municipio', 'Seccion', 'Codigo Postal', 'Edad 2027', 'ID', 'Numero de Telefono']
    .forEach(function (c) { if (c in r) r[c] = aEntero(r[c]); });
  if (r['Codigo Postal'] === 0) r['Codigo Postal'] = null;
  if (typeof r['Colonia'] === 'string') {
    r['Colonia'] = /^N\/?D$/i.test(r['Colonia']) ? null : r['Colonia'].toUpperCase(); // "ND" = sin dato; "Centro" = "CENTRO"
  }
  // Banderas 0/1 -> texto legible (0 = no aplica, se deja vacio)
  ['Servidor Publico', 'Beneficiario'].forEach(function (c) {
    if (c in r) r[c] = (r[c] === 1 || r[c] === '1') ? 'Sí' : null;
  });
  ['Lat', 'Lon'].forEach(function (c) {
    if (c in r) r[c] = typeof r[c] === 'number' ? r[c] : (r[c] === null ? null : Number(r[c]) || null);
  });
  r['Rango edad'] = rangoEdad(r['Edad 2027']);
  if (r['Fecha de la llamada'] !== null && r['Fecha de la llamada'] !== undefined) {
    r['Fecha de la llamada'] = String(r['Fecha de la llamada']);
  }
  return r;
}

// ---------------- Delimitacion por las secciones del shapefile ----------------
// Solo se conservan los registros que pertenecen a las secciones de secciones_son.js:
//   - punto dentro de alguna seccion                -> se queda tal cual ("Geocodificada")
//   - punto fuera, pero su seccion existe en la capa -> se reubica en el centro de su seccion
//   - punto fuera y seccion inexistente en la capa   -> se omite (fuera del area del shapefile)

function leerCapaSecciones() {
  var texto = fs.readFileSync(CAPA_SECCIONES, 'utf8');
  return JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
}

function poligonosDe(geometria) {
  return geometria.type === 'MultiPolygon' ? geometria.coordinates : [geometria.coordinates];
}

// Centroide (ponderado por area) del anillo exterior mas grande de la seccion
function centroideSeccion(geometria) {
  var mejor = null;
  poligonosDe(geometria).forEach(function (pol) {
    var anillo = pol[0], a = 0, cx = 0, cy = 0;
    for (var i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      var f = anillo[j][0] * anillo[i][1] - anillo[i][0] * anillo[j][1];
      a += f;
      cx += (anillo[j][0] + anillo[i][0]) * f;
      cy += (anillo[j][1] + anillo[i][1]) * f;
    }
    if (a && (!mejor || Math.abs(a) > Math.abs(mejor.a))) mejor = { a: a, lon: cx / (3 * a), lat: cy / (3 * a) };
  });
  return mejor;
}

function puntoEnAnillo(lon, lat, anillo) {
  var dentro = false;
  for (var i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    var xi = anillo[i][0], yi = anillo[i][1], xj = anillo[j][0], yj = anillo[j][1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function puntoEnGeometria(lon, lat, geometria) {
  return poligonosDe(geometria).some(function (pol) {
    if (!puntoEnAnillo(lon, lat, pol[0])) return false;
    for (var h = 1; h < pol.length; h++) if (puntoEnAnillo(lon, lat, pol[h])) return false;
    return true;
  });
}

function prepararSecciones() {
  var indice = leerCapaSecciones().features.map(function (f) {
    var caja = [180, 90, -180, -90];
    poligonosDe(f.geometry).forEach(function (pol) {
      pol[0].forEach(function (p) {
        caja[0] = Math.min(caja[0], p[0]); caja[1] = Math.min(caja[1], p[1]);
        caja[2] = Math.max(caja[2], p[0]); caja[3] = Math.max(caja[3], p[1]);
      });
    });
    return { props: f.properties, geometria: f.geometry, caja: caja, centro: centroideSeccion(f.geometry) };
  });
  var porSeccion = {};
  indice.forEach(function (s) { porSeccion[s.props.Seccion] = s; });
  return {
    porSeccion: porSeccion,
    // Seccion de la capa que contiene el punto (o null)
    contiene: function (lat, lon) {
      return indice.find(function (s) {
        return lon >= s.caja[0] && lon <= s.caja[2] && lat >= s.caja[1] && lat <= s.caja[3] &&
          puntoEnGeometria(lon, lat, s.geometria);
      }) || null;
    }
  };
}

function delimitarPorSecciones(registros) {
  var secciones = prepararSecciones();
  var vecesPorSeccion = {};
  var resultado = { conservados: [], omitidos: 0, reubicados: 0, seccionDistinta: 0 };
  registros.forEach(function (r) {
    var tieneCoords = typeof r.Lat === 'number' && typeof r.Lon === 'number';
    var contenedora = tieneCoords ? secciones.contiene(r.Lat, r.Lon) : null;
    var propia = secciones.porSeccion[r.Seccion];
    if (contenedora) {
      r['Ubicacion'] = 'Geocodificada';
      if (contenedora.props.Seccion !== r.Seccion) resultado.seccionDistinta++;
    } else if (propia && propia.centro) {
      // Patron de girasol alrededor del centro para que los puntos de una misma seccion no se encimen
      var i = vecesPorSeccion[r.Seccion] = (vecesPorSeccion[r.Seccion] || 0) + 1;
      var angulo = i * 2.39996, radio = 0.0012 * Math.sqrt(i);
      r.Lat = +(propia.centro.lat + radio * Math.sin(angulo)).toFixed(6);
      r.Lon = +(propia.centro.lon + radio * Math.cos(angulo)).toFixed(6);
      r['Ubicacion'] = 'Aproximada (centro de la seccion)';
      resultado.reubicados++;
    } else {
      resultado.omitidos++;
      return;
    }
    resultado.conservados.push(r);
  });
  return resultado;
}

// ---------------- Salidas ----------------

function aCsv(registros, campos) {
  var esc = function (v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  var lineas = [campos.map(esc).join(',')];
  registros.forEach(function (r) { lineas.push(campos.map(function (c) { return esc(r[c]); }).join(',')); });
  return '﻿' + lineas.join('\r\n') + '\r\n'; // BOM para que Excel respete los acentos
}

function procesar() {
  var inicio = Date.now();
  var partes = leerEntradasZip(ARCHIVO_EXCEL, ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml']);

  // Primera hoja del libro
  var rId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(partes['xl/workbook.xml'])[1];
  var reRel = new RegExp('<Relationship\\b[^>]*Id="' + rId + '"[^>]*Target="([^"]+)"');
  var destino = (reRel.exec(partes['xl/_rels/workbook.xml.rels']) ||
    new RegExp('<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="' + rId + '"').exec(partes['xl/_rels/workbook.xml.rels']))[1];
  var rutaHoja = destino.charAt(0) === '/' ? destino.slice(1) : 'xl/' + destino;
  var xmlHoja = leerEntradasZip(ARCHIVO_EXCEL, [rutaHoja])[rutaHoja];

  var filas = leerFilas(xmlHoja, leerSharedStrings(partes['xl/sharedStrings.xml']));
  if (!filas.length) throw new Error('La hoja esta vacia.');

  var sinMapeo = [];
  var encabezados = filas[0].map(function (h) {
    var texto = h === null || h === undefined ? '' : String(h).trim();
    var m = MAPEO_COLUMNAS.find(function (x) { return x.prueba.test(texto); });
    if (!m && texto) sinMapeo.push(texto);
    return m ? m.campo : (texto || null);
  });
  var faltantes = CAMPOS_REQUERIDOS.filter(function (c) { return encabezados.indexOf(c) === -1; });

  var todos = filas.slice(1)
    .filter(function (f) { return f.some(function (v) { return v !== null && v !== undefined && v !== ''; }); })
    .map(function (f) { return construirRegistro(encabezados, f); });
  var delimitacion = delimitarPorSecciones(todos);
  var registros = delimitacion.conservados;

  var campos = encabezados.filter(Boolean).concat(['Rango edad', 'Ubicacion'])
    .filter(function (c, i, arr) { return arr.indexOf(c) === i; });
  fs.writeFileSync(SALIDA_JS,
    '// Generado por actualizar_datos.js a partir de "' + path.basename(ARCHIVO_EXCEL) + '" el ' +
    new Date().toLocaleString('es-MX') + '. No editar a mano.\n' +
    'var datos = ' + JSON.stringify(registros) + ';\n');
  fs.writeFileSync(SALIDA_CSV, aCsv(registros, campos));

  console.log('[' + new Date().toLocaleTimeString('es-MX') + '] ' + registros.length + ' registros -> data.js y ' +
    path.basename(SALIDA_CSV) + ' (' + (Date.now() - inicio) + ' ms)');
  if (delimitacion.omitidos) {
    console.log('  Se omitieron ' + delimitacion.omitidos + ' registro(s) fuera de las secciones del shapefile.');
  }
  if (delimitacion.reubicados) {
    console.log('  Aviso: ' + delimitacion.reubicados + ' registro(s) con punto fuera de las secciones se ubicaron en el centro de su seccion.');
  }
  if (faltantes.length) console.log('  Aviso: columnas no encontradas en el Excel: ' + faltantes.join(', '));
  if (sinMapeo.length) console.log('  Aviso: columnas nuevas sin mapeo (se publican tal cual): ' + sinMapeo.join(', '));
}

function procesarSeguro() {
  try {
    procesar();
  } catch (e) {
    console.error('Error al procesar el Excel: ' + e.message);
    process.exitCode = 1;
  }
}

procesarSeguro();

if (process.argv.indexOf('--vigilar') !== -1) {
  console.log('Vigilando "' + path.basename(ARCHIVO_EXCEL) + '"... (Ctrl+C para salir)');
  var espera = null;
  fs.watchFile(ARCHIVO_EXCEL, { interval: 2000 }, function (actual, anterior) {
    if (actual.mtimeMs === anterior.mtimeMs) return;
    clearTimeout(espera);
    // Excel escribe el archivo en varias pasadas; se espera a que termine de guardar
    espera = setTimeout(function () { process.exitCode = 0; procesarSeguro(); }, 3000);
  });
}
