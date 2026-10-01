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
      rios:       { label: 'Rio',                icon: 'ph-waves',   color: '#0891b2', bg: '#cffafe' },
      pocos:      { label: 'Poço',               icon: 'ph-drop-half-bottom', color: '#b45309', bg: '#fef3c7' }
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

    // feições de um grupo (açudes, poços…) cujo centro está dentro de um município/bacia
    function feicoesDentro(areaLayer, grupo) {
      if (!grupo || !areaLayer.getBounds || !areaLayer.feature) return [];
      const bounds = areaLayer.getBounds();
      const geom = areaLayer.feature.geometry;
      return grupo.getLayers().filter(function (l) {
        const c = featureCenter(l);
        return c && bounds.contains(c) && pointInGeometry(c.lng, c.lat, geom);
      });
    }

    function acudesDentro(areaLayer) { return feicoesDentro(areaLayer, geojsonAcudes); }
    function pocosDentro(areaLayer)  { return feicoesDentro(areaLayer, geojsonPocos); }

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
        return L.circleMarker(ll, { pane: 'highlightPane', radius: 15, color: cor, weight: w, fill: false, interactive: false });
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
      else if (layer.getLatLng) {
        const ll = layer.getLatLng();
        map.fitBounds(L.latLngBounds([ll, ll]), { paddingTopLeft: [40, 40], paddingBottomRight: [PANEL_WIDTH + 40, 40], maxZoom: 15 });
      }
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

      if (layer && (tipo === 'municipios' || tipo === 'bacias') && geojsonPocos) {
        const lp = pocosDentro(layer).sort(function (a, b) {
          return (Number(b.feature.properties.q_m3h) || 0) - (Number(a.feature.properties.q_m3h) || 0);
        });
        relatedHtml += '<div class="related-title">' + (tipo === 'municipios' ? 'Poços neste município' : 'Poços nesta bacia') +
          ' <span class="related-count">' + lp.length + '</span></div>';
        if (lp.length) {
          lp.slice(0, 5).forEach(function (l) {
            const p = l.feature.properties || {};
            const vz = fmtNum(p.q_m3h, 1);
            relatedHtml += itemHtml(l, 'ph-drop-half-bottom', 'Poço ' + p.fid + (p.proprietario ? ' · ' + p.proprietario : ''), vz ? vz + ' m³/h' : '');
          });
          if (lp.length > 5) {
            relatedHtml += '<div class="small text-muted px-1 pt-2">Mostrando os 5 de maior vazão. Veja todos na tabela de atributos (camada Poços).</div>';
          }
        } else {
          relatedHtml += '<div class="small text-muted px-1">Nenhum poço cadastrado.</div>';
        }
      }

      let mun = null;
      if (layer && (tipo === 'acudes' || tipo === 'pocos')) {
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
    map.createPane("pocosPane").style.zIndex = 560;
    const highlightPane = map.createPane("highlightPane");
    highlightPane.style.zIndex = 650;
    highlightPane.style.pointerEvents = "none";

    const layerMunicipios = L.layerGroup();
    const layerAcudes = L.layerGroup();
    const layerBacias = L.layerGroup();
    const layerRios = L.layerGroup();
    const layerPocos = L.layerGroup();

    let geojsonMunicipios = null;
    let geojsonBacias = null;
    let geojsonRios = null;
    let geojsonAcudes = null;
    let geojsonPocos = null;
    let clusterPocos = null;

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
        case 'pocos': return geojsonPocos;
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
    // 4B. CAMADA DE POÇOS (marcadores, agrupados quando há muitos juntos)
    // -------------------------------------------------------------
    if (typeof pocos !== "undefined") {
      const pocoIcon = L.divIcon({
        className: 'poco-marker',
        html: '<span><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M12 2.5c3.2 4.2 6 7.2 6 11a6 6 0 0 1-12 0c0-3.8 2.8-6.8 6-11z" fill="#ffffff"/></svg></span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      const fmt1 = function (v) {
        return (v === null || v === undefined || v === '') ? null : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
      };

      geojsonPocos = L.geoJSON(pocos, {
        pointToLayer: function (feature, latlng) {
          return L.marker(latlng, { icon: pocoIcon, pane: "pocosPane", riseOnHover: true });
        },
        onEachFeature: function (feature, layer) {
          const props = feature.properties || {};
          layer.bindTooltip('Poço ' + props.fid + (props.municipio ? ' · ' + props.municipio : ''), { direction: 'top', offset: [0, -10] });

          layer.on('click', function () {
            if (map.pm && map.pm.globalDrawModeEnabled()) return;

            const dt = /^\d{4}-\d{2}-\d{2}$/.test(props.data_perfuracao || '') ? props.data_perfuracao.split('-').reverse().join('/') : pick(props, ['data_perfuracao']);
            const prof = fmt1(props.profundidade);
            const vazao = fmt1(props.q_m3h);

            showFeatureDetails('Nº ' + props.fid, "pocos", {
              "Município": pick(props, ['municipio']),
              "Microrregião": pick(props, ['microregiao']),
              "Mesorregião": pick(props, ['mesoregiao']),
              "Proprietário": pick(props, ['proprietario']),
              "Órgão": pick(props, ['orgao']),
              "Equipamento": pick(props, ['equipamento']),
              "Profundidade": prof ? prof + " m" : null,
              "Vazão": vazao ? vazao + " m³/h" : null,
              "Data de perfuração": dt
            }, { layer: layer });

            sincronizarTabelaComMapa(geojsonPocos, feature);
          });
        }
      });

      if (typeof L.markerClusterGroup === 'function') {
        clusterPocos = L.markerClusterGroup({
          clusterPane: "pocosPane",
          maxClusterRadius: 45,
          disableClusteringAtZoom: 13,
          showCoverageOnHover: false,
          chunkedLoading: true,
          iconCreateFunction: function (cluster) {
            const n = cluster.getChildCount();
            const t = n < 10 ? 's' : (n < 100 ? 'm' : 'l');
            const tam = { s: 32, m: 38, l: 46 }[t];
            return L.divIcon({ html: '<span>' + n + '</span>', className: 'poco-cluster poco-cluster-' + t, iconSize: L.point(tam, tam) });
          }
        });
        clusterPocos.addLayer(geojsonPocos);
        clusterPocos.addTo(layerPocos);
      } else {
        geojsonPocos.addTo(layerPocos);
      }
      // a camada começa desligada: o usuário liga em "Camadas → Poços"
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

      if (map.hasLayer(layerPocos)) {
        html += '<div class="legend-item"><span class="legend-color" style="background:#d97706; border:2px solid #ffffff; box-shadow:0 0 0 1px #d97706; border-radius:50%;"></span> Poços</div>';
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
    const chkPoc = document.getElementById('checkPocos');

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

    if (chkPoc) {
      chkPoc.addEventListener('change', function () {
        this.checked ? layerPocos.addTo(map) : map.removeLayer(layerPocos);
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

    const rangeOpPoc = document.getElementById('rangeOpPoc');
    const valOpPoc = document.getElementById('valOpPoc');
    if (rangeOpPoc) {
      rangeOpPoc.addEventListener('input', function () {
        const opVal = parseFloat(this.value);
        if (valOpPoc) valOpPoc.textContent = Math.round(opVal * 100) + '%';
        map.getPane('pocosPane').style.opacity = opVal;
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

  // ---------- baixar imagem (direto, sem abrir aba) ----------
  function salvarBlob(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  linkDown.addEventListener('click', function () {
    const src = mapas[index].src;
    const nome = src.split('/').pop();
    linkDown.disabled = true;
    fetch(src)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(function (b) { salvarBlob(b, nome); })
      .catch(function () {
        // Página aberta direto do disco (file://): o navegador bloqueia a leitura do arquivo.
        // Em servidor (Live Server, hospedagem) o caminho acima funciona.
        const a = document.createElement('a');
        a.href = src; a.download = nome; a.target = '_blank'; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
      })
      .then(function () { linkDown.disabled = false; });
  });

  // ---------- tela cheia ----------
  const fsBtn = document.getElementById('viewerFullscreen');
  const fsAlvo = modalEl.querySelector('.modal-content');
  const fsAtual = function () { return document.fullscreenElement || document.webkitFullscreenElement; };

  function alternarTelaCheia() {
    if (!fsBtn || fsBtn.hidden) return;
    if (fsAtual()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const req = fsAlvo.requestFullscreen || fsAlvo.webkitRequestFullscreen;
      const p = req.call(fsAlvo);
      if (p && p.catch) p.catch(function () {});
    }
  }

  function aoMudarTelaCheia() {
    const ativa = !!fsAtual();
    if (fsBtn) {
      fsBtn.querySelector('i').className = 'ph ' + (ativa ? 'ph-arrows-in' : 'ph-arrows-out');
      fsBtn.title = ativa ? 'Sair da tela cheia (F)' : 'Tela cheia (F)';
      fsBtn.setAttribute('aria-label', fsBtn.title);
    }
    setTimeout(function () { if (atFit) fitToView(); else apply(); }, 60);
  }

  if (fsBtn) {
    if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) fsBtn.hidden = true;
    fsBtn.addEventListener('click', alternarTelaCheia);
  }
  document.addEventListener('fullscreenchange', aoMudarTelaCheia);
  document.addEventListener('webkitfullscreenchange', aoMudarTelaCheia);
  modalEl.addEventListener('hidden.bs.modal', function () {
    if (fsAtual()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
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
    else if (e.key === 'f' || e.key === 'F') alternarTelaCheia();
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
document.addEventListener("DOMContentLoaded", function () {
  const container = document.getElementById('dlItems');
  if (!container) return;

  // Todos os arquivos são gerados no navegador a partir dos dados já carregados
  // (dados/*.js). Não é preciso criar nem hospedar arquivos extras.
  // Bibliotecas auxiliares só são baixadas quando o formato é usado.
  const CDN = {
    jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    sql:   'https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/sql-wasm.js',
    sqlDir:'https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/'
  };

  const FORMATOS = {
    geojson: { nome: 'GeoJSON',    desc: 'Web, QGIS e Leaflet',                    icone: 'ph-file-code' },
    shp:     { nome: 'Shapefile',  desc: 'ZIP com .shp, .shx, .dbf, .prj e .cpg',  icone: 'ph-file-zip'  },
    gpkg:    { nome: 'GeoPackage', desc: 'Arquivo único, padrão aberto OGC',       icone: 'ph-database'  },
    csv:     { nome: 'CSV',        desc: 'Tabela de atributos (separador ;)',      icone: 'ph-file-csv'  }
  };

  // `dados` devolve o GeoJSON já carregado pelos arquivos dados/*.js
  // `crs` é o sistema de referência real dos dados (usado no .prj e no GeoPackage)
  const CAMADAS = [
    {
      id: 'municipios', titulo: 'Limites Municipais da Paraíba',
      desc: 'Divisão territorial oficial dos 223 municípios com código IBGE.',
      fonte: 'IBGE (2023)', icone: 'ph-map-pin', cor: 'primary', crs: 'EPSG:4326',
      dados: function () { return typeof municipios !== 'undefined' ? municipios : null; }
    },
    {
      id: 'bacias', titulo: 'Bacias Hidrográficas',
      desc: 'Polígonos das bacias e sub-bacias hidrográficas estaduais.',
      fonte: 'AESA (2022)', icone: 'ph-polygon', cor: 'success', crs: 'EPSG:4326',
      dados: function () { return typeof bacias !== 'undefined' ? bacias : null; }
    },
    {
      id: 'acudes', titulo: 'Açudes e Reservatórios',
      desc: "Localização e capacidade de acumulação dos corpos d'água.",
      fonte: 'AESA / ANA', icone: 'ph-drop', cor: 'info', crs: 'EPSG:4326',
      dados: function () { return typeof acudes !== 'undefined' ? acudes : null; }
    },
    {
      id: 'pocos', titulo: 'Poços',
      desc: 'Poços cadastrados com proprietário, órgão, profundidade, vazão e equipamento.',
      fonte: '', icone: 'ph-drop-half-bottom', cor: 'amber', crs: 'EPSG:4326', // preencha "fonte" com a origem dos dados
      dados: function () { return typeof pocos !== 'undefined' ? pocos : null; }
    },
    {
      id: 'rios', titulo: 'Rede Hidrográfica (Rios)',
      desc: "Eixos e cursos d'água dos rios principais e afluentes.",
      fonte: 'AESA / CPRM', icone: 'ph-waves', cor: 'primary', crs: 'EPSG:4326',
      dados: function () { return typeof rios !== 'undefined' ? rios : null; }
    }
  ];

  // Definições dos sistemas de referência suportados (.prj do Shapefile e GeoPackage)
  const SRS = {
    4326: {
      nome: 'WGS 84',
      prj: 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
      wkt: 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]'
    },
    4674: {
      nome: 'SIRGAS 2000',
      prj: 'GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
      wkt: 'GEOGCS["SIRGAS 2000",DATUM["Sistema_de_Referencia_Geocentrico_para_las_AmericaS_2000",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],TOWGS84[0,0,0,0,0,0,0],AUTHORITY["EPSG","6674"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4674"]]'
    }
  };

  // ---------- utilitários ----------
  const enc = new TextEncoder();

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function epsgDe(camada) {
    const n = Number(String(camada.crs).split(':')[1]);
    return SRS[n] ? n : 4326;
  }

  function geometria(dados) {
    const f = dados && dados.features && dados.features.find(function (x) { return x.geometry; });
    const t = f && f.geometry.type;
    if (!t) return null;
    if (t.indexOf('Polygon') >= 0) return { rotulo: 'Polígonos', icone: 'ph-polygon' };
    if (t.indexOf('Line') >= 0)    return { rotulo: 'Linhas',    icone: 'ph-line-segment' };
    if (t.indexOf('Point') >= 0)   return { rotulo: 'Pontos',    icone: 'ph-dots-three' };
    return null;
  }

  function carregarScript(url) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Não foi possível carregar uma biblioteca necessária. Verifique a conexão com a internet.')); };
      document.head.appendChild(s);
    });
  }

  function garantirJSZip() {
    if (window.JSZip) return Promise.resolve();
    return carregarScript(CDN.jszip);
  }

  function garantirSql() {
    if (window.initSqlJs) return Promise.resolve();
    return carregarScript(CDN.sql);
  }

  function salvarBlob(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function pausa() { return new Promise(function (r) { setTimeout(r, 0); }); }

  // ---------- atributos ----------
  function chavesDe(features) {
    const ordem = [], vistas = {};
    features.forEach(function (f) {
      Object.keys(f.properties || {}).forEach(function (k) {
        if (!vistas[k]) { vistas[k] = true; ordem.push(k); }
      });
    });
    return ordem;
  }

  function valorTexto(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  // ---------- CSV ----------
  function gerarCsv(features) {
    const chaves = chavesDe(features);
    const celula = function (v) {
      const t = valorTexto(v);
      return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const linhas = [chaves.map(celula).join(';')];
    features.forEach(function (f) {
      linhas.push(chaves.map(function (k) { return celula((f.properties || {})[k]); }).join(';'));
    });
    return '\ufeff' + linhas.join('\r\n') + '\r\n'; // BOM: o Excel reconhece os acentos
  }

  // ---------- Shapefile ----------
  function familiaDe(features) {
    let fam = null;
    for (let i = 0; i < features.length; i++) {
      const g = features[i].geometry;
      if (!g) continue;
      let f = null;
      if (g.type.indexOf('Polygon') >= 0) f = 'polygon';
      else if (g.type.indexOf('LineString') >= 0) f = 'line';
      else if (g.type === 'MultiPoint') f = 'multipoint';
      else if (g.type === 'Point') f = 'point';
      if (!f) continue;
      if (!fam) fam = f;
      else if (fam === 'point' && f === 'multipoint') fam = 'multipoint';
    }
    return fam;
  }

  // área com sinal: > 0 = sentido horário
  function sentidoHorario(anel) {
    let s = 0;
    for (let i = 0; i < anel.length - 1; i++) s += (anel[i + 1][0] - anel[i][0]) * (anel[i + 1][1] + anel[i][1]);
    return s > 0;
  }

  // Shapefile: anel externo horário, furos anti-horários
  function orientar(anel, externo) {
    return sentidoHorario(anel) === externo ? anel : anel.slice().reverse();
  }

  function partesShp(geom, fam) {
    if (!geom) return null;
    const t = geom.type, c = geom.coordinates;
    if (fam === 'polygon') {
      const polys = t === 'Polygon' ? [c] : (t === 'MultiPolygon' ? c : null);
      if (!polys) return null;
      const aneis = [];
      polys.forEach(function (p) { p.forEach(function (r, i) { aneis.push(orientar(r, i === 0)); }); });
      return aneis;
    }
    if (fam === 'line') return t === 'LineString' ? [c] : (t === 'MultiLineString' ? c : null);
    if (fam === 'point') return t === 'Point' ? [c] : null;
    if (fam === 'multipoint') return t === 'Point' ? [c] : (t === 'MultiPoint' ? c : null);
    return null;
  }

  function gerarShp(features, fam) {
    const TIPO = { polygon: 5, line: 3, point: 1, multipoint: 8 }[fam];
    const registros = features.map(function (f) { return partesShp(f.geometry, fam); });

    const nPts = function (partes) {
      if (fam === 'multipoint') return partes.length;
      return partes.reduce(function (s, p) { return s + p.length; }, 0);
    };
    const tamConteudo = function (partes) {
      if (!partes) return 4;
      if (fam === 'point') return 20;
      if (fam === 'multipoint') return 4 + 32 + 4 + 16 * nPts(partes);
      return 4 + 32 + 4 + 4 + 4 * partes.length + 16 * nPts(partes);
    };

    let total = 100;
    registros.forEach(function (p) { total += 8 + tamConteudo(p); });
    const shp = new DataView(new ArrayBuffer(total));
    const shx = new DataView(new ArrayBuffer(100 + 8 * registros.length));

    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    const alcance = function (x, y) {
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    };

    let o = 100;
    registros.forEach(function (partes, i) {
      const conteudo = tamConteudo(partes);
      shx.setInt32(100 + 8 * i, o / 2, false);
      shx.setInt32(100 + 8 * i + 4, conteudo / 2, false);
      shp.setInt32(o, i + 1, false);
      shp.setInt32(o + 4, conteudo / 2, false);
      o += 8;

      if (!partes) { shp.setInt32(o, 0, true); o += 4; return; }
      shp.setInt32(o, TIPO, true);

      if (fam === 'point') {
        shp.setFloat64(o + 4, partes[0][0], true);
        shp.setFloat64(o + 12, partes[0][1], true);
        alcance(partes[0][0], partes[0][1]);
        o += 20;
        return;
      }

      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      const todos = fam === 'multipoint' ? partes : [].concat.apply([], partes);
      todos.forEach(function (p) {
        if (p[0] < bx0) bx0 = p[0]; if (p[0] > bx1) bx1 = p[0];
        if (p[1] < by0) by0 = p[1]; if (p[1] > by1) by1 = p[1];
        alcance(p[0], p[1]);
      });
      shp.setFloat64(o + 4, bx0, true);
      shp.setFloat64(o + 12, by0, true);
      shp.setFloat64(o + 20, bx1, true);
      shp.setFloat64(o + 28, by1, true);
      let p = o + 36;
      if (fam === 'multipoint') {
        shp.setInt32(p, partes.length, true); p += 4;
      } else {
        shp.setInt32(p, partes.length, true);
        shp.setInt32(p + 4, todos.length, true);
        p += 8;
        let ini = 0;
        partes.forEach(function (parte) { shp.setInt32(p, ini, true); p += 4; ini += parte.length; });
      }
      todos.forEach(function (pt) { shp.setFloat64(p, pt[0], true); shp.setFloat64(p + 8, pt[1], true); p += 16; });
      o += conteudo;
    });

    if (xmin === Infinity) { xmin = ymin = xmax = ymax = 0; }
    [[shp, total], [shx, 100 + 8 * registros.length]].forEach(function (par) {
      const dv = par[0];
      dv.setInt32(0, 9994, false);
      dv.setInt32(24, par[1] / 2, false);
      dv.setInt32(28, 1000, true);
      dv.setInt32(32, TIPO, true);
      dv.setFloat64(36, xmin, true);
      dv.setFloat64(44, ymin, true);
      dv.setFloat64(52, xmax, true);
      dv.setFloat64(60, ymax, true);
    });

    return { shp: new Uint8Array(shp.buffer), shx: new Uint8Array(shx.buffer) };
  }

  function cortarBytes(texto, max) {
    let s = texto;
    while (enc.encode(s).length > max) s = s.slice(0, -1);
    return s;
  }

  function gerarDbf(features) {
    const chaves = chavesDe(features);

    // nomes de campo: ASCII, até 10 caracteres, únicos
    const usados = {};
    const campos = chaves.map(function (k) {
      let base = k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'CAMPO';
      let nome = base, n = 1;
      while (usados[nome.toUpperCase()]) { n++; nome = base.slice(0, 10 - String(n).length) + n; }
      usados[nome.toUpperCase()] = true;

      const valores = features.map(function (f) { return (f.properties || {})[k]; });
      const presentes = valores.filter(function (v) { return v !== null && v !== undefined && v !== ''; });
      const numerico = presentes.length > 0 && presentes.every(function (v) { return typeof v === 'number' && isFinite(v); });

      if (numerico) {
        let dec = 0;
        presentes.forEach(function (v) { const d = (String(v).split('.')[1] || '').replace(/e.*/i, '').length; if (d > dec) dec = Math.min(d, 10); });
        let larg = 1;
        presentes.forEach(function (v) { larg = Math.max(larg, v.toFixed(dec).length); });
        if (larg <= 19) return { chave: k, nome: nome, tipo: 'N', larg: larg, dec: dec };
      }
      let larg = 1;
      valores.forEach(function (v) { larg = Math.max(larg, enc.encode(valorTexto(v)).length); });
      return { chave: k, nome: nome, tipo: 'C', larg: Math.min(larg, 254), dec: 0 };
    });

    const tamReg = 1 + campos.reduce(function (s, c) { return s + c.larg; }, 0);
    const tamCab = 32 + 32 * campos.length + 1;
    const buf = new Uint8Array(tamCab + tamReg * features.length + 1);
    const dv = new DataView(buf.buffer);
    const hoje = new Date();
    buf[0] = 0x03; buf[1] = hoje.getFullYear() - 1900; buf[2] = hoje.getMonth() + 1; buf[3] = hoje.getDate();
    dv.setUint32(4, features.length, true);
    dv.setUint16(8, tamCab, true);
    dv.setUint16(10, tamReg, true);

    campos.forEach(function (c, i) {
      const p = 32 + 32 * i;
      for (let j = 0; j < c.nome.length; j++) buf[p + j] = c.nome.charCodeAt(j);
      buf[p + 11] = c.tipo.charCodeAt(0);
      buf[p + 16] = c.larg;
      buf[p + 17] = c.dec;
    });
    buf[32 + 32 * campos.length] = 0x0D;

    features.forEach(function (f, r) {
      let p = tamCab + r * tamReg;
      buf[p++] = 0x20;
      campos.forEach(function (c) {
        const v = (f.properties || {})[c.chave];
        const vazio = v === null || v === undefined || v === '';
        let bytes;
        if (c.tipo === 'N') {
          const t = vazio ? '' : v.toFixed(c.dec);
          bytes = enc.encode(t.padStart(c.larg, ' '));
        } else {
          const b = enc.encode(cortarBytes(valorTexto(v), c.larg));
          bytes = new Uint8Array(c.larg).fill(0x20);
          bytes.set(b, 0);
        }
        buf.set(bytes.subarray(0, c.larg), p);
        p += c.larg;
      });
    });
    buf[buf.length - 1] = 0x1A;
    return buf;
  }

  // devolve a lista de arquivos do Shapefile (sem compactar)
  function arquivosShapefile(camada, features) {
    const fam = familiaDe(features);
    if (!fam) throw new Error('A camada não tem geometrias para exportar.');
    const srs = SRS[epsgDe(camada)];
    const g = gerarShp(features, fam);
    return [
      { nome: camada.id + '.shp', dados: g.shp },
      { nome: camada.id + '.shx', dados: g.shx },
      { nome: camada.id + '.dbf', dados: gerarDbf(features) },
      { nome: camada.id + '.prj', dados: enc.encode(srs.prj) },
      { nome: camada.id + '.cpg', dados: enc.encode('UTF-8') }
    ];
  }

  // ---------- GeoPackage ----------
  function alvoGpkg(fam) {
    return { polygon: 'MULTIPOLYGON', line: 'MULTILINESTRING', point: 'POINT', multipoint: 'MULTIPOINT' }[fam];
  }

  // converte a geometria para o tipo único da tabela
  function normalizarGeom(geom, alvo) {
    if (!geom) return null;
    const t = geom.type, c = geom.coordinates;
    if (alvo === 'MULTIPOLYGON') return t === 'Polygon' ? [c] : (t === 'MultiPolygon' ? c : null);
    if (alvo === 'MULTILINESTRING') return t === 'LineString' ? [c] : (t === 'MultiLineString' ? c : null);
    if (alvo === 'MULTIPOINT') return t === 'Point' ? [c] : (t === 'MultiPoint' ? c : null);
    if (alvo === 'POINT') return t === 'Point' ? c : null;
    return null;
  }

  function wkbTamanho(g, alvo) {
    if (alvo === 'POINT') return 21;
    if (alvo === 'MULTIPOINT') return 9 + 21 * g.length;
    if (alvo === 'MULTILINESTRING') return 9 + g.reduce(function (s, l) { return s + 9 + 16 * l.length; }, 0);
    return 9 + g.reduce(function (s, p) {
      return s + 9 + p.reduce(function (a, r) { return a + 4 + 16 * r.length; }, 0);
    }, 0);
  }

  function blobGpkg(g, alvo, srsId) {
    const flat = alvo === 'POINT' ? [g] : (alvo === 'MULTIPOINT' ? g :
      (alvo === 'MULTILINESTRING' ? [].concat.apply([], g) : [].concat.apply([], [].concat.apply([], g))));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    flat.forEach(function (p) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    });

    const buf = new Uint8Array(8 + 32 + wkbTamanho(g, alvo));
    const dv = new DataView(buf.buffer);
    buf[0] = 0x47; buf[1] = 0x50; buf[2] = 0; buf[3] = 0x03; // 'GP', versão 0, little-endian + envelope XY
    dv.setInt32(4, srsId, true);
    dv.setFloat64(8, x0, true); dv.setFloat64(16, x1, true);
    dv.setFloat64(24, y0, true); dv.setFloat64(32, y1, true);

    let o = 40;
    const cab = function (tipo) { dv.setUint8(o, 1); dv.setUint32(o + 1, tipo, true); o += 5; };
    const pt = function (p) { dv.setFloat64(o, p[0], true); dv.setFloat64(o + 8, p[1], true); o += 16; };
    const linha = function (pts) { dv.setUint32(o, pts.length, true); o += 4; pts.forEach(pt); };

    if (alvo === 'POINT') { cab(1); pt(g); }
    else if (alvo === 'MULTIPOINT') { cab(4); dv.setUint32(o, g.length, true); o += 4; g.forEach(function (p) { cab(1); pt(p); }); }
    else if (alvo === 'MULTILINESTRING') { cab(5); dv.setUint32(o, g.length, true); o += 4; g.forEach(function (l) { cab(2); linha(l); }); }
    else {
      cab(6); dv.setUint32(o, g.length, true); o += 4;
      g.forEach(function (poli) {
        cab(3); dv.setUint32(o, poli.length, true); o += 4;
        poli.forEach(linha);
      });
    }
    return { blob: buf, x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function aspas(nome) { return '"' + String(nome).replace(/"/g, '""') + '"'; }

  async function gerarGpkg(camada, features) {
    const fam = familiaDe(features);
    if (!fam) throw new Error('A camada não tem geometrias para exportar.');
    await garantirSql();
    const SQL = await window.initSqlJs({ locateFile: function (f) { return CDN.sqlDir + f; } });

    const alvo = alvoGpkg(fam);
    const srsId = epsgDe(camada);
    const srs = SRS[srsId];
    const tabela = camada.id;

    // colunas de atributo
    const usados = { fid: true, geom: true };
    const cols = chavesDe(features).map(function (k) {
      let nome = k, n = 1;
      while (usados[nome.toLowerCase()]) { n++; nome = k + '_' + n; }
      usados[nome.toLowerCase()] = true;
      const vals = features.map(function (f) { return (f.properties || {})[k]; }).filter(function (v) { return v !== null && v !== undefined && v !== ''; });
      let tipo = 'TEXT';
      if (vals.length && vals.every(function (v) { return typeof v === 'number' && isFinite(v); })) {
        tipo = vals.every(Number.isInteger) ? 'INTEGER' : 'REAL';
      } else if (vals.length && vals.every(function (v) { return typeof v === 'boolean'; })) {
        tipo = 'BOOLEAN';
      }
      return { chave: k, nome: nome, tipo: tipo };
    });

    const db = new SQL.Database();
    db.run('PRAGMA application_id = 1196444487; PRAGMA user_version = 10300;');
    db.run('CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);');
    db.run("INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system');");
    db.run("INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system');");
    db.run('INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?);', [srs.nome, srsId, 'EPSG', srsId, srs.wkt, null]);

    db.run("CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER, CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));");
    db.run('CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name), CONSTRAINT uk_gc_table_name UNIQUE (table_name), CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name), CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id));');

    db.run('CREATE TABLE ' + aspas(tabela) + ' (fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, geom ' + alvo + cols.map(function (c) { return ', ' + aspas(c.nome) + ' ' + c.tipo; }).join('') + ');');

    const stmt = db.prepare('INSERT INTO ' + aspas(tabela) + ' (geom' + cols.map(function (c) { return ', ' + aspas(c.nome); }).join('') + ') VALUES (?' + cols.map(function () { return ', ?'; }).join('') + ');');
    let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
    db.run('BEGIN;');
    features.forEach(function (f) {
      const g = normalizarGeom(f.geometry, alvo);
      let blob = null;
      if (g && (alvo === 'POINT' || g.length)) {
        const r = blobGpkg(g, alvo, srsId);
        blob = r.blob;
        if (r.x0 < X0) X0 = r.x0; if (r.y0 < Y0) Y0 = r.y0;
        if (r.x1 > X1) X1 = r.x1; if (r.y1 > Y1) Y1 = r.y1;
      }
      const vals = cols.map(function (c) {
        const v = (f.properties || {})[c.chave];
        if (v === null || v === undefined || v === '') return null;
        if (c.tipo === 'BOOLEAN') return v ? 1 : 0;
        if (c.tipo === 'TEXT') return valorTexto(v);
        return v;
      });
      stmt.run([blob].concat(vals));
    });
    db.run('COMMIT;');
    stmt.free();

    if (X0 === Infinity) { X0 = Y0 = X1 = Y1 = 0; }
    db.run("INSERT INTO gpkg_contents (table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id) VALUES (?, 'features', ?, ?, ?, ?, ?, ?, ?);",
      [tabela, tabela, camada.titulo, X0, Y0, X1, Y1, srsId]);
    db.run("INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', ?, ?, 0, 0);", [tabela, alvo, srsId]);

    const bytes = db.export();
    db.close();
    return bytes;
  }

  // ---------- geração por formato ----------
  function featuresDe(camada) {
    const d = camada.dados();
    if (!d || !d.features || !d.features.length) throw new Error('Os dados de "' + camada.titulo + '" não foram carregados.');
    return d.features;
  }

  // lista de arquivos de uma camada em um formato: [{ nome, dados }]
  async function arquivosDe(camada, fmt) {
    const features = featuresDe(camada);
    if (fmt === 'geojson') return [{ nome: camada.id + '.geojson', dados: enc.encode(JSON.stringify(camada.dados())) }];
    if (fmt === 'csv')     return [{ nome: camada.id + '.csv', dados: enc.encode(gerarCsv(features)) }];
    if (fmt === 'shp')     return arquivosShapefile(camada, features);
    if (fmt === 'gpkg')    return [{ nome: camada.id + '.gpkg', dados: await gerarGpkg(camada, features) }];
    throw new Error('Formato desconhecido.');
  }

  async function baixarFormato(camada, fmt) {
    const arquivos = await arquivosDe(camada, fmt);
    if (fmt === 'shp') {
      await garantirJSZip();
      const zip = new window.JSZip();
      arquivos.forEach(function (a) { zip.file(a.nome, a.dados); });
      const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      salvarBlob(new Blob([bytes], { type: 'application/zip' }), camada.id + '_shapefile.zip');
      return;
    }
    const tipos = { geojson: 'application/geo+json', csv: 'text/csv;charset=utf-8', gpkg: 'application/geopackage+sqlite3' };
    salvarBlob(new Blob([arquivos[0].dados], { type: tipos[fmt] }), arquivos[0].nome);
  }

  async function baixarTudo(progresso) {
    await garantirJSZip();
    const zip = new window.JSZip();
    const leia = ['GeoPortal - pacote de camadas', '', 'Conteúdo (uma pasta por camada):'];
    const formatos = ['geojson', 'shp', 'gpkg', 'csv'];
    for (let i = 0; i < CAMADAS.length; i++) {
      const c = CAMADAS[i];
      const pasta = zip.folder(c.id);
      for (let j = 0; j < formatos.length; j++) {
        progresso(c.titulo + ' · ' + FORMATOS[formatos[j]].nome, i * formatos.length + j, CAMADAS.length * formatos.length);
        await pausa();
        const arqs = await arquivosDe(c, formatos[j]);
        const alvo = formatos[j] === 'shp' ? pasta.folder('shapefile') : pasta;
        arqs.forEach(function (a) { alvo.file(a.nome, a.dados); });
      }
      leia.push('- ' + c.id + ': ' + c.titulo + (c.fonte ? ' | fonte: ' + c.fonte : '') + ' | ' + c.crs);
    }
    leia.push('', 'Formatos: GeoJSON, Shapefile (pasta shapefile/), GeoPackage e CSV (separador ;, UTF-8).');
    zip.file('LEIA-ME.txt', leia.join('\r\n'));
    progresso('Compactando…', 1, 1);
    await pausa();
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    salvarBlob(new Blob([bytes], { type: 'application/zip' }), 'geoportal-todas-camadas.zip');
  }

  // ---------- interface ----------
  const status = document.createElement('div');
  status.className = 'dl-status';
  status.setAttribute('aria-live', 'polite');
  container.parentNode.appendChild(status);

  let ocupado = false;
  function mostrar(msg, erro) {
    status.className = 'dl-status' + (erro ? ' text-danger' : '') + (msg ? ' visible' : '');
    status.textContent = msg || '';
  }

  async function executar(rotulo, tarefa, botoes) {
    if (ocupado) return;
    ocupado = true;
    botoes.forEach(function (b) { b.classList.add('disabled'); b.setAttribute('aria-disabled', 'true'); });
    mostrar('Gerando ' + rotulo + '…');
    await pausa();
    try {
      await tarefa();
      mostrar('');
    } catch (e) {
      console.error(e);
      mostrar('Não foi possível gerar ' + rotulo + ': ' + (e && e.message ? e.message : e), true);
    } finally {
      ocupado = false;
      botoes.forEach(function (b) { b.classList.remove('disabled'); b.removeAttribute('aria-disabled'); });
    }
  }

  CAMADAS.forEach(function (c) {
    const dados = c.dados();
    const geo = geometria(dados);
    const n = dados && dados.features ? dados.features.length : null;

    let chips = '';
    if (geo) chips += '<span class="dl-chip"><i class="ph ' + geo.icone + '"></i>' + geo.rotulo + '</span>';
    if (n !== null) chips += '<span class="dl-chip"><i class="ph ph-list-numbers"></i>' + n.toLocaleString('pt-BR') + (n === 1 ? ' feição' : ' feições') + '</span>';
    chips += '<span class="dl-chip"><i class="ph ph-globe-hemisphere-west"></i>' + esc(c.crs) + '</span>';

    let itens = '';
    Object.keys(FORMATOS).forEach(function (fmt) {
      const f = FORMATOS[fmt];
      itens += '<li><button type="button" class="dropdown-item dl-format" data-fmt="' + fmt + '">' +
        '<i class="ph ' + f.icone + '"></i>' +
        '<span class="dl-format-text"><strong>' + f.nome + '</strong><small>' + f.desc + '</small></span></button></li>';
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
          (c.fonte ? '<small class="text-muted">Fonte: ' + esc(c.fonte) + '</small>' : '') +
        '</div>' +
      '</div>' +
      '<div class="dl-action"><div class="dropdown">' +
        '<button class="btn btn-primary btn-sm dropdown-toggle d-inline-flex align-items-center justify-content-center gap-1" type="button" data-bs-toggle="dropdown" aria-expanded="false"' + (n ? '' : ' disabled') + '>' +
          '<i class="ph ph-download-simple"></i> Baixar</button>' +
        '<ul class="dropdown-menu dropdown-menu-end shadow-sm">' + itens + '</ul>' +
      '</div></div>';
    container.appendChild(row);

    row.querySelectorAll('.dl-format').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const fmt = btn.dataset.fmt;
        executar(FORMATOS[fmt].nome + ' de ' + c.titulo, function () { return baixarFormato(c, fmt); }, [btn]);
      });
    });
  });

  // ---------- baixar tudo ----------
  const btnTudo = document.getElementById('btnBaixarTudo');
  if (btnTudo) {
    const rotuloOriginal = btnTudo.innerHTML;
    btnTudo.addEventListener('click', function () {
      if (ocupado) return;
      btnTudo.disabled = true;
      const fim = function () { btnTudo.disabled = false; btnTudo.innerHTML = rotuloOriginal; };
      executar('o pacote com todas as camadas', function () {
        return baixarTudo(function (txt, i, total) {
          btnTudo.innerHTML = '<span class="spinner-border spinner-border-sm"></span> ' + Math.round((i / total) * 100) + '%';
          mostrar('Gerando ' + txt + '…');
        });
      }, [btnTudo]).then(fim, fim);
    });
  }
});