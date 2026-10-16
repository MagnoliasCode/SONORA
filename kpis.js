// Calculos compartidos entre index.html, dashboard.html y resumen.html a partir de data.js
// (generado con: node actualizar_datos.js)

// Las 2 preguntas de la encuesta: campo en data.js -> textos para la interfaz.
// "base" indica sobre que total se calculan los porcentajes:
//   'total'       -> todas las encuestas (la pregunta se hizo a todos; "sin respuesta" es una opcion mas)
//   'respondidas' -> solo quienes contestaron (para preguntas que no se hacen a todos)
var PREGUNTAS = [
  { campo: 'Preferencia Partido', titulo: '1. Preferencia de partido', corto: 'Partido', base: 'total' },
  { campo: 'Gubernatura', titulo: '2. Intención de voto — Gubernatura', corto: 'Gubernatura', base: 'total' }
];

// Orden y colores fijos de las opciones de cada pregunta (las que no esten aqui se agregan al final)
var OPCIONES_PREGUNTA = {
  'Preferencia Partido': ['PAN', 'PRI', 'MORENA', 'MC'],
  'Gubernatura': ['Antonio Astiazarán', 'Lorenia Valles', 'Luis Donaldo Colosio']
};
var COLORES_OPCIONES = {
  'PAN': '#0047AB',
  'PRI': '#00953A',
  'MORENA': '#A50F2D',
  'MC': '#FF7A00',
  'Antonio Astiazarán': '#0047AB',   // PAN
  'Lorenia Valles': '#A50F2D',       // MORENA
  'Luis Donaldo Colosio': '#FF7A00'  // MC
};
// Partido de cada candidato (para el cruce partido vs. candidato del resumen)
var PARTIDO_DE_CANDIDATO = {
  'Antonio Astiazarán': 'PAN',
  'Lorenia Valles': 'MORENA',
  'Luis Donaldo Colosio': 'MC'
};
var COLOR_SIN_RESPUESTA = '#9aa0a6';
var SIN_RESPUESTA = '-';

function preguntaDe(campo) {
  return PREGUNTAS.find(function (p) { return p.campo === campo; }) || { campo: campo, titulo: campo, corto: campo, base: 'total' };
}

function esSinRespuesta(v) {
  return v === undefined || v === null || v === '' || v === SIN_RESPUESTA || v === '(sin dato)';
}

function etiquetaLegible(etiqueta) {
  return esSinRespuesta(etiqueta) ? 'Sin respuesta' : String(etiqueta);
}

function colorOpcion(etiqueta) {
  return esSinRespuesta(etiqueta) ? COLOR_SIN_RESPUESTA : (COLORES_OPCIONES[etiqueta] || '#6b7280');
}

function contarPor(datos, campo) {
  var conteo = {};
  datos.forEach(function (d) {
    var v = d[campo];
    if (v === undefined || v === null || v === '') v = '(sin dato)';
    conteo[v] = (conteo[v] || 0) + 1;
  });
  return conteo;
}

function ordenarConteo(conteo) {
  return Object.keys(conteo)
    .map(function (k) { return { etiqueta: k, valor: conteo[k] }; })
    .sort(function (a, b) { return b.valor - a.valor; });
}

// Distribucion de una pregunta: [{ etiqueta, valor, pct }] con todas las opciones del
// cuestionario (aunque tengan 0), ordenada de mayor a menor.
// Si la pregunta tiene base 'total', "sin respuesta" se incluye al final y pct = valor / total.
// Si tiene base 'respondidas', "sin respuesta" se excluye y pct = valor / quienes respondieron.
// lista.base trae el total usado como denominador.
function distribucionPregunta(datos, campo) {
  var soloRespondidas = preguntaDe(campo).base === 'respondidas';
  var conteo = {};
  (OPCIONES_PREGUNTA[campo] || []).forEach(function (op) { conteo[op] = 0; });
  var base = 0;
  datos.forEach(function (d) {
    var sin = esSinRespuesta(d[campo]);
    if (sin && soloRespondidas) return;
    var v = sin ? SIN_RESPUESTA : d[campo];
    conteo[v] = (conteo[v] || 0) + 1;
    base++;
  });
  var lista = Object.keys(conteo)
    .map(function (k) { return { etiqueta: k, valor: conteo[k], pct: base ? conteo[k] / base : 0 }; })
    .sort(function (a, b) {
      if (esSinRespuesta(a.etiqueta)) return 1;
      if (esSinRespuesta(b.etiqueta)) return -1;
      return b.valor - a.valor;
    });
  lista.base = base;
  return lista;
}

// Para las preguntas, "sin respuesta" no debe competir por el primer lugar como si fuera una opcion valida.
function topConOpinion(conteoOrdenado) {
  return conteoOrdenado.filter(function (c) {
    return !esSinRespuesta(c.etiqueta) && c.valor > 0;
  })[0] || { etiqueta: 'N/D', valor: 0, pct: 0 };
}

function segundoConOpinion(conteoOrdenado) {
  return conteoOrdenado.filter(function (c) {
    return !esSinRespuesta(c.etiqueta) && c.valor > 0;
  })[1] || { etiqueta: 'N/D', valor: 0, pct: 0 };
}

// Resumen de una pregunta: distribucion, 1er y 2o lugar, ventaja y cuantos respondieron
function resumenPregunta(datos, campo) {
  var dist = distribucionPregunta(datos, campo);
  var respondieron = datos.filter(function (d) { return !esSinRespuesta(d[campo]); }).length;
  var top = topConOpinion(dist);
  var segundo = segundoConOpinion(dist);
  return {
    dist: dist,
    base: dist.base,
    respondieron: respondieron,
    sinRespuesta: datos.length - respondieron,
    top: top,
    segundo: segundo,
    ventaja: (top.pct || 0) - (segundo.pct || 0)
  };
}

function calcularEstadisticas(datos) {
  var total = datos.length;
  var valoresUnicos = function (campo) {
    return new Set(datos.map(function (d) { return d[campo]; }).filter(function (v) { return v !== null && v !== undefined && v !== '' && v !== 0; })).size;
  };

  var preguntas = {};
  PREGUNTAS.forEach(function (p) { preguntas[p.campo] = resumenPregunta(datos, p.campo); });

  var fechas = datos.map(function (d) { return d['Fecha de la llamada']; }).filter(Boolean).sort();

  return {
    total: total,
    telefonos: valoresUnicos('Numero de Telefono'),
    conUbicacion: datos.filter(function (d) { return typeof d.Lat === 'number' && typeof d.Lon === 'number'; }).length,
    ubicacionAproximada: datos.filter(function (d) { return /^Aproximada/.test(d['Ubicacion'] || ''); }).length,
    distritosLocales: valoresUnicos('Distrito Local'),
    distritosFederales: valoresUnicos('Distrito Federal'),
    secciones: valoresUnicos('Seccion'),
    colonias: valoresUnicos('Colonia'),
    municipios: valoresUnicos('Nombre Municipio'),
    preguntas: preguntas,
    porSexo: ordenarConteo(contarPor(datos, 'Sexo')),
    porRangoEdad: ordenarConteo(contarPor(datos, 'Rango edad')),
    porColonia: ordenarConteo(contarPor(datos.filter(function (d) { return d['Colonia']; }), 'Colonia')).slice(0, 10),
    porMunicipio: ordenarConteo(contarPor(datos.filter(function (d) { return d['Nombre Municipio']; }), 'Nombre Municipio')).slice(0, 10),
    fechaInicio: fechas[0] || null,
    fechaFin: fechas[fechas.length - 1] || null
  };
}
