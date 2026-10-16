# Convierte el shapefile de secciones electorales (carpeta SON) a secciones_son.js para el mapa.
#
# Uso, desde esta carpeta:
#   python convertir_secciones.py                       -> lee ../SON/SECCION.shp
#   python convertir_secciones.py ruta/a/SECCION.shp
#
# Lee el .shp/.dbf a mano (sin pyshp), reproyecta de UTM 12N (EPSG:32612, ver SECCION.prj)
# a WGS84 con pyproj y simplifica la geometria con shapely (~3 m) para que la capa pese poco.
# Solo se necesita correr de nuevo si cambia el shapefile.

import json
import struct
import sys
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.ops import transform
from shapely.validation import make_valid

RAIZ = Path(__file__).resolve().parent
SHP = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ.parent / 'SON' / 'SECCION.shp'
SALIDA = RAIZ / 'secciones_son.js'
TOLERANCIA_M = 3  # simplificacion en metros (antes de reproyectar)

# Campo del .dbf -> propiedad usada por index.html
CAMPOS = {
    'SECCION': 'Seccion',
    'DISTRITO_L': 'DistritoLocal',
    'DISTRITO_F': 'DistritoFederal',
    'MUNICIPIO': 'MunicipioId',
    'TIPO': 'Tipo',
}


def leer_dbf(ruta):
    datos = ruta.read_bytes()
    n, largo_cab, largo_reg = struct.unpack('<IHH', datos[4:12])
    campos = []
    p = 32
    while datos[p] != 0x0D:
        nombre = datos[p:p + 11].split(b'\0')[0].decode('latin1')
        campos.append((nombre, chr(datos[p + 11]), datos[p + 16]))
        p += 32
    registros = []
    for i in range(n):
        o = largo_cab + i * largo_reg + 1
        reg = {}
        for nombre, tipo, largo in campos:
            v = datos[o:o + largo].decode('latin1').strip()
            o += largo
            reg[nombre] = (int(float(v)) if v else None) if tipo == 'N' else v
        registros.append(reg)
    return registros


def area_firmada(anillo):
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(anillo, anillo[1:] + anillo[:1])) / 2


def leer_shp(ruta):
    datos = ruta.read_bytes()
    p = 100
    geometrias = []
    while p < len(datos):
        largo = struct.unpack('>i', datos[p + 4:p + 8])[0] * 2
        cont = datos[p + 8:p + 8 + largo]
        p += 8 + largo
        tipo = struct.unpack('<i', cont[:4])[0]
        if tipo == 0:
            geometrias.append(None)
            continue
        if tipo not in (5, 15, 25):
            raise ValueError('Tipo de geometria no soportado: %d' % tipo)
        n_partes, n_puntos = struct.unpack('<ii', cont[36:44])
        partes = list(struct.unpack('<%di' % n_partes, cont[44:44 + 4 * n_partes]))
        base = 44 + 4 * n_partes
        puntos = [struct.unpack('<dd', cont[base + 16 * i:base + 16 * i + 16]) for i in range(n_puntos)]
        anillos = [puntos[a:b] for a, b in zip(partes, partes[1:] + [n_puntos])]
        # En shapefile los anillos exteriores van en sentido horario (area negativa) y los huecos al reves
        exteriores, huecos = [], []
        for an in anillos:
            (exteriores if area_firmada(an) < 0 else huecos).append(an)
        poligonos = [Polygon(ex) for ex in exteriores]
        con_huecos = [[] for _ in poligonos]
        for h in huecos:
            ph = Polygon(h)
            for i, pol in enumerate(poligonos):
                if pol.contains(ph.representative_point()):
                    con_huecos[i].append(h)
                    break
        geometrias.append(MultiPolygon([Polygon(ex, hs) for ex, hs in zip(exteriores, con_huecos)]))
    return geometrias


def main():
    registros = leer_dbf(SHP.with_suffix('.dbf'))
    geometrias = leer_shp(SHP)
    utm_a_wgs84 = Transformer.from_crs('EPSG:32612', 'EPSG:4326', always_xy=True).transform

    features = []
    for reg, geom in zip(registros, geometrias):
        if geom is None:
            continue
        geom = make_valid(geom).simplify(TOLERANCIA_M, preserve_topology=True)
        geom = transform(utm_a_wgs84, geom)
        g = mapping(geom)
        g = json.loads(json.dumps(g), parse_float=lambda v: round(float(v), 6))
        if g['type'] == 'MultiPolygon' and len(g['coordinates']) == 1:
            g = {'type': 'Polygon', 'coordinates': g['coordinates'][0]}
        features.append({
            'type': 'Feature',
            'properties': {destino: reg.get(origen) for origen, destino in CAMPOS.items()},
            'geometry': g,
        })

    capa = {'type': 'FeatureCollection', 'features': features}
    SALIDA.write_text(
        '// Secciones electorales de Sonora generadas con convertir_secciones.py a partir de '
        + SHP.name + '. No editar a mano.\n'
        'var secciones = ' + json.dumps(capa, separators=(',', ':')) + ';\n',
        encoding='utf-8')
    print('%d secciones -> %s (%.1f MB)' % (len(features), SALIDA.name, SALIDA.stat().st_size / 1e6))


if __name__ == '__main__':
    main()
