<!-- egdev:lang:start -->
<p align="right">
  <a href="./README.md"><img src="https://img.shields.io/badge/English-1F1F1F?style=for-the-badge&labelColor=0A0A0A&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2MCAzMCI%2BPGNsaXBQYXRoIGlkPSJ0Ij48cGF0aCBkPSJNMzAsMTVoMzB2MTV6djE1aC0zMHpoLTMwdi0xNXp2LTE1aDMweiIvPjwvY2xpcFBhdGg%2BPHBhdGggZD0iTTAsMHYzMGg2MHYtMzB6IiBmaWxsPSIjMDEyMTY5Ii8%2BPHBhdGggZD0iTTAsMCA2MCwzME02MCwwIDAsMzAiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSI2Ii8%2BPHBhdGggZD0iTTAsMCA2MCwzME02MCwwIDAsMzAiIGNsaXAtcGF0aD0idXJsKCN0KSIgc3Ryb2tlPSIjQzgxMDJFIiBzdHJva2Utd2lkdGg9IjQiLz48cGF0aCBkPSJNMzAsMHYzME0wLDE1aDYwIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMTAiLz48cGF0aCBkPSJNMzAsMHYzME0wLDE1aDYwIiBzdHJva2U9IiNDODEwMkUiIHN0cm9rZS13aWR0aD0iNiIvPjwvc3ZnPg%3D%3D" alt="English" /></a>
  <img src="https://img.shields.io/badge/Espa%C3%B1ol-FF0036?style=for-the-badge&labelColor=0A0A0A&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA3NTAgNTAwIj48cmVjdCB3aWR0aD0iNzUwIiBoZWlnaHQ9IjUwMCIgZmlsbD0iI2M2MGIxZSIvPjxyZWN0IHdpZHRoPSI3NTAiIGhlaWdodD0iMjUwIiB5PSIxMjUiIGZpbGw9IiNmZmM0MDAiLz48L3N2Zz4%3D" alt="Español" />
</p>
<!-- egdev:lang:end -->

<!-- egdev:header:start -->
<img src="./.github/assets/banner.png" alt="Banner de Nexo" width="100%" />

<div align="center">

[![Version](https://img.shields.io/github/v/release/egdev6/nexo?style=for-the-badge&labelColor=000000&color=FF0036&label=version)](https://github.com/egdev6/nexo/releases)
[![Stars](https://img.shields.io/github/stars/egdev6/nexo?style=for-the-badge&labelColor=000000&color=FF0036)](https://github.com/egdev6/nexo/stargazers)
[![Issues](https://img.shields.io/github/issues/egdev6/nexo?style=for-the-badge&labelColor=000000&color=FF0036)](https://github.com/egdev6/nexo/issues)
[![License](https://img.shields.io/github/license/egdev6/nexo?style=for-the-badge&labelColor=000000&color=FF0036)](./LICENSE)

</div>
<!-- egdev:header:end -->

# Nexo

Nexo reúne aplicaciones compatibles en un único hub.

## Qué es

Nexo es un hub de bandeja para Windows que permite acceder a aplicaciones compatibles y sus acciones desde un panel anclado a la derecha. También muestra apps oficiales de un catálogo público y permite gestionar apps locales.

El panel permanece abierto mientras trabajáis en otras ventanas. Utiliza la bandeja de Windows para acceder rápidamente y conserva vuestros ajustes entre sesiones.

<p align="center"><img src="./.github/assets/screenshot.png" alt="Hub de Nexo" width="100%" /></p>

<!-- egdev:stack:start -->
## Stack

<div align="center">
<a href="https://github.com/Gentleman-Programming/gentle-ai">
  <img width="220" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
</a>
</div>

<div align="center">

![Tauri](https://img.shields.io/badge/Tauri-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)
![npm](https://img.shields.io/badge/npm-CB3837?style=for-the-badge&logo=npm&logoColor=white)

</div>
<!-- egdev:stack:end -->

## Inicio rápido

### Instalar

En Windows 10 u 11, descargad `Nexo_<version>_x64-setup.exe` desde [Releases](https://github.com/egdev6/nexo/releases) y ejecutadlo. La instalación es por usuario y no requiere permisos de administrador. El instalador no tiene firma de código de Windows, por lo que SmartScreen puede pedir confirmación. Desde la 0.2.0, Nexo busca versiones nuevas al arrancar y desde **Ajustes › Acerca de**, y las instala cuando lo confirmáis; las versiones anteriores se actualizan instalando la nueva encima.

El repositorio es privado, por lo que necesitáis permiso para acceder a la release.

### Desarrollar

Instalad Rust estable y Node.js 22.12 o superior dentro de la rama 22.x, o Node.js 24 o superior. Vite necesita Node.js 22.12+ y Vitest no es compatible con Node.js 23. Las herramientas del design system para agentes requieren Node.js 24.x. Para ejecutar el hub hacen falta Windows y WebView2. Mientras el repositorio sea privado, necesitáis permiso para clonarlo.

```sh
git clone https://github.com/egdev6/nexo.git
cd nexo
cd apps/hub
npm ci
npm test
npm run build
npm run app:dev
```

Compilad el frontend antes de ejecutar las comprobaciones de Rust, ya que el hub lo incorpora. Consultad [Contribuir](./CONTRIBUTING.md) para el flujo de trabajo y las comprobaciones de Windows.

## Scripts

Desde `apps/hub`:

| Comando | Función |
| --- | --- |
| `npm run dev` | Iniciar el servidor de desarrollo del frontend. |
| `npm test` | Ejecutar los tests del frontend. |
| `npm run ds:doctor` | Comprobar la instalación del design system y ejecutar su protección (elementos sin componente, selectores internos, lista de excepciones). |
| `npm run build` | Comprobar TypeScript y compilar el frontend. |
| `npm run app:dev` | Ejecutar la aplicación de escritorio en desarrollo. |

Desde la raíz del repositorio, tras compilar el frontend:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --workspace
```

`scripts/check.sh --windows` ejecuta la verificación local, incluidos los tests y Clippy nativos de Windows desde WSL; consultad [Contribuir](./CONTRIBUTING.md) para los requisitos. CI ejecuta las mismas comprobaciones en Windows en cada pull request.

## Arquitectura

- `apps/hub/` contiene el hub Tauri y React; el protocolo compartido (`nexo-protocol`) y el [cliente de bandeja de Windows](https://github.com/egdev6/tauri-plugin-nexo/blob/v0.1.1/crates/tauri-plugin-nexo/README.md) vienen del repositorio público [egdev6/tauri-plugin-nexo](https://github.com/egdev6/tauri-plugin-nexo); `crates/nexo-catalog/` valida los datos del catálogo.
- Un clic izquierdo en el icono de la bandeja muestra u oculta el panel. El botón X y Escape también lo ocultan; con clic derecho y **Salir** cerráis la aplicación. Una segunda ejecución muestra el panel existente. El panel tiene tamaño fijo, permanece por encima de las demás ventanas, ocupa la altura del área de trabajo, cubre su borde derecho y se desplaza cuando hace falta. Sigue abierto al perder el foco; las pestañas admiten flechas, Inicio y Fin.
- El hub sirve el protocolo IPC para apps que usan `tauri-plugin-nexo`, cuyas acciones aparecen en su menú de bandeja. Para apps oficiales instaladas sin el plugin, detecta el proceso del ejecutable correspondiente e indica si está abierto, detenido o si su estado es desconocido. La solicitud de cierre equivale al botón X de la app, nunca fuerza la terminación y avisa si la app sigue abierta, por ejemplo en su bandeja. Las apps locales se cierran desde la propia aplicación.
- Los ajustes se guardan en el directorio de configuración de la aplicación. **Ocultar apps locales** está desactivado por defecto; al activarlo se oculta su sección de Mis apps sin afectar a su gestión desde Ajustes.
- El [catálogo oficial](https://github.com/egdev6/nexo-catalog) y sus novedades se sirven mediante GitHub Pages y se guardan en caché local. Los cambios del catálogo pueden llegar a los hubs instalados sin publicar una versión de Nexo; desarrollo y tests usan datos de ejemplo. Novedades se abre al mostrar el hub solo si hay noticias oficiales sin ver de los últimos 30 días y está activado **Mostrar novedades al abrir**.
- El hub usa paquetes vendorizados del design system EGDEV y expone su servidor MCP a los agentes. Consultad el [ADR 0001](./docs/decisions/0001-adopt-egdev-design-system.md) para las versiones fijadas, las reglas y el procedimiento de actualización.

## Contribuir

Empezad con una issue, trabajad en una rama y abrid una pull request. Ejecutad las comprobaciones locales antes de enviarla. Consultad [CONTRIBUTING.md](./CONTRIBUTING.md) para el proceso completo y las reglas del design system.

## Recursos

- [Repositorio del catálogo oficial](https://github.com/egdev6/nexo-catalog)
- [Decisión del design system (ADR 0001)](./docs/decisions/0001-adopt-egdev-design-system.md)
- [Formato y carga del catálogo](./docs/catalog.md)
- [Protocolo IPC](https://github.com/egdev6/tauri-plugin-nexo/blob/v0.1.1/docs/protocol.md)
- [Resolución de problemas de arranque](./docs/troubleshooting.md)
- [Guía del plugin Tauri](https://github.com/egdev6/tauri-plugin-nexo/blob/v0.1.1/crates/tauri-plugin-nexo/README.md)

## Licencia

Nexo está disponible bajo la [licencia MIT](./LICENSE).

<!-- egdev:contact:start -->
## Contacto

<div align="center">

[![Web](https://img.shields.io/badge/egdev.es-FF0036?style=for-the-badge&logo=googlechrome&logoColor=white)](https://egdev.es)
[![YouTube](https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/@egdev6)
[![Twitch](https://img.shields.io/badge/Twitch-9146FF?style=for-the-badge&logo=twitch&logoColor=white)](https://twitch.tv/egdev6)
[![X](https://img.shields.io/badge/X-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/egdev66)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/egdev6/)
[![Instagram](https://img.shields.io/badge/Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://www.instagram.com/egdev6/)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/egdev6)
![Discord](https://img.shields.io/badge/Egdev5285-5865F2?style=for-the-badge&logo=discord&logoColor=white)
[![Gmail](https://img.shields.io/badge/Gmail-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:egdev6@gmail.com)

</div>
<!-- egdev:contact:end -->

<!-- egdev:footer:start -->
---

<div align="center">

**⭐ Si este proyecto te resulta útil, considera darle una estrella en GitHub ⭐**

</div>
<!-- egdev:footer:end -->
