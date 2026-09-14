# axie-card-extractor

Proof of Concept reproducible para catalogar y descargar, sin modificar, las cartas que publica [Axie Origin Card Explorer](https://origin-rosy.vercel.app/).

## Resultado

- Fuente: dataset público Sanity `tac9w5pw / production`.
- Catálogo: 192 documentos `card`, 32 por cada una de 6 clases.
- Imágenes: assets PNG originales de Sanity CDN, 900×1350 en las 192 cartas.
- Integridad: validación contra tamaño y SHA-1 de Sanity, más SHA-256 local.
- Dependencias npm: ninguna. Requiere Node.js 22.6 o posterior.

Los PNG son renders completos de carta y ya contienen el coste, nombre, tipo visual y texto de efecto. El dataset no ofrece esos datos de forma estructurada para 188 de las 192 cartas. Este PoC no usa OCR ni transcribe/infiere esos campos desde píxeles.

## Uso

```powershell
npm run inspect
npm run list
npm run download -- --name "Teal Shell"
npm test
```

En npm 10 para Windows, `--name` puede ser consumido por npm; el script acepta también el valor posicional resultante. También se puede usar un slug para resolver variantes:

```powershell
npm run download -- --name "nut-cracker-tail"
```

`Nut Cracker` tiene tres documentos. El nombre sin sufijo selecciona determinísticamente el slug canónico `nut-cracker` (Mouth); los otros son `nut-cracker-ears` y `nut-cracker-tail`.

Para forzar una consulta nueva y omitir el catálogo cacheado:

```powershell
npm run list -- --refresh
npm run inspect -- --refresh
```

## Archivos producidos

- `output/card_catalog.json`: catálogo normalizado y ordenado por nombre/slug.
- `output/catalog_summary.json`: total, clases y nombres duplicados.
- `output/raw/<class>/<slug_snake_case>.png`: bytes originales sin recomprimir.
- `output/data/<slug_snake_case>.json`: metadata, hashes y procedencia.
- `debug/source_report.json`: reporte legible por máquina con fuente, consulta y casos de prueba.
- `debug/findings.md`: conclusiones técnicas y limitaciones.

`cache/` es descartable. En cold start, los scripts reconstruyen el cache consultando la fuente pública.

## Modelo de datos

El catálogo preserva el ID y slug técnico de Sanity. `local_name` deriva del slug y usa `snake_case`, lo que evita colisiones entre variantes con el mismo display name.

Los campos `cost`, `effect` y `card_type` son `null` cuando Sanity no los publica. En los únicos cuatro documentos con `body`, el PoC conserva `body_text`; además reconoce exclusivamente líneas explícitas `Mana: N` como coste. No analiza imágenes.

## Seguridad y alcance

Solo se utilizan endpoints públicos, sin token, credenciales ni bypass de autenticación. El flujo no redimensiona, recorta, optimiza ni vuelve a codificar imágenes.
