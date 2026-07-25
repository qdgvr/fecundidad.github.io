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
    description: 'Europa, Estados Unidos, China, Japón, Corea del Sur y Taiwán en un mismo atlas interactivo.',
    author: 'Kitak Kang',
    date: '2026-07-25',
    dateLabel: '25 de julio de 2026',
    bodyHtml: `
      <section class="grid-atlas" data-grid-atlas aria-label="Atlas interactivo de infraestructura eléctrica">
        <div class="grid-atlas-toolbar">
          <div class="grid-atlas-regions" role="group" aria-label="Cambiar región">
            <button type="button" data-region-button data-region-key="europa" data-region="Europa" data-map-url="https://openinframap.org/#3.5/51/10/A,B,L,P" data-bounds="-25,34,45,72" data-max-zoom="4.5" aria-pressed="true">Europa</button>
            <button type="button" data-region-button data-region-key="estados-unidos" data-region="Estados Unidos continentales" data-map-url="https://openinframap.org/#3.4/39/-98/A,B,L,P" data-bounds="-125,24,-66,50" data-max-zoom="4.5" aria-pressed="false">Estados Unidos cont.</button>
            <button type="button" data-region-button data-region-key="china" data-region="China" data-map-url="https://openinframap.org/#3.5/35/104/A,B,L,P" data-bounds="73,18,135,54" data-max-zoom="4.5" aria-pressed="false">China</button>
            <button type="button" data-region-button data-region-key="japon" data-region="Japón" data-map-url="https://openinframap.org/#5/36.5/138/A,B,L,P" data-bounds="128,30,146,46" data-max-zoom="6" aria-pressed="false">Japón</button>
            <button type="button" data-region-button data-region-key="corea-del-sur" data-region="Corea del Sur" data-map-url="https://openinframap.org/#6/36/128/A,B,L,P" data-bounds="125.5,33,130,39.2" data-max-zoom="7" aria-pressed="false">Corea del Sur</button>
            <button type="button" data-region-button data-region-key="taiwan" data-region="Taiwán" data-map-url="https://openinframap.org/#6.5/23.7/121/A,B,L,P" data-bounds="119.2,21.7,122.2,25.5" data-max-zoom="8" aria-pressed="false">Taiwán</button>
          </div>
          <div class="grid-atlas-actions">
            <button type="button" data-layers-button aria-controls="grid-atlas-layers" aria-expanded="false">Capas</button>
            <button type="button" data-scope-button aria-controls="grid-atlas-scope" aria-expanded="false">Límites</button>
            <a data-open-map href="https://openinframap.org/#3.5/51/10/A,B,L,P" target="_blank" rel="noopener noreferrer">Abrir mapa <span aria-hidden="true">↗</span></a>
          </div>
        </div>

        <div class="grid-atlas-drawers">
          <section class="grid-atlas-drawer grid-atlas-layers" id="grid-atlas-layers" data-layers-panel hidden aria-labelledby="grid-atlas-layers-title">
            <div class="grid-atlas-drawer-heading">
              <strong id="grid-atlas-layers-title">Capas cartografiadas</strong>
              <span>Los filtros cambian lo visible; no corrigen omisiones.</span>
            </div>
            <div class="grid-atlas-layers-grid">
              <fieldset class="grid-atlas-layer-options">
                <legend>Infraestructura</legend>
                <label><input type="checkbox" data-layer-toggle="overhead" checked><span>Líneas aéreas</span></label>
                <label><input type="checkbox" data-layer-toggle="underground" checked><span>Cables y tramos subterráneos/submarinos</span></label>
                <label><input type="checkbox" data-layer-toggle="substations" checked><span>Subestaciones y convertidores</span></label>
                <label><input type="checkbox" data-layer-toggle="plants" checked><span>Centrales mapeadas · parcial</span></label>
                <label><input type="checkbox" data-layer-toggle="generators" checked><span>Generadores mapeados · parcial</span></label>
                <label><input type="checkbox" data-layer-toggle="equipment"><span>Equipos OSM · parcial · z14+</span></label>
                <label><input type="checkbox" data-layer-toggle="construction" checked><span>Líneas en construcción</span></label>
                <label><input type="checkbox" data-layer-toggle="disused" checked><span>Líneas fuera de uso</span></label>
              </fieldset>

              <label class="grid-atlas-voltage-filter">
                <span>Tensión mínima de líneas y subestaciones</span>
                <select data-voltage-filter>
                  <option value="220">≥ 220 kV</option>
                  <option value="100" selected>≥ 100 kV</option>
                  <option value="25">≥ 25 kV</option>
                  <option value="0">Todo lo cartografiado</option>
                </select>
                <small>La fuente limita subestaciones por zoom: &gt;200 kV en z5–8, &gt;50 kV en z9 y todas las etiquetadas desde z10.</small>
              </label>

              <div class="grid-atlas-status-key" aria-label="Simbología de estado de las líneas">
                <strong>Estado de líneas en OpenStreetMap</strong>
                <span><i class="grid-atlas-status-line status-active"></i>Sin etiqueta de ciclo de vida</span>
                <span><i class="grid-atlas-status-line status-construction"></i>En construcción</span>
                <span><i class="grid-atlas-status-line status-disused"></i>Fuera de uso</span>
              </div>
            </div>
          </section>

          <section class="grid-atlas-drawer grid-atlas-scope" id="grid-atlas-scope" data-scope-panel hidden aria-labelledby="grid-atlas-scope-title">
            <div class="grid-atlas-scope-callout">
              <strong id="grid-atlas-scope-title">Uso correcto</strong>
              <span>Distribución geográfica de infraestructura eléctrica publicada en OpenStreetMap.</span>
            </div>
            <div class="grid-atlas-scope-grid">
              <div>
                <strong>Origen y cobertura</strong>
                <span>Inventario voluntario, no oficial. El detalle y la actualización varían; no existe una capa oficial homogénea y comparable para las seis regiones.</span>
              </div>
              <div>
                <strong>Evidencia de Corea del Sur</strong>
                <span><a href="https://arxiv.org/abs/2606.12791" target="_blank" rel="noopener noreferrer">Preprint GIST, junio de 2026 ↗</a>: cobertura de trazados 765/345/154 kV ≈100/96/79%; 19 subestaciones de 345 kV y 130 de 154 kV necesitaron enlaces estimados.</span>
              </div>
              <div>
                <strong>Tramos difíciles de observar</strong>
                <span>En Corea, el 14,9% de la longitud de transmisión era subterránea en 2024. Cables urbanos, enlaces submarinos, HVDC de Jeju y generación distribuida pueden faltar.</span>
              </div>
              <div>
                <strong>Trazado no es circuit-km</strong>
                <span>Corea: ≈15.175 km cartografiados frente a 35.856 circuit-km oficiales. Un cruce no prueba conexión; al ajustar circuitos, el preprint obtuvo 108/107/97% para 765/345/154 kV.</span>
              </div>
              <div>
                <strong>Modelo eléctrico incompleto</strong>
                <span>El detalle z14+ muestra equipos etiquetados, no las 925 subestaciones oficiales de Corea como una taxonomía equivalente ni barras, bancos, circuitos, impedancias, taps o compensación completos.</span>
              </div>
              <div>
                <strong>Sin operación en tiempo real</strong>
                <span>No incluye flujo, congestión, límites térmicos, N-1, estabilidad de tensión, estado de interruptores, averías, mantenimiento ni capacidad de conexión.</span>
              </div>
              <div>
                <strong>Generación y distribución</strong>
                <span>Corea: 121,4 GW etiquetados frente a 157,1 GW oficiales; solar OSM 406 MW frente a 27.096 MW oficiales y eólica oficial 2.248 MW. La red de 22,9 kV, los cierres, cambios de combustible, obras y múltiples unidades no quedan representados de forma completa.</span>
              </div>
              <div>
                <strong>Complemento necesario</strong>
                <span>No agregue longitudes, potencia ni rankings regionales sin validar. Un modelo de flujo exige estadísticas oficiales, datos de carga, parámetros eléctricos, circuitos, transformadores y estados separados.</span>
              </div>
            </div>
          </section>
        </div>

        <div class="grid-atlas-stage">
          <div class="grid-atlas-loading" data-map-status role="status">Cargando Europa…</div>
          <div
            class="grid-atlas-map"
            data-grid-map
            role="region"
            aria-label="Infraestructura eléctrica cartografiada en Europa"
            aria-describedby="grid-atlas-map-help"
          ></div>

          <p class="grid-atlas-visually-hidden" id="grid-atlas-map-help">Use las flechas para mover el mapa y las teclas más y menos para cambiar el zoom. Pulse Intro para inspeccionar la infraestructura situada en el centro.</p>
          <div class="grid-atlas-visually-hidden" data-filter-status aria-live="polite"></div>
          <div class="grid-atlas-visually-hidden" data-feature-status aria-live="polite"></div>
          <div class="grid-atlas-warning" data-map-warning role="status" hidden></div>

          <div class="grid-atlas-truth" aria-label="Contexto del mapa">
            <strong data-region-label>Europa</strong>
            <span>OSM · geográfico</span>
            <span data-visible-label>Líneas visibles · &gt;199 kV + HVDC etiquetado</span>
            <span>No tiempo real</span>
          </div>

          <aside class="grid-atlas-legend" aria-label="Leyenda de tensión">
            <div class="grid-atlas-voltage-scale">
              <span data-voltage-value="0"><i class="grid-atlas-voltage voltage-unknown"></i>Sin dato</span>
              <span data-voltage-value="10"><i class="grid-atlas-voltage voltage-10"></i>10–24 kV</span>
              <span data-voltage-value="25"><i class="grid-atlas-voltage voltage-25"></i>25–51 kV</span>
              <span data-voltage-value="52"><i class="grid-atlas-voltage voltage-52"></i>52–131 kV</span>
              <span data-voltage-value="132"><i class="grid-atlas-voltage voltage-132"></i>132–219 kV</span>
              <span data-voltage-value="220"><i class="grid-atlas-voltage voltage-220"></i>220–309 kV</span>
              <span data-voltage-value="310"><i class="grid-atlas-voltage voltage-310"></i>310–549 kV</span>
              <span data-voltage-value="550"><i class="grid-atlas-voltage voltage-550"></i>≥550 kV</span>
              <span data-voltage-hvdc><i class="grid-atlas-voltage voltage-hvdc"></i>HVDC etiquetado</span>
            </div>
            <div class="grid-atlas-line-scale">
              <span><i class="grid-atlas-line-key line-overhead"></i>Aérea</span>
              <span><i class="grid-atlas-line-key line-underground"></i>Cable / subterránea / submarina</span>
              <span><i class="grid-atlas-line-key line-construction"></i>Construcción</span>
              <span><i class="grid-atlas-line-key line-disused"></i>Fuera de uso</span>
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
