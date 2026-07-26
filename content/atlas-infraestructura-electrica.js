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
    date: '2026-07-26',
    dateLabel: '26 de julio de 2026',
    bodyHtml: `
      <section class="grid-atlas" data-grid-atlas aria-label="Atlas interactivo de infraestructura eléctrica">
        <div class="grid-atlas-toolbar">
          <div class="grid-atlas-regions" role="group" aria-label="Cambiar región">
            <button type="button" data-region-button data-region-key="europa" data-region="Europa" data-map-url="atlas-infraestructura-electrica.html#europa" data-bounds="-25,34,45,72" data-max-zoom="4.5" aria-pressed="true">Europa</button>
            <button type="button" data-region-button data-region-key="estados-unidos" data-region="Estados Unidos continentales" data-map-url="atlas-infraestructura-electrica.html#estados-unidos" data-bounds="-125,24,-66,50" data-max-zoom="4.5" aria-pressed="false">Estados Unidos cont.</button>
            <button type="button" data-region-button data-region-key="china" data-region="China" data-map-url="atlas-infraestructura-electrica.html#china" data-bounds="73,18,135,54" data-max-zoom="4.5" aria-pressed="false">China</button>
            <button type="button" data-region-button data-region-key="japon" data-region="Japón" data-map-url="atlas-infraestructura-electrica.html#japon" data-bounds="128,30,146,46" data-max-zoom="6" aria-pressed="false">Japón</button>
            <button type="button" data-region-button data-region-key="corea-del-sur" data-region="Corea del Sur" data-map-url="atlas-infraestructura-electrica.html#corea-del-sur" data-bounds="125.5,33,130,39.2" data-max-zoom="7" aria-pressed="false">Corea del Sur</button>
            <button type="button" data-region-button data-region-key="taiwan" data-region="Taiwán" data-map-url="atlas-infraestructura-electrica.html#taiwan" data-bounds="119.2,21.7,122.2,25.5" data-max-zoom="8" aria-pressed="false">Taiwán</button>
          </div>
          <div class="grid-atlas-actions">
            <button type="button" data-layers-button aria-controls="grid-atlas-layers" aria-expanded="false">Capas</button>
            <button type="button" data-scope-button aria-controls="grid-atlas-scope" aria-expanded="false">Fuentes</button>
            <a data-open-map href="atlas-infraestructura-electrica.html#europa" target="_blank" rel="noopener noreferrer">Abrir vista <span aria-hidden="true">↗</span></a>
          </div>
        </div>

        <div class="grid-atlas-drawers">
          <section class="grid-atlas-drawer grid-atlas-layers" id="grid-atlas-layers" data-layers-panel hidden aria-labelledby="grid-atlas-layers-title">
            <div class="grid-atlas-drawer-heading">
              <strong id="grid-atlas-layers-title">Capas de la red integrada</strong>
              <span>La procedencia y el grado de inferencia se conservan por objeto.</span>
            </div>
            <div class="grid-atlas-layers-grid">
              <fieldset class="grid-atlas-layer-options">
                <legend>Infraestructura</legend>
                <label><input type="checkbox" data-layer-toggle="official" checked><span>Red oficial o validada disponible</span></label>
                <label><input type="checkbox" data-layer-toggle="model-corridors"><span>Corredores de capacidad esquemáticos</span></label>
                <label><input type="checkbox" data-layer-toggle="kpg-model"><span>Topología sintética KPG 193 · no es la red real</span></label>
                <label><input type="checkbox" data-layer-toggle="gem-plants" checked><span>Centrales operativas/en obra · GEM 2026</span></label>
                <label><input type="checkbox" data-layer-toggle="gem-planned"><span>Proyectos anunciados · GEM 2026</span></label>
                <label><input type="checkbox" data-layer-toggle="gem-retired"><span>Centrales retiradas/inactivas · GEM 2026</span></label>
                <label><input type="checkbox" data-layer-toggle="overhead" checked><span>Líneas aéreas · OSM</span></label>
                <label><input type="checkbox" data-layer-toggle="underground" checked><span>Cables subterráneos/submarinos · OSM</span></label>
                <label><input type="checkbox" data-layer-toggle="substations" checked><span>Subestaciones y convertidores · OSM</span></label>
                <label><input type="checkbox" data-layer-toggle="plants"><span>Centrales adicionales · OSM</span></label>
                <label><input type="checkbox" data-layer-toggle="generators"><span>Generadores adicionales · OSM</span></label>
                <label><input type="checkbox" data-layer-toggle="equipment"><span>Equipos OSM · parcial · z12+</span></label>
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
                <strong>Procedencia y estado</strong>
                <span><i class="grid-atlas-status-line status-official"></i>Fuente oficial o validada</span>
                <span><i class="grid-atlas-status-line status-modelled"></i>Enlace modelado, no trazado</span>
                <span><i class="grid-atlas-status-line status-active"></i>Geometría OSM</span>
                <span><i class="grid-atlas-status-line status-construction"></i>En construcción</span>
                <span><i class="grid-atlas-status-line status-disused"></i>Fuera de uso</span>
              </div>
            </div>
          </section>

          <section class="grid-atlas-drawer grid-atlas-scope" id="grid-atlas-scope" data-scope-panel hidden aria-labelledby="grid-atlas-scope-title">
            <div class="grid-atlas-scope-callout">
              <strong id="grid-atlas-scope-title">Fusión trazable</strong>
              <span data-source-summary>Geometría OSM, centrales verificadas y fuentes oficiales cuando ofrecen datos reutilizables.</span>
            </div>
            <section class="grid-atlas-evidence" data-region-evidence aria-label="Cobertura y hechos verificados de la región">
              <div class="grid-atlas-evidence-copy">
                <span>Cobertura regional verificada</span>
                <strong data-profile-title>Geometría oficial multifuente sin falsa precisión</strong>
                <p data-profile-summary>Francia incorpora IGN BD TOPO; Gran Bretaña añade OS OpenMap Local; Alemania suma BKG ≥110 kV y proyectos BNetzA, y Noruega conserva NVE. Las rectas de planificación se distinguen del trazado físico.</p>
              </div>
              <dl class="grid-atlas-evidence-metrics" data-profile-metrics>
                <div><dt>14.497</dt><dd>líneas oficiales IGN · Francia</dd></div>
                <div><dt>3.414</dt><dd>líneas OS · Gran Bretaña</dd></div>
                <div><dt>12.986</dt><dd>líneas BKG ≥110 kV · Alemania</dd></div>
                <div><dt>184</dt><dd>objetos de proyecto BNetzA</dd></div>
                <div><dt>390</dt><dd>tramos de transmisión NVE</dd></div>
              </dl>
              <div class="grid-atlas-evidence-links" data-profile-links>
                <a href="https://www.data.gouv.fr/datasets/bd-topo-r" target="_blank" rel="noopener noreferrer">IGN BD TOPO · Licence Ouverte 2.0 ↗</a>
                <a href="https://docs.os.uk/os-downloads/products/maps-and-imagery-portfolio/os-openmap-local/os-openmap-local-technical-specification/feature-types/electricitytransmissionline" target="_blank" rel="noopener noreferrer">OS OpenMap Local · OGL 3.0 ↗</a>
                <a href="https://gdz.bkg.bund.de/index.php/default/digitales-landschaftsmodell-1-250-000-kompakt-dlm250-kompakt.html" target="_blank" rel="noopener noreferrer">BKG DLM250 · dl-de/by-2-0 ↗</a>
                <a href="https://odre.opendatasoft.com/explore/dataset/lignes-aeriennes-rte-nv/" target="_blank" rel="noopener noreferrer">RTE ODRÉ · Licence Ouverte 2.0 ↗</a>
                <a href="https://www.nve.no/energi/energisystem/nett/kraftsystemdata/nettkart/" target="_blank" rel="noopener noreferrer">NVE Nettanlegg · NLOD ↗</a>
              </div>
            </section>
            <section class="grid-atlas-inventory" data-official-inventory hidden aria-labelledby="grid-atlas-inventory-title">
              <div class="grid-atlas-inventory-head">
                <div>
                  <span>Inventario oficial sin geometría inventada</span>
                  <h3 id="grid-atlas-inventory-title" data-inventory-title></h3>
                  <p data-inventory-summary></p>
                </div>
                <label>
                  <span>Buscar registros</span>
                  <input type="search" data-inventory-search autocomplete="off" placeholder="Nombre, tensión, etapa…" />
                </label>
              </div>
              <div class="grid-atlas-inventory-body">
                <div class="grid-atlas-inventory-list" data-inventory-list role="list"></div>
                <article class="grid-atlas-inventory-detail" data-inventory-detail></article>
              </div>
              <div class="grid-atlas-inventory-foot">
                <p class="grid-atlas-inventory-note" data-inventory-note></p>
                <nav class="grid-atlas-inventory-pagination" aria-label="Páginas del inventario">
                  <button type="button" data-inventory-previous>Página anterior</button>
                  <span data-inventory-page-status aria-live="polite"></span>
                  <button type="button" data-inventory-next>Página siguiente</button>
                </nav>
              </div>
            </section>
            <div class="grid-atlas-scope-grid">
              <div>
                <strong>Base geográfica mundial</strong>
                <span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors · ODbL ↗</a>: el proyecto extrae, normaliza y sirve sus propios mosaicos PMTiles de trazados, cables, subestaciones y equipos. Cada objeto conserva su enlace OSM.</span>
              </div>
              <div>
                <strong>Centrales · seis regiones</strong>
                <span><a href="https://globalenergymonitor.org/projects/global-integrated-power-tracker/" target="_blank" rel="noopener noreferrer">Global Energy Monitor, marzo de 2026 ↗</a>: capacidad, tecnología, combustible, estado, propiedad y fechas por unidad o fase.</span>
              </div>
              <div>
                <strong>Estados Unidos · integrado</strong>
                <span><a href="https://catalog.data.gov/dataset/electric-power-transmission-lines" target="_blank" rel="noopener noreferrer">HIFLD / U.S. Government ↗</a> aporta la red nacional archivada; <a href="https://catalog.data.gov/dataset/california-electric-transmission-lines" target="_blank" rel="noopener noreferrer">CEC ↗</a> actualiza California, <a href="https://services3.arcgis.com/Iz3chmSt4P7oOoZy/arcgis/rest/services/BPA_TransmissionLines_View/FeatureServer/0" target="_blank" rel="noopener noreferrer">BPA ↗</a> añade 705 líneas del noroeste y <a href="https://www.eia.gov/electricity/data/eia860m/" target="_blank" rel="noopener noreferrer">EIA-860M junio de 2026 ↗</a> añade 15.764 centrales continentales.</span>
              </div>
              <div>
                <strong>Europa · geometría e inventario oficial</strong>
                <span><a href="https://www.data.gouv.fr/datasets/bd-topo-r" target="_blank" rel="noopener noreferrer">IGN BD TOPO ↗</a> aporta Francia; <a href="https://docs.os.uk/os-downloads/products/maps-and-imagery-portfolio/os-openmap-local/os-openmap-local-technical-specification/feature-types/electricitytransmissionline" target="_blank" rel="noopener noreferrer">OS OpenMap Local ↗</a> añade 3.414 líneas cartográficas de transmisión de Gran Bretaña y <a href="https://www.pdok.nl/introductie/-/article/basisregistratie-topografie-brt-topnl" target="_blank" rel="noopener noreferrer">Kadaster BRT TOP10NL ↗</a> 496 líneas de alta tensión de Países Bajos; ambas capas conservan la geometría 1:10.000 sin simplificar ni inventar tensión. <a href="https://gdz.bkg.bund.de/index.php/default/digitales-landschaftsmodell-1-250-000-kompakt-dlm250-kompakt.html" target="_blank" rel="noopener noreferrer">BKG DLM250 ↗</a> y <a href="https://www.netzausbau.de/" target="_blank" rel="noopener noreferrer">BNetzA ↗</a> cubren Alemania, marcando «Luftlinie» como esquema. <a href="https://www.nve.no/energi/energisystem/nett/kraftsystemdata/nettkart/" target="_blank" rel="noopener noreferrer">NVE ↗</a> cubre Noruega y <a href="https://opendata.swiss/en/dataset/elektrische-anlagen-mit-einer-nennspannung-von-uber-36-kv" target="_blank" rel="noopener noreferrer">SFOE ↗</a> Suiza >36 kV; RTE conserva inventario sin coordenadas propias.</span>
              </div>
              <div>
                <strong>Corea del Sur · inventario oficial y contraste</strong>
                <span><a href="https://www.kepco.co.kr/home/business/transbus.do" target="_blank" rel="noopener noreferrer">KEPCO 2024 ↗</a> verifica 35.856 c-km de transmisión, 925 subestaciones y 14,9 % de red subterránea. La <a href="https://www.kepco.co.kr/home/disclosure/transdisclosure/transstatus/transinfo.do" target="_blank" rel="noopener noreferrer">plataforma de obras ↗</a> declara 849 proyectos, pero sus listas exponen 848: todos se pueden buscar y el atlas no inventa el faltante ni una ruta. <a href="https://github.com/agm-center/kpg-testgrid/tree/5c9580b9effdd388bcc2433c8b66dea85c159617/kpg193_v2_0" target="_blank" rel="noopener noreferrer">KPG 193 v2.0 · ODbL ↗</a> y <a href="https://arxiv.org/abs/2606.12791" target="_blank" rel="noopener noreferrer">GIST 2.217 barras ↗</a> quedan separados como modelos sintéticos.</span>
              </div>
              <div>
                <strong>Japón · geometría y capacidad oficiales</strong>
                <span><a href="https://maps.gsi.go.jp/development/vt.html" target="_blank" rel="noopener noreferrer">GSI ↗</a> aporta líneas de transmisión oficiales a z14–16 y centrales a z13–16. <a href="https://www.occto.or.jp/assets/renkeisenriyou/oshirase/2025/files/oshirase_20260311_1_2026-2035_unyouyouryou.pdf" target="_blank" rel="noopener noreferrer">OCCTO 2026-2035 ↗</a> añade siete enlaces con capacidad direccional; sus rectas siguen marcadas como esquema.</span>
              </div>
              <div>
                <strong>Taiwán · activos oficiales</strong>
                <span><a href="https://data.gov.tw/dataset/161874" target="_blank" rel="noopener noreferrer">Taipower / data.gov.tw ↗</a>: las 505.791 coordenadas válidas de feeder o transformador se transforman de TWD67 a WGS84 y se muestran completas en 5.570 celdas de 0,02°, sin muestreo ni suma engañosa de capacidad.</span>
              </div>
              <div>
                <strong>China · inventario oficial verificable</strong>
                <span><a href="https://prpq.nea.gov.cn/zxdt/12012.html" target="_blank" rel="noopener noreferrer">NEA 2024 ↗</a> verifica 51 sistemas HVDC, 233.574 MW y 52.949 km; los 51 se pueden buscar por atributos y terminales publicados. El informe no ofrece coordenadas reutilizables, y el proyecto Tíbet-Gran Bahía se muestra sólo como corredor esquemático oficializado.</span>
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
            <span data-source-label>OSM + GEM</span>
            <span data-visible-label>Líneas visibles · &gt;199 kV + HVDC etiquetado</span>
            <span data-data-status>Fuentes fechadas</span>
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
          <span>Teselas y estilo propios · instantánea OSM 25-07-2026</span>
          <span>Centrales © <a href="https://globalenergymonitor.org/" target="_blank" rel="noopener noreferrer">Global Energy Monitor</a> · CC BY 4.0</span>
          <span data-official-credit hidden>Capas oficiales regionales · consulte Fuentes</span>
        </div>
      </section>
    `
  }
};
