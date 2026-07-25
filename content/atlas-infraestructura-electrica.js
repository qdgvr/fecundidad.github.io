window.COMUNICACION_POST = {
  meta: {
    title: 'Comunicación | Atlas abierto de la infraestructura eléctrica',
    description: 'Atlas interactivo de la infraestructura eléctrica cartografiada públicamente en Europa, Estados Unidos y Asia Oriental.',
    canonical: 'https://qdgvr.github.io/fecundidad.github.io/atlas-infraestructura-electrica.html'
  },
  brand: {
    name: 'Comunicación',
    motto: 'veritas lux mea',
    href: 'main.html'
  },
  article: {
    section: 'Infraestructura',
    title: 'Atlas abierto de la infraestructura eléctrica',
    description: 'Europa, Estados Unidos, China, Japón, Corea del Sur y Taiwán en una misma vista cartográfica.',
    author: 'Kitak Kang',
    date: '2026-07-25',
    dateLabel: '25 de julio de 2026',
    bodyHtml: `
      <section class="grid-atlas" data-grid-atlas aria-label="Atlas interactivo de infraestructura eléctrica">
        <div class="grid-atlas-toolbar">
          <div class="grid-atlas-regions" role="group" aria-label="Cambiar región">
            <button type="button" data-region-button data-region-key="europa" data-region="Europa" data-map-url="https://openinframap.org/#3.5/51/10/A,B,L,P" data-bounds="-11,34,41,72" data-max-zoom="4.5" aria-pressed="true">Europa</button>
            <button type="button" data-region-button data-region-key="estados-unidos" data-region="Estados Unidos" data-map-url="https://openinframap.org/#3.4/39/-98/A,B,L,P" data-bounds="-125,24,-66,50" data-max-zoom="4.5" aria-pressed="false">Estados Unidos</button>
            <button type="button" data-region-button data-region-key="china" data-region="China" data-map-url="https://openinframap.org/#3.5/35/104/A,B,L,P" data-bounds="73,18,135,54" data-max-zoom="4.5" aria-pressed="false">China</button>
            <button type="button" data-region-button data-region-key="japon" data-region="Japón" data-map-url="https://openinframap.org/#5/36.5/138/A,B,L,P" data-bounds="128,30,146,46" data-max-zoom="6" aria-pressed="false">Japón</button>
            <button type="button" data-region-button data-region-key="corea-del-sur" data-region="Corea del Sur" data-map-url="https://openinframap.org/#6/36/128/A,B,L,P" data-bounds="125.5,33,130,39.2" data-max-zoom="7" aria-pressed="false">Corea del Sur</button>
            <button type="button" data-region-button data-region-key="taiwan" data-region="Taiwán" data-map-url="https://openinframap.org/#6.5/23.7/121/A,B,L,P" data-bounds="119.2,21.7,122.2,25.5" data-max-zoom="8" aria-pressed="false">Taiwán</button>
          </div>
          <div class="grid-atlas-actions">
            <button class="grid-atlas-scope-button" type="button" data-scope-button aria-controls="grid-atlas-scope" aria-expanded="false">Alcance</button>
            <a data-open-map href="https://openinframap.org/#3.5/51/10/A,B,L,P" target="_blank" rel="noopener noreferrer">Abrir mapa <span aria-hidden="true">↗</span></a>
          </div>
        </div>

        <div class="grid-atlas-stage">
          <div class="grid-atlas-loading" data-map-status role="status">Cargando Europa…</div>
          <div
            class="grid-atlas-map"
            data-grid-map
            role="region"
            tabindex="0"
            aria-label="Infraestructura eléctrica cartografiada en Europa"
          ></div>

          <aside class="grid-atlas-legend" aria-label="Leyenda de tensión">
            <span><i class="grid-atlas-voltage voltage-10"></i>10 kV</span>
            <span><i class="grid-atlas-voltage voltage-25"></i>25 kV</span>
            <span><i class="grid-atlas-voltage voltage-52"></i>52 kV</span>
            <span><i class="grid-atlas-voltage voltage-132"></i>132 kV</span>
            <span><i class="grid-atlas-voltage voltage-220"></i>220 kV</span>
            <span><i class="grid-atlas-voltage voltage-310"></i>310 kV</span>
            <span><i class="grid-atlas-voltage voltage-550"></i>550 kV</span>
            <span><i class="grid-atlas-voltage voltage-hvdc"></i>HVDC</span>
          </aside>

          <aside class="grid-atlas-scope" id="grid-atlas-scope" data-scope-panel hidden>
            <div>
              <strong>Infraestructura cartografiada</strong>
              <span>Líneas, cables, subestaciones y centrales registradas en OpenStreetMap.</span>
            </div>
            <div>
              <strong>Cobertura variable</strong>
              <span>El detalle y la actualización pueden diferir entre países y niveles de tensión.</span>
            </div>
            <div>
              <strong>No es un mapa de operación</strong>
              <span>No muestra flujo en tiempo real, congestión, capacidad térmica ni estado de interruptores.</span>
            </div>
          </aside>
        </div>

        <div class="grid-atlas-credit">
          <span>Datos © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> · ODbL</span>
          <span>Visualización © <a href="https://openinframap.org/copyright" target="_blank" rel="noopener noreferrer">OpenInfraMap</a> · CC BY 4.0</span>
        </div>
      </section>
    `
  }
};
