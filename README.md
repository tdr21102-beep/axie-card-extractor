# AXIE / CARD EXTRACTOR

Desktop V1 y CLI reproducible para catalogar, previsualizar y exportar sin modificaciones las 192 cartas publicadas en el dataset público de Sanity usado por Axie Origin Card Explorer.

## Desktop V1

La aplicación usa Electron, React, Vite y TypeScript. Conserva el backend original en `src/` y lo comparte con la CLI mediante esta separación:

```text
React UI -> preload API -> IPC validado -> backend TypeScript -> Sanity/cache/exporter
```

Electron se ejecuta con `contextIsolation: true`, `nodeIntegration: false` y sandbox habilitado. El renderer no recibe acceso general a Node ni ejecuta comandos CLI como subprocesses.

Requisitos: Node.js 22.6 o posterior y Windows para generar el portable.

```powershell
npm ci
npm run dev
```

## Card Catalog

La pestaña **Card Catalog** muestra metadata de las 192 cartas y permite filtrar por clase y parte, además de buscar instantáneamente por display name, slug, nombre local o ID interno. La lista no carga imágenes. Solo al seleccionar una carta se descarga o reutiliza desde cache su preview original.

El panel de detalle muestra los campos reales disponibles: clase, parte, ID de Sanity, slug, nombre local, URL, body, mana/cost, effect y card type. Los valores ausentes se identifican como no estructurados en la fuente. También muestra dimensiones, SHA-256 y estado Cached/Downloaded.

**Export Raw Card** conserva exactamente los bytes descargados: no recomprime, redimensiona, recorta ni transforma el PNG. Si un archivo idéntico ya existe se omite; si el mismo nombre contiene bytes distintos se informa un conflicto y no se sobrescribe.

## Batch Export

La pestaña **Batch Export** filtra por clase y parte, anticipa cuántas cartas están cacheadas y permite elegir:

- **By Class** (default): `<export_root>/<class>/<local_name>.png`
- **Flat Folder**: `<export_root>/<local_name>.png`
- **Export metadata JSON** (activado por defecto)

La metadata se escribe bajo `data/<class>/` o `data/` según el layout. El primer lote crea `batch_report.json` con filtros, layout, totales y resultado individual; las ejecuciones diferentes posteriores preservan los reportes previos usando `batch_report_2.json`, etc. Un error de red, imagen o filesystem en una carta no detiene las demás.

Los nombres derivan del slug mediante la utilidad compartida `snakeCase`. Por eso las variantes de Nut Cracker se exportan sin colisión como `nut_cracker.png`, `nut_cracker_ears.png` y `nut_cracker_tail.png`.

## Card Studio

La tercera pestaña compone una carta sin modificar ninguno de sus inputs:

```text
clean visual PNG + game metadata JSON + config/card_layout.json
  -> renderer raster local
  -> rendered final PNG
```

El browser de la izquierda selecciona una carta del catálogo. La preview central se actualiza después de editar cualquier campo y muestra claramente `Clean visual not available` hasta importar manualmente un PNG clean. El editor derecho separa Source Metadata de Sanity, siempre read-only, de Game Metadata editable.

Campos editables visuales: Name, Cost, Value, Card Type y Description. `card_type` ofrece `attack`, `skill`, `secret` y `power` como sugerencias, pero acepta texto extensible. La sección **Gameplay** edita `targeting` y una lista ordenada de effects sin exigir JSON manual: Add, Move Up/Down, Duplicate y Delete. La vista **Advanced JSON** valida el documento completo antes de reemplazar el draft válido.

Game Metadata V2 separa el texto visible de la lógica estructurada. `description` nunca se ejecuta ni genera effects. La validación muestra `Valid`, `Warnings` o `Invalid`; los warnings se pueden guardar, los errores estructurales no. Los JSON V1 existentes se migran a V2 solo en memoria y no se reescriben hasta un Save explícito.

Desktop guarda las capas editables bajo el directorio de datos de usuario de Electron:

```text
cards/
├── clean/<class>/<card_name>.png
├── data/<class>/<card_name>.json
└── rendered/<class>/<card_name>.png
```

Las rutas se derivan del ID/slug source, nunca del nombre editable. Importar un clean distinto requiere confirmación. Los PNG se validan, se copian sin transformación y se registran con SHA-256. Preview y export usan el mismo servicio backend; React no dibuja ni escribe archivos.

El layout versionado está en `config/card_layout.json`, con referencia 900×1350 y posición, ancho, fuente, alineación, líneas y espaciado para cada campo. El renderer escala esas coordenadas a las dimensiones reales del clean, conserva alpha y aplica wrapping con reducción determinista de fuente; si el contenido aún no entra, informa un error explícito sin truncarlo silenciosamente.

El ejemplo V2 solicitado está en `cards/data/beast/furball.json`:

```json
{
  "schema_version": 2,
  "id": "furball",
  "name": "Furball",
  "class": "beast",
  "part": "back",
  "cost": 1,
  "value": 40,
  "card_type": "attack",
  "description": "Deal 2 hits.",
  "targeting": { "mode": "single_enemy" },
  "effects": [
    {
      "id": "damage_1",
      "type": "damage",
      "target": "selected",
      "amount": 20,
      "hits": 2
    }
  ]
}
```

Effects iniciales: `damage`, `heal`, `shield`, `buff`, `debuff` y `cleanse`. Targets iniciales: `self`, `selected`, `single_enemy`, `single_ally`, `all_enemies` y `all_allies`. La unión discriminada conserva solo campos relevantes por tipo y deja preparada la evolución futura sin implementar todavía statuses como poison/rage/feathers/bubbles.

### Visual placeholder y game export

**Visual Source** permite elegir `Original / Placeholder` o `Clean / Rendered`. El original se obtiene desde la misma capa RAW/cache y nunca recibe metadata superpuesta; la UI advierte que su texto horneado puede no coincidir con Game Metadata. Clean/Rendered conserva el renderer V1 desacoplado de `effects`.

**Export Game Card** genera un paquete conflict-safe y determinista:

```text
<export_root>/game_export/<class>/<card_id>/
├── card.png
└── card.json
```

En modo placeholder, `card.png` es byte-identical al original. `card.json` contiene Game Metadata V2 y un bloque `visual` con source, filename y SHA-256. El contrato estable para un futuro importador Godot está documentado en `docs/game_card_schema.md`; este proyecto no modifica ni ejecuta Godot.

El layout usa `config/card_layout.json` v2 con `min_font_size` y fitting determinista. Name y Description reducen la fuente hasta el mínimo configurado; si el texto importante aún no entra, el renderer devuelve un error explícito en vez de truncarlo silenciosamente. `config/card_types.json` prepara labels, style keys y referencias futuras a iconos sin descargar assets. `assets/fonts/` reserva el slot para una fuente empaquetada futura.

No existe integración con OpenAI, OCR ni borrado automático. El almacenamiento clean queda desacoplado para que una iteración futura pueda producir ese input con otro proveedor sin cambiar metadata ni renderer.

## Fuente y cache

- Metadata source: Sanity public dataset `tac9w5pw / production`, API `2022-01-31`.
- Image source: Sanity CDN.
- Tipo consultado: `card`.
- Total conocido: 192 cartas, 32 por clase.

La aplicación no se presenta como fuente oficial. `cache/` es descartable en la CLI; Desktop usa el directorio de datos de usuario de Electron. Si el catálogo cacheado es válido, el inicio no fuerza una consulta. **Refresh Catalog** solicita una actualización explícita.

## CLI

Los comandos originales continúan disponibles:

```powershell
npm run inspect
npm run inspect -- --refresh
npm run list
npm run list -- --refresh
npm run download -- --name "Teal Shell"
npm run download -- --name "nut-cracker-tail"
npm test
npm run typecheck
```

## Build y portable Windows

```powershell
npm run build
npm run dist
```

El build genera el renderer en `dist/`, los procesos Electron en `dist-electron/` y el portable sin firma en:

```text
release/Axie Card Extractor.exe
```

Para ejecutar los casos reales de aceptación del catálogo, Teal Shell, Cucumber Slice, variantes Nut Cracker y batch Aqua:

```powershell
npm run acceptance
```

`npm run acceptance` ejecuta las regresiones del extractor, el flujo V1 y la aceptación Furball V2. También pueden ejecutarse por separado con `npm run acceptance:extractor`, `npm run acceptance:studio` y `npm run acceptance:studio-v2`. Los outputs quedan bajo `output/acceptance/` y son regenerables.

La aceptación de GUI abre Electron empaquetado localmente, entra a Card Studio, selecciona Furball y captura el editor:

```powershell
npm run smoke:gui
```

## Desarrollo y tests

```powershell
npm run typecheck
npm test
npm run build
```

La suite cubre el core original, filtros, búsqueda, layouts, nombres sin colisión, metadata, cache hit/miss, aislamiento batch, cold start e IPC. `npm ci` usa el lockfile versionado.

## Limitaciones conocidas

- Los PNG son renders completos; no hay artwork separado.
- Sanity no publica cost/effect/type estructurados para la mayoría de las cartas.
- No se usa OCR, IA ni inferencia desde píxeles.
- La fuente temporal es `Arial` del sistema. El layout admite reemplazarla, pero falta seleccionar y versionar una fuente pixel-art con licencia segura para garantizar tipografía idéntica entre PCs.
- La composición es determinista dentro del mismo runtime/fuente; con una fuente de sistema, el raster puede variar entre equipos.
- No hay eliminación de texto, generación de imágenes, OCR, integración Godot ni ejecución de effects/sistema de combate.
- El portable no está firmado; Windows puede mostrar una advertencia de reputación.
- La V1 usa el ícono por defecto de Electron.
- La primera carga sin cache requiere acceso a Sanity y la primera preview/exportación requiere acceso al CDN.
