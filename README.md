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

Vite sin framework. Resolución interna 456×262, todo dibujado por código (sin imágenes): el mundo es un plano con
alturas que `render.js` proyecta en **perspectiva caballera** (lo ancho tal cual, el fondo
aplastado y corrido a la derecha, la altura hacia arriba), como las máquinas de antes.

La pista se levanta por **módulos de altura**: cada esquina del trazado es un bloque a 0, 1 o 2
pisos (15 unidades por piso) y cada recta une dos. Si están al mismo piso la recta es llana; si
no, lleva una rampa empinada a media recta o, al bajar, un corte del que se cae volando. Cada
bloque sube entero, con su valla, y por fuera queda el talud vertical. La salida va siempre a
ras de suelo y las diagonales de un cruce también.

Ningún desnivel pasa de 45°: las bajadas bruscas de un nivel y la caída de una rampa son
planos a 45°, y los obstáculos nunca se ponen donde cambia el piso. Obstáculos: rampas
(plano limpio con cresta), montañas (conos con arista), huecos (hoyos de paredes a 45°),
lomas, ondulado, rocas y charcos.

Las camionetas son un campo de alturas con las aristas biseladas, iluminado por su normal
(`truckModel`), girado en 32 ángulos. Además se inclinan con la normal del piso (cabeceo a lo
largo del eje y balanceo entre las ruedas, con la suavidad de una suspensión) y en el aire
levantan el morro al subir y lo bajan al caer; los cuadros inclinados se dibujan la primera vez
que hacen falta (`renderTruck`) y se guardan en caché a pasos de ~5°.

Las sombras salen de las alturas (luz del noroeste): una valla, una roca, un talud o el borde
de una rampa arrojan una sombra tan larga como altos son.

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
| `src/render.js` | Perspectiva caballera: terreno con relieve y camionetas biseladas con luz |
| `src/race.js` | Pantalla de carrera: bucle, mandos y marcador |
| `src/main.js` | Mapa, taller, resultado y compartir |

La pista tiene lados rectos y **ninguna esquina puntiaguda**. Cada esquina sale, según la
semilla, en arco o cortada a 45° (`buildField` mide la franja con distancia normal o «de
octógono» según la esquina más cercana), y después `smoothCorners` lima sobre la silueta los
picos que queden, por fuera y por dentro, con un arco de 9 px.
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
