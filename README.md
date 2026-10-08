# Offroad — Dotrino

> **Parte del ecosistema [Dotrino](https://dotrino.com).** Dotrino es un ecosistema de aplicaciones centradas en la privacidad de los datos: tu información es tuya, y las decisiones sobre ella también — qué compartes, con quién, cuándo y por qué. Sin anuncios, sin cookies, sin rastreo de datos, sin vender tu identidad a nadie.

Carreras de camionetas todoterreno en pixel art, con **la pista entera en pantalla**, en la
línea de las máquinas de carreras de tierra de finales de los 80. Gráficos, pistas y código
propios. PWA instalable, **funciona sin conexión**.

🔗 **https://offroad.dotrino.com/**

## Qué tiene

- **Cuatro camionetas por carrera**: tú contra tres llevadas por la máquina. Lomas que te
  hacen saltar, charcos que te frenan, y nitros y bolsas de dinero que aparecen en la pista.
- **Taller** entre carreras: llantas, amortiguadores, aceleración, velocidad y nitros, con el
  dinero de los premios.
- **Mapa de 24 carreras** (CONVENCIONES §12): cuatro regiones (desierto, bosque, nieve,
  volcán) con caminos que se bifurcan y un jefe al final de cada una. Las estrellas (3 por
  ganar, 2 por el segundo puesto, 1 por el tercero) abren jefes y regiones.
- **Reta a un amigo**: cada carrera es determinista y se comparte por enlace (`#r=<carrera>`).
  Compartir da 3 nitros, una vez por carrera.
- Teclado (← → girar, ↑ acelerar, ↓ frenar, Espacio nitro) y mandos táctiles. En un teléfono
  en vertical la pista se gira para ocupar la pantalla.
- Bilingüe es/en.

## Privacidad

Tu avance (estrellas, dinero, mejoras) vive en tu [store.dotrino.com](https://store.dotrino.com/),
atado a tu perfil. Las carreras compartidas viajan por `#fragment`, que no llega al servidor.
Analítica: GoatCounter sin cookies, autohospedado, solo en producción.

## Desarrollo

Vite sin framework. Resolución interna 384×240, todo dibujado por código (sin imágenes).

```bash
npm install
npm run dev        # http://localhost:3310
npm test           # simulación: las 24 carreras se completan y son deterministas
npm run test:e2e   # Playwright sobre el build
```

| Archivo | Qué hace |
|---|---|
| `src/track.js` | Trazados, muestreo del eje y campo de distancias (lógica pura) |
| `src/sim.js` | Física, rivales, premios en pista (lógica pura y determinista) |
| `src/levels.js` | Mapa, estrellas, premios y precios |
| `src/render.js` | Terreno y camionetas en pixel art |
| `src/race.js` | Pantalla de carrera: bucle, mandos y marcador |
| `src/main.js` | Mapa, taller, resultado y compartir |

Añadir una pista: un trazado nuevo en `LAYOUTS` (`src/track.js`), con el primer tramo recto,
y `npm test` comprueba que la máquina lo completa.

Licencia MIT.
