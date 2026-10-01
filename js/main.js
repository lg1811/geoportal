document.addEventListener("DOMContentLoaded", function () {
  const mapElement = document.getElementById("map");

  if (mapElement) {
    // -------------------------------------------------------------
    // FICHA TÉCNICA LATERAL (Offcanvas) + DESTAQUE DA FEIÇÃO
    // -------------------------------------------------------------
    const PANEL_WIDTH = 380;
    let highlightLayer = null;
    let skipAutoPan = false;

    const TIPOS = {
      municipios: { label: 'Município',          icon: 'ph-map-pin', color: '#475569', bg: '#e2e8f0' },
      acudes:     { label: 'Açude',              icon: 'ph-drop',    color: '#0284c7', bg: '#e0f2fe' },
      bacias:     { label: 'Bacia hidrográfica', icon: 'ph-polygon', color: '#16a34a', bg: '#dcfce7' },
      rios:       { label: 'Rio',                icon: 'ph-waves',   color: '#0891b2', bg: '#cffafe' }
    };

    const offcanvasEl = document.getElementById('attributeOffcanvas');
    let bsOffcanvas = null;
    if (offcanvasEl && typeof bootstrap !== "undefined") {
      // sem backdrop e com rolagem: o mapa continua visível e clicável com a ficha aberta
      bsOffcanvas = new bootstrap.Offcanvas(offcanvasEl, { backdrop: false, scroll: true });
      offcanvasEl.addEventListener('hidden.bs.offcanvas', function () { clearHighlight(); });
    }
    const offcanvasContent = document.getElementById('offcanvasContent');

    // ---- utilitários ----
    function escapeHtml(v) {
      return String(v).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function fmtNum(v, dec) {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (isNaN(n)) return String(v);
      const d = (dec === undefined) ? 2 : dec;
      return n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    function pick(props, keys) {
      for (let i = 0; i < keys.length; i++) {
        const v = props[keys[i]];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return null;
    }

    function featureCenter(layer) {
      if (layer.getLatLng) return layer.getLatLng();
      if (layer.getBounds) return layer.getBounds().getCenter();
      return null;
    }

    function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
      return new Promise(function (resolve) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* ignora */ }
        document.body.removeChild(ta);
        resolve();
      });
    }

    // ---- ponto dentro de polígono (sem dependências) ----
    function pointInRing(x, y, ring) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    }

    function pointInPolygon(x, y, poly) {
      if (!poly || !poly.length || !pointInRing(x, y, poly[0])) return false;
      for (let k = 1; k < poly.length; k++) {
        if (pointInRing(x, y, poly[k])) return false;
      }
      return true;
    }

    function pointInGeometry(x, y, geom) {
      if (!geom) return false;
      if (geom.type === 'Polygon') return pointInPolygon(x, y, geom.coordinates);
      if (geom.type === 'MultiPolygon') return geom.coordinates.some(function (p) { return pointInPolygon(x, y, p); });
      return false;
    }

    // açudes cujo centro está dentro de um município/bacia
    function acudesDentro(areaLayer) {
      if (!geojsonAcudes || !areaLayer.getBounds || !areaLayer.feature) return [];
      const bounds = areaLayer.getBounds();
      const geom = areaLayer.feature.geometry;
      return geojsonAcudes.getLayers().filter(function (l) {
        const c = featureCenter(l);
        return c && bounds.contains(c) && pointInGeometry(c.lng, c.lat, geom);
      });
    }

    // município onde está o centro do açude
    function municipioDoAcude(acudeLayer) {
      const c = featureCenter(acudeLayer);
      if (!c || !geojsonMunicipios) return null;
      return geojsonMunicipios.getLayers().find(function (l) {
        return l.getBounds && l.feature && l.getBounds().contains(c) && pointInGeometry(c.lng, c.lat, l.feature.geometry);
      }) || null;
    }

    // ---- destaque no mapa ----
    function clearHighlight() {
      if (highlightLayer && typeof map !== 'undefined') map.removeLayer(highlightLayer);
      highlightLayer = null;
    }

    function setHighlight(layer) {
      clearHighlight();
      if (!layer || !layer.feature) return;
      const ponto = function (f, ll, cor, w) {
        return L.circleMarker(ll, { pane: 'highlightPane', radius: 10, color: cor, weight: w, fill: false, interactive: false });
      };
      const casing = L.geoJSON(layer.feature, {
        pane: 'highlightPane', interactive: false,
        style: { color: '#0f172a', weight: 7, opacity: 0.55, fill: false },
        pointToLayer: function (f, ll) { return ponto(f, ll, '#0f172a', 6); }
      });
      const topo = L.geoJSON(layer.feature, {
        pane: 'highlightPane', interactive: false,
        style: { color: '#facc15', weight: 3, opacity: 1, fill: false },
        pointToLayer: function (f, ll) { return ponto(f, ll, '#facc15', 3); }
      });
      highlightLayer = L.layerGroup([casing, topo]).addTo(map);
    }

    // ---- navegação ----
    function focusOnFeature(layer) {
      const opts = { paddingTopLeft: [40, 40], paddingBottomRight: [PANEL_WIDTH + 40, 40], maxZoom: 14 };
      if (layer.getBounds && layer.getBounds().isValid()) map.fitBounds(layer.getBounds(), opts);
      else if (layer.getLatLng) map.setView(layer.getLatLng(), 14);
    }

    // se a feição clicada ficou sob a ficha, desloca o mapa para a área livre
    function ensureVisible(layer) {
      const c = featureCenter(layer);
      if (!c) return;
      const size = map.getSize();
      const limit = size.x - PANEL_WIDTH - 30;
      const pt = map.latLngToContainerPoint(c);
      if (limit > 100 && pt.x > limit) map.panBy([pt.x - limit / 2, 0]);
    }

    function selectLayer(layer, zoom) {
      if (zoom) focusOnFeature(layer);
      skipAutoPan = !!zoom;
      layer.fire('click');
      skipAutoPan = false;
    }

    function showFeatureDetails(title, tipo, properties, ctx) {
      if (!offcanvasContent) return;

      const t = TIPOS[tipo] || TIPOS.municipios;
      const layer = ctx && ctx.layer;

      // ---- informação relacionada (calculada pela geometria) ----
      let relatedHtml = '';
      const relatedLayers = [];
      const itemHtml = function (l, icon, nome, detalhe) {
        relatedLayers.push(l);
        return '<button type="button" class="related-item" data-related="' + (relatedLayers.length - 1) + '">' +
          '<i class="ph ' + icon + '"></i><span class="related-name">' + escapeHtml(nome) + '</span>' +
          (detalhe ? '<span class="related-detail">' + escapeHtml(detalhe) + '</span>' : '') +
          '<i class="ph ph-caret-right related-caret"></i></button>';
      };

      if (layer && (tipo === 'municipios' || tipo === 'bacias')) {
        const lista = acudesDentro(layer).sort(function (a, b) {
          return (Number(b.feature.properties.Capacidade) || 0) - (Number(a.feature.properties.Capacidade) || 0);
        });
        const titulo = tipo === 'municipios' ? 'Açudes neste município' : 'Açudes nesta bacia';
        relatedHtml += '<div class="related-title">' + titulo + ' <span class="related-count">' + lista.length + '</span></div>';
        if (lista.length) {
          lista.slice(0, 10).forEach(function (l) {
            const p = l.feature.properties || {};
            const cap = fmtNum(p.Capacidade, 0);
            relatedHtml += itemHtml(l, 'ph-drop', p.Nome || p.NOME || 'Açude sem nome', cap ? cap + ' m³' : '');
          });
          if (lista.length > 10) {
            relatedHtml += '<div class="small text-muted px-1 pt-2">e mais ' + (lista.length - 10) + ' — veja a lista completa na tabela de atributos.</div>';
          }
        } else {
          relatedHtml += '<div class="small text-muted px-1">Nenhum açude mapeado.</div>';
        }
      }

      let mun = null;
      if (layer && tipo === 'acudes') {
        mun = municipioDoAcude(layer);
        if (mun) {
          const mp = mun.feature.properties || {};
          relatedHtml += '<div class="related-title">Localização</div>' +
            itemHtml(mun, 'ph-map-pin', mp.NM_MUN || mp.Nome || 'Município', 'Município');
          delete properties['Município']; // evita repetir: a localização vem da geometria
        }
      }

      // ---- atributos (sem valores vazios / N/A) ----
      let rowsHtml = '';
      Object.keys(properties).forEach(function (key) {
        const value = properties[key];
        if (value === null || value === undefined || value === '' || value === 'N/A') return;
        rowsHtml += '<tr><td class="text-muted fw-semibold small text-nowrap">' + escapeHtml(key) + '</td>' +
          '<td class="text-dark small text-end">' + escapeHtml(value) + '</td></tr>';
      });

      const botao = function (acao, icone, rotulo, dica) {
        return '<button type="button" class="feature-action" data-action="' + acao + '" title="' + dica + '">' +
          '<i class="ph ' + icone + '"></i><span>' + rotulo + '</span></button>';
      };

      offcanvasContent.innerHTML =
        '<div class="card border-0 bg-light mb-3"><div class="card-body p-3 d-flex align-items-center gap-3">' +
          '<span class="feature-icon" style="background:' + t.bg + ';color:' + t.color + ';"><i class="ph ' + t.icon + '"></i></span>' +
          '<div class="feature-heading"><div class="small fw-semibold" style="color:' + t.color + ';">' + t.label + '</div>' +
          '<h4 class="h5 fw-bold text-dark mb-0">' + escapeHtml(title) + '</h4></div>' +
        '</div></div>' +
        (layer ? '<div class="d-flex gap-2 mb-3">' +
          botao('zoom', 'ph-magnifying-glass-plus', 'Aproximar', 'Aproximar da feição') +
          botao('table', 'ph-table', 'Na tabela', 'Ver na tabela de atributos') +
          botao('copy', 'ph-copy', 'Coordenadas', 'Copiar coordenadas do centro') +
        '</div>' : '') +
        '<div class="card border-0 shadow-sm bg-white mb-3"><div class="card-body p-0"><div class="table-responsive">' +
          '<table class="table table-sm table-hover align-middle mb-0"><tbody>' + rowsHtml + '</tbody></table>' +
        '</div></div></div>' +
        (relatedHtml ? '<div class="related-block">' + relatedHtml + '</div>' : '');

      // ---- ações ----
      const bind = function (acao, fn) {
        const el = offcanvasContent.querySelector('[data-action="' + acao + '"]');
        if (el) el.addEventListener('click', function () { fn(el); });
      };
      if (layer) {
        bind('zoom', function () { focusOnFeature(layer); });
        bind('table', function () { abrirTabelaNaFeicao(tipo, layer); });
        bind('copy', function (el) {
          const c = featureCenter(layer);
          if (!c) return;
          const span = el.querySelector('span');
          copyText(c.lat.toFixed(6) + ', ' + c.lng.toFixed(6)).then(function () {
            span.textContent = 'Copiado!';
            setTimeout(function () { span.textContent = 'Coordenadas'; }, 1500);
          });
        });
      }
      offcanvasContent.querySelectorAll('[data-related]').forEach(function (el) {
        el.addEventListener('click', function () { selectLayer(relatedLayers[Number(el.dataset.related)], true); });
      });

      // ---- mapa ----
      setHighlight(layer);
      const sidebar = document.getElementById('layerSidebar');
      if (sidebar) sidebar.classList.add('collapsed');
      if (layer && !skipAutoPan) ensureVisible(layer);

      if (bsOffcanvas) bsOffcanvas.show();
    }

    // -------------------------------------------------------------
    // 1. BASEMAPS
    // -------------------------------------------------------------
    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    });

    const googleSat = L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      attribution: '&copy; Google Maps'
    });

    const cartoDark = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      maxZoom: 16
    });

    const map = L.map("map", {
      center: [-7.12, -36.72],
      zoom: 8,
      layers: [googleSat]
    });

    // -------------------------------------------------------------
    // WIDGET DE COORDENADAS E ESCALA (Bottom-Left)
    // -------------------------------------------------------------
    const statusBar = L.control({ position: 'bottomleft' });
    statusBar.onAdd = function () {
      const container = L.DomUtil.create('div', 'map-status-bar');
      const scale = L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
      container.appendChild(scale.getContainer());
      const coords = L.DomUtil.create('span', 'leaflet-control-coordinates', container);
      coords.id = 'mouseCoordinates';
      coords.textContent = 'Lat: 0.0000, Lng: 0.0000';
      L.DomEvent.disableClickPropagation(container);
      return container;
    };
    statusBar.addTo(map);

    map.on('mousemove', function (e) {
      const coordsDiv = document.getElementById('mouseCoordinates');
      if (coordsDiv) {
        const lat = e.latlng.lat.toFixed(4);
        const lng = e.latlng.lng.toFixed(4);
        coordsDiv.innerHTML = `Lat: ${lat}, Lng: ${lng}`;
      }
    });

    // -------------------------------------------------------------
    // PAINEL LATERAL FLUTUANTE DE CAMADAS (SIDEBAR)
    // -------------------------------------------------------------
    const toggleSidebarBtn = L.control({ position: 'topright' });
    toggleSidebarBtn.onAdd = function () {
      const btn = L.DomUtil.create('button', 'map-tool-btn');
      btn.title = "Gestão de Camadas";
      btn.innerHTML = '<i class="ph ph-stack fs-5 text-dark"></i>';

      btn.onclick = function (e) {
        e.preventDefault();
        const sidebar = document.getElementById('layerSidebar');
        if (sidebar) sidebar.classList.toggle('collapsed');
      };
      return btn;
    };
    toggleSidebarBtn.addTo(map);

    const toggleTableBtn = L.control({ position: 'topright' });
    toggleTableBtn.onAdd = function () {
      const btn = L.DomUtil.create('button', 'map-tool-btn');
      btn.title = "Abrir Tabela de Atributos";
      btn.innerHTML = '<i class="ph ph-table fs-5 text-dark"></i>';

      btn.onclick = function (e) {
        e.preventDefault();
        const panel = document.getElementById('attributeTablePanel');
        if (panel) {
          panel.classList.toggle('closed');
          if (!panel.classList.contains('closed')) {
            const select = document.getElementById('layerTableSelect');
            const layerName = select ? select.value : 'municipios';
            carregarDadosTabela(getLayerByName(layerName));
          }
        }
      };
      return btn;
    };
    toggleTableBtn.addTo(map);

    const closeBtn = document.getElementById('closeSidebarBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        const sidebar = document.getElementById('layerSidebar');
        if (sidebar) sidebar.classList.add('collapsed');
      });
    }

    const basemaps = { osm: osm, sat: googleSat, dark: cartoDark };

    function setBasemap(name) {
      Object.values(basemaps).forEach(l => map.removeLayer(l));
      basemaps[name].addTo(map);
      currentBasemap = name;
      applyOverlayTheme();
    }

    [['radioOsm', 'osm'], ['radioSat', 'sat'], ['radioDark', 'dark']].forEach(function (pair) {
      const el = document.getElementById(pair[0]);
      if (el) el.addEventListener('change', function () { if (this.checked) setBasemap(pair[1]); });
    });

    // -------------------------------------------------------------
    // FERRAMENTA DE MEDIÇÃO DE DISTÂNCIA
    // -------------------------------------------------------------
    if (map.pm) {
      map.pm.addControls({
        position: 'topright',
        drawMarker: false,
        drawPolyline: true,
        drawRectangle: false,
        drawPolygon: false,
        drawCircleMarker: false,
        drawCircle: false,
        drawText: false,
        editMode: false,
        dragMode: false,
        cutPolygon: false,
        removalMode: false,
        rotateMode: false
      });

      map.pm.setLang('pt');
      map.pm.setPathOptions({ color: '#0284c7', weight: 3, dashArray: '5, 5' });

      map.on('pm:create', function (e) {
        const layer = e.layer;
        const shape = e.shape;

        if (shape === 'Line') {
          const latlngs = layer.getLatLngs();
          let totalDistance = 0;

          for (let i = 0; i < latlngs.length - 1; i++) {
            totalDistance += latlngs[i].distanceTo(latlngs[i + 1]);
          }

          const distKm = (totalDistance / 1000).toFixed(2);
          
          const tooltipContent = `
            <div class="d-flex align-items-center gap-2">
              <span><b>Distância:</b> ${distKm} km</span>
              <button type="button" class="btn-close btn-close-white ms-1 delete-measure-btn" style="font-size: 8px; cursor: pointer;" title="Apagar medição"></button>
            </div>
          `;

          layer.bindTooltip(tooltipContent, {
            permanent: true,
            direction: 'center',
            interactive: true,
            className: 'measure-tooltip bg-dark text-white p-2 rounded shadow-sm'
          }).openTooltip();

          setTimeout(() => {
            const tooltipNode = layer.getTooltip() ? layer.getTooltip().getElement() : null;
            if (tooltipNode) {
              const closeBtn = tooltipNode.querySelector('.delete-measure-btn');
              if (closeBtn) {
                closeBtn.addEventListener('click', function (evt) {
                  evt.stopPropagation();
                  map.removeLayer(layer);
                });
              }
            }
          }, 100);
        }
      });
    }

    // -------------------------------------------------------------
    // 2. CRIAÇÃO DOS PANES (Hierarquia)
    // -------------------------------------------------------------
    map.createPane("municipiosPane").style.zIndex = 400;
    map.createPane("baciasPane").style.zIndex = 450;
    map.createPane("riosPane").style.zIndex = 500;
    map.createPane("acudesPane").style.zIndex = 550;
    const highlightPane = map.createPane("highlightPane");
    highlightPane.style.zIndex = 650;
    highlightPane.style.pointerEvents = "none";

    const layerMunicipios = L.layerGroup();
    const layerAcudes = L.layerGroup();
    const layerBacias = L.layerGroup();
    const layerRios = L.layerGroup();

    let geojsonMunicipios = null;
    let geojsonBacias = null;
    let geojsonRios = null;
    let geojsonAcudes = null;

    let currentMunicipiosOpacity = 0.15;

    // Cores das camadas conforme o mapa de fundo (contraste)
    let currentBasemap = 'sat';
    let munStroke = '#475569', munFill = '#64748b', munHover = '#0f172a', riosColor = '#0284c7';

    function getMunStyle() {
      return { color: munStroke, weight: 1, opacity: 0.7, fillColor: munFill, fillOpacity: currentMunicipiosOpacity };
    }

    // -------------------------------------------------------------
    // TABELA DE ATRIBUTOS INTERATIVA MULTICAMADAS
    // -------------------------------------------------------------
    const attributeTablePanel = document.getElementById('attributeTablePanel');
    const closeTableBtn = document.getElementById('closeTableBtn');
    const layerTableSelect = document.getElementById('layerTableSelect');
    const gisTableHead = document.getElementById('gisTableHead');
    const gisTableBody = document.getElementById('gisTableBody');

    let selectedRowElement = null;

    if (closeTableBtn && attributeTablePanel) {
      closeTableBtn.addEventListener('click', () => {
        attributeTablePanel.classList.add('closed');
      });
    }

    function getLayerByName(name) {
      switch (name) {
        case 'municipios': return geojsonMunicipios;
        case 'acudes': return geojsonAcudes;
        case 'bacias': return geojsonBacias;
        case 'rios': return geojsonRios;
        default: return null;
      }
    }

    let tableLayers = [];

    function marcarLinha(tr) {
      if (selectedRowElement) selectedRowElement.classList.remove('selected-row');
      tr.classList.add('selected-row');
      selectedRowElement = tr;
    }

    function carregarDadosTabela(geojsonData) {
      if (!geojsonData || !gisTableHead || !gisTableBody) return;

      gisTableHead.innerHTML = '';
      gisTableBody.innerHTML = '';
      selectedRowElement = null;

      tableLayers = geojsonData.getLayers().filter(l => l.feature);
      if (tableLayers.length === 0) return;

      const keys = Object.keys(tableLayers[0].feature.properties || {});

      let headHtml = '<tr>';
      keys.forEach(key => {
        headHtml += `<th>${escapeHtml(key)}</th>`;
      });
      headHtml += '</tr>';
      gisTableHead.innerHTML = headHtml;

      tableLayers.forEach((layer, index) => {
        const props = layer.feature.properties || {};
        const tr = document.createElement('tr');
        tr.dataset.featureIndex = index;

        keys.forEach(key => {
          const td = document.createElement('td');
          td.textContent = props[key] !== null && props[key] !== undefined ? props[key] : '';
          tr.appendChild(td);
        });

        tr.addEventListener('click', () => {
          marcarLinha(tr);
          selectLayer(layer, true);
        });

        gisTableBody.appendChild(tr);
      });
    }

    // Abre a tabela já na camada certa, com a linha da feição selecionada
    function abrirTabelaNaFeicao(tipo, layer) {
      const grupo = getLayerByName(tipo);
      if (!attributeTablePanel || !grupo) return;
      if (layerTableSelect) layerTableSelect.value = tipo;
      attributeTablePanel.classList.remove('closed');
      carregarDadosTabela(grupo);
      sincronizarTabelaComMapa(grupo, layer.feature);
    }

    if (layerTableSelect) {
      layerTableSelect.addEventListener('change', function () {
        const activeLayer = getLayerByName(this.value);
        carregarDadosTabela(activeLayer);
      });
    }

    function sincronizarTabelaComMapa(geojsonLayer, feature) {
      if (!attributeTablePanel || attributeTablePanel.classList.contains('closed') || !layerTableSelect) return;
      if (getLayerByName(layerTableSelect.value) !== geojsonLayer) return;

      const idx = tableLayers.findIndex(l => l.feature === feature);
      const tr = gisTableBody.children[idx];
      if (idx >= 0 && tr) {
        marcarLinha(tr);
        tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    // -------------------------------------------------------------
    // 3. CAMADA DE MUNICÍPIOS
    // -------------------------------------------------------------
    if (typeof municipios !== "undefined") {
      geojsonMunicipios = L.geoJSON(municipios, {
        pane: "municipiosPane",
        style: function () { return getMunStyle(); },
        onEachFeature: function (feature, layer) {
          layer.on({
            mouseover: function (e) {
              if (map.pm && map.pm.globalDrawModeEnabled()) return;
              e.target.setStyle({ 
                weight: 2, 
                color: munHover, 
                fillOpacity: Math.min(currentMunicipiosOpacity + 0.2, 1) 
              });
              e.target.bringToFront();
            },
            mouseout: function (e) {
              e.target.setStyle(getMunStyle());
            },
            click: function () {
              if (map.pm && map.pm.globalDrawModeEnabled()) return;

              const props = feature.properties || {};
              const nome = props.NM_MUN || props.Nome || "Município";
              
              const areaMun = fmtNum(pick(props, ['AREA_KM2', 'Area_km2']));
              showFeatureDetails(nome, "municipios", {
                "Código IBGE": pick(props, ['CD_MUN']),
                "Mesorregião": pick(props, ['NM_MESO', 'Mesorregiao', 'MESORREGIAO', 'NM_MESORREG']),
                "Área": areaMun ? areaMun + " km²" : null
              }, { layer: layer });

              sincronizarTabelaComMapa(geojsonMunicipios, feature);
            }
          });
        }
      });

      geojsonMunicipios.addTo(layerMunicipios);
      layerMunicipios.addTo(map);

      const munBounds = geojsonMunicipios.getBounds();
      if (munBounds.isValid()) map.fitBounds(munBounds, { padding: [20, 20] });

      if (typeof L.Control.Search !== "undefined") {
        const searchControl = new L.Control.Search({
          layer: geojsonMunicipios,
          propertyName: 'NM_MUN',
          marker: false,
          moveToLocation: function (latlng, title, map) {
            const zoom = map.getBoundsZoom(latlng.layer.getBounds());
            map.setView(latlng, zoom);
          }
        });
        map.addControl(searchControl);
      }
    }

    // -------------------------------------------------------------
    // 4. CAMADA DE AÇUDES
    // -------------------------------------------------------------
    if (typeof acudes !== "undefined") {
      geojsonAcudes = L.geoJSON(acudes, {
        pane: "acudesPane",
        style: { color: "#ffffff", weight: 1, fillColor: "#0284c7", fillOpacity: 0.6, opacity: 0.6 },
        onEachFeature: function (feature, layer) {
          layer.on('click', function () {
            if (map.pm && map.pm.globalDrawModeEnabled()) return;

            const props = feature.properties || {};
            const nome = props.Nome || props.NOME || "Açude sem nome";
            
            showFeatureDetails(nome, "acudes", {
              "Município": pick(props, ['Municip', 'Municipio']),
              "Bacia": pick(props, ['Bacia']),
              "Capacidade (m³)": fmtNum(props.Capacidade, 0)
            }, { layer: layer });

            sincronizarTabelaComMapa(geojsonAcudes, feature);
          });
        }
      });
      geojsonAcudes.addTo(layerAcudes);
      layerAcudes.addTo(map);
    }

    // -------------------------------------------------------------
    // 5. CAMADA DE BACIAS HIDROGRÁFICAS
    // -------------------------------------------------------------
    if (typeof bacias !== "undefined") {
      function getCorBacia(nome) {
        if (!nome) return "#94a3b8";
        const n = nome.toLowerCase();
        if (n.includes("paraíba") || n.includes("paraiba")) return "#0284c7";
        if (n.includes("piranhas") || n.includes("mamaranguape")) return "#0d9488";
        if (n.includes("jacu") || n.includes("curimataú")) return "#16a34a";
        if (n.includes("gramame") || n.includes("abaiara")) return "#2563eb";
        if (n.includes("trairi") || n.includes("camaratuba")) return "#059669";
        if (n.includes("litoral")) return "#06b6d4";
        return "#7c3aed";
      }

      geojsonBacias = L.geoJSON(bacias, {
        pane: "baciasPane",
        style: function (feature) {
          const nomeBacia = feature.properties ? feature.properties.Nome : "";
          return { color: getCorBacia(nomeBacia), weight: 2, opacity: 0.9, fillColor: getCorBacia(nomeBacia), fillOpacity: 0.45 };
        },
        onEachFeature: function (feature, layer) {
          layer.on('click', function () {
            if (map.pm && map.pm.globalDrawModeEnabled()) return;

            const props = feature.properties || {};
            const nome = props.Nome || "Bacia Hidrográfica";
            
            const areaBac = fmtNum(props.Area_km2);
            showFeatureDetails(nome, "bacias", {
              "Área": areaBac ? areaBac + " km²" : null,
              "Rios principais": pick(props, ['Rios'])
            }, { layer: layer });

            sincronizarTabelaComMapa(geojsonBacias, feature);
          });
        }
      });
      geojsonBacias.addTo(layerBacias);
    }

    // -------------------------------------------------------------
    // 6. CAMADA DE RIOS
    // -------------------------------------------------------------
    if (typeof rios !== "undefined") {
      geojsonRios = L.geoJSON(rios, {
        pane: "riosPane",
        style: { color: "#0284c7", weight: 2, opacity: 0.8 },
        onEachFeature: function (feature, layer) {
          layer.on('click', function () {
            if (map.pm && map.pm.globalDrawModeEnabled()) return;

            const props = feature.properties || {};
            const nome = props.Nome || props.NOME || "Rio sem nome";

            const extRio = fmtNum(props.Extensao);
            showFeatureDetails(nome, "rios", {
              "Bacia hidrográfica": pick(props, ['Bacia']),
              "Extensão": extRio ? extRio + " km" : null
            }, { layer: layer });

            sincronizarTabelaComMapa(geojsonRios, feature);
          });
        }
      });
      geojsonRios.addTo(layerRios);
    }

    function applyOverlayTheme() {
      const onImagery = currentBasemap !== 'osm';
      munStroke = onImagery ? '#e2e8f0' : '#475569';
      munFill   = onImagery ? '#cbd5e1' : '#64748b';
      munHover  = onImagery ? '#ffffff' : '#0f172a';
      riosColor = onImagery ? '#38bdf8' : '#0284c7';
      if (geojsonMunicipios) geojsonMunicipios.setStyle(getMunStyle());
      if (geojsonRios) geojsonRios.setStyle({ color: riosColor });
      updateLegend();
    }

    // -------------------------------------------------------------
    // LEGENDA DINÂMICA
    // -------------------------------------------------------------
    let legendCollapsed = false;
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'legend-control');
      div.id = 'dynamicLegend';
      L.DomEvent.disableClickPropagation(div);
      div.addEventListener('click', function (e) {
        if (e.target.closest('.legend-toggle')) {
          legendCollapsed = !legendCollapsed;
          updateLegend();
        }
      });
      return div;
    };
    legend.addTo(map);

    function updateLegend() {
      const div = document.getElementById('dynamicLegend');
      if (!div) return;

      let html = '';
      let hasLayer = false;

      if (map.hasLayer(layerMunicipios)) {
        html += '<div class="legend-item"><span class="legend-color" style="background:' + munFill + '; border:1px solid ' + munStroke + ';"></span> Municípios</div>';
        hasLayer = true;
      }

      if (map.hasLayer(layerAcudes)) {
        html += '<div class="legend-item"><span class="legend-color" style="background:#0284c7; border-radius:50%;"></span> Açudes</div>';
        hasLayer = true;
      }

      if (map.hasLayer(layerBacias)) {
        html += '<div class="mt-2 mb-1 fw-bold text-muted" style="font-size:11px; text-transform:uppercase;">Bacias Hidrográficas</div>';
        const listaBacias = [
          { nome: "Rio Paraíba", cor: "#0284c7" },
          { nome: "Rio Piranhas / Mamanguape", cor: "#0d9488" },
          { nome: "Rio Jacu / Curimataú", cor: "#16a34a" },
          { nome: "Rio Gramame / Abaiara", cor: "#2563eb" },
          { nome: "Rio Trairi / Camaratuba", cor: "#059669" },
          { nome: "Litoral", cor: "#06b6d4" },
          { nome: "Outras Bacias", cor: "#7c3aed" }
        ];

        listaBacias.forEach(function (bacia) {
          html += `<div class="legend-item" style="padding-left: 4px;">
                     <span class="legend-color" style="background:${bacia.cor};"></span> ${bacia.nome}
                   </div>`;
        });
        hasLayer = true;
      }

      if (map.hasLayer(layerRios)) {
        html += '<div class="legend-item mt-1"><span class="legend-color" style="background:' + riosColor + '; height:3px;"></span> Rios</div>';
        hasLayer = true;
      }

      div.style.display = hasLayer ? 'block' : 'none';
      const caret = legendCollapsed ? 'ph-caret-up' : 'ph-caret-down';
      div.innerHTML = '<button type="button" class="legend-toggle"><strong>Legenda</strong><i class="ph ' + caret + '"></i></button>' +
        (legendCollapsed ? '' : '<div class="legend-body">' + html + '</div>');
    }

    // -------------------------------------------------------------
    // SWITCHES DO PAINEL LATERAL
    // -------------------------------------------------------------
    const chkMun = document.getElementById('checkMunicipios');
    const chkAcu = document.getElementById('checkAcudes');
    const chkBac = document.getElementById('checkBacias');
    const chkRio = document.getElementById('checkRios');

    if (chkMun) {
      chkMun.addEventListener('change', function () {
        this.checked ? layerMunicipios.addTo(map) : map.removeLayer(layerMunicipios);
        updateLegend();
      });
    }

    if (chkAcu) {
      chkAcu.addEventListener('change', function () {
        this.checked ? layerAcudes.addTo(map) : map.removeLayer(layerAcudes);
        updateLegend();
      });
    }

    if (chkBac) {
      chkBac.addEventListener('change', function () {
        this.checked ? layerBacias.addTo(map) : map.removeLayer(layerBacias);
        updateLegend();
      });
    }

    if (chkRio) {
      chkRio.addEventListener('change', function () {
        this.checked ? layerRios.addTo(map) : map.removeLayer(layerRios);
        updateLegend();
      });
    }

    updateLegend();

    const checkedBase = document.querySelector('input[name="basemapRadio"]:checked');
    setBasemap(checkedBase && checkedBase.id === 'radioSat' ? 'sat' : (checkedBase && checkedBase.id === 'radioDark' ? 'dark' : 'osm'));

    // -------------------------------------------------------------
    // CONTROLE DE OPACIDADE DAS CAMADAS (Sliders da Sidebar)
    // -------------------------------------------------------------
    const rangeOpMun = document.getElementById('rangeOpMun');
    const valOpMun = document.getElementById('valOpMun');
    if (rangeOpMun && geojsonMunicipios) {
      rangeOpMun.addEventListener('input', function () {
        currentMunicipiosOpacity = parseFloat(this.value);
        if (valOpMun) valOpMun.textContent = Math.round(currentMunicipiosOpacity * 100) + '%';
        geojsonMunicipios.setStyle({ fillOpacity: currentMunicipiosOpacity });
      });
    }

    const rangeOpAcu = document.getElementById('rangeOpAcu');
    const valOpAcu = document.getElementById('valOpAcu');
    if (rangeOpAcu && geojsonAcudes) {
      rangeOpAcu.addEventListener('input', function () {
        const opVal = parseFloat(this.value);
        if (valOpAcu) valOpAcu.textContent = Math.round(opVal * 100) + '%';
        geojsonAcudes.setStyle({ fillOpacity: opVal, opacity: opVal });
      });
    }

    const rangeOpBac = document.getElementById('rangeOpBac');
    const valOpBac = document.getElementById('valOpBac');
    if (rangeOpBac && geojsonBacias) {
      rangeOpBac.addEventListener('input', function () {
        const opVal = parseFloat(this.value);
        if (valOpBac) valOpBac.textContent = Math.round(opVal * 100) + '%';
        geojsonBacias.setStyle({ fillOpacity: opVal, opacity: opVal });
      });
    }

    const rangeOpRio = document.getElementById('rangeOpRio');
    const valOpRio = document.getElementById('valOpRio');
    if (rangeOpRio && geojsonRios) {
      rangeOpRio.addEventListener('input', function () {
        const opVal = parseFloat(this.value);
        if (valOpRio) valOpRio.textContent = Math.round(opVal * 100) + '%';
        geojsonRios.setStyle({ opacity: opVal });
      });
    }

    // =============================================================
    // 7. FUNCIONALIDADE DE CONSULTA POR COORDENADAS (ADICIONADA)
    // =============================================================
    const coordTypeSelect = document.getElementById('coordTypeSelect');
    const coordInputsContainer = document.getElementById('coordInputsContainer');
    const btnLocalizarCoord = document.getElementById('btnLocalizarCoord');
    let coordMarker = null;

    if (coordTypeSelect && coordInputsContainer) {
      coordTypeSelect.addEventListener('change', function() {
        const type = this.value;
        if (type === 'dec') {
          coordInputsContainer.innerHTML = `
            <div class="row g-2 mb-2" id="groupDec">
              <div class="col-6">
                <label for="inputLatDec" class="form-label text-muted" style="font-size: 10px;">Latitude (-)</label>
                <input type="text" class="form-control form-control-sm" id="inputLatDec" placeholder="Ex: -7.1198">
              </div>
              <div class="col-6">
                <label for="inputLonDec" class="form-label text-muted" style="font-size: 10px;">Longitude (-)</label>
                <input type="text" class="form-control form-control-sm" id="inputLonDec" placeholder="Ex: -34.8450">
              </div>
            </div>`;
        } else if (type === 'dms') {
          coordInputsContainer.innerHTML = `
            <div class="mb-2">
              <label class="form-label text-muted" style="font-size: 10px;">Latitude (Graus, Min, Seg)</label>
              <div class="row g-1">
                <div class="col-4"><input type="text" class="form-control form-control-sm" id="latDeg" placeholder="Graus"></div>
                <div class="col-4"><input type="text" class="form-control form-control-sm" id="latMin" placeholder="Min"></div>
                <div class="col-4"><input type="text" class="form-control form-control-sm" id="latSec" placeholder="Seg"></div>
              </div>
            </div>
            <div class="mb-2">
              <label class="form-label text-muted" style="font-size: 10px;">Longitude (Graus, Min, Seg)</label>
              <div class="row g-1">
                <div class="col-4"><input type="text" class="form-control form-control-sm" id="lonDeg" placeholder="Graus"></div>
                <div class="col-4"><input type="text" class="form-control form-control-sm" id="lonMin" placeholder="Min"></div>
                <div class="col-4"><input type="text" class="form-control form-control-sm" id="lonSec" placeholder="Seg"></div>
              </div>
            </div>`;
        } else if (type === 'utm') {
          coordInputsContainer.innerHTML = `
            <div class="row g-2 mb-2">
              <div class="col-6">
                <label for="utmEasting" class="form-label text-muted" style="font-size: 10px;">Easting (X)</label>
                <input type="text" class="form-control form-control-sm" id="utmEasting" placeholder="Ex: 292000">
              </div>
              <div class="col-6">
                <label for="utmNorthing" class="form-label text-muted" style="font-size: 10px;">Northing (Y)</label>
                <input type="text" class="form-control form-control-sm" id="utmNorthing" placeholder="Ex: 9212000">
              </div>
            </div>
            <div class="row g-2 mb-2">
              <div class="col-6">
                <label for="utmZone" class="form-label text-muted" style="font-size: 10px;">Zona UTM</label>
                <input type="text" class="form-control form-control-sm" id="utmZone" placeholder="Ex: 25">
              </div>
              <div class="col-6">
                <label for="utmHemisphere" class="form-label text-muted" style="font-size: 10px;">Hemisfério</label>
                <select class="form-select form-select-sm" id="utmHemisphere">
                  <option value="S">Sul (S)</option>
                  <option value="N">Norte (N)</option>
                </select>
              </div>
            </div>`;
        }
      });
    }

    if (btnLocalizarCoord) {
      btnLocalizarCoord.addEventListener('click', function() {
        const type = coordTypeSelect.value;
        let lat = null, lon = null;

        if (type === 'dec') {
          const latInput = document.getElementById('inputLatDec').value.replace(',', '.');
          const lonInput = document.getElementById('inputLonDec').value.replace(',', '.');
          lat = parseFloat(latInput);
          lon = parseFloat(lonInput);
        } 
        else if (type === 'dms') {
          const dLat = parseFloat(document.getElementById('latDeg').value) || 0;
          const mLat = parseFloat(document.getElementById('latMin').value) || 0;
          const sLat = parseFloat(document.getElementById('latSec').value) || 0;
          
          const dLon = parseFloat(document.getElementById('lonDeg').value) || 0;
          const mLon = parseFloat(document.getElementById('lonMin').value) || 0;
          const sLon = parseFloat(document.getElementById('lonSec').value) || 0;

          lat = Math.abs(dLat) + (mLat / 60) + (sLat / 3600);
          if (dLat < 0 || document.getElementById('latDeg').value.startsWith('-')) lat = -lat;

          lon = Math.abs(dLon) + (mLon / 60) + (sLon / 3600);
          if (dLon < 0 || document.getElementById('lonDeg').value.startsWith('-')) lon = -lon;
        }
        else if (type === 'utm') {
          alert("Para conversão UTM exata, utilize uma biblioteca auxiliar como 'proj4js' ou 'leaflet.utm'.");
          return;
        }

        if (isNaN(lat) || isNaN(lon)) {
          alert("Por favor, insira valores numéricos válidos para as coordenadas.");
          return;
        }

        map.setView([lat, lon], 15);

        if (coordMarker) {
          map.removeLayer(coordMarker);
        }

        coordMarker = L.marker([lat, lon]).addTo(map)
          .bindPopup(`<b>Ponto Localizado</b><br>Lat: ${lat.toFixed(5)}<br>Lon: ${lon.toFixed(5)}`)
          .openPopup();
      });
    }

  }
});

// =============================================================
// PÁGINA: GALERIA (galeria.html)
// =============================================================
// Galeria: cartões clicáveis + visualizador com zoom, arrastar, pinça, navegação e download
document.addEventListener("DOMContentLoaded", function () {
  const cards = Array.from(document.querySelectorAll('.gallery-card'));
  const mapas = cards.map(function (c) { return { title: c.dataset.title, src: c.dataset.src }; });

  const modalEl   = document.getElementById('mapViewerModal');
  const viewport  = document.getElementById('mapViewport');
  const img       = document.getElementById('modalMapImage');
  const titleEl   = document.getElementById('modalMapTitle');
  const counterEl = document.getElementById('modalMapCounter');
  const zoomLabel = document.getElementById('zoomLabel');
  const errorEl   = document.getElementById('viewerError');
  const linkTab   = document.getElementById('modalOpenTab');
  const linkDown  = document.getElementById('modalDownload');
  if (!modalEl || !mapas.length) return;

  const modal = new bootstrap.Modal(modalEl);

  let index = 0, scale = 1, tx = 0, ty = 0;
  let fit = 1, minScale = 1, maxScale = 4, atFit = true;
  let natW = 0, natH = 0, lastFocus = null;

  // ---------- transformação ----------
  function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }

  function apply() {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const w = natW * scale, h = natH * scale;
    tx = (w <= vw) ? (vw - w) / 2 : clamp(tx, vw - w, 0);
    ty = (h <= vh) ? (vh - h) / 2 : clamp(ty, vh - h, 0);
    img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    zoomLabel.textContent = Math.round((scale / fit) * 100) + '%';
  }

  function fitToView() {
    if (!natW || !viewport.clientWidth) return;
    fit = Math.min(viewport.clientWidth / natW, viewport.clientHeight / natH);
    minScale = fit;
    maxScale = Math.max(fit * 12, 2);
    scale = fit;
    tx = ty = 0;
    atFit = true;
    apply();
  }

  // amplia mantendo o ponto (px, py) do visualizador parado
  function zoomAt(px, py, factor) {
    const novo = clamp(scale * factor, minScale, maxScale);
    const f = novo / scale;
    if (f === 1) return;
    tx = px - (px - tx) * f;
    ty = py - (py - ty) * f;
    scale = novo;
    atFit = scale <= minScale * 1.001;
    apply();
  }

  function zoomCenter(factor) {
    zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor);
  }

  function localPoint(e) {
    const r = viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---------- abrir / navegar ----------
  function loadImage(src) {
    errorEl.hidden = true;
    img.classList.add('loading');
    const done = function () {
      natW = img.naturalWidth;
      natH = img.naturalHeight;
      fitToView();
      img.classList.remove('loading');
    };
    img.onload = done;
    img.onerror = function () { errorEl.hidden = false; };
    img.src = src;
    if (img.complete && img.naturalWidth) done();
  }

  function show(i) {
    index = (i + mapas.length) % mapas.length;
    const m = mapas[index];
    titleEl.textContent = m.title;
    counterEl.textContent = (index + 1) + ' / ' + mapas.length;
    linkTab.href = m.src;
    linkDown.href = m.src;
    linkDown.setAttribute('download', m.src.split('/').pop());
    loadImage(m.src);

    // pré-carrega o vizinho para a troca ficar instantânea
    const prox = new Image();
    prox.src = mapas[(index + 1) % mapas.length].src;
  }

  function openAt(i) {
    lastFocus = document.activeElement;
    show(i);
    modal.show();
  }

  modalEl.addEventListener('shown.bs.modal', function () { fitToView(); });
  modalEl.addEventListener('hidden.bs.modal', function () {
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  });
  window.addEventListener('resize', function () {
    if (!modalEl.classList.contains('show')) return;
    if (atFit) fitToView(); else apply();
  });

  // ---------- cartões: clique e teclado ----------
  cards.forEach(function (card, i) {
    card.addEventListener('click', function () { openAt(i); });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAt(i); }
    });
  });

  // ---------- botões ----------
  document.getElementById('viewerPrev').addEventListener('click', function () { show(index - 1); });
  document.getElementById('viewerNext').addEventListener('click', function () { show(index + 1); });
  document.getElementById('zoomIn').addEventListener('click', function () { zoomCenter(1.5); });
  document.getElementById('zoomOut').addEventListener('click', function () { zoomCenter(1 / 1.5); });
  document.getElementById('zoomFit').addEventListener('click', fitToView);

  // botões sobre o mapa não devem iniciar o arrasto
  viewport.querySelectorAll('.viewer-nav, .viewer-tools').forEach(function (el) {
    el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    el.addEventListener('dblclick', function (e) { e.stopPropagation(); });
  });

  // ---------- teclado ----------
  modalEl.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); show(index - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
    else if (e.key === '+' || e.key === '=') zoomCenter(1.5);
    else if (e.key === '-') zoomCenter(1 / 1.5);
    else if (e.key === '0') fitToView();
  });

  // ---------- roda do mouse ----------
  viewport.addEventListener('wheel', function (e) {
    e.preventDefault();
    const p = localPoint(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  // ---------- arrastar e pinça (mouse, toque e caneta) ----------
  const pointers = new Map();
  let lastDist = 0;

  viewport.addEventListener('pointerdown', function (e) {
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.classList.add('dragging');
    if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      lastDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  });

  viewport.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      tx += e.clientX - prev.x;
      ty += e.clientY - prev.y;
      apply();
    } else if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const r = viewport.getBoundingClientRect();
      const mx = (pts[0].x + pts[1].x) / 2 - r.left;
      const my = (pts[0].y + pts[1].y) / 2 - r.top;
      if (lastDist) zoomAt(mx, my, dist / lastDist);
      lastDist = dist;
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    lastDist = 0;
    if (pointers.size === 0) viewport.classList.remove('dragging');
  }
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);

  // clique duplo: aproxima no ponto clicado ou volta ao ajuste
  viewport.addEventListener('dblclick', function (e) {
    if (scale > fit * 1.05) fitToView();
    else { const p = localPoint(e); zoomAt(p.x, p.y, 3); }
  });
});

// =============================================================
// PÁGINA: DOWNLOADS (downloads.html)
// =============================================================
// Downloads: lista de camadas com vários formatos, metadados e "baixar tudo".
// Para adicionar/remover um formato ou camada, edite apenas as listas abaixo.
document.addEventListener("DOMContentLoaded", function () {
  // Pacote com todas as camadas (gerado por você, por ex. no QGIS, e salvo em dados/)
  const ARQUIVO_TUDO = 'dados/geoportal-todas-camadas.zip';

  const FORMATOS = {
    geojson: { nome: 'GeoJSON',    desc: 'Web, QGIS e Leaflet',                icone: 'ph-file-code' },
    shp:     { nome: 'Shapefile',  desc: 'ZIP com .shp, .dbf, .shx e .prj',    icone: 'ph-file-zip'  },
    gpkg:    { nome: 'GeoPackage', desc: 'Arquivo único, padrão aberto OGC',   icone: 'ph-database'  },
    csv:     { nome: 'CSV',        desc: 'Somente a tabela de atributos',      icone: 'ph-file-csv'  }
  };

  // `dados` devolve o objeto GeoJSON já carregado pelos arquivos dados/*.js
  const CAMADAS = [
    {
      titulo: 'Limites Municipais da Paraíba',
      desc: 'Divisão territorial oficial dos 223 municípios com código IBGE.',
      fonte: 'IBGE (2023)', icone: 'ph-map-pin', cor: 'primary', crs: 'EPSG:4326',
      dados: function () { return typeof municipios !== 'undefined' ? municipios : null; },
      arquivos: { geojson: 'dados/municipios.geojson', shp: 'dados/municipios.zip', gpkg: 'dados/municipios.gpkg', csv: 'dados/municipios.csv' }
    },
    {
      titulo: 'Bacias Hidrográficas',
      desc: 'Polígonos das bacias e sub-bacias hidrográficas estaduais.',
      fonte: 'AESA (2022)', icone: 'ph-polygon', cor: 'success', crs: 'EPSG:4326',
      dados: function () { return typeof bacias !== 'undefined' ? bacias : null; },
      arquivos: { geojson: 'dados/bacias.geojson', shp: 'dados/bacias.zip', gpkg: 'dados/bacias.gpkg', csv: 'dados/bacias.csv' }
    },
    {
      titulo: 'Açudes e Reservatórios',
      desc: "Localização e capacidade de acumulação dos corpos d'água.",
      fonte: 'AESA / ANA', icone: 'ph-drop', cor: 'info', crs: 'EPSG:4326',
      dados: function () { return typeof acudes !== 'undefined' ? acudes : null; },
      arquivos: { geojson: 'dados/acudes.geojson', shp: 'dados/acudes.zip', gpkg: 'dados/acudes.gpkg', csv: 'dados/acudes.csv' }
    },
    {
      titulo: 'Rede Hidrográfica (Rios)',
      desc: "Eixos e cursos d'água dos rios principais e afluentes.",
      fonte: 'AESA / CPRM', icone: 'ph-waves', cor: 'primary', crs: 'EPSG:4326',
      dados: function () { return typeof rios !== 'undefined' ? rios : null; },
      arquivos: { geojson: 'dados/rios.geojson', shp: 'dados/rios.zip', gpkg: 'dados/rios.gpkg', csv: 'dados/rios.csv' }
    }
  ];

  // ---------- utilitários ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function tamanho(bytes) {
    if (bytes === null || bytes === undefined) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB';
  }

  function geometria(dados) {
    const f = dados && dados.features && dados.features[0];
    const t = f && f.geometry && f.geometry.type;
    if (!t) return null;
    if (t.indexOf('Polygon') >= 0) return { rotulo: 'Polígonos', icone: 'ph-polygon' };
    if (t.indexOf('Line') >= 0)    return { rotulo: 'Linhas',    icone: 'ph-line-segment' };
    if (t.indexOf('Point') >= 0)   return { rotulo: 'Pontos',    icone: 'ph-dots-three' };
    return null;
  }

  // HEAD no arquivo: devolve { ok: true|false|null, size, date }.
  // null = não foi possível verificar (ex.: página aberta direto do disco).
  function sondar(url) {
    return fetch(url, { method: 'HEAD' }).then(function (r) {
      if (!r.ok) return { ok: false };
      const len = r.headers.get('content-length');
      const lm = r.headers.get('last-modified');
      return { ok: true, size: len ? Number(len) : null, date: lm ? new Date(lm) : null };
    }).catch(function () { return { ok: null }; });
  }

  function marcarIndisponivel(el) {
    el.classList.add('disabled');
    el.setAttribute('aria-disabled', 'true');
    el.removeAttribute('href');
    el.title = 'Arquivo não encontrado no servidor';
  }

  // ---------- montagem ----------
  const container = document.getElementById('dlItems');
  if (!container) return;

  CAMADAS.forEach(function (c, i) {
    const geo = geometria(c.dados());
    const dados = c.dados();
    const n = dados && dados.features ? dados.features.length : null;

    let chips = '';
    if (geo) chips += '<span class="dl-chip"><i class="ph ' + geo.icone + '"></i>' + geo.rotulo + '</span>';
    if (n !== null) chips += '<span class="dl-chip"><i class="ph ph-list-numbers"></i>' + n.toLocaleString('pt-BR') + (n === 1 ? ' feição' : ' feições') + '</span>';
    chips += '<span class="dl-chip"><i class="ph ph-globe-hemisphere-west"></i>' + esc(c.crs) + '</span>';
    chips += '<span class="dl-chip" data-meta="atualizado" hidden></span>';

    let itens = '';
    Object.keys(c.arquivos).forEach(function (fmt) {
      const f = FORMATOS[fmt];
      const nomeArq = c.arquivos[fmt].split('/').pop();
      itens += '<li><a class="dropdown-item dl-format" data-fmt="' + fmt + '" href="' + esc(c.arquivos[fmt]) + '" download="' + esc(nomeArq) + '">' +
        '<i class="ph ' + f.icone + '"></i>' +
        '<span class="dl-format-text"><strong>' + f.nome + '</strong><small>' + f.desc + '</small></span>' +
        '<small class="dl-format-size"></small></a></li>';
    });

    const row = document.createElement('div');
    row.className = 'dl-item';
    row.innerHTML =
      '<div class="dl-main">' +
        '<div class="dl-icon bg-' + c.cor + '-subtle text-' + c.cor + '"><i class="ph ' + c.icone + '"></i></div>' +
        '<div class="dl-info">' +
          '<strong class="d-block text-dark">' + esc(c.titulo) + '</strong>' +
          '<small class="text-muted d-block">' + esc(c.desc) + '</small>' +
          '<div class="dl-meta">' + chips + '</div>' +
          '<small class="text-muted">Fonte: ' + esc(c.fonte) + '</small>' +
        '</div>' +
      '</div>' +
      '<div class="dl-action"><div class="dropdown">' +
        '<button class="btn btn-primary btn-sm dropdown-toggle d-inline-flex align-items-center justify-content-center gap-1" type="button" data-bs-toggle="dropdown" aria-expanded="false">' +
          '<i class="ph ph-download-simple"></i> Baixar</button>' +
        '<ul class="dropdown-menu dropdown-menu-end shadow-sm">' + itens + '</ul>' +
      '</div></div>';
    container.appendChild(row);

    // tamanho e data de cada arquivo (quando o servidor informa)
    Object.keys(c.arquivos).forEach(function (fmt) {
      const link = row.querySelector('.dl-format[data-fmt="' + fmt + '"]');
      sondar(c.arquivos[fmt]).then(function (r) {
        if (r.ok === false) { marcarIndisponivel(link); link.querySelector('.dl-format-size').textContent = 'indisponível'; return; }
        if (r.ok && r.size !== null) link.querySelector('.dl-format-size').textContent = tamanho(r.size);
        if (r.ok && fmt === 'geojson' && r.date) {
          const chip = row.querySelector('[data-meta="atualizado"]');
          chip.innerHTML = '<i class="ph ph-calendar-blank"></i>Atualizado em ' + r.date.toLocaleDateString('pt-BR');
          chip.hidden = false;
        }
      });
    });
  });

  // ---------- baixar tudo ----------
  const btnTudo = document.getElementById('btnBaixarTudo');
  if (btnTudo) {
    btnTudo.href = ARQUIVO_TUDO;
    btnTudo.setAttribute('download', ARQUIVO_TUDO.split('/').pop());
    sondar(ARQUIVO_TUDO).then(function (r) {
      if (r.ok === false) { marcarIndisponivel(btnTudo); btnTudo.title = 'Pacote ainda não disponível'; return; }
      if (r.ok && r.size !== null) document.getElementById('tudoSize').textContent = '(' + tamanho(r.size) + ')';
    });
  }
});
