# fecundidad.github.io

La página publicada también funciona como diseño maestro para nuevos reportajes.
Consulte [TEMPLATE.md](TEMPLATE.md) para crear otra página con la misma estructura y contenido independiente.

## Portada y redacción

- `main.html`: portada editorial de Comunicación.
- `admin/`: acceso de autores, formulario, borradores y vista previa.
- `worker/`: autenticación con GitHub y publicación segura mediante Cloudflare Workers.
- `content/articles.json`: índice que alimenta automáticamente la portada.

La redacción funciona en modo de vista previa durante el desarrollo local. Para activar el inicio de sesión y la publicación real, siga [worker/README.md](worker/README.md). Los secretos OAuth y de sesión no deben guardarse en este repositorio.
