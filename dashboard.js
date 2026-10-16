// Funciones de las 3 secciones del dashboard (dashboard.html).
// Consume data.js (datos) y kpis.js (PREGUNTAS, distribucionPregunta, colores, etc.).

var COLORES_GRUPO = ['#1b84ff', '#50cd89', '#f1416c', '#7239ea', '#ffc700', '#17c1e8'];
var FUENTE_NUMEROS = "'TitilliumWeb', sans-serif";

function pct1(v) {
  return (v * 100).toFixed(1);
}

// Grupos del comparativo de la seccion 2: las dos ciudades principales y el resto del estado
function gruposRegion() {
  var mun = function (d) { return String(d['Nombre Municipio'] || '').toUpperCase(); };
  return [
    { clave: 'resto', nombre: 'Resto del Estado', prueba: function (d) { return !!mun(d) && mun(d) !== 'HERMOSILLO' && mun(d) !== 'CAJEME'; } },
    { clave: 'hermosillo', nombre: 'Hermosillo', prueba: function (d) { return mun(d) === 'HERMOSILLO'; } },
    { clave: 'cajeme', nombre: 'Cajeme', prueba: function (d) { return mun(d) === 'CAJEME'; } }
  ];
}

// filtro = { dl: Set<number>, df: Set<number>, mun: Set<string> } (Set vacio = todos)
function filtrarDatos(filtro) {
  return datos.filter(function (d) {
    if (filtro.dl && filtro.dl.size && !filtro.dl.has(d['Distrito Local'])) return false;
    if (filtro.df && filtro.df.size && !filtro.df.has(d['Distrito Federal'])) return false;
    if (filtro.mun && filtro.mun.size && !filtro.mun.has(d['Nombre Municipio'])) return false;
    return true;
  });
}

function valoresUnicosOrdenados(campo, numerico) {
  return Array.from(new Set(datos.map(function (d) { return d[campo]; })))
    .filter(function (v) { return v !== null && v !== undefined && v !== '' && v !== 0; })
    .sort(function (a, b) { return numerico ? a - b : String(a).localeCompare(String(b), 'es'); });
}

// Alterna la categoria en labelIndex dentro de las ocultas por el usuario (clic en su
// etiqueta del eje), salvo que sea la ultima categoria visible, y llama a actualizar().
function alternarCategoria(el, listaVisible, labelIndex, actualizar) {
  var cat = listaVisible[labelIndex];
  if (!cat) return;
  var ocultando = !el.__ocultas[cat.etiqueta];
  if (ocultando && listaVisible.length <= 1) return; // no ocultar la ultima categoria
  el.__ocultas[cat.etiqueta] = ocultando;
  actualizar();
}

// Al ocultar una categoria (clic en su etiqueta) esta desaparece del eje, asi que no
// queda forma de volver a hacer clic en ella. Este contenedor muestra las categorias
// ocultas como "chips" clicables debajo del grafico para poder restaurarlas.
function pintarOcultas(el, actualizar) {
  if (!el.__ocultasEl) {
    var cont = document.createElement('div');
    cont.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;justify-content:center;padding:0 5px 10px;';
    el.insertAdjacentElement('afterend', cont);
    el.__ocultasEl = cont;
  }
  var cont = el.__ocultasEl;
  cont.innerHTML = '';
  var claves = Object.keys(el.__ocultas).filter(function (k) { return el.__ocultas[k]; });
  if (!claves.length) return;

  var titulo = document.createElement('span');
  titulo.textContent = 'Ocultas:';
  titulo.style.cssText = 'font-size:11px;color:var(--muted-foreground);';
  cont.appendChild(titulo);

  claves.forEach(function (etiqueta) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = etiquetaLegible(etiqueta);
    chip.title = 'Mostrar de nuevo';
    chip.style.cssText = 'font-size:11px;line-height:1;padding:4px 9px;border-radius:9999px;' +
      'border:1px solid var(--border);background:transparent;color:var(--muted-foreground);cursor:pointer;';
    chip.addEventListener('click', function () {
      el.__ocultas[etiqueta] = false;
      actualizar();
    });
    cont.appendChild(chip);
  });
}

// Prepara el contenedor para (re)dibujar un grafico conservando las categorias ocultas
// que sigan existiendo en la lista nueva.
function prepararContenedor(selector, lista) {
  var el = document.querySelector(selector);
  if (el.__chart) { el.__chart.destroy(); el.__chart = null; }
  el.__listaCompleta = lista;
  var vigentes = {};
  lista.forEach(function (c) { if (el.__ocultas && el.__ocultas[c.etiqueta]) vigentes[c.etiqueta] = true; });
  el.__ocultas = vigentes;
  return el;
}

// Texto con la base de los porcentajes de una pregunta, p. ej. "Base: 567 que respondieron"
function textoBase(campo, registros) {
  var r = resumenPregunta(registros, campo);
  if (preguntaDe(campo).base === 'respondidas') {
    return 'Base: ' + r.respondieron.toLocaleString('es-MX') + ' que respondieron · ' +
      r.sinRespuesta.toLocaleString('es-MX') + ' sin respuesta';
  }
  return 'Base: ' + registros.length.toLocaleString('es-MX') + ' encuestas';
}

// Grafico de barras horizontales con el % de cada opcion de una pregunta, coloreado por
// partido/candidato. Las etiquetas del eje son clicables para ocultar/mostrar esa opcion.
function graficoDistribucion(selector, lista, altura) {
  var el = prepararContenedor(selector, lista);

  function datosVisibles() {
    return el.__listaCompleta.filter(function (c) { return !el.__ocultas[c.etiqueta]; });
  }

  function opcionesSerie(visible) {
    return {
      series: [{ name: 'Porcentaje', data: visible.map(function (c) { return Number(pct1(c.pct)); }) }],
      xaxis: { categories: visible.map(function (c) { return etiquetaLegible(c.etiqueta); }) },
      colors: visible.map(function (c) { return colorOpcion(c.etiqueta); })
    };
  }

  function actualizar() {
    var visible = datosVisibles();
    el.__visibleActual = visible;
    el.__chart.updateOptions(opcionesSerie(visible));
    pintarOcultas(el, actualizar);
  }

  var visibleInicial = datosVisibles();
  el.__visibleActual = visibleInicial;
  var inicial = opcionesSerie(visibleInicial);
  var chart = new ApexCharts(el, {
    chart: {
      type: 'bar', height: altura || 260, toolbar: { show: false }, fontFamily: 'inherit',
      events: {
        xAxisLabelClick: function (event, chartContext, config) {
          alternarCategoria(el, el.__visibleActual, config.labelIndex, actualizar);
        }
      }
    },
    series: inicial.series,
    xaxis: {
      categories: inicial.xaxis.categories,
      labels: { formatter: function (v) { return v + '%'; }, style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' } }
    },
    colors: inicial.colors,
    plotOptions: { bar: { horizontal: true, distributed: true, borderRadius: 4, barHeight: '65%' } },
    legend: { show: false },
    dataLabels: {
      enabled: true,
      formatter: function (v, opts) {
        var c = el.__visibleActual[opts.dataPointIndex];
        return v + '%' + (c ? ' (' + c.valor.toLocaleString('es-MX') + ')' : '');
      },
      style: { colors: ['#fff'], fontFamily: FUENTE_NUMEROS, fontSize: '13px' }
    },
    tooltip: {
      y: {
        formatter: function (v, opts) {
          var c = el.__visibleActual[opts.dataPointIndex];
          return v + '%' + (c ? ' — ' + c.valor.toLocaleString('es-MX') + ' respuestas' : '');
        }
      },
      style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' }
    }
  });
  chart.render();
  el.__chart = chart;
  pintarOcultas(el, actualizar);
  return chart;
}

// Junta una pregunta de todos los grupos en una sola lista [{ etiqueta, <clave grupo>: pct, ... }],
// ordenada por el promedio simple de los grupos. Los porcentajes usan la misma base que la
// pregunta (todas las encuestas del grupo o solo quienes respondieron).
function combinarGrupos(campo, grupos) {
  var mapa = {};
  var totales = {};
  grupos.forEach(function (g) {
    var registros = datos.filter(g.prueba);
    var dist = distribucionPregunta(registros, campo);
    totales[g.clave] = dist.base;
    dist.forEach(function (c) {
      if (!mapa[c.etiqueta]) {
        mapa[c.etiqueta] = { etiqueta: c.etiqueta };
        grupos.forEach(function (g2) { mapa[c.etiqueta][g2.clave] = 0; });
      }
      mapa[c.etiqueta][g.clave] = c.pct;
    });
  });
  var suma = function (c) { return grupos.reduce(function (s, g) { return s + c[g.clave]; }, 0); };
  var lista = Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) {
    if (esSinRespuesta(a.etiqueta)) return 1;
    if (esSinRespuesta(b.etiqueta)) return -1;
    return suma(b) - suma(a);
  });
  lista.totales = totales;
  return lista;
}

// Grafico de barras horizontales agrupadas comparando los grupos (Distritos Locales).
// Mismo comportamiento de clic en etiqueta para ocultar/mostrar una categoria.
function graficoGrupos(selector, categorias, grupos, altura) {
  var el = prepararContenedor(selector, categorias);
  var totales = categorias.totales || {};

  function datosVisibles() {
    return el.__listaCompleta.filter(function (c) { return !el.__ocultas[c.etiqueta]; });
  }

  function series(visible) {
    return grupos.map(function (g) {
      return {
        name: g.nombre + ' (n=' + (totales[g.clave] || 0).toLocaleString('es-MX') + ')',
        data: visible.map(function (c) { return Number(pct1(c[g.clave])); })
      };
    });
  }

  function actualizar() {
    var visible = datosVisibles();
    el.__visibleActual = visible;
    el.__chart.updateOptions({
      series: series(visible),
      xaxis: { categories: visible.map(function (c) { return etiquetaLegible(c.etiqueta); }) }
    });
    pintarOcultas(el, actualizar);
  }

  var visibleInicial = datosVisibles();
  el.__visibleActual = visibleInicial;
  var chart = new ApexCharts(el, {
    chart: {
      type: 'bar', height: altura || 340, toolbar: { show: false }, fontFamily: 'inherit',
      events: {
        xAxisLabelClick: function (event, chartContext, config) {
          alternarCategoria(el, el.__visibleActual, config.labelIndex, actualizar);
        }
      }
    },
    series: series(visibleInicial),
    xaxis: {
      categories: visibleInicial.map(function (c) { return etiquetaLegible(c.etiqueta); }),
      labels: { formatter: function (v) { return v + '%'; }, style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' } }
    },
    colors: COLORES_GRUPO.slice(0, grupos.length),
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '75%' } },
    legend: { position: 'bottom', horizontalAlign: 'center' },
    dataLabels: { enabled: false },
    tooltip: {
      y: { formatter: function (v) { return v + '%'; } },
      style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' }
    }
  });
  chart.render();
  el.__chart = chart;
  pintarOcultas(el, actualizar);
  return chart;
}

// Cruce de dos preguntas: para cada opcion de campoFilas (p. ej. partido preferido), como se
// reparten las respuestas de campoSeries (p. ej. aspirante a la alcaldia), en barras apiladas al 100%.
// Solo cuenta a quienes respondieron campoSeries.
function graficoCruce(selector, registros, campoFilas, campoSeries, altura) {
  var el = document.querySelector(selector);
  if (el.__chart) { el.__chart.destroy(); el.__chart = null; }

  var conRespuesta = registros.filter(function (d) { return !esSinRespuesta(d[campoSeries]); });
  var filas = distribucionPregunta(conRespuesta, campoFilas)
    .filter(function (c) { return c.valor > 0; })
    .map(function (c) { return c.etiqueta; });
  var columnas = distribucionPregunta(conRespuesta, campoSeries)
    .filter(function (c) { return !esSinRespuesta(c.etiqueta); })
    .map(function (c) { return c.etiqueta; });

  var conteo = {};
  conRespuesta.forEach(function (d) {
    var f = esSinRespuesta(d[campoFilas]) ? SIN_RESPUESTA : d[campoFilas];
    var c = d[campoSeries];
    conteo[f + '|' + c] = (conteo[f + '|' + c] || 0) + 1;
  });

  var chart = new ApexCharts(el, {
    chart: { type: 'bar', height: altura || 260, stacked: true, stackType: '100%', toolbar: { show: false }, fontFamily: 'inherit' },
    series: columnas.map(function (c) {
      return { name: etiquetaLegible(c), data: filas.map(function (f) { return conteo[f + '|' + c] || 0; }) };
    }),
    xaxis: {
      categories: filas.map(etiquetaLegible),
      labels: { formatter: function (v) { return v + '%'; }, style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' } }
    },
    colors: columnas.map(colorOpcion),
    plotOptions: { bar: { horizontal: true, borderRadius: 2, barHeight: '65%' } },
    legend: { position: 'bottom', horizontalAlign: 'center' },
    dataLabels: {
      enabled: true,
      formatter: function (v) { return v >= 8 ? Math.round(v) + '%' : ''; },
      style: { colors: ['#fff'], fontFamily: FUENTE_NUMEROS, fontSize: '12px' }
    },
    tooltip: {
      y: { formatter: function (v) { return v.toLocaleString('es-MX') + ' respuestas'; } },
      style: { fontFamily: FUENTE_NUMEROS, fontSize: '13px' }
    },
    noData: { text: 'Sin datos' }
  });
  chart.render();
  el.__chart = chart;
  return chart;
}

// Rellena la fila de KPIs (5 tarjetas con divisores) a partir de un conjunto de registros.
function pintarKpis(prefijo, registros) {
  var fmt = function (n) { return n.toLocaleString('es-MX'); };
  var poner = function (id, texto) { document.getElementById(prefijo + id).textContent = texto; };
  var s = calcularEstadisticas(registros);
  var partido = s.preguntas['Preferencia Partido'];
  var gub = s.preguntas['Gubernatura'];

  poner('_total', fmt(s.total));
  poner('_partido', partido.top.etiqueta);
  poner('_partido_pct', pct1(partido.top.pct || 0) + '% de las encuestas');
  poner('_gub', gub.top.etiqueta);
  poner('_gub_pct', pct1(gub.top.pct || 0) + '% de las encuestas');
  poner('_ventaja', s.total ? pct1(gub.ventaja) + ' pts' : '-');
  poner('_ventaja_sub', gub.segundo.valor ? 'sobre ' + gub.segundo.etiqueta : 'sin segundo lugar');
  poner('_sin', s.total ? pct1(gub.sinRespuesta / s.total) + '%' : '-');
}

// Dibuja las graficas de preguntas (y su texto de base) para un prefijo de seccion.
function pintarPreguntas(prefijo, registros) {
  PREGUNTAS.forEach(function (p, i) {
    var id = prefijo + '_chart_q' + (i + 1);
    graficoDistribucion('#' + id, distribucionPregunta(registros, p.campo));
    document.getElementById(id + '_base').textContent = textoBase(p.campo, registros);
  });
}
