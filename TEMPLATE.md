# Plantilla de reportaje

`index.html` es la página maestra. Conserva el diseño, las animaciones, los mapas, los gráficos y el comportamiento adaptable de la versión publicada de fecundidad.

## Crear otro reportaje

```sh
node scripts/create-reportage.mjs nombre-del-reportaje
```

El comando crea dos archivos:

- `nombre-del-reportaje.html`: una copia funcional de la página maestra.
- `content/nombre-del-reportaje.js`: el contenido específico del nuevo reportaje.

La nueva URL será:

```text
https://qdgvr.github.io/fecundidad.github.io/nombre-del-reportaje.html
```

## Qué se modifica en cada artículo

Edite `content/nombre-del-reportaje.js` para cambiar:

- título, descripción y URL canónica;
- nombre y lema de la cabecera;
- pasos narrativos del globo;
- títulos del índice y de los tres capítulos;
- párrafos situados antes y después de los interactivos y gráficos;
- imagen, fecha y tarjetas del bloque final.

Los estilos, los mapas, los gráficos, los selectores, las clasificaciones y las animaciones siguen cargándose desde los archivos comunes del repositorio.

## Posiciones narrativas disponibles

Los bloques de texto se identifican con estos nombres:

- `intro-body`
- `after-ocio-digital`
- `before-tiempo-exterior`
- `after-tiempo-exterior`
- `after-graph-1`
- `after-fecundidad`
- `after-graph-2`
- `closing-body`

## Comprobar sin crear archivos

```sh
node scripts/create-reportage.mjs prueba --dry-run
```

La página principal no carga ninguna configuración externa y continúa funcionando como antes.

## Crear artículos desde el navegador

La ruta `admin/` ofrece la misma plantilla mediante un formulario editorial:

1. inicio de sesión con una cuenta de GitHub autorizada;
2. edición de metadatos, prólogo, capítulos y bloques narrativos;
3. guardado del borrador en el navegador;
4. vista previa antes de publicar;
5. publicación del artículo y actualización automática de la portada.

En un servidor local se puede utilizar el editor y la vista previa sin credenciales. El botón de publicación solo se habilita cuando `admin/config.js` apunta al Worker desplegado y existe una sesión válida.

La configuración segura del servicio está descrita en [worker/README.md](worker/README.md).
