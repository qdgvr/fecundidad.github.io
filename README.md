# fecundidad.github.io

La página publicada también funciona como diseño maestro para nuevos reportajes.
Consulte [TEMPLATE.md](TEMPLATE.md) para crear otra página con la misma estructura y contenido independiente.

## Portada y redacción

- `main.html`: portada editorial de Comunicación.
- `admin/`: acceso de autores, formulario, borradores y vista previa.
- `worker/`: autenticación con GitHub y publicación segura mediante Cloudflare Workers.
- `content/articles.json`: índice que alimenta automáticamente la portada.

La redacción funciona en modo de vista previa durante el desarrollo local. Para activar el inicio de sesión y la publicación real, siga [worker/README.md](worker/README.md). Los secretos OAuth y de sesión no deben guardarse en este repositorio.

## Gráficos en la redacción

El editor incluye un creador de gráficos en `admin/`. El botón **Gráfico** permite:

- elegir entre barras, barras horizontales, líneas, áreas, dispersión y anillo;
- pegar datos en CSV o JSON;
- cambiar título, subtítulo, fuente, etiquetas, color, tema, leyenda y cuadrícula;
- importar una plantilla JSON local;
- importar un catálogo JSON desde un archivo público de GitHub o GitHub Gist;
- previsualizar el resultado antes de insertarlo en el artículo.

El gráfico se renderiza en el navegador y se inserta como PNG de 1600 × 900 px. El artículo publicado no ejecuta código procedente de la plantilla ni depende de un servicio gráfico externo.

### Plantillas JSON

Las plantillas integradas están en `admin/chart-templates.json`. `admin/chart-template.example.json` contiene un ejemplo descargable e importable. Una plantilla admite esta estructura básica:

```json
{
  "id": "mi-linea",
  "name": "Mi gráfico de líneas",
  "type": "line",
  "description": "Descripción visible en el editor.",
  "palette": ["#36babc", "#75a8e8"],
  "defaults": {
    "legend": true,
    "grid": true,
    "stacked": false
  },
  "content": {
    "title": "Título inicial",
    "subtitle": "Subtítulo inicial",
    "source": "Fuente: ejemplo",
    "xLabel": "Año",
    "yLabel": "Valor",
    "theme": "dark",
    "data": [
      { "Año": "2023", "Serie A": 12, "Serie B": 9 },
      { "Año": "2024", "Serie A": 15, "Serie B": 11 }
    ]
  }
}
```

Los tipos permitidos son `bar`, `horizontalBar`, `line`, `area`, `scatter` y `donut`. También se puede importar `{ "templates": [...] }` para añadir varias plantillas a la vez.

Por seguridad, la importación directa por URL solo acepta archivos JSON públicos de `raw.githubusercontent.com` y `gist.githubusercontent.com`. Los archivos de otras fuentes pueden descargarse y cargarse mediante el selector local. El editor limita cada catálogo a 40 plantillas, los datos a 250 filas y 8 series, y el JSON a 500 KB.
