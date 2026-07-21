# Servicio editorial de Comunicación

Este Worker mantiene fuera de GitHub Pages el secreto OAuth. El navegador solo recibe una sesión firmada de dos horas que contiene el token OAuth cifrado con `SESSION_SECRET`; la página nunca recibe el token legible.

## 1. Crear la aplicación OAuth de GitHub

En GitHub, abra **Settings > Developer settings > OAuth Apps > New OAuth App** y use:

- **Application name:** `Comunicación Publisher`
- **Homepage URL:** `https://qdgvr.github.io/fecundidad.github.io/admin/`
- **Authorization callback URL:** `https://comunicacion-publisher.<su-subdominio>.workers.dev/auth/callback`

Guarde el `Client ID` y genere un `Client secret`. La aplicación OAuth verifica la identidad del autor y solicita `public_repo` para publicar en el repositorio configurado.

## 2. Instalar y desplegar el Worker

```sh
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

Después cargue los tres secretos:

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
```

Vuelva a desplegar si Wrangler lo solicita:

```sh
npx wrangler deploy
```

## 3. Conectar la redacción

Copie la URL final del Worker en `admin/config.js`:

```js
window.COMUNICACION_ADMIN_CONFIG = {
  apiBaseUrl: 'https://comunicacion-publisher.<su-subdominio>.workers.dev'
};
```

Si la URL del Worker cambia, actualice también la URL de callback de la aplicación OAuth.

## 4. Autorizar más cuentas

`ALLOWED_GITHUB_LOGINS` en `wrangler.jsonc` contiene una lista de usuarios de GitHub separados por comas:

```json
"ALLOWED_GITHUB_LOGINS": "qdgvr,otro-autor"
```

Despliegue de nuevo después de cambiarla.

## Flujo de publicación

1. El autor inicia sesión con GitHub en `/admin/`.
2. GitHub solicita `read:user` y `public_repo`; el Worker verifica que el usuario esté autorizado y emite una sesión firmada de dos horas con el token OAuth cifrado.
3. La redacción permite guardar un borrador local y generar una vista previa exacta de la plantilla.
4. Al publicar, el Worker crea el HTML, la configuración del artículo y la imagen opcional, y actualiza `content/articles.json` en un único commit.
5. GitHub Pages publica el artículo y la portada lo incorpora automáticamente.

La publicación falla sin modificar la rama si GitHub detecta un conflicto. Los slugs existentes no se sobrescriben.

## Seguridad operativa

- Active la autenticación de dos factores en GitHub y Cloudflare.
- Guarde `GITHUB_CLIENT_SECRET` y `SESSION_SECRET` únicamente como Cloudflare Secrets. Nunca los copie a `wrangler.jsonc`, `.dev.vars`, JavaScript del navegador o Git.
- La aplicación OAuth solicita `public_repo`, pero el Worker solo escribe en `GITHUB_OWNER/GITHUB_REPO`, exige una cuenta incluida en `ALLOWED_GITHUB_LOGINS` y valida el origen del panel.
- La sesión editorial caduca a las dos horas y se guarda en `sessionStorage`; cerrar la pestaña elimina esa copia. Los borradores sí permanecen en el almacenamiento local del navegador hasta que se borren sus datos.
- El Worker acepta publicaciones solo desde `https://qdgvr.github.io`, comprueba la cuenta permitida, valida tamaño, tipo y rutas, y nunca sobrescribe un slug ya publicado.
