document.addEventListener("DOMContentLoaded", function () {
  const mapElement = document.getElementById("map");

  if (mapElement) {
    // -------------------------------------------------------------
    // 1. BASEMAPS (OSM, Google Satélite e CartoDB Dark)
    // -------------------------------------------------------------
    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    });

    const googleSat = L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      attribution: '&copy; Google Maps'
    });

    const cartoDark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution: '&copy; CartoDB'
    });

    // Inicializa o mapa
    const map = L.map("map", {
      center: [-7.12, -36.72],
      zoom: 8,
      layers: [osm]
    });

    // Barra de Escala
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

    // -------------------------------------------------------------
    // 2. CRIAÇÃO DOS PANES (Hierarquia)
    // -------------------------------------------------------------
    map.createPane("municipiosPane");
    map.getPane("municipiosPane").style.zIndex = 400;

    map.createPane("baciasPane");
    map.getPane("baciasPane").style.zIndex = 450;

    map.createPane("riosPane");
    map.getPane("riosPane").style.zIndex = 500;

    map.createPane("acudesPane");
    map.getPane("acudesPane").style.zIndex = 550;

    // Grupos de Camadas
    const layerMunicipios = L.layerGroup();
    const layerAcudes = L.layerGroup();
    const layerBacias = L.layerGroup();
    const layerRios = L.layerGroup();

    let geojsonMunicipios = null;
    let geojsonBacias = null;
    let geojsonRios = null;
    let geojsonAcudes = null;

    // Variável para armazenar a opacidade dinâmica dos municípios
    let currentMunicipiosOpacity = 0.15;

    // -------------------------------------------------------------
    // 3. CAMADA DE MUNICÍPIOS
    // -------------------------------------------------------------
    if (typeof municipios !== "undefined") {
      const municipioStyle = {
        color: "#475569",
        weight: 1,
        opacity: 0.7,
        fillColor: "#64748b",
        fillOpacity: currentMunicipiosOpacity
      };

      geojsonMunicipios = L.geoJSON(municipios, {
        pane: "municipiosPane",
        style: municipioStyle,
        onEachFeature: function (feature, layer) {
          if (feature.properties && feature.properties.NM_MUN) {
            layer.bindPopup("<strong>Município:</strong> " + feature.properties.NM_MUN);
          }
          layer.on({
            mouseover: function (e) {
              e.target.setStyle({ 
                weight: 2, 
                color: "#0f172a", 
                fillOpacity: Math.min(currentMunicipiosOpacity + 0.2, 1) 
              });
              e.target.bringToFront();
            },
            mouseout: function (e) {
              e.target.setStyle({
                color: "#475569",
                weight: 1,
                opacity: 0.7,
                fillColor: "#64748b",
                fillOpacity: currentMunicipiosOpacity
              });
            }
          });
        }
      });

      geojsonMunicipios.addTo(layerMunicipios);
      layerMunicipios.addTo(map);

      // Busca de Municípios
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
        style: { color: "#0284c7", weight: 1, fillOpacity: 0.6 },
        onEachFeature: function (feature, layer) {
          const nome = feature.properties ? (feature.properties.Nome || feature.properties.NOME) : null;
          if (nome) layer.bindPopup("<strong>Açude:</strong> " + nome);
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
          if (feature.properties && feature.properties.Nome) {
            layer.bindPopup("<strong>Bacia Hidrográfica:</strong> " + feature.properties.Nome);
          }
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
        style: { color: "#0284c7", weight: 2, opacity: 0.8 }
      });
      geojsonRios.addTo(layerRios);
    }

    // Controle de Camadas
    const baseMaps = {
      "OpenStreetMap": osm,
      "Google Satélite": googleSat,
      "CartoDB Escuro": cartoDark
    };

    const overlayMaps = {
      "Municípios": layerMunicipios,
      "Açudes": layerAcudes,
      "Bacias Hidrográficas": layerBacias,
      "Rios": layerRios
    };

    L.control.layers(baseMaps, overlayMaps, { collapsed: true }).addTo(map);

    // -------------------------------------------------------------
    // 7. GEOLOCALIZAÇÃO DO UTILIZADOR
    // -------------------------------------------------------------
    let userLocationMarker = null;

    const locateControl = L.control({ position: 'topleft' });
    locateControl.onAdd = function () {
      const btn = L.DomUtil.create('button', 'leaflet-bar btn btn-light btn-sm p-1 shadow-sm');
      btn.style.width = '34px';
      btn.style.height = '34px';
      btn.style.cursor = 'pointer';
      btn.title = "Minha Localização";
      btn.innerHTML = '<i class="ph ph-crosshair fs-5 text-dark"></i>';

      btn.onclick = function (e) {
        e.preventDefault();
        map.locate({ setView: true, maxZoom: 13 });
      };
      return btn;
    };
    locateControl.addTo(map);

    map.on('locationfound', function (e) {
      if (userLocationMarker) map.removeLayer(userLocationMarker);

      userLocationMarker = L.circleMarker(e.latlng, {
        radius: 8,
        fillColor: '#2563eb',
        color: '#ffffff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.9
      }).addTo(map);

      userLocationMarker.bindPopup("<b>Você está aqui!</b>").openPopup();
    });

    map.on('locationerror', function () {
      alert("Não foi possível acessar a sua localização.");
    });

    // -------------------------------------------------------------
    // 8. LEGENDA DINÂMICA
    // -------------------------------------------------------------
    const legend = L.control({ position: 'bottomright' });

    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'legend-control');
      div.id = 'dynamicLegend';
      return div;
    };
    legend.addTo(map);

    function updateLegend() {
      const div = document.getElementById('dynamicLegend');
      if (!div) return;

      let html = '<strong class="d-block mb-1">Legenda</strong>';
      let hasLayer = false;

      if (map.hasLayer(layerMunicipios)) {
        html += '<div class="legend-item"><span class="legend-color" style="background:#64748b; border:1px solid #475569;"></span> Municípios</div>';
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
        html += '<div class="legend-item mt-1"><span class="legend-color" style="background:#0284c7; height:3px;"></span> Rios</div>';
        hasLayer = true;
      }

      if (map.hasLayer(layerAcudes)) {
        html += '<div class="legend-item"><span class="legend-color" style="background:#0284c7; border-radius:50%;"></span> Açudes</div>';
        hasLayer = true;
      }

      div.style.display = hasLayer ? 'block' : 'none';
      div.innerHTML = html;
    }

    map.on('overlayadd overlayremove', updateLegend);
    updateLegend();

    // -------------------------------------------------------------
    // 9. CONTROLE DE OPACIDADE DAS CAMADAS (Retrátil)
    // -------------------------------------------------------------
    const opacityControl = L.control({ position: 'topleft' });

    opacityControl.onAdd = function () {
      const container = L.DomUtil.create('div', 'leaflet-control-opacity leaflet-bar');
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      container.innerHTML = `
        <a class="leaflet-control-opacity-toggle" id="opacityToggle" title="Ajustar Opacidade">
          <i class="ph ph-sliders-horizontal fs-5"></i>
        </a>

        <div class="opacity-control-panel">
          <div class="fw-bold mb-2 text-dark d-flex align-items-center justify-content-between">
            <span class="d-flex align-items-center gap-1">
              <i class="ph ph-sliders-horizontal text-primary"></i> Opacidade
            </span>
            <i class="ph ph-x text-muted fs-6" id="opacityCloseBtn" style="cursor:pointer;" title="Fechar"></i>
          </div>

          <div class="opacity-slider-group">
            <div class="opacity-slider-label">
              <span>Municípios</span>
              <span id="valMunicipios">15%</span>
            </div>
            <input type="range" id="sliderMunicipios" class="opacity-slider-input" min="0" max="100" value="15">
          </div>

          <div class="opacity-slider-group">
            <div class="opacity-slider-label">
              <span>Bacias</span>
              <span id="valBacias">45%</span>
            </div>
            <input type="range" id="sliderBacias" class="opacity-slider-input" min="0" max="100" value="45">
          </div>

          <div class="opacity-slider-group">
            <div class="opacity-slider-label">
              <span>Açudes</span>
              <span id="valAcudes">60%</span>
            </div>
            <input type="range" id="sliderAcudes" class="opacity-slider-input" min="0" max="100" value="60">
          </div>
        </div>
      `;

      L.DomEvent.on(container, 'mouseenter', function () {
        L.DomUtil.addClass(container, 'expanded');
      });

      L.DomEvent.on(container, 'mouseleave', function () {
        L.DomUtil.removeClass(container, 'expanded');
      });

      return container;
    };

    opacityControl.addTo(map);

    // Eventos dos Sliders de Opacidade
    setTimeout(() => {
      const toggleBtn = document.getElementById("opacityToggle");
      const closeBtn = document.getElementById("opacityCloseBtn");
      const container = document.querySelector(".leaflet-control-opacity");

      if (toggleBtn && container) {
        toggleBtn.addEventListener("click", () => L.DomUtil.addClass(container, "expanded"));
      }
      if (closeBtn && container) {
        closeBtn.addEventListener("click", () => L.DomUtil.removeClass(container, "expanded"));
      }

      // 1. Slider Municípios
      const sliderMun = document.getElementById("sliderMunicipios");
      if (sliderMun && geojsonMunicipios) {
        sliderMun.addEventListener("input", function (e) {
          const val = e.target.value / 100;
          currentMunicipiosOpacity = val;
          document.getElementById("valMunicipios").innerText = e.target.value + "%";
          geojsonMunicipios.setStyle({ fillOpacity: val });
        });
      }

      // 2. Slider Bacias
      const sliderBac = document.getElementById("sliderBacias");
      if (sliderBac && geojsonBacias) {
        sliderBac.addEventListener("input", function (e) {
          const val = e.target.value / 100;
          document.getElementById("valBacias").innerText = e.target.value + "%";
          geojsonBacias.setStyle({ fillOpacity: val });
        });
      }

      // 3. Slider Açudes
      const sliderAcu = document.getElementById("sliderAcudes");
      if (sliderAcu && geojsonAcudes) {
        sliderAcu.addEventListener("input", function (e) {
          const val = e.target.value / 100;
          document.getElementById("valAcudes").innerText = e.target.value + "%";
          geojsonAcudes.setStyle({ fillOpacity: val });
        });
      }
    }, 200);
  }
});