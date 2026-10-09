# Offroad — Dotrino

> **Parte del ecosistema [Dotrino](https://dotrino.com).** Dotrino es un ecosistema de aplicaciones centradas en la privacidad de los datos: tu información es tuya, y las decisiones sobre ella también — qué compartes, con quién, cuándo y por qué. Sin anuncios, sin cookies, sin rastreo de datos, sin vender tu identidad a nadie.

Carreras de camionetas todoterreno en pixel art, con **la pista entera en pantalla** y vista
en perspectiva (lomas, cuestas y vallas con relieve), en la
línea de las máquinas de carreras de tierra de finales de los 80. Gráficos, pistas y código
propios. PWA instalable, **funciona sin conexión**.

🔗 **https://offroad.dotrino.com/**

## Qué tiene

- **Cuatro camionetas por carrera**: tú contra tres llevadas por la máquina, en una pista
  muy ancha (76 px: caben seis camionetas a la par). **Rampas** con saltos largos, **rocas** que hay que rodear, montículos, ondulado, lomas,
  cuestas, charcos que te frenan, y nitros y bolsas
  de dinero que aparecen en la pista. Las camionetas chocan entre sí (caja de choque de medio
  dibujo: se solapan al rozarse, rebotan y saltan chispas).
- **Taller** entre carreras: llantas, amortiguadores, aceleración, velocidad y nitros, con el
  dinero de los premios.
- **Mapa de 24 carreras** (CONVENCIONES §12): cuatro regiones (desierto, bosque, nieve,
  volcán) con caminos que se bifurcan y un jefe al final de cada una. Las estrellas (3 por
  ganar, 2 por el segundo puesto, 1 por el tercero) abren jefes y regiones.
- **Pista al azar**: una pista nueva cada vez, sin fin, con rivales a tu nivel. Da premio, no
  estrellas, y se comparte por su semilla (`#t=<semilla>`).
- **Reta a un amigo**: cada carrera es determinista y se comparte por enlace (`#r=<carrera>`).
  Compartir da 3 nitros, una vez por carrera.
- **Giro analógico**: en táctil, un volante (cuanto más lejos del centro, más gira), el pedal
  de gas y el botón de nitro; mando de juego (palanca izquierda, gatillos, X nitro); y teclado (← → girar,
  ↑ acelerar, ↓ frenar, Espacio nitro), que gira el volante poco a poco. En un teléfono se ve
  más grande en horizontal.
- Bilingüe es/en.

## Privacidad

Tu avance (estrellas, dinero, mejoras) vive en tu [store.dotrino.com](https://store.dotrino.com/),
atado a tu perfil. Las carreras compartidas viajan por `#fragment`, que no llega al servidor.
Analítica: GoatCounter sin cookies, autohospedado, solo en producción.

## Desarrollo

Vite sin framework. Resolución interna 456×240, todo dibujado por código (sin imágenes): el mundo es un plano con
alturas que `render.js` proyecta en **perspectiva caballera** (lo ancho tal cual, el fondo
aplastado y corrido a la derecha, la altura hacia arriba), como las máquinas de antes.

La pista tiene **varios niveles**: además de lomas, montículos y rampas, hay tramos enteros en
alto (mesetas, con su valla y su talud), a los que se sube por una cuesta y de los que se sale
por otra o por un corte del que se cae volando.

```bash
npm install
npm run dev        # http://localhost:3310
npm test           # simulación: las 24 carreras se completan y son deterministas
npm run test:e2e   # Playwright sobre el build
```

| Archivo | Qué hace |
|---|---|
| `src/track.js` | Trazados, muestreo del eje, campo de distancias y alturas (lógica pura) |
| `src/sim.js` | Física (agarre, altura y saltos, choques), rivales, premios en pista (lógica pura y determinista) |
| `src/levels.js` | Mapa, estrellas, premios y precios |
| `src/render.js` | Perspectiva caballera: terreno con relieve y camionetas modeladas con cubitos |
| `src/race.js` | Pantalla de carrera: bucle, mandos y marcador |
| `src/main.js` | Mapa, taller, resultado y compartir |

La pista tiene las **esquinas cuadradas**, por fuera y por dentro: la franja se mide con
distancia «de cuadrado» al polígono (`buildField`), no con distancia normal, que las redondea.
La trazada por la que se mide el avance y conduce la máquina sí va redondeada.

Las pistas se **arman por piezas** a partir de una semilla (`generateLayout` en `src/track.js`):
sobre una cuadrícula de 3×3 casillas se elige un grupo de casillas pegadas y la pista es su
contorno: cada lado es una recta, cada vértice una curva, y algunas esquinas se cortan en
diagonal. Sobre eso se añaden dos piezas: el **cruce** (dos rectas enfrentadas se cambian de
lado por dos diagonales que se cortan, y sale un ocho) y la **chicana** (en una recta larga la
pista se desvía a un lado y vuelve, si el desvío cabe). La misma semilla da siempre la misma pista (por eso se comparte por enlace), y
3.000 semillas dan más de 2.300 formas distintas (230 con cruce, 760 con chicana). Quedan ocho trazados dibujados a mano
(`LAYOUTS`): el óvalo de la primera carrera y los de cruce (ocho, reloj de arena) de los jefes.

`npm test` comprueba que la máquina lo completa.

Licencia MIT.
