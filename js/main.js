/*
 * GeoPortal — main.js
 * ---------------------------------------------------------------
 * Arquivo único, usado por todas as páginas. Cada página só ativa
 * a sua parte (veja "INICIALIZAÇÃO POR PÁGINA", no fim do arquivo).
 *
 * ÍNDICE
 *   0. UTILITÁRIOS COMPARTILHADOS
 *
 *   PÁGINA: MAPA (index.html) ........ iniciarMapa()
 *     1. FICHA TÉCNICA LATERAL (OFFCANVAS): CONSTANTES E CONFIGURAÇÃO
 *     2. NOMES AMIGÁVEIS DOS CAMPOS (tabela de atributos e ficha da feição)
 *     3. FICHA TÉCNICA LATERAL: OFFCANVAS, GEOMETRIA, DESTAQUE E showFeatureDetails
 *     4. MAPA E MAPAS DE FUNDO
 *     5. BARRA DE ESCALA E COORDENADAS (canto inferior esquerdo)
 *     6. BOTÕES DE FERRAMENTAS E PAINEL LATERAL DE CAMADAS
 *     7. FERRAMENTA DE MEDIÇÃO DE DISTÂNCIA (régua)
 *     8. PANES (ORDEM DE EMPILHAMENTO) E GRUPOS DE CAMADAS
 *     9. TABELA DE ATRIBUTOS: BUSCA, ORDENAÇÃO E EXPORTAÇÃO
 *     10. ESTADO COMPARTILHADO: TEMAS, FILTROS E LINK
 *     11. CAMADA: MUNICÍPIOS
 *     12. CAMADA: AÇUDES
 *     13. CAMADA: POÇOS (marcadores, agrupados quando há muitos juntos)
 *     14. CAMADA: BACIAS HIDROGRÁFICAS
 *     15. CAMADA: RIOS
 *     16. LEGENDA DINÂMICA
 *     17. LIGA/DESLIGA DAS CAMADAS
 *     18. OPACIDADE DAS CAMADAS
 *     19. INFOGRÁFICOS DA FICHA ("Em números")
 *     20. MAPAS TEMÁTICOS
 *     21. FILTROS NO MAPA
 *     22. LAYOUT: PROJEÇÕES E CONVERSÕES (Mercator da web e UTM)
 *     23. LAYOUT: MODELOS (leitura de .qpt do QGIS e modelo padrão do portal)
 *     24. LAYOUT: DESENHO (tudo em canvas, com o mapa na mesma vista da tela)
 *     25. COMPARTILHAR (link com o estado do mapa) E EXPORTAR (imagem / PDF / impressão)
 *     26. CONSULTA POR COORDENADAS
 *     27. GUIA DE PRIMEIRA VISITA ("Como usar")
 *
 *   PÁGINA: GALERIA (galeria.html) ... iniciarGaleria()
 *   PÁGINA: DOWNLOADS (downloads.html) iniciarDownloads()
 *   INICIALIZAÇÃO POR PÁGINA
 *
 * Dicas de manutenção
 *   - Nomes e formatos dos campos: seção 2 (objeto CAMPOS).
 *   - Cores e classes dos temas: seção 10 (constantes CLASSES_*).
 *   - Filtros disponíveis: seção 21 (objeto FILTROS).
 *   - Layout de impressão (.qpt do QGIS): seções 22 a 24.
 *   - Passos do guia de primeira visita: seção 27 (PASSOS_GUIA).
 *   - Formatos e camadas de download: início de iniciarDownloads().
 */

// =============================================================
// 0. UTILITÁRIOS COMPARTILHADOS (usados por mais de uma página)
// =============================================================

// protege textos que vão para innerHTML
function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// remove acentos: "São José" -> "Sao Jose"
function semAcentos(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// célula de CSV com separador ";" (aspas quando necessário)
function csvCelula(texto) {
  return /[;"\n\r]/.test(texto) ? '"' + texto.replace(/"/g, '""') + '"' : texto;
}

// baixa um Blob direto, sem abrir aba
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

// copia texto para a área de transferência (com plano B para páginas sem HTTPS)
function copiarTexto(text) {
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

// ícones (Phosphor) são só decoração: o texto ou o aria-label já diz o que o botão faz
function ocultarIconesDecorativos() {
  const marcar = function (raiz) {
    raiz.querySelectorAll('i[class*="ph-"], i.ph').forEach(function (i) {
      if (!i.hasAttribute('aria-hidden')) i.setAttribute('aria-hidden', 'true');
    });
  };
  marcar(document);
  new MutationObserver(function (mudancas) {
    mudancas.forEach(function (m) {
      // tiles, camadas e marcadores do mapa mudam o tempo todo e não têm ícones: ignora
      if (m.target.closest && m.target.closest('.leaflet-map-pane')) return;
      m.addedNodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        if (n.matches && n.matches('i[class*="ph-"], i.ph') && !n.hasAttribute('aria-hidden')) n.setAttribute('aria-hidden', 'true');
        if (n.querySelectorAll) marcar(n);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
}

// carrega uma biblioteca externa só quando for usada (JSZip, sql.js, jsPDF)
const scriptsExternos = {};
function carregarScriptExterno(url, nomeGlobal) {
  if (nomeGlobal && window[nomeGlobal]) return Promise.resolve();
  if (scriptsExternos[url]) return scriptsExternos[url];
  scriptsExternos[url] = new Promise(function (resolve, reject) {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = function () {
      delete scriptsExternos[url];
      reject(new Error('Não foi possível carregar uma biblioteca necessária. Verifique a conexão com a internet.'));
    };
    document.head.appendChild(s);
  });
  return scriptsExternos[url];
}

// =============================================================
// PÁGINA: MAPA (index.html)
// =============================================================
// Tudo roda dentro desta função, porque as seções compartilham variáveis
// (mapa, camadas, estado). A ORDEM IMPORTA: constantes e `let` usados pelos
// estilos das camadas precisam ser declarados antes de elas serem criadas.
function iniciarMapa() {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;

  // =============================================================
  // 1. FICHA TÉCNICA LATERAL (OFFCANVAS): CONSTANTES E CONFIGURAÇÃO
  // =============================================================
  const PANEL_WIDTH = 380;
  let highlightLayer = null;
  let skipAutoPan = false;
  let selecionada = null;     // feição aberta na ficha (vai para o link compartilhável)
  let focoAntesDaFicha = null; // elemento que tinha o foco quando a ficha abriu

  const TIPOS = {
    municipios: { label: 'Município',          icon: 'ph-map-pin', color: '#475569', texto: '#475569', bg: '#e2e8f0' },
    acudes:     { label: 'Açude',              icon: 'ph-drop',    color: '#0284c7', texto: '#0369a1', bg: '#e0f2fe' },
    bacias:     { label: 'Bacia hidrográfica', icon: 'ph-polygon', color: '#16a34a', texto: '#15803d', bg: '#dcfce7' },
    rios:       { label: 'Rio',                icon: 'ph-waves',   color: '#0891b2', texto: '#0e7490', bg: '#cffafe' },
    pocos:      { label: 'Poço',               icon: 'ph-drop-half-bottom', color: '#b45309', texto: '#b45309', bg: '#fef3c7' }
  };

  // =============================================================
  // 2. NOMES AMIGÁVEIS DOS CAMPOS (tabela de atributos e ficha da feição)
  //   c: campo no arquivo | r: nome exibido | f: formato | z: zero = sem informação
  //   ficha: aparece também na ficha lateral
  //   ocultar: campos técnicos que não aparecem para o usuário
  //   Campos novos que não estejam aqui aparecem com o nome "limpo" automaticamente.
  // =============================================================
  const CAMPOS = {
    municipios: {
      campos: [
        { c: 'nome',       r: 'Município' },
        { c: 'CD_MUN',     r: 'Código IBGE', ficha: true },
        { c: 'NM_RGI',     r: 'Região geográfica imediata', ficha: true },
        { c: 'NM_RGINT',   r: 'Região geográfica intermediária', ficha: true },
        { c: 'NM_CONCURB', r: 'Concentração urbana', ficha: true },
        { c: 'AREA_KM2',   r: 'Área (km²)', f: 'dec2', ficha: true }
      ],
      ocultar: ['CD_RGI', 'CD_RGINT', 'CD_UF', 'NM_UF', 'SIGLA_UF', 'CD_REGIAO', 'NM_REGIAO', 'SIGLA_RG', 'CD_CONCURB']
    },
    acudes: {
      campos: [
        { c: 'Nome',       r: 'Açude' },
        { c: 'Municipio',  r: 'Município', ficha: true },
        { c: 'Microrreg',  r: 'Microrregião', ficha: true },
        { c: 'Mesorreg',   r: 'Mesorregião', ficha: true },
        { c: 'Propriet',   r: 'Proprietário', ficha: true },
        { c: 'Executor',   r: 'Executor da obra', ficha: true },
        { c: 'Org_Resp',   r: 'Órgão responsável' },
        { c: 'Finalidade', r: 'Finalidade', ficha: true },
        { c: 'Capacidade', r: 'Capacidade (m³)', f: 'int', z: true, ficha: true },
        { c: 'A_Espelho',  r: 'Área do espelho d\'água (m²)', f: 'int', z: true, ficha: true },
        { c: 'Vol_Morto',  r: 'Volume morto (m³)', f: 'int', z: true },
        { c: 'B_Hidrog',   r: 'Área da bacia hidrográfica (km²)', f: 'dec1', z: true },
        { c: 'B_Hidraul',  r: 'Área da bacia hidráulica', f: 'dec1', z: true },
        { c: 'Curso_Bar',  r: 'Curso d\'água barrado', ficha: true },
        { c: 'Ord_Curso',  r: 'Ordem do curso d\'água' },
        { c: 'Alt_Barrag', r: 'Altura da barragem (m)', f: 'dec1', z: true, ficha: true },
        { c: 'Comp_',      r: 'Comprimento da barragem (m)', f: 'dec1', z: true },
        { c: 'Mat_Macico', r: 'Material do maciço' },
        { c: 'Tipo_Verte', r: 'Tipo de vertedouro' },
        { c: 'Mat_Verted', r: 'Material do vertedouro' },
        { c: 'Larg_Verte', r: 'Largura do vertedouro (m)', f: 'dec1', z: true },
        { c: 'Cot_Soleir', r: 'Cota da soleira (m)', f: 'dec2', z: true },
        { c: 'Cota_Minim', r: 'Cota mínima (m)', f: 'dec2', z: true },
        { c: 'Cota_Porao', r: 'Cota do porão (m)', f: 'dec2', z: true },
        { c: 'Curva_Cota', r: 'Possui curva cota × volume', f: 'sn' },
        { c: 'Inic_Const', r: 'Início da construção', ficha: true },
        { c: 'Conclusao',  r: 'Conclusão da obra', ficha: true },
        { c: 'Orig_Ficha', r: 'Origem da ficha' },
        { c: 'Fonte',      r: 'Fonte dos dados' },
        { c: 'Observacao', r: 'Observações', ficha: true },
        { c: 'Latitude',   r: 'Latitude', f: 'dec5' },
        { c: 'Longitude',  r: 'Longitude', f: 'dec5' }
      ],
      ocultar: ['OBJECTID', 'Cod_LMRS', 'K', 'Alfa', 'Shape_Leng', 'Shape_Area']
    },
    bacias: {
      campos: [
        { c: 'Nome',      r: 'Bacia' },
        { c: 'Cod',       r: 'Código' },
        { c: 'Comite',    r: 'Comitê de bacia', ficha: true, f: function (v) {
            return String(v).replace(/^\s*Nada\s*$/i, 'Sem comitê').replace(/forma[cç]\?o/i, 'formação');
        } },
        { c: 'Area_Km2',  r: 'Área (km²)', f: 'dec2', ficha: true },
        { c: 'Perimetro', r: 'Perímetro (km)', f: 'dec2', ficha: true }
      ],
      ocultar: ['OBJECTID', 'Shape_Leng', 'Shape_Area', 'Volume(%)']
    },
    rios: {
      campos: [
        { c: 'Nome',      r: 'Nome do rio' },
        { c: 'Dominio',   r: 'Domínio', ficha: true },
        { c: 'CONAMA357', r: 'Classe (CONAMA 357)', ficha: true },
        { c: 'nu_ordem',  r: 'Ordem do curso d\'água', f: 'int', z: true, ficha: true },
        { c: 'códotto',   r: 'Código da ottobacia', ficha: true }
      ],
      ocultar: ['ID', 'ordem1', 'ordem2', 'ordem3', 'Lat_1', 'Long_1']
    },
    pocos: {
      campos: [
        { c: 'fid',             r: 'Nº do poço' },
        { c: 'municipio',       r: 'Município', ficha: true },
        { c: 'microregiao',     r: 'Microrregião', ficha: true },
        { c: 'mesoregiao',      r: 'Mesorregião', ficha: true },
        { c: 'proprietario',    r: 'Proprietário', ficha: true },
        { c: 'orgao',           r: 'Órgão', ficha: true },
        { c: 'equipamento',     r: 'Equipamento', ficha: true },
        { c: 'profundidade',    r: 'Profundidade (m)', f: 'dec1', ficha: true },
        { c: 'q_m3h',           r: 'Vazão (m³/h)', f: 'dec1', ficha: true },
        { c: 'data_perfuracao', r: 'Data de perfuração', f: 'data', ficha: true }
      ],
      ocultar: []
    }
  };

  // "CD_RGI" -> "CD RGI" | "areaTotal" -> "Area total" (campos que não estão no dicionário)
  function humanizar(campo) {
    const t = String(campo).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function formatarCampo(def, v) {
    if (v === null || v === undefined || v === '') return '';
    if (def.z && Number(v) === 0) return '';
    const f = def.f;
    if (typeof f === 'function') return String(f(v));
    if (f === 'int')  return fmtNum(v, 0);
    if (f === 'dec1') return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    if (f === 'dec2') return fmtNum(v, 2);
    if (f === 'dec5') return fmtNum(v, 5);
    if (f === 'data') return /^\d{4}-\d{2}-\d{2}/.test(v) ? String(v).slice(0, 10).split('-').reverse().join('/') : String(v);
    if (f === 'sn') {
      const t = String(v).trim().toUpperCase();
      return t === 'SIM' ? 'Sim' : ((t === 'NAO' || t === 'NÃO') ? 'Não' : String(v));
    }
    return String(v);
  }

  // colunas da tabela: primeiro as do dicionário (na ordem definida), depois as demais não ocultas
  function colunasDe(tipo, props) {
    const cfg = CAMPOS[tipo];
    const existentes = Object.keys(props || {});
    const cols = [], usados = {};
    if (cfg) {
      cfg.campos.forEach(function (d) {
        if (existentes.indexOf(d.c) >= 0) { cols.push(d); usados[d.c] = true; }
      });
    }
    existentes.forEach(function (k) {
      if (usados[k]) return;
      if (cfg && cfg.ocultar.indexOf(k) >= 0) return;
      cols.push({ c: k, r: humanizar(k) });
    });
    cols.forEach(function (c) { c.num = ['int', 'dec1', 'dec2', 'dec5'].indexOf(c.f) >= 0; });
    return cols;
  }

  // linhas da ficha lateral: { "Nome amigável": "valor formatado" }
  function fichaDe(tipo, props) {
    const out = {};
    const cfg = CAMPOS[tipo];
    if (!cfg) return out;
    cfg.campos.forEach(function (d) {
      if (!d.ficha) return;
      const t = formatarCampo(d, (props || {})[d.c]);
      out[d.r] = t === '' ? null : t;
    });
    return out;
  }

  // =============================================================
  // 3. FICHA TÉCNICA LATERAL: OFFCANVAS, GEOMETRIA, DESTAQUE E showFeatureDetails
  // =============================================================
  const offcanvasEl = document.getElementById('attributeOffcanvas');
  let bsOffcanvas = null;
  if (offcanvasEl && typeof bootstrap !== "undefined") {
    // sem backdrop e com rolagem: o mapa continua visível e clicável com a ficha aberta
    bsOffcanvas = new bootstrap.Offcanvas(offcanvasEl, { backdrop: false, scroll: true });
    offcanvasEl.addEventListener('hidden.bs.offcanvas', function () {
      clearHighlight();
      selecionada = null;
      agendarHash();
      // devolve o foco a quem abriu a ficha (ex.: a linha da tabela, no teclado)
      if (focoAntesDaFicha && document.contains(focoAntesDaFicha)) focoAntesDaFicha.focus();
      focoAntesDaFicha = null;
    });
  }
  const offcanvasContent = document.getElementById('offcanvasContent');

  // ---- utilitários do mapa ----
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

  // true enquanto a régua (Geoman) está desenhando: cliques nas feições não devem abrir a ficha
  function medindo() { return !!(map.pm && map.pm.globalDrawModeEnabled()); }

  // todas as camadas vetoriais dividem um canvas: a ordem de desenho é a ordem em que foram
  // adicionadas, então reordena sempre que algo é ligado, filtrado ou muda de tema
  function reordenarVetoriais() {
    [geojsonMunicipios, geojsonBacias, geojsonRios, geojsonAcudes, simbolosAcudes, circulosPocos].forEach(function (g) {
      if (g) g.eachLayer(function (l) { if (l.bringToFront) l.bringToFront(); });
    });
  }

  // destaque ao passar o mouse sobre um município: um único contorno em SVG (leve),
  // em vez de redesenhar o canvas com 230 mil vértices a cada passagem
  let hoverMun = null;
  function mostrarHoverMun(layer) {
    if (!hoverMun) hoverMun = L.polygon([], { pane: 'highlightPane', interactive: false, weight: 2, fillOpacity: 0.15 });
    hoverMun.setStyle({ color: munHover, fillColor: munHover });
    hoverMun.setLatLngs(layer.getLatLngs());
    if (!map.hasLayer(hoverMun)) hoverMun.addTo(map);
  }
  function esconderHoverMun() {
    if (hoverMun && map.hasLayer(hoverMun)) map.removeLayer(hoverMun);
  }

  // título mostrado na ficha de cada tipo de feição
  function tituloDaFeicao(tipo, props) {
    if (tipo === 'municipios') return pick(props, ['nome', 'NM_MUN', 'Nome']) || 'Município';
    if (tipo === 'acudes') return props.Nome || props.NOME || 'Açude sem nome';
    if (tipo === 'bacias') return props.Nome || 'Bacia Hidrográfica';
    if (tipo === 'rios') return props.Nome || props.NOME || 'Rio sem nome';
    return 'Nº ' + props.fid;   // poços
  }

  // clique padrão de qualquer camada: abre a ficha e marca a linha da tabela
  function ligarCliqueFeicao(layer, feature, tipo) {
    layer.on('click', function () {
      if (medindo()) return;
      const props = feature.properties || {};
      showFeatureDetails(tituloDaFeicao(tipo, props), tipo, fichaDe(tipo, props), { layer: layer });
      sincronizarTabelaComMapa(getLayerByName(tipo), feature);
    });
  }

  function rotuloPoco(props) {
    return 'Poço ' + props.fid + (props.municipio ? ' · ' + props.municipio : '');
  }

  function featureCenter(layer) {
    if (layer.getLatLng) return layer.getLatLng();
    if (layer.getBounds) return layer.getBounds().getCenter();
    return null;
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
  function feicoesDentro(areaLayer, lista) {
    if (!lista || !areaLayer.getBounds || !areaLayer.feature) return [];
    const bounds = areaLayer.getBounds();
    const geom = areaLayer.feature.geometry;
    return lista.filter(function (l) {
      const c = featureCenter(l);
      return c && bounds.contains(c) && pointInGeometry(c.lng, c.lat, geom);
    });
  }

  function acudesDentro(areaLayer) { return feicoesDentro(areaLayer, todas.acudes); }
  function pocosDentro(areaLayer)  { return feicoesDentro(areaLayer, todas.pocos); }

  // município onde está o centro do açude
  function municipioDoAcude(acudeLayer) {
    const c = featureCenter(acudeLayer);
    if (!c || !todas.municipios.length) return null;
    return todas.municipios.find(function (l) {
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
          itemHtml(mun, 'ph-map-pin', pick(mp, ['nome', 'NM_MUN', 'Nome']) || 'Município', 'Município');
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

    const infoHtml = layer ? infograficoDe(tipo, layer) : '';
    const abaAtiva = (infoHtml && abaFicha === 'info') ? 'info' : 'dados';

    offcanvasContent.innerHTML =
      '<div class="card border-0 bg-light mb-3"><div class="card-body p-3 d-flex align-items-center gap-3">' +
        '<span class="feature-icon" style="background:' + t.bg + ';color:' + t.color + ';"><i class="ph ' + t.icon + '"></i></span>' +
        '<div class="feature-heading"><div class="small fw-semibold" style="color:' + t.texto + ';">' + t.label + '</div>' +
        '<h4 class="h5 fw-bold text-dark mb-0">' + escapeHtml(title) + '</h4></div>' +
      '</div></div>' +
      (layer ? '<div class="d-flex gap-2 mb-3">' +
        botao('zoom', 'ph-magnifying-glass-plus', 'Aproximar', 'Aproximar da feição') +
        botao('table', 'ph-table', 'Na tabela', 'Ver na tabela de atributos') +
        botao('copy', 'ph-copy', 'Coordenadas', 'Copiar coordenadas do centro') +
      '</div>' : '') +
      (infoHtml ? '<div class="ficha-tabs" role="tablist">' +
        '<button type="button" role="tab" aria-selected="' + (abaAtiva === 'info') + '" class="ficha-tab' + (abaAtiva === 'info' ? ' ativo' : '') + '" data-aba="info"><i class="ph ph-chart-pie-slice"></i> Em números</button>' +
        '<button type="button" role="tab" aria-selected="' + (abaAtiva === 'dados') + '" class="ficha-tab' + (abaAtiva === 'dados' ? ' ativo' : '') + '" data-aba="dados"><i class="ph ph-list-dashes"></i> Dados</button></div>' : '') +
      (infoHtml ? '<div role="tabpanel" data-painel="info"' + (abaAtiva === 'info' ? '' : ' hidden') + '>' + infoHtml + '</div>' : '') +
      '<div role="tabpanel" data-painel="dados"' + (abaAtiva === 'dados' ? '' : ' hidden') + '>' +
        '<div class="card border-0 shadow-sm bg-white mb-3"><div class="card-body p-0"><div class="table-responsive">' +
          '<table class="table table-sm table-hover align-middle mb-0"><tbody>' + rowsHtml + '</tbody></table>' +
        '</div></div></div>' +
      '</div>' +
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
        copiarTexto(c.lat.toFixed(6) + ', ' + c.lng.toFixed(6)).then(function () {
          span.textContent = 'Copiado!';
          setTimeout(function () { span.textContent = 'Coordenadas'; }, 1500);
        });
      });
    }
    offcanvasContent.querySelectorAll('[data-aba]').forEach(function (b) {
      b.addEventListener('click', function () {
        abaFicha = b.dataset.aba;
        offcanvasContent.querySelectorAll('[data-aba]').forEach(function (x) { x.classList.toggle('ativo', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
        offcanvasContent.querySelectorAll('[data-painel]').forEach(function (pn) { pn.hidden = pn.dataset.painel !== abaFicha; });
      });
    });
    offcanvasContent.querySelectorAll('[data-related]').forEach(function (el) {
      el.addEventListener('click', function () { selectLayer(relatedLayers[Number(el.dataset.related)], true); });
    });

    // ---- mapa ----
    setHighlight(layer);
    selecionada = (layer && layer.feature) ? { tipo: tipo, layer: layer } : null;
    agendarHash();
    const sidebar = document.getElementById('layerSidebar');
    if (sidebar) sidebar.classList.add('collapsed');
    if (layer && !skipAutoPan) ensureVisible(layer);

    if (bsOffcanvas) {
      if (!offcanvasEl.classList.contains('show')) focoAntesDaFicha = document.activeElement;
      bsOffcanvas.show();
    }
  }

  // =============================================================
  // 4. MAPA E MAPAS DE FUNDO
  // =============================================================
  // crossOrigin permite capturar o mapa para exportar imagem/PDF
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    crossOrigin: true,
    attribution: '&copy; OpenStreetMap'
  });

  const googleSat = L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
    maxZoom: 20,
    attribution: '&copy; Google Maps'
  });

  const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
    crossOrigin: true
  });

  const cartoDark = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    maxZoom: 16,
    crossOrigin: true
  });

  const map = L.map("map", {
    center: [-7.12, -36.72],
    zoom: 8,
    layers: [googleSat],
    zoomControl: false
  });
  L.control.zoom({ position: 'topleft', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(map);

  // leitores de tela: o que é este elemento e como usar pelo teclado
  mapElement.setAttribute('role', 'region');
  mapElement.setAttribute('aria-label', 'Mapa interativo da Paraíba. Setas movem o mapa; mais e menos aproximam e afastam. Use Tab para chegar aos botões e à tabela de atributos.');

  const linkPular = document.querySelector('.skip-link');
  if (linkPular) linkPular.addEventListener('click', function (e) { e.preventDefault(); map.getContainer().focus(); });

  // =============================================================
  // 5. BARRA DE ESCALA E COORDENADAS (canto inferior esquerdo)
  // =============================================================
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

  // =============================================================
  // 6. BOTÕES DE FERRAMENTAS E PAINEL LATERAL DE CAMADAS
  // =============================================================
  // botão quadrado na coluna de ferramentas, à direita do mapa (devolve o <button>)
  function adicionarBotaoFerramenta(titulo, classeIcone, aoClicar) {
    let botao = null;
    const ctl = L.control({ position: 'topright' });
    ctl.onAdd = function () {
      botao = L.DomUtil.create('button', 'map-tool-btn');
      botao.type = 'button';
      botao.title = titulo;
      botao.setAttribute('aria-label', titulo);
      botao.innerHTML = '<i class="ph ' + classeIcone + '"></i>';
      botao.onclick = function (e) { e.preventDefault(); aoClicar(botao); };
      return botao;
    };
    ctl.addTo(map);
    return botao;
  }

  // mantém aria-expanded do botão igual ao estado do painel, qualquer que seja quem o abra/feche
  function sincronizarAriaExpanded(painel, classeFechado, botao) {
    if (!painel || !botao) return;
    botao.setAttribute('aria-controls', painel.id);
    const atualizar = function () { botao.setAttribute('aria-expanded', painel.classList.contains(classeFechado) ? 'false' : 'true'); };
    new MutationObserver(atualizar).observe(painel, { attributes: true, attributeFilter: ['class'] });
    atualizar();
  }

  const painelCamadas = document.getElementById('layerSidebar');
  const painelTabela = document.getElementById('attributeTablePanel');
  let btnCamadas = null, btnTabela = null, btnCompartilhar = null;

  function abrirPainelCamadas() {
    if (!painelCamadas) return;
    painelCamadas.classList.remove('collapsed');
    setTimeout(function () { const f = document.getElementById('closeSidebarBtn'); if (f) f.focus(); }, 80);
  }

  function fecharPainelCamadas() {
    if (!painelCamadas) return;
    const tinhaFoco = painelCamadas.contains(document.activeElement);
    painelCamadas.classList.add('collapsed');
    if (tinhaFoco && btnCamadas) btnCamadas.focus();
  }

  function abrirPainelTabela() {
    if (!painelTabela) return;
    painelTabela.classList.remove('closed');
    const select = document.getElementById('layerTableSelect');
    carregarDadosTabela(getLayerByName(select ? select.value : 'municipios'));
    setTimeout(function () { const f = document.getElementById('tableSearchInput'); if (f) f.focus(); }, 80);
  }

  function fecharPainelTabela() {
    if (!painelTabela) return;
    const tinhaFoco = painelTabela.contains(document.activeElement);
    painelTabela.classList.add('closed');
    if (tinhaFoco && btnTabela) btnTabela.focus();
  }

  btnCamadas = adicionarBotaoFerramenta('Gestão de Camadas', 'ph-stack', function () {
    painelCamadas.classList.contains('collapsed') ? abrirPainelCamadas() : fecharPainelCamadas();
  });
  sincronizarAriaExpanded(painelCamadas, 'collapsed', btnCamadas);

  btnTabela = adicionarBotaoFerramenta('Abrir Tabela de Atributos', 'ph-table', function () {
    painelTabela.classList.contains('closed') ? abrirPainelTabela() : fecharPainelTabela();
  });
  sincronizarAriaExpanded(painelTabela, 'closed', btnTabela);

  const closeBtn = document.getElementById('closeSidebarBtn');
  if (closeBtn) closeBtn.addEventListener('click', fecharPainelCamadas);

  // Esc fecha o painel em que o foco está
  if (painelCamadas) painelCamadas.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharPainelCamadas(); });
  if (painelTabela) painelTabela.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharPainelTabela(); });

  const basemaps = { osm: osm, sat: googleSat, esri: esriSat, dark: cartoDark };

  function setBasemap(name) {
    Object.values(basemaps).forEach(l => map.removeLayer(l));
    basemaps[name].addTo(map);
    currentBasemap = name;
    applyOverlayTheme();
  }

  [['radioOsm', 'osm'], ['radioSat', 'sat'], ['radioEsri', 'esri'], ['radioDark', 'dark']].forEach(function (pair) {
    const el = document.getElementById(pair[0]);
    if (el) el.addEventListener('change', function () { if (this.checked) setBasemap(pair[1]); });
  });

  // =============================================================
  // 7. FERRAMENTA DE MEDIÇÃO DE DISTÂNCIA (régua)
  // =============================================================
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

  // =============================================================
  // 8. PANES (ORDEM DE EMPILHAMENTO) E GRUPOS DE CAMADAS
  // =============================================================
  // municípios, bacias, rios, açudes e poços coloridos dividem UM canvas: com vários canvas empilhados
  // só o de cima recebe cliques. A ordem de desenho é mantida por reordenarVetoriais().
  map.createPane("vetoresPane").style.zIndex = 450;
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

  function getMunStyle(feature) {
    const tematico = feature && temas.municipios !== 'nenhum';
    return { color: munStroke, weight: 1, opacity: 0.7, fillColor: tematico ? corTemaMun(feature) : munFill, fillOpacity: currentMunicipiosOpacity };
  }

  // =============================================================
  // 9. TABELA DE ATRIBUTOS: BUSCA, ORDENAÇÃO E EXPORTAÇÃO
  // =============================================================
  const attributeTablePanel = document.getElementById('attributeTablePanel');
  const closeTableBtn = document.getElementById('closeTableBtn');
  const layerTableSelect = document.getElementById('layerTableSelect');
  const gisTableHead = document.getElementById('gisTableHead');
  const gisTableBody = document.getElementById('gisTableBody');

  let selectedRowElement = null;

  if (closeTableBtn && attributeTablePanel) closeTableBtn.addEventListener('click', fecharPainelTabela);

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
  let tabelaCols = [];
  let linhasDesenhadas = 0;
  const LINHAS_POR_PARTE = 400;

  // busca: listaLinhas = índices (em tableLayers) das linhas que atendem ao filtro atual
  let listaLinhas = [];
  let termoBusca = '';
  let indiceBusca = null;
  const tableSearchInput = document.getElementById('tableSearchInput');
  const tableCount = document.getElementById('tableCount');
  const tableClearBtn = document.getElementById('tableSearchClear');
  const tableExportBtn = document.getElementById('tableExportBtn');

  // ordenação: col = índice da coluna (-1 = ordem original), dir = 1 crescente / -1 decrescente
  let ordenacao = { col: -1, dir: 1 };
  const colador = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

  // minúsculas e sem acentos: "sao jose" encontra "São José"
  function normalizarBusca(s) {
    return semAcentos(s).toLowerCase();
  }

  // apenas uma linha fica na ordem do Tab (as setas percorrem as demais)
  let linhaTab = null;
  function definirLinhaTab(tr) {
    if (linhaTab && linhaTab !== tr) linhaTab.tabIndex = -1;
    tr.tabIndex = 0;
    linhaTab = tr;
  }

  function marcarLinha(tr) {
    if (selectedRowElement) { selectedRowElement.classList.remove('selected-row'); selectedRowElement.removeAttribute('aria-current'); }
    tr.classList.add('selected-row');
    tr.setAttribute('aria-current', 'true');
    selectedRowElement = tr;
    definirLinhaTab(tr);
  }

  function tipoDaCamada(grupo) {
    return TIPOS_CAMADA.find(function (n) { return getLayerByName(n) === grupo; });
  }

  function carregarDadosTabela(geojsonData) {
    if (!geojsonData || !gisTableHead || !gisTableBody) return;

    gisTableHead.innerHTML = '';
    gisTableBody.innerHTML = '';
    selectedRowElement = null;

    termoBusca = '';
    indiceBusca = null;
    ordenacao = { col: -1, dir: 1 };
    if (tableSearchInput) tableSearchInput.value = '';
    if (tableClearBtn) tableClearBtn.hidden = true;

    tableLayers = geojsonData.getLayers().filter(l => l.feature);
    listaLinhas = tableLayers.map(function (_, i) { return i; });
    atualizarContagem();
    if (tableLayers.length === 0) return;

    const tipo = tipoDaCamada(geojsonData);
    const cols = colunasDe(tipo, tableLayers[0].feature.properties);

    // cabeçalho com nomes amigáveis (o nome técnico fica no balão ao passar o mouse)
    // clicar no cabeçalho ordena a coluna
    gisTableHead.innerHTML = '<tr>' + cols.map(function (c, j) {
      return '<th scope="col" tabindex="0" class="th-sort' + (c.num ? ' text-end' : '') + '" data-col="' + j + '" aria-sort="none" title="Ordenar por esta coluna · campo original: ' + escapeHtml(c.c) + '">' +
        escapeHtml(c.r) + '<i class="ph ph-caret-up-down sort-icon"></i></th>';
    }).join('') + '</tr>';

    // camadas grandes (ex.: rios, 31 mil feições) são desenhadas por partes, conforme a rolagem
    tabelaCols = cols;
    linhasDesenhadas = 0;
    const corpo = gisTableBody.closest('.table-panel-body');
    if (corpo) corpo.scrollTop = 0;
    desenharLinhas(LINHAS_POR_PARTE);
  }

  function desenharLinhas(ate) {
    const fim = Math.min(ate, listaLinhas.length);
    if (fim <= linhasDesenhadas) return;
    let html = '';
    for (let k = linhasDesenhadas; k < fim; k++) {
      const i = listaLinhas[k];
      const props = tableLayers[i].feature.properties || {};
      html += '<tr tabindex="-1" data-i="' + i + '">' + tabelaCols.map(function (c) {
        const t = formatarCampo(c, props[c.c]);
        return '<td' + (c.num ? ' class="text-end"' : '') + '>' + (t === '' ? '<span class="text-muted">—</span>' : escapeHtml(t)) + '</td>';
      }).join('') + '</tr>';
    }
    const primeiraParte = linhasDesenhadas === 0;
    gisTableBody.insertAdjacentHTML('beforeend', html);
    linhasDesenhadas = fim;
    if (primeiraParte && gisTableBody.firstElementChild) definirLinhaTab(gisTableBody.firstElementChild);
  }

  function atualizarContagem() {
    const total = tableLayers.length, n = listaLinhas.length;
    if (tableCount) {
      tableCount.innerHTML = total === 0 ? '' :
        (n === total
          ? '<strong>' + total.toLocaleString('pt-BR') + '</strong> feições'
          : '<strong>' + n.toLocaleString('pt-BR') + '</strong> de ' + total.toLocaleString('pt-BR') + ' feições');
    }
    if (tableExportBtn) {
      tableExportBtn.disabled = n === 0;
      tableExportBtn.title = n === 0 ? 'Nada para exportar' : 'Exportar as ' + n.toLocaleString('pt-BR') + ' linhas visíveis em CSV';
    }
  }

  function construirIndiceBusca() {
    indiceBusca = tableLayers.map(function (l) {
      const props = l.feature.properties || {};
      return normalizarBusca(tabelaCols.map(function (c) { return formatarCampo(c, props[c.c]); }).join(' | '));
    });
  }

  // vazios sempre por último, em qualquer direção
  function ordenarLista(lista) {
    const col = tabelaCols[ordenacao.col];
    if (!col) return lista;
    const dir = ordenacao.dir;
    const itens = lista.map(function (i) {
      const v = (tableLayers[i].feature.properties || {})[col.c];
      const txt = formatarCampo(col, v);
      return { i: i, vazio: txt === '', k: col.num ? Number(v) : (col.f === 'data' ? String(v) : txt) };
    });
    itens.sort(function (a, b) {
      if (a.vazio !== b.vazio) return a.vazio ? 1 : -1;
      if (a.vazio) return a.i - b.i;
      const r = (col.num ? a.k - b.k : colador.compare(a.k, b.k)) * dir;
      return r || (a.i - b.i);
    });
    return itens.map(function (x) { return x.i; });
  }

  function atualizarCabecalho() {
    gisTableHead.querySelectorAll('th[data-col]').forEach(function (th) {
      const ativo = Number(th.dataset.col) === ordenacao.col;
      th.classList.toggle('ordenado', ativo);
      th.setAttribute('aria-sort', !ativo ? 'none' : (ordenacao.dir === 1 ? 'ascending' : 'descending'));
      th.querySelector('.sort-icon').className = 'ph sort-icon ' + (!ativo ? 'ph-caret-up-down' : (ordenacao.dir === 1 ? 'ph-caret-up' : 'ph-caret-down'));
    });
  }

  // aplica busca (todas as palavras em qualquer coluna) e depois a ordenação
  function atualizarLista() {
    const palavras = normalizarBusca(termoBusca).split(/\s+/).filter(Boolean);
    let lista = [];

    if (!palavras.length) {
      lista = tableLayers.map(function (_, i) { return i; });
    } else {
      if (!indiceBusca) construirIndiceBusca();
      for (let i = 0; i < indiceBusca.length; i++) {
        if (palavras.every(function (p) { return indiceBusca[i].indexOf(p) >= 0; })) lista.push(i);
      }
    }
    listaLinhas = ordenacao.col >= 0 ? ordenarLista(lista) : lista;

    gisTableBody.innerHTML = '';
    selectedRowElement = null;
    linhasDesenhadas = 0;
    const corpo = gisTableBody.closest('.table-panel-body');
    if (corpo) corpo.scrollTop = 0;

    if (!listaLinhas.length) {
      gisTableBody.innerHTML = '<tr class="tabela-vazia"><td colspan="' + (tabelaCols.length || 1) + '" class="text-center text-muted py-4">' +
        'Nenhum resultado para “' + escapeHtml(termoBusca) + '”</td></tr>';
    } else {
      desenharLinhas(LINHAS_POR_PARTE);
    }
    atualizarContagem();
  }

  function aplicarBusca(termo) {
    termoBusca = termo.trim();
    if (tableClearBtn) tableClearBtn.hidden = !tableSearchInput.value;
    atualizarLista();
  }

  function limparBusca() {
    if (tableSearchInput) tableSearchInput.value = '';
    if (tableClearBtn) tableClearBtn.hidden = true;
    if (termoBusca) aplicarBusca('');
  }

  if (tableSearchInput) {
    let temporizador = null;
    tableSearchInput.addEventListener('input', function () {
      if (tableClearBtn) tableClearBtn.hidden = !tableSearchInput.value;
      clearTimeout(temporizador);
      temporizador = setTimeout(function () { aplicarBusca(tableSearchInput.value); }, 150);
    });
    tableSearchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && tableSearchInput.value) { e.stopPropagation(); limparBusca(); }
    });
  }

  if (tableClearBtn) {
    tableClearBtn.addEventListener('click', function () { limparBusca(); tableSearchInput.focus(); });
  }

  // clique no cabeçalho: crescente → decrescente → ordem original
  if (gisTableHead) {
    gisTableHead.addEventListener('click', function (e) {
      const th = e.target.closest('th[data-col]');
      if (!th) return;
      const j = Number(th.dataset.col);
      if (ordenacao.col !== j) ordenacao = { col: j, dir: 1 };
      else if (ordenacao.dir === 1) ordenacao = { col: j, dir: -1 };
      else ordenacao = { col: -1, dir: 1 };
      atualizarCabecalho();
      atualizarLista();
    });
  }

  // exporta exatamente o que está na tabela: linhas filtradas, na ordem atual, com os nomes das colunas
  function exportarTabelaCsv() {
    if (!listaLinhas.length) return;
    const linhas = [tabelaCols.map(function (c) { return csvCelula(c.r); }).join(';')];
    listaLinhas.forEach(function (i) {
      const props = tableLayers[i].feature.properties || {};
      linhas.push(tabelaCols.map(function (c) { return csvCelula(formatarCampo(c, props[c.c])); }).join(';'));
    });

    const tipo = layerTableSelect ? layerTableSelect.value : 'tabela';
    const nome = tipo + (termoBusca ? '_filtrado' : '_tabela') + '.csv';
    salvarBlob(new Blob(['\ufeff' + linhas.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }), nome);
  }

  if (tableExportBtn) tableExportBtn.addEventListener('click', exportarTabelaCsv);

  // teclado: Enter/Espaço localizam no mapa; setas, Home e End percorrem as linhas
  if (gisTableBody) {
    gisTableBody.addEventListener('keydown', function (e) {
      const tr = e.target.closest('tr[data-i]');
      if (!tr || e.target !== tr) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tr.click(); return; }

      let alvo = null;
      if (e.key === 'ArrowDown') {
        alvo = tr.nextElementSibling;
        if (!alvo && linhasDesenhadas < listaLinhas.length) { desenharLinhas(linhasDesenhadas + LINHAS_POR_PARTE); alvo = tr.nextElementSibling; }
      } else if (e.key === 'ArrowUp') {
        alvo = tr.previousElementSibling;
      } else if (e.key === 'Home') {
        alvo = gisTableBody.firstElementChild;
      } else if (e.key === 'End') {
        alvo = gisTableBody.lastElementChild;
      } else {
        return;
      }
      e.preventDefault();
      if (alvo && alvo.dataset.i !== undefined) { definirLinhaTab(alvo); alvo.focus(); }
    });
  }

  if (gisTableHead) {
    gisTableHead.addEventListener('keydown', function (e) {
      const th = e.target.closest('th[data-col]');
      if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); th.click(); }
    });
  }

  const painelRolagem = gisTableBody ? gisTableBody.closest('.table-panel-body') : null;
  if (painelRolagem) {
    painelRolagem.addEventListener('scroll', function () {
      if (painelRolagem.scrollTop + painelRolagem.clientHeight >= painelRolagem.scrollHeight - 300) {
        desenharLinhas(linhasDesenhadas + LINHAS_POR_PARTE);
      }
    });
  }

  if (gisTableBody) {
    gisTableBody.addEventListener('click', function (e) {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const layer = tableLayers[Number(tr.dataset.i)];
      if (!layer) return;
      marcarLinha(tr);
      selectLayer(layer, true);
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
    if (idx < 0) return;

    let pos = listaLinhas.indexOf(idx);
    if (pos < 0 && termoBusca) {   // a feição clicada está fora do filtro: limpa a busca para mostrá-la
      limparBusca();
      pos = listaLinhas.indexOf(idx);
    }
    if (pos < 0) return;
    if (pos >= linhasDesenhadas) desenharLinhas(pos + 50);
    const tr = gisTableBody.children[pos];
    if (tr) {
      marcarLinha(tr);
      tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // =============================================================
  // 10. ESTADO COMPARTILHADO: TEMAS, FILTROS E LINK
  // (declarado antes das camadas, pois os estilos já usam esses valores)
  // =============================================================
  const TIPOS_CAMADA = ['municipios', 'acudes', 'bacias', 'rios', 'pocos'];
  const todas = { municipios: [], acudes: [], bacias: [], rios: [], pocos: [] }; // todas as feições (sem filtro)
  const temas = { municipios: 'nenhum', acudes: 'nenhum', pocos: 'nenhum' };
  const filtros = { municipios: {}, acudes: {}, bacias: {}, rios: {}, pocos: {} };

  let contagemMun = new Map();     // feição do município -> nº de poços (tema "poços por município")
  let classesMun = null;           // classes de área (calculadas uma vez)
  let catOrgaos = null;            // categorias de órgão (calculadas uma vez)
  let opMunAntes = 0.15;           // opacidade dos municípios antes de ligar um tema
  let aplicandoHash = false;
  let temporizadorHash = null;

  const simbolosAcudes = L.layerGroup();   // símbolos proporcionais à capacidade
  const circulosPocos = L.layerGroup();    // poços coloridos por tema (sem agrupamento)
  // camadas com muitos vértices ficam em canvas: milhares de elementos SVG deixam o zoom pesado
  // (rios: 31 mil feições / 417 mil vértices; municípios: 230 mil vértices)
  // Como a versão antiga: SVG acompanha o zoom animado sem "piscar" (o canvas estica a imagem e redesenha no fim).
  // Se a camada de rios ficar pesada, troque para true (mais rápido, porém com pequeno "pulo" no zoom).
  const VETORES_EM_CANVAS = false;
  const rendererVetores = VETORES_EM_CANVAS ? L.canvas({ pane: 'vetoresPane', padding: 0.5 }) : L.svg({ pane: 'vetoresPane' });
  let opacidadePocos = 1;          // opacidade dos poços coloridos (slider da camada)

  const RAMPA_AREA = ['#deebf7', '#9ecae1', '#4292c6', '#2171b5', '#08306b'];
  const CLASSES_POCOS_MUN = [
    { max: 0,        rotulo: 'Nenhum',     cor: '#e2e8f0' },
    { max: 3,        rotulo: '1 – 3',      cor: '#fed7aa' },
    { max: 7,        rotulo: '4 – 7',      cor: '#fdba74' },
    { max: 14,       rotulo: '8 – 14',     cor: '#f97316' },
    { max: 29,       rotulo: '15 – 29',    cor: '#c2410c' },
    { max: Infinity, rotulo: '30 ou mais', cor: '#7c2d12' }
  ];
  const CLASSES_VAZAO = [
    { max: 2,        rotulo: 'até 2',      cor: '#ffffb2' },
    { max: 5,        rotulo: '2 – 5',      cor: '#a1dab4' },
    { max: 10,       rotulo: '5 – 10',     cor: '#41b6c4' },
    { max: 20,       rotulo: '10 – 20',    cor: '#2c7fb8' },
    { max: Infinity, rotulo: 'mais de 20', cor: '#253494' }
  ];
  const CORES_ORGAO = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#0891b2'];

  // primeira classe cujo limite superior comporta o valor
  function classeDe(classes, valor) {
    for (let i = 0; i < classes.length; i++) if (valor <= classes[i].max) return classes[i];
    return classes[classes.length - 1];
  }

  // "NAO INFORMADO" -> "Não informado" | "DNOCS" continua "DNOCS"
  function prettify(v) {
    const s = String(v);
    const especiais = { 'NAO INFORMADO': 'Não informado', 'EXERCITO': 'Exército' };
    if (especiais[s]) return especiais[s];
    if (s === s.toUpperCase() && s.length > 5 && /[A-ZÀ-Ý]/.test(s)) {
      return s.toLowerCase().replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
    }
    return s;
  }

  // (re)agenda a gravação do estado do mapa no endereço da página
  function agendarHash() {
    if (aplicandoHash) return;
    clearTimeout(temporizadorHash);
    temporizadorHash = setTimeout(function () {
      try { history.replaceState(null, '', '#' + estadoParaHash()); } catch (e) { /* ignora */ }
    }, 400);
  }

  // =============================================================
  // 11. CAMADA: MUNICÍPIOS
  // =============================================================
  if (typeof municipios !== "undefined") {
    geojsonMunicipios = L.geoJSON(municipios, {
      pane: "vetoresPane",
    renderer: rendererVetores,
    smoothFactor: 1.5,
      style: function (feature) { return getMunStyle(feature); },
      onEachFeature: function (feature, layer) {
        layer.on({
          mouseover: function (e) {
            if (medindo()) return;
            mostrarHoverMun(e.target);
          },
          mouseout: function () {
            esconderHoverMun();
          }
        });
        ligarCliqueFeicao(layer, feature, 'municipios');
      }
    });

    geojsonMunicipios.addTo(layerMunicipios);
    layerMunicipios.addTo(map);

    const munBounds = geojsonMunicipios.getBounds();
    if (munBounds.isValid()) map.fitBounds(munBounds, { padding: [20, 20] });
  }

  // =============================================================
  // 12. CAMADA: AÇUDES
  // =============================================================
  if (typeof acudes !== "undefined") {
    geojsonAcudes = L.geoJSON(acudes, {
      pane: "vetoresPane",
    renderer: rendererVetores,
    smoothFactor: 1.5,
      style: { color: "#ffffff", weight: 1, fillColor: "#0284c7", fillOpacity: 0.6, opacity: 0.6 },
      onEachFeature: function (feature, layer) {
        ligarCliqueFeicao(layer, feature, 'acudes');
      }
    });
    geojsonAcudes.addTo(layerAcudes);
    layerAcudes.addTo(map);
  }

  // =============================================================
  // 13. CAMADA: POÇOS (marcadores, agrupados quando há muitos juntos)
  // =============================================================
  if (typeof pocos !== "undefined") {
    const pocoIcon = L.divIcon({
      className: 'poco-marker',
      html: '<span><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M12 2.5c3.2 4.2 6 7.2 6 11a6 6 0 0 1-12 0c0-3.8 2.8-6.8 6-11z" fill="#ffffff"/></svg></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    geojsonPocos = L.geoJSON(pocos, {
      pointToLayer: function (feature, latlng) {
        return L.marker(latlng, { icon: pocoIcon, pane: "pocosPane", riseOnHover: true, keyboard: false });
      },
      onEachFeature: function (feature, layer) {
        const props = feature.properties || {};
        layer.bindTooltip(rotuloPoco(props), { direction: 'top', offset: [0, -10] });
        ligarCliqueFeicao(layer, feature, 'pocos');
      }
    });

    if (typeof L.markerClusterGroup === 'function') {
      clusterPocos = L.markerClusterGroup({
        clusterPane: "pocosPane",
        maxClusterRadius: 45,
      animate: false,
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

  // =============================================================
  // 14. CAMADA: BACIAS HIDROGRÁFICAS
  // =============================================================
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
      pane: "vetoresPane",
    renderer: rendererVetores,
    smoothFactor: 1.5,
      style: function (feature) {
        const nomeBacia = feature.properties ? feature.properties.Nome : "";
        return { color: getCorBacia(nomeBacia), weight: 2, opacity: 0.9, fillColor: getCorBacia(nomeBacia), fillOpacity: 0.45 };
      },
      onEachFeature: function (feature, layer) {
        ligarCliqueFeicao(layer, feature, 'bacias');
      }
    });
    geojsonBacias.addTo(layerBacias);
  }

  // =============================================================
  // 15. CAMADA: RIOS
  // =============================================================
  if (typeof rios !== "undefined") {
    geojsonRios = L.geoJSON(rios, {
      pane: "vetoresPane",
    renderer: rendererVetores,
    smoothFactor: 2,
      style: { color: "#0284c7", weight: 2, opacity: 0.8 },
      onEachFeature: function (feature, layer) {
        ligarCliqueFeicao(layer, feature, 'rios');
      }
    });
    geojsonRios.addTo(layerRios);
  }

  // todas as feições de cada camada (os filtros do mapa só tiram/colocam feições nos grupos)
  todas.municipios = geojsonMunicipios ? geojsonMunicipios.getLayers().slice() : [];
  todas.acudes     = geojsonAcudes     ? geojsonAcudes.getLayers().slice()     : [];
  todas.bacias     = geojsonBacias     ? geojsonBacias.getLayers().slice()     : [];
  todas.rios       = geojsonRios       ? geojsonRios.getLayers().slice()       : [];
  todas.pocos      = geojsonPocos      ? geojsonPocos.getLayers().slice()      : [];

  function applyOverlayTheme() {
    const onImagery = currentBasemap !== 'osm';
    munStroke = onImagery ? '#e2e8f0' : '#475569';
    munFill   = onImagery ? '#cbd5e1' : '#64748b';
    munHover  = onImagery ? '#ffffff' : '#0f172a';
    riosColor = onImagery ? '#38bdf8' : '#0284c7';
    if (geojsonMunicipios) geojsonMunicipios.setStyle(getMunStyle);
    if (geojsonRios) geojsonRios.setStyle({ color: riosColor });
    updateLegend();
  }

  // =============================================================
  // 16. LEGENDA DINÂMICA
  // =============================================================
  let legendCollapsed = false;
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'legend-control');
    div.id = 'dynamicLegend';
    div.setAttribute('role', 'group');
    div.setAttribute('aria-label', 'Legenda do mapa');
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

  function itemLegenda(cor, rotulo) {
    return '<div class="legend-item"><span class="legend-color" style="background:' + cor + '; border:1px solid rgba(15,23,42,0.35);"></span> ' + rotulo + '</div>';
  }

  function filtroAtivo(tipo) { return Object.keys(filtros[tipo]).length > 0; }
  function tagFiltrado(tipo) { return filtroAtivo(tipo) ? ' <span class="legend-filtro">filtrado</span>' : ''; }
  function tituloLegenda(txt, tipo) { return '<div class="legend-title">' + txt + tagFiltrado(tipo) + '</div>'; }

  function updateLegend() {
    const div = document.getElementById('dynamicLegend');
    if (!div) return;

    let html = '';
    let hasLayer = false;

    // ---- municípios ----
    if (map.hasLayer(layerMunicipios)) {
      if (temas.municipios === 'area') {
        html += tituloLegenda('Municípios · área (km²)', 'municipios');
        classesAreaMun().forEach(function (c) { html += itemLegenda(c.cor, c.rotulo); });
      } else if (temas.municipios === 'pocos') {
        html += tituloLegenda('Municípios · nº de poços', 'municipios');
        CLASSES_POCOS_MUN.forEach(function (c) { html += itemLegenda(c.cor, c.rotulo); });
      } else {
        html += '<div class="legend-item"><span class="legend-color" style="background:' + munFill + '; border:1px solid ' + munStroke + ';"></span> Municípios' + tagFiltrado('municipios') + '</div>';
      }
      hasLayer = true;
    }

    // ---- açudes ----
    if (map.hasLayer(layerAcudes)) {
      if (temas.acudes === 'capacidade') {
        const max = capMaxAcudes() || 1;
        html += tituloLegenda('Açudes · capacidade (milhões de m³)', 'acudes');
        let refs = [10e6, 100e6, 500e6].filter(function (v) { return v <= max; });
        if (!refs.length) refs = [max];
        refs.forEach(function (v) {
          const r = raioAcude(v, max), d = Math.ceil(2 * r + 3);
          html += '<div class="legend-item"><span class="legend-sym"><svg width="' + d + '" height="' + d + '"><circle cx="' + d / 2 + '" cy="' + d / 2 + '" r="' + r + '" fill="#0ea5e9" fill-opacity="0.7" stroke="#ffffff" stroke-width="1.5"></circle></svg></span> ' +
            (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '</div>';
        });
        html += '<div class="legend-nota">Açudes sem capacidade informada não são representados.</div>';
      } else {
        html += '<div class="legend-item"><span class="legend-color" style="background:#0284c7; border-radius:50%;"></span> Açudes' + tagFiltrado('acudes') + '</div>';
      }
      hasLayer = true;
    }

    // ---- poços ----
    if (map.hasLayer(layerPocos)) {
      if (temas.pocos === 'orgao' || temas.pocos === 'vazao') {
        const visiveis = geojsonPocos ? geojsonPocos.getLayers() : [];
        const itens = temas.pocos === 'orgao'
          ? categoriasOrgao().map(function (c) { return { rotulo: c.rotulo, cor: c.cor, n: 0, test: function (p) { return itemOrgao(p) === c; } }; })
          : CLASSES_VAZAO.map(function (c) { return { rotulo: c.rotulo + ' m³/h', cor: c.cor, n: 0, test: function (p) { const v = Number(p.q_m3h); return p.q_m3h !== null && p.q_m3h !== undefined && isFinite(v) && classeDe(CLASSES_VAZAO, v) === c; } }; })
            .concat([{ rotulo: 'Sem informação', cor: '#cbd5e1', n: 0, test: function (p) { return p.q_m3h === null || p.q_m3h === undefined || !isFinite(Number(p.q_m3h)); } }]);
        visiveis.forEach(function (l) {
          const p = l.feature.properties || {};
          for (let i = 0; i < itens.length; i++) { if (itens[i].test(p)) { itens[i].n++; break; } }
        });
        html += tituloLegenda(temas.pocos === 'orgao' ? 'Poços · órgão' : 'Poços · vazão', 'pocos');
        itens.forEach(function (it) {
          if (it.n > 0) html += '<div class="legend-item"><span class="legend-color legend-dot" style="background:' + it.cor + ';"></span> ' + escapeHtml(it.rotulo) + ' <span class="legend-n">' + it.n.toLocaleString('pt-BR') + '</span></div>';
        });
      } else {
        html += '<div class="legend-item"><span class="legend-color" style="background:#d97706; border:2px solid #ffffff; box-shadow:0 0 0 1px #d97706; border-radius:50%;"></span> Poços' + tagFiltrado('pocos') + '</div>';
      }
      hasLayer = true;
    }

    // ---- bacias ----
    if (map.hasLayer(layerBacias)) {
      html += '<div class="mt-2 mb-1 fw-bold text-muted" style="font-size:11px; text-transform:uppercase;">Bacias Hidrográficas' + tagFiltrado('bacias') + '</div>';
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

    // ---- rios ----
    if (map.hasLayer(layerRios)) {
      html += '<div class="legend-item mt-1"><span class="legend-color" style="background:' + riosColor + '; height:3px;"></span> Rios' + tagFiltrado('rios') + '</div>';
      hasLayer = true;
    }

    div.style.display = hasLayer ? 'block' : 'none';
    const caret = legendCollapsed ? 'ph-caret-up' : 'ph-caret-down';
    div.innerHTML = '<button type="button" class="legend-toggle" aria-expanded="' + (!legendCollapsed) + '"><strong>Legenda</strong><i class="ph ' + caret + '"></i></button>' +
      (legendCollapsed ? '' : '<div class="legend-body">' + html + '</div>');
  }

  // =============================================================
  // 17. LIGA/DESLIGA DAS CAMADAS
  // =============================================================
  // tipo da camada -> grupo no mapa e checkbox do painel
  const GRUPOS_CAMADA = { municipios: layerMunicipios, acudes: layerAcudes, bacias: layerBacias, rios: layerRios, pocos: layerPocos };
  const IDS_CHECK = { municipios: 'checkMunicipios', acudes: 'checkAcudes', bacias: 'checkBacias', rios: 'checkRios', pocos: 'checkPocos' };

  function chkDe(tipo) { return document.getElementById(IDS_CHECK[tipo]); }

  TIPOS_CAMADA.forEach(function (tipo) {
    const chk = chkDe(tipo);
    if (!chk) return;
    chk.addEventListener('change', function () {
      this.checked ? GRUPOS_CAMADA[tipo].addTo(map) : map.removeLayer(GRUPOS_CAMADA[tipo]);
      reordenarVetoriais();
      esconderHoverMun();
      updateLegend();
    });
  });

  updateLegend();

  const checkedBase = document.querySelector('input[name="basemapRadio"]:checked');
  setBasemap({ radioSat: 'sat', radioEsri: 'esri', radioDark: 'dark' }[checkedBase && checkedBase.id] || 'osm');

  // =============================================================
  // 18. OPACIDADE DAS CAMADAS
  // =============================================================
  // liga um slider de opacidade: atualiza o rótulo (%) e chama `aplicar(valor)`
  function ligarOpacidade(idSlider, idRotulo, aplicar) {
    const slider = document.getElementById(idSlider), rotulo = document.getElementById(idRotulo);
    if (!slider) return;
    let valor = 0, agendado = false;
    slider.addEventListener('input', function () {
      valor = parseFloat(this.value);
      if (rotulo) rotulo.textContent = Math.round(valor * 100) + '%';
      this.setAttribute('aria-valuetext', Math.round(valor * 100) + '%');   // leitores de tela leem "45%"
      // redesenhar camadas grandes a cada evento trava o slider: aplica no máximo uma vez por quadro
      if (!agendado) {
        agendado = true;
        requestAnimationFrame(function () { agendado = false; aplicar(valor); });
      }
    });
  }

  ligarOpacidade('rangeOpMun', 'valOpMun', function (v) {
    currentMunicipiosOpacity = v;
    if (geojsonMunicipios) geojsonMunicipios.setStyle({ fillOpacity: v });
  });
  ligarOpacidade('rangeOpAcu', 'valOpAcu', function (v) { if (geojsonAcudes) geojsonAcudes.setStyle({ fillOpacity: v, opacity: v }); });
  ligarOpacidade('rangeOpBac', 'valOpBac', function (v) { if (geojsonBacias) geojsonBacias.setStyle({ fillOpacity: v, opacity: v }); });
  ligarOpacidade('rangeOpPoc', 'valOpPoc', function (v) {
    opacidadePocos = v;
    map.getPane('pocosPane').style.opacity = v;
    circulosPocos.eachLayer(function (c) { c.setStyle({ fillOpacity: 0.95 * v, opacity: v }); });
  });
  ligarOpacidade('rangeOpRio', 'valOpRio', function (v) { if (geojsonRios) geojsonRios.setStyle({ opacity: v }); });

  // =============================================================
  // 19. INFOGRÁFICOS DA FICHA ("Em números")
  // Tudo é desenhado com HTML/SVG puro, a partir dos dados já carregados.
  // =============================================================
  let estatCache = null;
  let abaFicha = 'info';   // aba aberta por último (vale para as próximas fichas)

  const COR_INFO = { municipios: '#475569', acudes: '#0284c7', bacias: '#16a34a', rios: '#0891b2', pocos: '#d97706' };
  const BG_INFO  = { municipios: '#e2e8f0', acudes: '#e0f2fe', bacias: '#dcfce7', rios: '#cffafe', pocos: '#fef3c7' };

  function nf(v, d) { return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d === undefined ? 0 : d }); }
  function nfMi(v) { const m = v / 1e6; return nf(m, m < 10 ? 1 : 0); }
  function numOuNulo(v) { return (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? null : Number(v); }
  function anoDe(v) { const m = String(v === null || v === undefined ? '' : v).match(/(1[89]\d{2}|20\d{2})/); return m ? Number(m[1]) : null; }
  function mediaDe(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; }
  function posicaoEm(desc, v) { let n = 1; for (let i = 0; i < desc.length; i++) if (desc[i] > v) n++; return n; }
  function percentilEm(asc, v) { let n = 0; for (let i = 0; i < asc.length; i++) if (asc[i] < v) n++; return asc.length ? Math.round(n / asc.length * 100) : 0; }
  function indiceFaixa(limites, v) { for (let i = 0; i < limites.length; i++) if (v <= limites[i]) return i; return limites.length; }

  function comprimentoKm(layer) {
    const g = layer.feature && layer.feature.geometry;
    if (!g) return 0;
    const linhas = g.type === 'LineString' ? [g.coordinates] : (g.type === 'MultiLineString' ? g.coordinates : []);
    let m = 0;
    linhas.forEach(function (ln) {
      for (let i = 0; i < ln.length - 1; i++) m += L.latLng(ln[i][1], ln[i][0]).distanceTo(L.latLng(ln[i + 1][1], ln[i + 1][0]));
    });
    return m / 1000;
  }

  // estatísticas do estado inteiro (calculadas uma vez, sem filtros)
  function estatisticas() {
    if (estatCache) return estatCache;
    const E = {};
    const prop = function (l, c) { return numOuNulo((l.feature.properties || {})[c]); };

    E.acudes = todas.acudes.map(function (l) { return { l: l, v: prop(l, 'Capacidade') || 0 }; })
      .filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; });
    E.capTotal = E.acudes.reduce(function (s, x) { return s + x.v; }, 0);

    E.vazao = todas.pocos.map(function (l) { return prop(l, 'q_m3h'); }).filter(function (v) { return v !== null; }).sort(function (a, b) { return a - b; });
    E.prof  = todas.pocos.map(function (l) { return prop(l, 'profundidade'); }).filter(function (v) { return v !== null; }).sort(function (a, b) { return a - b; });
    E.vazMedia = mediaDe(E.vazao);

    E.areasMun = todas.municipios.map(function (l) { return prop(l, 'AREA_KM2'); }).filter(function (v) { return v !== null; }).sort(function (a, b) { return b - a; });
    const porMun = new Map();
    todas.pocos.forEach(function (p) {
      const ll = p.getLatLng();
      const m = todas.municipios.find(function (l) { return l.getBounds().contains(ll) && pointInGeometry(ll.lng, ll.lat, l.feature.geometry); });
      if (m) porMun.set(m, (porMun.get(m) || 0) + 1);
    });
    E.contPocos = todas.municipios.map(function (m) { return porMun.get(m) || 0; }).sort(function (a, b) { return b - a; });

    E.bacias = todas.bacias.map(function (l) { return { l: l, v: prop(l, 'Area_Km2') || 0 }; }).sort(function (a, b) { return b.v - a.v; });
    E.areaBacTotal = E.bacias.reduce(function (s, x) { return s + x.v; }, 0);

    estatCache = E;
    return E;
  }

  // ---------- blocos visuais ----------
  function secInfo(titulo, corpo, nota) {
    return '<div class="info-sec"><div class="info-title">' + titulo + '</div>' + corpo + (nota ? '<div class="info-nota">' + nota + '</div>' : '') + '</div>';
  }

  function kpisHtml(itens, tipo) {
    const validos = itens.filter(function (i) { return i.valor !== null && i.valor !== undefined && i.valor !== ''; }).slice(0, 4);
    if (!validos.length) return '';
    return '<div class="info-kpis">' + validos.map(function (i) {
      return '<div class="info-kpi"><span class="info-kpi-ico" style="background:' + BG_INFO[tipo] + ';color:' + COR_INFO[tipo] + ';"><i class="ph ' + i.icone + '"></i></span>' +
        '<div class="info-kpi-txt"><div class="info-kpi-val">' + i.valor + (i.un ? '<small> ' + i.un + '</small>' : '') + '</div><div class="info-kpi-lab">' + i.rotulo + '</div></div></div>';
    }).join('') + '</div>';
  }

  function barrasHtml(linhas) {
    if (!linhas.length) return '';
    const max = Math.max.apply(null, linhas.map(function (l) { return l.valor; })) || 1;
    return '<div class="info-barras">' + linhas.map(function (l) {
      return '<div class="info-barra' + (l.destaque ? ' destaque' : '') + '"><span class="info-barra-nome" title="' + escapeHtml(l.rotulo) + '">' + escapeHtml(l.rotulo) + '</span>' +
        '<span class="info-barra-trilho"><span class="info-barra-fill" style="width:' + Math.max(2, l.valor / max * 100) + '%;background:' + l.cor + ';"></span></span>' +
        '<span class="info-barra-val">' + l.texto + '</span></div>';
    }).join('') + '</div>';
  }

  function donutHtml(fatias, centro, sub) {
    const itens = fatias.filter(function (f) { return f.valor > 0; });
    const total = itens.reduce(function (s, f) { return s + f.valor; }, 0);
    if (!total) return '';
    const r = 38, C = 2 * Math.PI * r;
    let off = 0;
    const arcos = itens.map(function (f) {
      const len = C * f.valor / total;
      const s = '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + f.cor + '" stroke-width="16" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) +
        '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 50 50)"><title>' + escapeHtml(f.rotulo) + ': ' + f.valor.toLocaleString('pt-BR') + '</title></circle>';
      off += len;
      return s;
    }).join('');
    const legenda = itens.map(function (f) {
      return '<div class="info-leg-item"><span class="info-dot" style="background:' + f.cor + ';"></span><span class="info-leg-nome">' + escapeHtml(f.rotulo) +
        '</span><span class="info-leg-n">' + f.valor.toLocaleString('pt-BR') + '</span></div>';
    }).join('');
    return '<div class="info-donut"><svg viewBox="0 0 100 100" width="112" height="112" role="img" aria-label="Gráfico de rosca">' + arcos +
      '<text x="50" y="49" text-anchor="middle" class="info-donut-n">' + centro + '</text><text x="50" y="61" text-anchor="middle" class="info-donut-s">' + sub + '</text></svg>' +
      '<div class="info-leg">' + legenda + '</div></div>';
  }

  function gaugeHtml(pct, cor, textoDireita) {
    const r = 32, C = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
    const len = C * p / 100;
    return '<div class="info-gauge"><svg viewBox="0 0 80 80" width="86" height="86" role="img" aria-label="' + nf(p, 1) + '%">' +
      '<circle cx="40" cy="40" r="' + r + '" fill="none" stroke="#e2e8f0" stroke-width="9"></circle>' +
      '<circle cx="40" cy="40" r="' + r + '" fill="none" stroke="' + cor + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" transform="rotate(-90 40 40)"></circle>' +
      '<text x="40" y="45" text-anchor="middle" class="info-gauge-n">' + (p < 1 && p > 0 ? '<1' : nf(p, p < 10 ? 1 : 0)) + '%</text></svg>' +
      '<div class="info-gauge-txt">' + textoDireita + '</div></div>';
  }

  // régua: onde o valor está entre o menor e o maior do estado
  function posicaoHtml(titulo, posicao, total, cor) {
    const pct = total > 1 ? (total - posicao) / (total - 1) * 100 : 100;
    return '<div class="info-pos"><div class="info-pos-topo"><span>' + titulo + '</span><strong>' + posicao + 'º de ' + total.toLocaleString('pt-BR') + '</strong></div>' +
      '<div class="info-pos-barra"><span class="info-pos-marca" style="left:' + pct.toFixed(1) + '%;background:' + cor + ';"></span></div>' +
      '<div class="info-pos-eixo"><span>menor</span><span>maior</span></div></div>';
  }

  function histogramaHtml(faixas, destaque, cor) {
    const max = Math.max.apply(null, faixas.map(function (b) { return b.n; })) || 1;
    return '<div class="info-hist">' + faixas.map(function (b, i) {
      return '<div class="info-hist-col' + (i === destaque ? ' destaque' : '') + '" title="' + escapeHtml(b.rotulo) + ': ' + b.n.toLocaleString('pt-BR') + '">' +
        '<span class="info-hist-n">' + b.n.toLocaleString('pt-BR') + '</span>' +
        '<span class="info-hist-bar" style="height:' + Math.max(3, b.n / max * 64) + 'px;background:' + (i === destaque ? cor : '#cbd5e1') + ';"></span>' +
        '<span class="info-hist-rot">' + escapeHtml(b.rotulo) + '</span></div>';
    }).join('') + '</div>';
  }

  function empilhadaHtml(partes) {
    const total = partes.reduce(function (s, p) { return s + p.valor; }, 0) || 1;
    return '<div class="info-pilha">' + partes.map(function (p) {
      return '<span class="info-pilha-seg" style="width:' + (p.valor / total * 100).toFixed(1) + '%;background:' + p.cor + ';" title="' + escapeHtml(p.rotulo) + '"></span>';
    }).join('') + '</div><div class="info-pilha-leg">' + partes.map(function (p) {
      return '<span><i class="info-dot" style="background:' + p.cor + ';"></i>' + escapeHtml(p.rotulo) + ' <strong>' + p.texto + '</strong></span>';
    }).join('') + '</div>';
  }

  // poços de uma lista por órgão (rosca) e por faixa de vazão (barras)
  function blocoPocos(pocs, tituloSufixo) {
    let html = '';
    if (!pocs.length) return html;
    const cats = categoriasOrgao();
    const fatias = cats.map(function (c) {
      return { rotulo: c.rotulo, cor: c.cor, valor: pocs.filter(function (l) { return itemOrgao(l.feature.properties || {}) === c; }).length };
    });
    html += secInfo('Poços por órgão' + tituloSufixo, donutHtml(fatias, pocs.length.toLocaleString('pt-BR'), pocs.length === 1 ? 'poço' : 'poços'));

    const contagem = CLASSES_VAZAO.map(function () { return 0; });
    let semDado = 0;
    pocs.forEach(function (l) {
      const v = numOuNulo((l.feature.properties || {}).q_m3h);
      if (v === null) semDado++; else contagem[CLASSES_VAZAO.indexOf(classeDe(CLASSES_VAZAO, v))]++;
    });
    const linhas = CLASSES_VAZAO.map(function (c, i) { return { rotulo: c.rotulo + ' m³/h', valor: contagem[i], texto: contagem[i].toLocaleString('pt-BR'), cor: c.cor === '#ffffb2' ? '#e5e58a' : c.cor }; });
    if (semDado) linhas.push({ rotulo: 'Sem informação', valor: semDado, texto: semDado.toLocaleString('pt-BR'), cor: '#cbd5e1' });
    html += secInfo('Poços por faixa de vazão', barrasHtml(linhas));
    return html;
  }

  // ---------- por tipo de feição ----------
  function infoMunicipio(layer) {
    const E = estatisticas(), p = layer.feature.properties || {};
    const cor = COR_INFO.municipios;
    const pocs = pocosDentro(layer), acus = acudesDentro(layer);
    const area = numOuNulo(p.AREA_KM2);
    const capTot = acus.reduce(function (s, l) { return s + (numOuNulo((l.feature.properties || {}).Capacidade) || 0); }, 0);

    let html = secInfo('Visão geral', kpisHtml([
      { icone: 'ph-ruler', valor: area !== null ? nf(area, 1) : null, un: 'km²', rotulo: 'Área do município' },
      { icone: 'ph-drop-half-bottom', valor: nf(pocs.length), rotulo: pocs.length === 1 ? 'Poço cadastrado' : 'Poços cadastrados' },
      { icone: 'ph-drop', valor: nf(acus.length), rotulo: acus.length === 1 ? 'Açude' : 'Açudes' },
      capTot > 0 ? { icone: 'ph-stack', valor: nfMi(capTot), un: 'mi m³', rotulo: 'Capacidade dos açudes' }
                 : { icone: 'ph-chart-bar', valor: (area && pocs.length) ? nf(pocs.length / area * 100, 1) : null, un: 'por 100 km²', rotulo: 'Densidade de poços' }
    ], 'municipios'));

    let pos = '';
    if (area !== null) pos += posicaoHtml('Área', posicaoEm(E.areasMun, area), E.areasMun.length, cor);
    if (pocs.length) pos += posicaoHtml('Número de poços', posicaoEm(E.contPocos, pocs.length), E.contPocos.length, COR_INFO.pocos);
    if (pos) html += secInfo('Posição no estado', pos, 'Entre os ' + E.areasMun.length + ' municípios da Paraíba.');

    html += blocoPocos(pocs, '');

    const comCap = acus.map(function (l) { return { l: l, v: numOuNulo((l.feature.properties || {}).Capacidade) || 0 }; })
      .filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 5);
    if (comCap.length) {
      html += secInfo('Açudes por capacidade', barrasHtml(comCap.map(function (x) {
        return { rotulo: (x.l.feature.properties || {}).Nome || 'Açude sem nome', valor: x.v, texto: nfMi(x.v) + ' mi m³', cor: COR_INFO.acudes };
      })));
    }
    return html;
  }

  function infoAcude(layer) {
    const E = estatisticas(), p = layer.feature.properties || {};
    const cap = numOuNulo(p.Capacidade) || 0, esp = numOuNulo(p.A_Espelho) || 0, alt = numOuNulo(p.Alt_Barrag) || 0;
    const bh = numOuNulo(p.B_Hidrog) || 0, vm = numOuNulo(p.Vol_Morto) || 0;
    const ano = anoDe(p.Conclusao), idade = ano ? new Date().getFullYear() - ano : null;

    let html = secInfo('Visão geral', kpisHtml([
      cap > 0 ? { icone: 'ph-stack', valor: nfMi(cap), un: 'milhões de m³', rotulo: 'Capacidade' } : null,
      esp > 0 ? { icone: 'ph-waves', valor: nf(esp / 1e6, 2), un: 'km²', rotulo: 'Espelho d\'água' } : null,
      alt > 0 ? { icone: 'ph-arrow-line-up', valor: nf(alt, 1), un: 'm', rotulo: 'Altura da barragem' } : null,
      bh > 0 ? { icone: 'ph-polygon', valor: nf(bh, 0), un: 'km²', rotulo: 'Bacia hidrográfica' } : null,
      idade !== null && idade >= 0 ? { icone: 'ph-calendar-blank', valor: nf(idade), un: 'anos', rotulo: 'Desde a conclusão (' + ano + ')' } : null
    ].filter(Boolean), 'acudes'));

    if (cap > 0) {
      const pos = posicaoEm(E.acudes.map(function (x) { return x.v; }), cap);
      const part = cap / E.capTotal * 100;
      html += secInfo('Posição entre os açudes', posicaoHtml('Capacidade', pos, E.acudes.length, COR_INFO.acudes) +
        gaugeHtml(part, COR_INFO.acudes, 'da capacidade total dos <strong>' + E.acudes.length + '</strong> açudes mapeados<br><span class="info-nota-inline">≈ ' + nf(cap / 2500) + ' piscinas olímpicas</span>'));

      const top = E.acudes.slice(0, 6).map(function (x) {
        return { rotulo: (x.l.feature.properties || {}).Nome || 'Açude', valor: x.v, texto: nfMi(x.v) + ' mi m³', cor: x.l === layer ? COR_INFO.acudes : '#cbd5e1', destaque: x.l === layer };
      });
      if (!top.some(function (x) { return x.destaque; })) {
        top.push({ rotulo: p.Nome || 'Este açude', valor: cap, texto: nfMi(cap) + ' mi m³', cor: COR_INFO.acudes, destaque: true });
      }
      html += secInfo('Comparado aos maiores açudes', barrasHtml(top));

      if (vm > 0 && vm < cap) {
        html += secInfo('Volume útil e volume morto', empilhadaHtml([
          { rotulo: 'Útil', valor: cap - vm, texto: nfMi(cap - vm) + ' mi m³', cor: COR_INFO.acudes },
          { rotulo: 'Morto', valor: vm, texto: nfMi(vm) + ' mi m³', cor: '#94a3b8' }
        ]));
      }
    }
    return html;
  }

  function infoPoco(layer) {
    const E = estatisticas(), p = layer.feature.properties || {};
    const cor = COR_INFO.pocos;
    const prof = numOuNulo(p.profundidade), vaz = numOuNulo(p.q_m3h);
    const ano = anoDe(p.data_perfuracao), idade = ano ? new Date().getFullYear() - ano : null;
    const orgao = prettify(normOrgao(p.orgao));

    let html = secInfo('Visão geral', kpisHtml([
      prof !== null ? { icone: 'ph-arrow-line-down', valor: nf(prof, 1), un: 'm', rotulo: 'Profundidade' } : null,
      vaz !== null ? { icone: 'ph-gauge', valor: nf(vaz, 1), un: 'm³/h', rotulo: 'Vazão' } : null,
      idade !== null && idade >= 0 ? { icone: 'ph-calendar-blank', valor: nf(idade), un: 'anos', rotulo: 'Perfurado em ' + ano } : null,
      { icone: 'ph-buildings', valor: escapeHtml(orgao), rotulo: 'Órgão responsável' }
    ].filter(Boolean), 'pocos'));

    if (vaz !== null) {
      const contagem = CLASSES_VAZAO.map(function () { return 0; });
      E.vazao.forEach(function (v) { contagem[CLASSES_VAZAO.indexOf(classeDe(CLASSES_VAZAO, v))]++; });
      const faixas = CLASSES_VAZAO.map(function (c, i) { return { rotulo: c.rotulo, n: contagem[i] }; });
      const pc = percentilEm(E.vazao, vaz);
      html += secInfo('Vazão comparada aos outros poços', histogramaHtml(faixas, CLASSES_VAZAO.indexOf(classeDe(CLASSES_VAZAO, vaz)), cor),
        'Vazão em m³/h. Maior que <strong>' + pc + '%</strong> dos ' + E.vazao.length.toLocaleString('pt-BR') + ' poços com vazão informada.');

      const mun = municipioDoAcude(layer);
      const linhas = [{ rotulo: 'Este poço', valor: vaz, texto: nf(vaz, 1) + ' m³/h', cor: cor, destaque: true }];
      if (mun) {
        const mv = mediaDe(pocosDentro(mun).map(function (l) { return numOuNulo((l.feature.properties || {}).q_m3h); }).filter(function (v) { return v !== null; }));
        if (mv !== null) linhas.push({ rotulo: 'Média do município', valor: mv, texto: nf(mv, 1) + ' m³/h', cor: '#cbd5e1' });
      }
      if (E.vazMedia !== null) linhas.push({ rotulo: 'Média do estado', valor: E.vazMedia, texto: nf(E.vazMedia, 1) + ' m³/h', cor: '#94a3b8' });
      html += secInfo('Comparação de vazão', barrasHtml(linhas));
    }

    if (prof !== null) {
      const lim = [30, 60, 100, 150];
      const rot = ['até 30', '30 – 60', '60 – 100', '100 – 150', 'mais de 150'];
      const cont = [0, 0, 0, 0, 0];
      E.prof.forEach(function (v) { cont[indiceFaixa(lim, v)]++; });
      html += secInfo('Profundidade comparada aos outros poços',
        histogramaHtml(rot.map(function (r, i) { return { rotulo: r, n: cont[i] }; }), indiceFaixa(lim, prof), cor),
        'Profundidade em metros. Maior que <strong>' + percentilEm(E.prof, prof) + '%</strong> dos poços.');
    }
    return html;
  }

  function infoBacia(layer) {
    const E = estatisticas(), p = layer.feature.properties || {};
    const area = numOuNulo(p.Area_Km2), per = numOuNulo(p.Perimetro);
    const pocs = pocosDentro(layer), acus = acudesDentro(layer);
    const capTot = acus.reduce(function (s, l) { return s + (numOuNulo((l.feature.properties || {}).Capacidade) || 0); }, 0);

    let html = secInfo('Visão geral', kpisHtml([
      area !== null ? { icone: 'ph-ruler', valor: nf(area, 0), un: 'km²', rotulo: 'Área da bacia' } : null,
      per !== null ? { icone: 'ph-polygon', valor: nf(per, 0), un: 'km', rotulo: 'Perímetro' } : null,
      { icone: 'ph-drop', valor: nf(acus.length), rotulo: acus.length === 1 ? 'Açude' : 'Açudes' },
      { icone: 'ph-drop-half-bottom', valor: nf(pocs.length), rotulo: pocs.length === 1 ? 'Poço' : 'Poços' }
    ].filter(Boolean), 'bacias'));

    if (area !== null && E.areaBacTotal > 0) {
      html += secInfo('Tamanho entre as bacias', gaugeHtml(area / E.areaBacTotal * 100, COR_INFO.bacias, 'da área somada das <strong>' + E.bacias.length + '</strong> bacias da Paraíba') +
        barrasHtml(E.bacias.map(function (x) {
          const pr = x.l.feature.properties || {};
          return { rotulo: pr.Nome || 'Bacia', valor: x.v, texto: nf(x.v, 0) + ' km²', cor: x.l === layer ? COR_INFO.bacias : '#cbd5e1', destaque: x.l === layer };
        })));
    }
    if (capTot > 0) html += secInfo('Água acumulada', '<div class="info-destaque"><strong>' + nfMi(capTot) + '</strong> milhões de m³ <span>nos ' + acus.length + ' açudes da bacia</span></div>');
    html += blocoPocos(pocs, '');
    return html;
  }

  function infoRio(layer) {
    const p = layer.feature.properties || {};
    const km = comprimentoKm(layer);
    const nome = p.Nome || p.NOME || '';
    const ordem = numOuNulo(p.nu_ordem);

    let mesmoRio = null;
    if (nome) {
      let n = 0, total = 0;
      todas.rios.forEach(function (l) {
        if ((l.feature.properties || {}).Nome === nome) { n++; total += comprimentoKm(l); }
      });
      mesmoRio = { n: n, km: total };
    }

    let html = secInfo('Visão geral', kpisHtml([
      km > 0 ? { icone: 'ph-ruler', valor: nf(km, 1), un: 'km', rotulo: 'Extensão deste trecho' } : null,
      mesmoRio ? { icone: 'ph-waves', valor: nf(mesmoRio.n), rotulo: mesmoRio.n === 1 ? 'Trecho mapeado do rio' : 'Trechos mapeados do rio' } : null,
      mesmoRio ? { icone: 'ph-chart-bar', valor: nf(mesmoRio.km, 0), un: 'km', rotulo: 'Extensão somada do rio' } : null,
      ordem !== null && ordem > 0 ? { icone: 'ph-polygon', valor: nf(ordem), rotulo: 'Ordem do curso d\'água' } : null
    ].filter(Boolean), 'rios'));

    if (mesmoRio && mesmoRio.km > 0 && km > 0) {
      html += secInfo('Este trecho no rio', barrasHtml([
        { rotulo: 'Este trecho', valor: km, texto: nf(km, 1) + ' km', cor: COR_INFO.rios, destaque: true },
        { rotulo: 'Rio inteiro', valor: mesmoRio.km, texto: nf(mesmoRio.km, 0) + ' km', cor: '#cbd5e1' }
      ]));
    }
    if (ordem !== null && ordem > 0) {
      let max = 0;
      todas.rios.forEach(function (l) { const o = numOuNulo((l.feature.properties || {}).nu_ordem); if (o !== null && o > max) max = o; });
      if (max > 1) {
        const seg = [];
        for (let i = 1; i <= max; i++) seg.push('<span class="info-ordem-seg' + (i <= ordem ? ' on' : '') + '" title="Ordem ' + i + '"></span>');
        html += secInfo('Hierarquia do curso d\'água', '<div class="info-ordem">' + seg.join('') + '</div>',
          'Ordem <strong>' + ordem + '</strong> de ' + max + '. Quanto maior a ordem, mais volumoso é o rio.');
      }
    }
    return html;
  }

  function infograficoDe(tipo, layer) {
    try {
      if (tipo === 'municipios') return infoMunicipio(layer);
      if (tipo === 'acudes') return infoAcude(layer);
      if (tipo === 'pocos') return infoPoco(layer);
      if (tipo === 'bacias') return infoBacia(layer);
      if (tipo === 'rios') return infoRio(layer);
    } catch (e) {
      console.error('Infográfico:', e);
    }
    return '';
  }

  // =============================================================
  // 20. MAPAS TEMÁTICOS
  // =============================================================
  function classesAreaMun() {
    if (classesMun) return classesMun;
    const v = todas.municipios.map(function (l) { return Number(l.feature.properties.AREA_KM2); })
      .filter(function (x) { return isFinite(x); }).sort(function (a, b) { return a - b; });
    const q = function (p) { return Math.round(v[Math.min(v.length - 1, Math.floor(v.length * p))]); };
    const b = [q(0.2), q(0.4), q(0.6), q(0.8)];
    const f = function (n) { return n.toLocaleString('pt-BR'); };
    classesMun = [
      { max: b[0],     rotulo: 'até ' + f(b[0]),                cor: RAMPA_AREA[0] },
      { max: b[1],     rotulo: f(b[0]) + ' – ' + f(b[1]),       cor: RAMPA_AREA[1] },
      { max: b[2],     rotulo: f(b[1]) + ' – ' + f(b[2]),       cor: RAMPA_AREA[2] },
      { max: b[3],     rotulo: f(b[2]) + ' – ' + f(b[3]),       cor: RAMPA_AREA[3] },
      { max: Infinity, rotulo: 'mais de ' + f(b[3]),            cor: RAMPA_AREA[4] }
    ];
    return classesMun;
  }

  function recontarPocosPorMunicipio() {
    contagemMun = new Map();
    const pontos = geojsonPocos ? geojsonPocos.getLayers() : [];   // só os poços visíveis (respeita filtros)
    pontos.forEach(function (p) {
      const ll = p.getLatLng();
      const m = todas.municipios.find(function (l) {
        return l.getBounds().contains(ll) && pointInGeometry(ll.lng, ll.lat, l.feature.geometry);
      });
      if (m) contagemMun.set(m.feature, (contagemMun.get(m.feature) || 0) + 1);
    });
  }

  function corTemaMun(feature) {
    if (temas.municipios === 'area') {
      const a = Number(feature.properties.AREA_KM2);
      return isFinite(a) ? classeDe(classesAreaMun(), a).cor : '#e2e8f0';
    }
    if (temas.municipios === 'pocos') return classeDe(CLASSES_POCOS_MUN, contagemMun.get(feature) || 0).cor;
    return munFill;
  }

  function definirOpacidadeMun(v) {
    currentMunicipiosOpacity = v;
    const r = document.getElementById('rangeOpMun'), t = document.getElementById('valOpMun');
    if (r) r.value = v;
    if (t) t.textContent = Math.round(v * 100) + '%';
  }

  function garantirCamadaLigada(tipo) {
    const chk = chkDe(tipo);
    if (chk && !chk.checked) { chk.checked = true; chk.dispatchEvent(new Event('change')); }
  }

  function aplicarTemaMun(valor) {
    const anterior = temas.municipios;
    temas.municipios = valor;
    if (valor === 'pocos') recontarPocosPorMunicipio();
    if (anterior === 'nenhum' && valor !== 'nenhum') { opMunAntes = currentMunicipiosOpacity; definirOpacidadeMun(0.75); }
    else if (valor === 'nenhum' && anterior !== 'nenhum') { definirOpacidadeMun(opMunAntes); }
    if (geojsonMunicipios) geojsonMunicipios.setStyle(getMunStyle);
    if (valor !== 'nenhum') garantirCamadaLigada('municipios');
    updateLegend();
    agendarHash();
  }

  // ---- açudes: símbolos proporcionais à capacidade ----
  function capMaxAcudes() {
    return todas.acudes.reduce(function (m, l) { return Math.max(m, Number(l.feature.properties.Capacidade) || 0); }, 0);
  }

  function raioAcude(cap, max) { return 4 + 20 * Math.sqrt(cap / max); }

  function reconstruirSimbolosAcudes() {
    simbolosAcudes.clearLayers();
    if (temas.acudes !== 'capacidade' || !geojsonAcudes) return;
    const max = capMaxAcudes() || 1;
    geojsonAcudes.getLayers().forEach(function (l) {
      const props = l.feature.properties || {};
      const cap = Number(props.Capacidade) || 0;
      if (cap <= 0) return;
      const s = L.circleMarker(featureCenter(l), {
        pane: 'vetoresPane', renderer: rendererVetores, radius: raioAcude(cap, max), color: '#ffffff', weight: 1.5, fillColor: '#0ea5e9', fillOpacity: 0.7
      });
      s.bindTooltip((props.Nome || 'Açude') + ' · ' + fmtNum(cap / 1e6, 1) + ' milhões de m³', { direction: 'top' });
      s.on('click', function () {
        if (medindo()) return;
        l.fire('click');
      });
      simbolosAcudes.addLayer(s);
    });
  }

  function aplicarTemaAcudes(valor) {
    temas.acudes = valor;
    reconstruirSimbolosAcudes();
    if (valor === 'capacidade') { layerAcudes.addLayer(simbolosAcudes); garantirCamadaLigada('acudes'); }
    else layerAcudes.removeLayer(simbolosAcudes);
    reordenarVetoriais();
    updateLegend();
    agendarHash();
  }

  // ---- poços: cor por órgão ou por vazão ----
  function normOrgao(v) {
    const s = semAcentos(v === null || v === undefined ? '' : v).trim().toUpperCase();
    return s || 'NAO INFORMADO';
  }

  function categoriasOrgao() {
    if (catOrgaos) return catOrgaos;
    const cont = {};
    todas.pocos.forEach(function (l) { const o = normOrgao(l.feature.properties.orgao); cont[o] = (cont[o] || 0) + 1; });
    const principais = Object.keys(cont).filter(function (k) { return k !== 'NAO INFORMADO'; })
      .sort(function (a, b) { return cont[b] - cont[a]; }).slice(0, 6);
    catOrgaos = principais.map(function (k, i) { return { chave: k, rotulo: prettify(k), cor: CORES_ORGAO[i] }; })
      .concat([{ chave: '__outros', rotulo: 'Outros órgãos', cor: '#64748b' }, { chave: 'NAO INFORMADO', rotulo: 'Não informado', cor: '#cbd5e1' }]);
    return catOrgaos;
  }

  function itemOrgao(props) {
    const k = normOrgao(props.orgao), cats = categoriasOrgao();
    return cats.find(function (i) { return i.chave === k; }) || cats.find(function (i) { return i.chave === '__outros'; });
  }

  function corPoco(props) {
    if (temas.pocos === 'orgao') return itemOrgao(props).cor;
    if (temas.pocos === 'vazao') {
      const v = Number(props.q_m3h);
      return (props.q_m3h === null || props.q_m3h === undefined || !isFinite(v)) ? '#cbd5e1' : classeDe(CLASSES_VAZAO, v).cor;
    }
    return '#d97706';
  }

  function reconstruirCirculosPocos() {
    circulosPocos.clearLayers();
    if (temas.pocos === 'nenhum' || !geojsonPocos) return;
    geojsonPocos.getLayers().forEach(function (m) {
      const props = m.feature.properties || {};
      const c = L.circleMarker(m.getLatLng(), {
        renderer: rendererVetores, pane: 'vetoresPane', radius: 6, color: 'rgba(15,23,42,0.55)', weight: 1, opacity: opacidadePocos,
        fillColor: corPoco(props), fillOpacity: 0.95 * opacidadePocos, bubblingMouseEvents: false
      });
      c.bindTooltip(rotuloPoco(props), { direction: 'top', offset: [0, -4] });
      c.on('click', function () { m.fire('click'); });
      circulosPocos.addLayer(c);
    });
  }

  function aplicarTemaPocos(valor) {
    temas.pocos = valor;
    if (valor !== 'nenhum') {
      reconstruirCirculosPocos();
      if (clusterPocos) layerPocos.removeLayer(clusterPocos); else if (geojsonPocos) layerPocos.removeLayer(geojsonPocos);
      layerPocos.addLayer(circulosPocos);
      garantirCamadaLigada('pocos');
    } else {
      layerPocos.removeLayer(circulosPocos);
      circulosPocos.clearLayers();
      if (clusterPocos) layerPocos.addLayer(clusterPocos); else if (geojsonPocos) layerPocos.addLayer(geojsonPocos);
    }
    reordenarVetoriais();
    updateLegend();
    agendarHash();
  }

  [['temaMun', aplicarTemaMun], ['temaAcu', aplicarTemaAcudes], ['temaPoc', aplicarTemaPocos]].forEach(function (par) {
    const el = document.getElementById(par[0]);
    if (el) el.addEventListener('change', function () { par[1](el.value); });
  });

  // =============================================================
  // 21. FILTROS NO MAPA
  // =============================================================
  const FILTROS = {
    pocos: [
      { id: 'orgao', r: 'Órgão', t: 'lista', c: 'orgao' },
      { id: 'equip', r: 'Equipamento', t: 'lista', c: 'equipamento' },
      { id: 'meso',  r: 'Mesorregião', t: 'lista', c: 'mesoregiao' },
      { id: 'vaz',   r: 'Vazão mínima (m³/h)', t: 'min', c: 'q_m3h' },
      { id: 'prof',  r: 'Profundidade mínima (m)', t: 'min', c: 'profundidade' }
    ],
    acudes: [
      { id: 'fin',  r: 'Finalidade', t: 'contem', c: 'Finalidade', opcoes: [
        ['Abastecimento', 'abastec'], ['Irrigação', 'irrig'], ['Piscicultura', 'p[a-z]*cultura'],
        ['Perenização', 'perenizac'], ['Turismo', 'turism'], ['Energia', 'energ|eletrific'] ] },
      { id: 'meso', r: 'Mesorregião', t: 'lista', c: 'Mesorreg' },
      { id: 'cap',  r: 'Capacidade mínima (milhões de m³)', t: 'min', c: 'Capacidade', fator: 1e6 }
    ],
    municipios: [
      { id: 'rgi',  r: 'Região geográfica imediata', t: 'lista', c: 'NM_RGI' },
      { id: 'amin', r: 'Área mínima (km²)', t: 'min', c: 'AREA_KM2' },
      { id: 'amax', r: 'Área máxima (km²)', t: 'max', c: 'AREA_KM2' }
    ],
    bacias: [
      { id: 'comite', r: 'Comitê de bacia', t: 'lista', c: 'Comite' }
    ],
    rios: [
      { id: 'dom',    r: 'Domínio', t: 'lista', c: 'Dominio' },
      { id: 'conama', r: 'Classe (CONAMA 357)', t: 'lista', c: 'CONAMA357' },
      { id: 'ordem',  r: 'Ordem mínima do curso d\'água', t: 'min', c: 'nu_ordem' }
    ]
  };

  const NOMES_CAMADA = {
    pocos: ['poço', 'poços'], acudes: ['açude', 'açudes'], municipios: ['município', 'municípios'],
    bacias: ['bacia', 'bacias'], rios: ['trecho de rio', 'trechos de rio']
  };

  const filtroCamadaSel = document.getElementById('filtroCamada');
  const filtroCampos = document.getElementById('filtroCampos');
  const filtroResumo = document.getElementById('filtroResumo');
  const filtrosBadge = document.getElementById('filtrosBadge');
  let filtroTipoAtual = 'pocos';

  // valor do campo como o usuário vê (mesma formatação da tabela)
  function valorLista(tipo, d, props) {
    const cfg = CAMPOS[tipo];
    const def = (cfg && cfg.campos.find(function (x) { return x.c === d.c; })) || { c: d.c };
    return formatarCampo(def, props[d.c]);
  }

  function opcoesLista(tipo, d) {
    if (d._opcoes) return d._opcoes;
    const cont = {};
    todas[tipo].forEach(function (l) {
      const v = valorLista(tipo, d, l.feature.properties || {});
      if (v !== '') cont[v] = (cont[v] || 0) + 1;
    });
    const col = new Intl.Collator('pt-BR', { sensitivity: 'base' });
    d._opcoes = Object.keys(cont).sort(function (a, b) { return col.compare(prettify(a), prettify(b)); })
      .map(function (v) { return { v: v, n: cont[v] }; });
    return d._opcoes;
  }

  function passaFiltros(tipo, feature) {
    const f = filtros[tipo], defs = FILTROS[tipo], props = feature.properties || {};
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i], v = f[d.id];
      if (v === undefined || v === '') continue;
      if (d.t === 'lista') {
        if (valorLista(tipo, d, props) !== v) return false;
      } else if (d.t === 'contem') {
        const op = d.opcoes.find(function (o) { return o[0] === v; });
        if (!op || !new RegExp(op[1]).test(normalizarBusca(props[d.c] || ''))) return false;
      } else {
        if (props[d.c] === null || props[d.c] === undefined || props[d.c] === '') return false;
        const n = Number(props[d.c]);
        if (!isFinite(n)) return false;
        const lim = Number(v) * (d.fator || 1);
        if (d.t === 'min' && n < lim) return false;
        if (d.t === 'max' && n > lim) return false;
      }
    }
    return true;
  }

  function atualizarResumoFiltro() {
    const tipo = filtroTipoAtual, g = getLayerByName(tipo);
    const n = g ? g.getLayers().length : 0, total = todas[tipo].length;
    const ativos = Object.keys(filtros[tipo]).length;
    const nome = NOMES_CAMADA[tipo][total === 1 ? 0 : 1];
    if (filtroResumo) {
      filtroResumo.innerHTML = ativos
        ? '<strong>' + n.toLocaleString('pt-BR') + '</strong> de ' + total.toLocaleString('pt-BR') + ' ' + nome + ' no mapa'
        : '<span class="text-muted">Sem filtros · ' + total.toLocaleString('pt-BR') + ' ' + nome + '</span>';
    }
    const limpar = document.getElementById('filtroLimpar');
    if (limpar) limpar.hidden = !ativos;

    const camadasFiltradas = TIPOS_CAMADA.filter(function (t) { return filtroAtivo(t); }).length;
    if (filtrosBadge) { filtrosBadge.textContent = camadasFiltradas; filtrosBadge.hidden = camadasFiltradas === 0; }
  }

  // mostra/oculta no mapa as feições conforme os filtros da camada
  function aplicarFiltros(tipo) {
    const grupo = getLayerByName(tipo);
    if (!grupo) return;
    todas[tipo].forEach(function (l) {
      const ok = passaFiltros(tipo, l.feature), tem = grupo.hasLayer(l);
      if (ok && !tem) grupo.addLayer(l);
      else if (!ok && tem) grupo.removeLayer(l);
    });

    if (tipo === 'pocos') {
      if (clusterPocos) { clusterPocos.clearLayers(); clusterPocos.addLayers(geojsonPocos.getLayers()); }
      if (temas.pocos !== 'nenhum') reconstruirCirculosPocos();
      if (temas.municipios === 'pocos') { recontarPocosPorMunicipio(); geojsonMunicipios.setStyle(getMunStyle); }
    }
    if (tipo === 'acudes' && temas.acudes === 'capacidade') reconstruirSimbolosAcudes();

    if (filtroAtivo(tipo)) garantirCamadaLigada(tipo);

    // a tabela passa a mostrar só o que está no mapa
    if (attributeTablePanel && !attributeTablePanel.classList.contains('closed') && layerTableSelect && layerTableSelect.value === tipo) {
      carregarDadosTabela(grupo);
    }
    atualizarResumoFiltro();
    reordenarVetoriais();
    updateLegend();
    agendarHash();
  }

  function renderizarFiltros(tipo) {
    filtroTipoAtual = tipo;
    if (filtroCamadaSel) filtroCamadaSel.value = tipo;
    if (!filtroCampos) return;
    const f = filtros[tipo];
    filtroCampos.innerHTML = FILTROS[tipo].map(function (d) {
      const v = f[d.id] === undefined ? '' : String(f[d.id]);
      const idCtl = 'filtro-' + tipo + '-' + d.id;
      let ctl;
      if (d.t === 'lista') {
        ctl = '<select id="' + idCtl + '" class="form-select form-select-sm" data-filtro="' + d.id + '"><option value="">Todos</option>' +
          opcoesLista(tipo, d).map(function (o) {
            return '<option value="' + escapeHtml(o.v) + '"' + (o.v === v ? ' selected' : '') + '>' + escapeHtml(prettify(o.v)) + ' (' + o.n.toLocaleString('pt-BR') + ')</option>';
          }).join('') + '</select>';
      } else if (d.t === 'contem') {
        ctl = '<select id="' + idCtl + '" class="form-select form-select-sm" data-filtro="' + d.id + '"><option value="">Todas</option>' +
          d.opcoes.map(function (o) { return '<option value="' + escapeHtml(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + o[0] + '</option>'; }).join('') + '</select>';
      } else {
        ctl = '<input id="' + idCtl + '" type="number" min="0" step="any" class="form-control form-control-sm" data-filtro="' + d.id + '" value="' + escapeHtml(v) + '" placeholder="Qualquer">';
      }
      return '<div class="filtro-campo"><label class="form-label" for="' + idCtl + '">' + d.r + '</label>' + ctl + '</div>';
    }).join('');
    atualizarResumoFiltro();
  }

  if (filtroCampos) {
    let tFiltro = null;
    filtroCampos.addEventListener('input', function (e) {
      const el = e.target.closest('[data-filtro]');
      if (!el) return;
      clearTimeout(tFiltro);
      tFiltro = setTimeout(function () {
        const tipo = filtroTipoAtual, v = el.value.trim();
        if (v === '') delete filtros[tipo][el.dataset.filtro]; else filtros[tipo][el.dataset.filtro] = v;
        aplicarFiltros(tipo);
      }, 250);
    });
  }

  if (filtroCamadaSel) filtroCamadaSel.addEventListener('change', function () { renderizarFiltros(filtroCamadaSel.value); });

  const btnFiltroLimpar = document.getElementById('filtroLimpar');
  if (btnFiltroLimpar) btnFiltroLimpar.addEventListener('click', function () {
    filtros[filtroTipoAtual] = {};
    renderizarFiltros(filtroTipoAtual);
    aplicarFiltros(filtroTipoAtual);
  });

  function limitesDe(camadas) {
    const b = L.latLngBounds([]);
    camadas.forEach(function (l) {
      if (l.getBounds) b.extend(l.getBounds()); else if (l.getLatLng) b.extend(l.getLatLng());
    });
    return b;
  }

  function aproximarResultados(tipo) {
    const grupo = getLayerByName(tipo), camadas = grupo ? grupo.getLayers() : [];
    if (!camadas.length) { if (filtroResumo) filtroResumo.innerHTML = '<span class="text-danger">Nenhum resultado para aproximar.</span>'; return; }
    garantirCamadaLigada(tipo);
    const b = limitesDe(camadas);
    if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 14 });
  }

  const btnFiltroZoom = document.getElementById('filtroZoom');
  if (btnFiltroZoom) btnFiltroZoom.addEventListener('click', function () { aproximarResultados(filtroTipoAtual); });

  const btnFiltroTabela = document.getElementById('filtroTabela');
  if (btnFiltroTabela) btnFiltroTabela.addEventListener('click', function () {
    const grupo = getLayerByName(filtroTipoAtual);
    if (!grupo || !attributeTablePanel) return;
    if (layerTableSelect) layerTableSelect.value = filtroTipoAtual;
    attributeTablePanel.classList.remove('closed');
    carregarDadosTabela(grupo);
  });

  renderizarFiltros('pocos');

  // =============================================================
  // 22. LAYOUT: PROJEÇÕES E CONVERSÕES (Mercator da web e UTM)
  // =============================================================
  const RAD = Math.PI / 180;
  const CIRC_EQUADOR = 40075016.686;   // metros

  // Mercator da web normalizado: x e y de 0 a 1 em todo o mundo
  function mercX(lng) { return (lng + 180) / 360; }
  function mercY(lat) {
    const s = Math.sin(lat * RAD);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }
  function mercLng(x) { return x * 360 - 180; }
  function mercLat(y) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD; }

  // UTM sobre o elipsoide GRS80 (SIRGAS 2000; diferença para o WGS 84 é de milímetros)
  const UTM = (function () {
    const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996;
    const n = f / (2 - f), e = Math.sqrt(f * (2 - f));
    const n2 = n * n, n3 = n2 * n, n4 = n3 * n;
    const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64);
    const alfa = [
      n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180,
      13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440,
      61 * n3 / 240 - 103 * n4 / 140,
      49561 * n4 / 161280
    ];
    const beta = [
      n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360,
      n2 / 48 + n3 / 15 - 437 * n4 / 1440,
      17 * n3 / 480 - 37 * n4 / 840,
      4397 * n4 / 161280
    ];
    const asinh = Math.asinh || function (x) { return Math.log(x + Math.sqrt(x * x + 1)); };
    const atanh = Math.atanh || function (x) { return 0.5 * Math.log((1 + x) / (1 - x)); };

    function meridiano(zona) { return (zona * 6 - 183) * RAD; }

    // lat/lng (graus) -> { e, n } em metros (hemisfério sul soma 10.000.000 ao norte)
    function direto(lat, lng, zona) {
      const phi = lat * RAD, lam = lng * RAD - meridiano(zona);
      const tau = Math.tan(phi);
      const sigma = Math.sinh(e * atanh(e * tau / Math.sqrt(1 + tau * tau)));
      const tauL = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
      const xiL = Math.atan2(tauL, Math.cos(lam));
      const etaL = asinh(Math.sin(lam) / Math.sqrt(tauL * tauL + Math.cos(lam) * Math.cos(lam)));
      let xi = xiL, eta = etaL;
      for (let j = 1; j <= 4; j++) {
        xi += alfa[j - 1] * Math.sin(2 * j * xiL) * Math.cosh(2 * j * etaL);
        eta += alfa[j - 1] * Math.cos(2 * j * xiL) * Math.sinh(2 * j * etaL);
      }
      return { e: 500000 + k0 * A * eta, n: (lat < 0 ? 10000000 : 0) + k0 * A * xi };
    }

    // { e, n } -> { lat, lng } em graus
    function inverso(E, N, zona, sul) {
      const xi = ((sul ? N - 10000000 : N)) / (k0 * A), eta = (E - 500000) / (k0 * A);
      let xiL = xi, etaL = eta;
      for (let j = 1; j <= 4; j++) {
        xiL -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
        etaL -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
      }
      const tauL = Math.sin(xiL) / Math.sqrt(Math.sinh(etaL) * Math.sinh(etaL) + Math.cos(xiL) * Math.cos(xiL));
      let tau = tauL;
      for (let i = 0; i < 6; i++) {
        const sigma = Math.sinh(e * atanh(e * tau / Math.sqrt(1 + tau * tau)));
        const tauI = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
        tau += (tauL - tauI) / Math.sqrt(1 + tauI * tauI) * (1 + (1 - e * e) * tau * tau) / ((1 - e * e) * Math.sqrt(1 + tau * tau));
      }
      return { lat: Math.atan(tau) / RAD, lng: (Math.atan2(Math.sinh(etaL), Math.cos(xiL)) + meridiano(zona)) / RAD };
    }
    return { direto: direto, inverso: inverso };
  })();

  // =============================================================
  // 23. LAYOUT: MODELOS (leitura de .qpt do QGIS e modelo padrão do portal)
  // Um modelo é { nome, pagina: [largura, altura] em mm, itens: [...], avisos: [...] }.
  // Cada item tem tipo ('mapa', 'rotulo', 'legenda', 'escala', 'norte', 'forma', 'linha')
  // e retângulo x, y, w, h em milímetros.
  // =============================================================
  const TIPOS_QGIS = {
    65638: 'pagina', 65639: 'mapa', 65640: 'imagem', 65641: 'rotulo', 65642: 'legenda',
    65643: 'forma', 65644: 'poligono', 65645: 'linha', 65646: 'escala', 65647: 'norte',
    65648: 'tabela', 65649: 'html', 65650: 'moldura', 65651: 'grupo'
  };
  const NOMES_TIPO = { imagem: 'imagem', tabela: 'tabela', html: 'moldura HTML', moldura: 'moldura', grupo: 'grupo', desconhecido: 'item desconhecido' };

  // "297,210,mm" -> [297, 210] em milímetros
  function mmDe(txt) {
    const p = String(txt || '0,0,mm').split(',');
    const un = (p[2] || 'mm').trim();
    const f = un === 'cm' ? 10 : (un === 'in' ? 25.4 : (un === 'm' ? 1000 : 1));
    return [Number(p[0]) * f, Number(p[1]) * f];
  }

  // "255,0,0,128,rgb:..." ou <Elemento red green blue alpha> -> "rgba(r,g,b,a)"
  function corQgis(txt, padrao) {
    if (!txt) return padrao || null;
    const n = String(txt).split(',').map(Number);
    if (n.length < 3 || n.slice(0, 3).some(isNaN)) return padrao || null;
    const a = n.length > 3 && !isNaN(n[3]) ? n[3] / 255 : 1;
    return 'rgba(' + n[0] + ',' + n[1] + ',' + n[2] + ',' + a.toFixed(3) + ')';
  }

  function corDeElemento(el, padrao) {
    if (!el) return padrao || null;
    return corQgis([el.getAttribute('red'), el.getAttribute('green'), el.getAttribute('blue'), el.getAttribute('alpha')].join(','), padrao);
  }

  // propriedade do primeiro símbolo (cor, contorno, espessura) de formas e linhas
  function opcaoSimbolo(el, nome) {
    const sim = el.getElementsByTagName('symbol')[0];
    if (!sim) return null;
    const ops = sim.getElementsByTagName('Option');
    for (let i = 0; i < ops.length; i++) {
      if (ops[i].getAttribute('name') === nome && ops[i].getAttribute('value') !== null) return ops[i].getAttribute('value');
    }
    return null;
  }

  function estiloTexto(el) {
    const ts = el.getElementsByTagName('text-style')[0];
    const nomeEstilo = ts ? (ts.getAttribute('namedStyle') || '') : '';
    return {
      familia: ts ? (ts.getAttribute('fontFamily') || 'Segoe UI') : 'Segoe UI',
      pt: ts ? Number(ts.getAttribute('fontSize') || 10) : 10,
      negrito: ts ? (/bold|negrito/i.test(nomeEstilo) || ts.getAttribute('forcedBold') === '1' || Number(ts.getAttribute('fontWeight') || 50) >= 63) : false,
      italico: ts ? (/italic|it[aá]lico/i.test(nomeEstilo) || ts.getAttribute('fontItalic') === '1' || ts.getAttribute('forcedItalic') === '1') : false,
      cor: ts ? corQgis(ts.getAttribute('textColor'), '#000') : '#000'
    };
  }

  // posição do item considerando o ponto de referência (0..8: canto/centro/borda)
  function retanguloDoItem(el) {
    const tam = mmDe(el.getAttribute('size'));
    const pos = mmDe(el.getAttribute('positionOnPage') || el.getAttribute('position'));
    const ref = Number(el.getAttribute('referencePoint') || 0);
    return { x: pos[0] - tam[0] * (ref % 3) / 2, y: pos[1] - tam[1] * Math.floor(ref / 3) / 2, w: tam[0], h: tam[1], px: pos[0], py: pos[1] };
  }

  function lerModeloQpt(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('O arquivo não é um XML válido.');
    const raiz = doc.documentElement;
    if (!raiz || raiz.tagName !== 'Layout') throw new Error('Este arquivo não parece um modelo de layout do QGIS (.qpt).');

    const modelo = { nome: raiz.getAttribute('name') || 'Modelo do QGIS', pagina: [297, 210], itens: [], avisos: [], origem: 'qgis', zonaUtm: 25, sulUtm: true };
    const elementos = Array.prototype.slice.call(raiz.getElementsByTagName('LayoutItem'));
    const naoSuportados = {};
    let achouPagina = false;

    elementos.forEach(function (el) {
      const tipo = TIPOS_QGIS[Number(el.getAttribute('type'))] || 'desconhecido';
      if (tipo === 'pagina') {
        if (!achouPagina) { modelo.pagina = mmDe(el.getAttribute('size')); achouPagina = true; }
        return;
      }
      if (el.getAttribute('visibility') === '0') return;
      const r = retanguloDoItem(el);
      const base = {
        uuid: el.getAttribute('uuid') || el.getAttribute('templateUuid') || ('item' + modelo.itens.length),
        id: el.getAttribute('id') || '', z: Number(el.getAttribute('zValue') || 0),
        x: r.x, y: r.y, w: r.w, h: r.h, px: r.px, py: r.py,
        rot: Number(el.getAttribute('itemRotation') || 0),
        fundo: el.getAttribute('background') === 'true' ? corDeElemento(el.getElementsByTagName('BackgroundColor')[0], '#fff') : null,
        quadro: el.getAttribute('frame') === 'true', corQuadro: corDeElemento(el.getElementsByTagName('FrameColor')[0], '#000'),
        espQuadro: Number(String(el.getAttribute('outlineWidthM') || '0.3').split(',')[0])
      };

      if (tipo === 'mapa') {
        const ex = el.getElementsByTagName('Extent')[0];
        base.tipo = 'mapa';
        base.extensao = ex ? { xmin: Number(ex.getAttribute('xmin')), ymin: Number(ex.getAttribute('ymin')), xmax: Number(ex.getAttribute('xmax')), ymax: Number(ex.getAttribute('ymax')) } : null;
        const g = el.getElementsByTagName('ComposerMapGrid')[0];
        if (g && g.getAttribute('show') === '1') {
          base.grade = {
            intX: Number(g.getAttribute('intervalX') || 0), intY: Number(g.getAttribute('intervalY') || 0),
            anotacoes: g.getAttribute('showAnnotation') === '1', nome: g.getAttribute('name') || ''
          };
        }
        modelo.itens.push(base);
      } else if (tipo === 'rotulo') {
        base.tipo = 'rotulo';
        base.texto = String(el.getAttribute('labelText') || '').replace(/<[^>]+>/g, '');
        base.halign = Number(el.getAttribute('halign') || 1);
        base.valign = Number(el.getAttribute('valign') || 32);
        base.mx = Number(el.getAttribute('marginX') || 0);
        base.my = Number(el.getAttribute('marginY') || 0);
        base.estilo = estiloTexto(el);
        // o QGIS costuma desenhar a seta norte com uma fonte de símbolos (ESRI Cartography etc.)
        base.setaNorte = /esri|north|arrow|symbol|wingdings/i.test(base.estilo.familia) && base.texto.trim().length <= 2;
        if (base.setaNorte) base.tipo = 'norte';
        modelo.itens.push(base);
      } else if (tipo === 'legenda') {
        base.tipo = 'legenda';
        modelo.itens.push(base);
      } else if (tipo === 'escala') {
        base.tipo = 'escala';
        base.mapaUuid = el.getAttribute('mapUuid') || '';
        base.estiloBarra = el.getAttribute('style') || 'Single Box';
        base.segmentos = Number(el.getAttribute('numSegments') || 2);
        base.alturaBarra = Number(el.getAttribute('height') || 3);
        base.unidade = el.getAttribute('unitLabel') || 'km';
        base.rotuloAcima = el.getAttribute('labelVerticalPlacement') !== '1';
        base.espaco = Number(el.getAttribute('boxContentSpace') || 1);
        base.estilo = estiloTexto(el);
        modelo.itens.push(base);
      } else if (tipo === 'poligono' || tipo === 'linha' || tipo === 'forma') {
        base.tipo = tipo === 'linha' ? 'linha' : 'forma';
        base.nos = Array.prototype.slice.call(el.getElementsByTagName('node')).map(function (n) { return [Number(n.getAttribute('x')), Number(n.getAttribute('y'))]; });
        base.formaTipo = tipo === 'forma' ? Number(el.getAttribute('shapeType') || 1) : null;   // 0 elipse, 1 retângulo, 2 triângulo
        base.cor = corQgis(opcaoSimbolo(el, 'color'), null);
        base.contorno = corQgis(opcaoSimbolo(el, 'outline_color') || opcaoSimbolo(el, 'line_color'), '#000');
        base.espessura = Number(opcaoSimbolo(el, 'outline_width') || opcaoSimbolo(el, 'line_width') || 0.3);
        base.ponta = Number(el.getAttribute('markerMode') || 0) === 1 ? Number(el.getAttribute('arrowHeadWidth') || 4) : 0;
        modelo.itens.push(base);
      } else if (tipo === 'imagem' && /north/i.test(el.getAttribute('file') || el.getAttribute('picturePath') || '')) {
        base.tipo = 'norte';
        modelo.itens.push(base);
      } else if (tipo !== 'grupo') {
        naoSuportados[NOMES_TIPO[tipo] || tipo] = (naoSuportados[NOMES_TIPO[tipo] || tipo] || 0) + 1;
      }
    });

    Object.keys(naoSuportados).forEach(function (k) {
      modelo.avisos.push(naoSuportados[k] + ' ' + k + (naoSuportados[k] > 1 ? ' (não suportados, ignorados)' : ' (não suportado, ignorado)'));
    });

    // zona UTM citada num rótulo ("UTM Zona 25S"); o .qpt não guarda o sistema de referência
    modelo.itens.forEach(function (it) {
      const m = it.texto && it.texto.match(/UTM\s*(?:zona|zone)?\s*(\d{1,2})\s*([NS])?/i);
      if (m) { modelo.zonaUtm = Number(m[1]); modelo.sulUtm = (m[2] || 'S').toUpperCase() === 'S'; }
    });

    const mapas = modelo.itens.filter(function (i) { return i.tipo === 'mapa'; });
    if (!mapas.length) throw new Error('O modelo não tem nenhum item de mapa.');
    // o maior mapa é o principal (acompanha a vista da tela)
    mapas.sort(function (a, b) { return b.w * b.h - a.w * a.h; });
    mapas.forEach(function (m, i) { m.principal = i === 0; });
    return modelo;
  }

  // modelo do próprio portal (A4), usado quando nenhum .qpt foi importado
  function modeloPadrao(retrato) {
    const W = retrato ? 210 : 297, H = retrato ? 297 : 210, m = 10;
    const mapaH = H - 24 - 26;
    const itens = [
      { tipo: 'rotulo', uuid: 'titulo', z: 2, x: m, y: 7, w: W - 2 * m, h: 10, texto: '{titulo}', halign: 1, valign: 128, mx: 0, my: 0, estilo: { familia: 'Segoe UI', pt: retrato ? 16 : 18, negrito: true, italico: false, cor: '#111827' } },
      { tipo: 'rotulo', uuid: 'subtitulo', z: 3, x: m, y: 17, w: W - 2 * m, h: 5, texto: 'GeoPortal · Paraíba · {data}', halign: 1, valign: 128, mx: 0, my: 0, estilo: { familia: 'Segoe UI', pt: 9, negrito: false, italico: false, cor: '#475569' } },
      { tipo: 'mapa', uuid: 'mapa', id: 'Mapa', z: 1, x: m, y: 24, w: W - 2 * m, h: mapaH, principal: true, quadro: true, corQuadro: '#000', espQuadro: 0.3, fundo: '#d9e6f2', grade: { geografica: true, anotacoes: true } },
      { tipo: 'legenda', uuid: 'legenda', z: 5, x: m + 3, y: 24 + 3, w: 40, h: 40 },
      { tipo: 'norte', uuid: 'norte', z: 6, x: W - m - 16, y: 24 + 3, w: 13, h: 17 },
      { tipo: 'escala', uuid: 'escala', z: 7, x: m, y: 24 + mapaH + 5, w: 70, h: 14, mapaUuid: 'mapa', estiloBarra: 'Double Box', segmentos: 3, alturaBarra: 2.5, unidade: 'km', rotuloAcima: true, espaco: 1, estilo: { familia: 'Segoe UI', pt: 8, negrito: false, italico: false, cor: '#000' } },
      { tipo: 'rotulo', uuid: 'rodape', z: 8, x: m + 80, y: 24 + mapaH + 5, w: W - 2 * m - 80, h: 14, texto: 'Sistema de referência: WGS 84 (EPSG:4326) · Escala aproximada 1:{escala}\nFonte: dados do GeoPortal · Gerado em {data}', halign: 2, valign: 32, mx: 0, my: 0, estilo: { familia: 'Segoe UI', pt: 8, negrito: false, italico: false, cor: '#475569' } }
    ];
    return { nome: 'Modelo do portal', pagina: [W, H], itens: itens, avisos: [], origem: 'portal' };
  }

  // =============================================================
  // 24. LAYOUT: DESENHO (tudo em canvas, com o mapa na mesma vista da tela)
  // =============================================================
  const PT_MM = 25.4 / 72;
  const FONTE_BASE = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';

  function carregarImagem(url) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const t = setTimeout(function () { resolve(null); }, 20000);
      img.onload = function () { clearTimeout(t); resolve(img); };
      img.onerror = function () { clearTimeout(t); resolve(null); };
      img.src = url;
    });
  }

  // número "redondo" para réguas e grades: 1, 2, 5 x 10^n
  function numeroBonito(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const m = x / p;
    return (m < 1.5 ? 1 : (m < 3.5 ? 2 : (m < 7.5 ? 5 : 10))) * p;
  }

  // ---------- vista do mapa: ajusta uma extensão geográfica ao retângulo do quadro ----------
  function vistaDoMapa(bounds, w, h) {
    const x0 = mercX(bounds.getWest()), x1 = mercX(bounds.getEast());
    const y0 = mercY(bounds.getNorth()), y1 = mercY(bounds.getSouth());
    const S = Math.min(w / Math.max(x1 - x0, 1e-9), h / Math.max(y1 - y0, 1e-9));
    return { S: S, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: w, h: h, zf: Math.log2(S / 256) };
  }
  function paraPx(v, lat, lng) { return { x: (mercX(lng) - v.cx) * v.S + v.w / 2, y: (mercY(lat) - v.cy) * v.S + v.h / 2 }; }
  function dePx(v, x, y) { return { lat: mercLat((y - v.h / 2) / v.S + v.cy), lng: mercLng((x - v.w / 2) / v.S + v.cx) }; }
  function limitesDaVista(v) {
    const nw = dePx(v, 0, 0), se = dePx(v, v.w, v.h);
    return L.latLngBounds([se.lat, nw.lng], [nw.lat, se.lng]);
  }
  // metros por pixel no centro da vista
  function metrosPorPx(v) { return CIRC_EQUADOR * Math.cos(mercLat(v.cy) * RAD) / v.S; }

  let limitesEstadoCache = null;
  function limitesDoEstado() {
    if (!limitesEstadoCache) {
      limitesEstadoCache = L.latLngBounds([]);
      todas.municipios.forEach(function (l) { limitesEstadoCache.extend(l.getBounds()); });
    }
    return limitesEstadoCache;
  }

  // extensão do modelo (UTM ou graus) -> limites geográficos; null se não der para converter
  function extensaoDoModeloParaLimites(ext, modelo) {
    if (!ext || ![ext.xmin, ext.ymin, ext.xmax, ext.ymax].every(isFinite)) return null;
    if (Math.abs(ext.xmin) <= 180 && Math.abs(ext.xmax) <= 180 && Math.abs(ext.ymin) <= 90 && Math.abs(ext.ymax) <= 90) {
      return L.latLngBounds([ext.ymin, ext.xmin], [ext.ymax, ext.xmax]);
    }
    const c = [[ext.xmin, ext.ymin], [ext.xmax, ext.ymin], [ext.xmax, ext.ymax], [ext.xmin, ext.ymax]]
      .map(function (p) { const r = UTM.inverso(p[0], p[1], modelo.zonaUtm, modelo.sulUtm); return [r.lat, r.lng]; });
    return L.latLngBounds(c);
  }

  // ---------- mapa de fundo ----------
  function fonteDeTiles() {
    // o Google não permite capturar tiles: no layout usa-se o Esri Satélite no lugar
    const base = { osm: osm, sat: esriSat, esri: esriSat, dark: cartoDark }[currentBasemap] || osm;
    return base;
  }

  function urlDoTile(base, x, y, z) {
    const sd = base.options.subdomains;
    const s = (typeof sd === 'string' || Array.isArray(sd)) ? sd[(x + y) % sd.length] : 'a';
    return L.Util.template(base._url, { s: s, x: x, y: y, z: z, r: '' });
  }

  async function desenharTiles(ctx, v) {
    const base = fonteDeTiles();
    const maxZ = base.options.maxZoom || 19;
    const z = Math.max(0, Math.min(maxZ, Math.round(v.zf)));
    const n = Math.pow(2, z);
    const xa = Math.max(0, Math.floor((v.cx - v.w / 2 / v.S) * n)), xb = Math.min(n - 1, Math.floor((v.cx + v.w / 2 / v.S) * n));
    const ya = Math.max(0, Math.floor((v.cy - v.h / 2 / v.S) * n)), yb = Math.min(n - 1, Math.floor((v.cy + v.h / 2 / v.S) * n));
    const pedidos = [];
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) pedidos.push({ x: x, y: y });
    const lado = v.S / n;
    for (let i = 0; i < pedidos.length; i += 10) {
      const lote = pedidos.slice(i, i + 10);
      const imgs = await Promise.all(lote.map(function (p) { return carregarImagem(urlDoTile(base, p.x, p.y, z)); }));
      imgs.forEach(function (img, k) {
        if (!img) return;
        const dx = (lote[k].x / n - v.cx) * v.S + v.w / 2, dy = (lote[k].y / n - v.cy) * v.S + v.h / 2;
        ctx.drawImage(img, Math.floor(dx), Math.floor(dy), Math.ceil(lado) + 1, Math.ceil(lado) + 1);
      });
    }
    return pedidos.length;
  }

  // ---------- camadas vetoriais (usam os estilos que já estão na tela) ----------
  function aneisDe(layer) {
    const out = [];
    (function rec(a) {
      if (!a || !a.length) return;
      if (a[0] instanceof L.LatLng) out.push(a); else a.forEach(rec);
    })(layer.getLatLngs());
    return out;
  }

  function caminhoDoAnel(ctx, anel, v) {
    for (let i = 0; i < anel.length; i++) {
      const p = paraPx(v, anel[i].lat, anel[i].lng);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
  }

  // agrupa por estilo para desenhar milhares de feições com poucos traços
  function desenharGrupo(ctx, camadas, v, esc, poligono, limites) {
    const grupos = {};
    camadas.forEach(function (l) {
      if (l.getBounds && !l.getBounds().intersects(limites)) return;
      const o = l.options || {};
      const chave = [o.color, o.opacity, o.weight, poligono ? o.fillColor : '', poligono ? o.fillOpacity : '', o.fill === false ? 0 : 1].join('|');
      (grupos[chave] = grupos[chave] || { o: o, itens: [] }).itens.push(l);
    });
    Object.keys(grupos).forEach(function (k) {
      const g = grupos[k], o = g.o;
      ctx.beginPath();
      g.itens.forEach(function (l) {
        aneisDe(l).forEach(function (anel) { caminhoDoAnel(ctx, anel, v); if (poligono) ctx.closePath(); });
      });
      if (poligono && o.fill !== false && o.fillColor) {
        ctx.globalAlpha = o.fillOpacity === undefined ? 0.2 : o.fillOpacity;
        ctx.fillStyle = o.fillColor;
        ctx.fill('evenodd');
      }
      if (o.stroke !== false && o.color) {
        ctx.globalAlpha = o.opacity === undefined ? 1 : o.opacity;
        ctx.strokeStyle = o.color;
        ctx.lineWidth = Math.max(0.5, (o.weight === undefined ? 3 : o.weight) * esc);
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }

  function desenharPontos(ctx, pontos, v, esc) {
    // Raio adaptativo (em px de tela): com poucos pontos usa o raio cheio; com muitos, diminui
    // para que os marcadores não se sobreponham e virem uma mancha branca no layout.
    const rMax = pontos.length ? pontos[0].r : 6;
    const areaTela = (v.w * v.h) / (esc * esc);
    const rAdapt = Math.sqrt((areaTela * 0.05) / (Math.max(1, pontos.length) * Math.PI));
    const raio = Math.max(1.6, Math.min(rMax, rAdapt));
    const borda = raio >= 4 ? 1.2 : (raio >= 2.5 ? 0.6 : 0.35);
    const porCor = {};
    pontos.forEach(function (p) { (porCor[p.cor] = porCor[p.cor] || []).push(p); });
    Object.keys(porCor).forEach(function (cor) {
      ctx.beginPath();
      porCor[cor].forEach(function (p) {
        const q = paraPx(v, p.lat, p.lng);
        ctx.moveTo(q.x + raio * esc, q.y);
        ctx.arc(q.x, q.y, raio * esc, 0, 2 * Math.PI);
      });
      ctx.fillStyle = cor;
      ctx.fill();
      ctx.lineWidth = borda * esc;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
    });
  }

  function desenharCamadas(ctx, v, esc) {
    const lim = limitesDaVista(v);
    const ligada = function (grupo) { return map.hasLayer(grupo); };
    if (geojsonBacias && ligada(layerBacias)) desenharGrupo(ctx, geojsonBacias.getLayers(), v, esc, true, lim);
    if (geojsonMunicipios && ligada(layerMunicipios)) desenharGrupo(ctx, geojsonMunicipios.getLayers(), v, esc, true, lim);
    if (geojsonRios && ligada(layerRios)) desenharGrupo(ctx, geojsonRios.getLayers(), v, esc, false, lim);
    if (geojsonAcudes && ligada(layerAcudes)) {
      desenharGrupo(ctx, geojsonAcudes.getLayers(), v, esc, true, lim);
      if (temas.acudes === 'capacidade') {
        simbolosAcudes.getLayers().forEach(function (s) {
          const ll = s.getLatLng();
          if (!lim.contains(ll)) return;
          const q = paraPx(v, ll.lat, ll.lng);
          ctx.beginPath();
          ctx.arc(q.x, q.y, s.getRadius() * esc, 0, 2 * Math.PI);
          ctx.globalAlpha = 0.7; ctx.fillStyle = s.options.fillColor; ctx.fill();
          ctx.globalAlpha = 1; ctx.lineWidth = 1.5 * esc; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        });
      }
    }
    if (geojsonPocos && ligada(layerPocos)) {
      const op = parseFloat(map.getPane('pocosPane').style.opacity);
      ctx.globalAlpha = isFinite(op) ? op : 1;
      const pts = [];
      geojsonPocos.getLayers().forEach(function (m) {
        const ll = m.getLatLng();
        if (lim.contains(ll)) pts.push({ lat: ll.lat, lng: ll.lng, cor: corPoco(m.feature.properties || {}), r: temas.pocos === 'nenhum' ? 6.5 : 6 });
      });
      desenharPontos(ctx, pts, v, esc);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- grade (UTM ou geográfica): moldura com marcas e coordenadas ----------
  function desenharGrade(ctx, rect, v, grade, modelo, pxmm) {
    const utm = !grade.geografica;
    const conv = utm
      ? function (x, y) { const p = dePx(v, x, y); const u = UTM.direto(p.lat, p.lng, modelo.zonaUtm); return { a: u.e, b: u.n }; }
      : function (x, y) { const p = dePx(v, x, y); return { a: p.lng, b: p.lat }; };

    const cantos = [conv(0, 0), conv(v.w, 0), conv(0, v.h)];
    const spanA = Math.abs(cantos[1].a - cantos[0].a), spanB = Math.abs(cantos[2].b - cantos[0].b);
    const intervalo = function (pedido, span) {
      const n = pedido > 0 ? span / pedido : 0;
      return (n >= 3 && n <= 14) ? pedido : numeroBonito(span / 5);
    };
    const ia = intervalo(utm ? grade.intX : 0, spanA), ib = intervalo(utm ? grade.intY : 0, spanB);

    const cruzamentos = function (n, valor, passo, intervaloGrade) {
      const res = [];
      let ant = valor(0);
      for (let i = 1; i <= n; i += 1) {
        const atual = valor(i);
        const k0 = Math.floor(ant / intervaloGrade), k1 = Math.floor(atual / intervaloGrade);
        if (k0 !== k1) {
          const alvo = Math.max(k0, k1) * intervaloGrade;
          res.push({ pos: (i - 1) + (alvo - ant) / (atual - ant), valor: alvo });
        }
        ant = atual;
      }
      return res;
    };

    const topo = cruzamentos(Math.ceil(v.w), function (x) { return conv(x, 0).a; }, 1, ia);
    const base = cruzamentos(Math.ceil(v.w), function (x) { return conv(x, v.h).a; }, 1, ia);
    const esq = cruzamentos(Math.ceil(v.h), function (y) { return conv(0, y).b; }, 1, ib);
    const dir = cruzamentos(Math.ceil(v.h), function (y) { return conv(v.w, y).b; }, 1, ib);

    // eixo 'h' = longitude (topo/base), 'v' = latitude (lados)
    const rotulo = function (valor, eixo) {
      if (utm) return Math.round(valor).toLocaleString('pt-BR');
      const hemisferio = eixo === 'v' ? (valor < 0 ? ' S' : ' N') : (valor < 0 ? ' O' : ' L');
      return Math.abs(valor).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + '°' + hemisferio;
    };

    const tick = 1.6 * pxmm, folga = 2.2 * pxmm;
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = 0.25 * pxmm;
    ctx.font = (7 * PT_MM * pxmm) + 'px ' + FONTE_BASE;
    ctx.beginPath();
    topo.forEach(function (c) { ctx.moveTo(c.pos, 0); ctx.lineTo(c.pos, -tick); });
    base.forEach(function (c) { ctx.moveTo(c.pos, v.h); ctx.lineTo(c.pos, v.h + tick); });
    esq.forEach(function (c) { ctx.moveTo(0, c.pos); ctx.lineTo(-tick, c.pos); });
    dir.forEach(function (c) { ctx.moveTo(v.w, c.pos); ctx.lineTo(v.w + tick, c.pos); });
    ctx.stroke();
    if (grade.anotacoes !== false) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom'; topo.forEach(function (c) { ctx.fillText(rotulo(c.valor, 'h'), c.pos, -folga); });
      ctx.textBaseline = 'top'; base.forEach(function (c) { ctx.fillText(rotulo(c.valor, 'h'), c.pos, v.h + folga); });
      // coordenadas verticais: esquerda de baixo para cima, direita de cima para baixo
      ctx.textBaseline = 'bottom';
      esq.forEach(function (c) { ctx.save(); ctx.translate(-folga, c.pos); ctx.rotate(-Math.PI / 2); ctx.fillText(rotulo(c.valor, 'v'), 0, 0); ctx.restore(); });
      dir.forEach(function (c) { ctx.save(); ctx.translate(v.w + folga, c.pos); ctx.rotate(Math.PI / 2); ctx.fillText(rotulo(c.valor, 'v'), 0, 0); ctx.restore(); });
    }
    ctx.restore();
  }

  async function desenharMapa(ctx, it, v, modelo, pxmm) {
    const rect = { x: it.x * pxmm, y: it.y * pxmm, w: it.w * pxmm, h: it.h * pxmm };
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    ctx.translate(rect.x, rect.y);
    ctx.fillStyle = it.fundo || '#e5e7eb'; ctx.fillRect(0, 0, rect.w, rect.h);
    await desenharTiles(ctx, v);
    desenharCamadas(ctx, v, pxmm * 25.4 / 96);   // 1 px da tela = 1/96 pol
    ctx.restore();
    if (it.grade) desenharGrade(ctx, rect, v, it.grade, modelo, pxmm);
    if (it.quadro !== false) {
      ctx.strokeStyle = it.corQuadro || '#000'; ctx.lineWidth = (it.espQuadro || 0.3) * pxmm;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  // ---------- textos ----------
  function fonteCss(est, pxmm, escala) {
    return (est.italico ? 'italic ' : '') + (est.negrito ? 'bold ' : '') + (est.pt * PT_MM * pxmm * (escala || 1)) + 'px "' + est.familia + '", ' + FONTE_BASE;
  }

  function quebrarTexto(ctx, texto, larguraMax) {
    const linhas = [];
    String(texto).split('\n').forEach(function (par) {
      let atual = '';
      par.split(' ').forEach(function (p) {
        const t = atual ? atual + ' ' + p : p;
        if (ctx.measureText(t).width > larguraMax && atual) { linhas.push(atual); atual = p; } else atual = t;
      });
      linhas.push(atual);
    });
    return linhas;
  }

  function desenharRotulo(ctx, it, texto, pxmm) {
    const r = { x: it.x * pxmm, y: it.y * pxmm, w: it.w * pxmm, h: it.h * pxmm };
    let halign = it.halign, valign = it.valign;
    if (it.papel === 'titulo') { r.x = 0; r.w = ctx.canvas.width; halign = 4; }                       // título sempre centralizado na página
    if (it.papel === 'fonte') { r.h = ctx.canvas.height - 1 * pxmm - r.y; valign = 64; }            // fonte encostada embaixo, abaixo das coordenadas
    if (it.fundo) { ctx.fillStyle = it.fundo; ctx.fillRect(r.x, r.y, r.w, r.h); }
    if (it.quadro) { ctx.strokeStyle = it.corQuadro; ctx.lineWidth = it.espQuadro * pxmm; ctx.strokeRect(r.x, r.y, r.w, r.h); }
    ctx.font = fonteCss(it.estilo, pxmm);
    ctx.fillStyle = it.estilo.cor;
    ctx.textBaseline = 'top';
    const mx = (it.mx || 0) * pxmm, my = (it.my || 0) * pxmm;
    const linhas = quebrarTexto(ctx, texto, r.w - 2 * mx);
    const alt = it.estilo.pt * PT_MM * pxmm * 1.2;
    const total = linhas.length * alt;
    let y = r.y + my;
    if (valign === 128) y = r.y + (r.h - total) / 2; else if (valign === 64) y = r.y + r.h - total - my;
    const h = halign;
    ctx.textAlign = h === 4 ? 'center' : (h === 2 ? 'right' : 'left');
    const x = h === 4 ? r.x + r.w / 2 : (h === 2 ? r.x + r.w - mx : r.x + mx);
    linhas.forEach(function (ln, i) { ctx.fillText(ln, x, y + i * alt); });
  }

  // ---------- seta norte, forma e linha ----------
  function desenharSetaNorte(ctx, it, pxmm) {
    const r = { x: it.x * pxmm, y: it.y * pxmm, w: it.w * pxmm, h: it.h * pxmm };
    const cx = r.x + r.w / 2, topo = r.y + r.h * 0.22, base = r.y + r.h;
    const larg = Math.min(r.w, r.h * 0.6) / 2;
    ctx.save();
    ctx.lineWidth = 0.25 * pxmm; ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.moveTo(cx, topo); ctx.lineTo(cx - larg, base); ctx.lineTo(cx, base - (base - topo) * 0.28); ctx.closePath();
    ctx.fillStyle = '#000'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, topo); ctx.lineTo(cx + larg, base); ctx.lineTo(cx, base - (base - topo) * 0.28); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.font = 'bold ' + (r.h * 0.2) + 'px ' + FONTE_BASE;
    ctx.fillText('N', cx, topo - r.h * 0.02);
    ctx.restore();
  }

  function desenharForma(ctx, it, pxmm) {
    ctx.save();
    ctx.translate(it.x * pxmm, it.y * pxmm);
    const nos = it.nos.map(function (n) { return [n[0] * pxmm, n[1] * pxmm]; });
    ctx.beginPath();
    if (it.tipo === 'forma' && !nos.length) {
      const w = it.w * pxmm, h = it.h * pxmm;
      if (it.formaTipo === 0) ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
      else if (it.formaTipo === 2) { ctx.moveTo(0, h); ctx.lineTo(w / 2, 0); ctx.lineTo(w, h); ctx.closePath(); }
      else ctx.rect(0, 0, w, h);
    } else {
      nos.forEach(function (n, i) { if (i === 0) ctx.moveTo(n[0], n[1]); else ctx.lineTo(n[0], n[1]); });
      if (it.tipo === 'forma') ctx.closePath();
    }
    if (it.tipo === 'forma' && it.cor) { ctx.fillStyle = it.cor; ctx.fill(); }
    ctx.strokeStyle = it.contorno || '#000'; ctx.lineWidth = Math.max(0.4, (it.espessura || 0.3) * pxmm); ctx.lineJoin = 'round';
    ctx.stroke();
    if (it.tipo === 'linha' && it.ponta && nos.length > 1) {
      const a = nos[nos.length - 2], b = nos[nos.length - 1], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), t = it.ponta * pxmm;
      ctx.beginPath(); ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - t * Math.cos(ang - 0.4), b[1] - t * Math.sin(ang - 0.4));
      ctx.lineTo(b[0] - t * Math.cos(ang + 0.4), b[1] - t * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fillStyle = it.contorno || '#000'; ctx.fill();
    }
    ctx.restore();
  }

  // ---------- barra de escala ----------
  function desenharEscala(ctx, it, v, larguraMapaMm, pxmm) {
    const mpp = metrosPorPx(v);
    const nSeg = Math.max(1, it.segmentos || 2);
    const alvoMm = Math.min(60, 0.35 * larguraMapaMm, it.w > 30 ? it.w : 60);
    const seg = numeroBonito(alvoMm * pxmm * mpp / nSeg);       // metros por segmento
    const usaKm = seg >= 1000 || /km/i.test(it.unidade || '') && seg >= 500;
    const fator = usaKm ? 1000 : 1;
    const larSeg = seg / mpp;
    const barraH = (it.alturaBarra || 3) * pxmm;
    const esp = (it.espaco || 1) * pxmm;
    const x0 = it.x * pxmm + esp, rotH = it.estilo.pt * PT_MM * pxmm * 1.25;
    const acima = it.rotuloAcima !== false;
    const yBarra = it.y * pxmm + esp + (acima ? rotH : 0);

    ctx.save();
    if (it.fundo) { ctx.fillStyle = it.fundo; ctx.fillRect(it.x * pxmm, it.y * pxmm, nSeg * larSeg + 2 * esp + 12 * pxmm, barraH + rotH + 2 * esp); }
    ctx.lineWidth = 0.25 * pxmm; ctx.strokeStyle = '#000';
    const duplo = /double/i.test(it.estiloBarra || '');
    for (let i = 0; i < nSeg; i++) {
      const x = x0 + i * larSeg;
      if (duplo) {
        ctx.fillStyle = i % 2 === 0 ? '#000' : '#fff'; ctx.fillRect(x, yBarra, larSeg, barraH / 2);
        ctx.fillStyle = i % 2 === 0 ? '#fff' : '#000'; ctx.fillRect(x, yBarra + barraH / 2, larSeg, barraH / 2);
      } else {
        ctx.fillStyle = i % 2 === 0 ? '#000' : '#fff'; ctx.fillRect(x, yBarra, larSeg, barraH);
      }
    }
    ctx.strokeRect(x0, yBarra, nSeg * larSeg, barraH);
    ctx.fillStyle = it.estilo.cor || '#000';
    ctx.font = fonteCss(it.estilo, pxmm);
    ctx.textAlign = 'center'; ctx.textBaseline = acima ? 'bottom' : 'top';
    const ty = acima ? yBarra - 0.6 * pxmm : yBarra + barraH + 0.6 * pxmm;
    for (let i = 0; i <= nSeg; i++) {
      const txt = (i * seg / fator).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
      ctx.textAlign = i === nSeg ? 'left' : 'center';
      ctx.fillText(i === nSeg ? txt + ' ' + (usaKm ? 'km' : 'm') : txt, x0 + i * larSeg - (i === nSeg ? larSeg * 0 : 0), ty);
    }
    ctx.restore();
  }

  // ---------- legenda: lê a legenda que está na tela ----------
  function lerLegendaDaTela() {
    const corpo = document.querySelector('#dynamicLegend .legend-body');
    if (!corpo) return [];
    const out = [];
    Array.prototype.forEach.call(corpo.children, function (el) {
      const texto = function (e) { return e.textContent.replace(/\s+/g, ' ').trim(); };
      if (el.classList.contains('legend-title') || el.classList.contains('fw-bold')) { out.push({ t: 'titulo', texto: texto(el) }); return; }
      if (el.classList.contains('legend-nota')) { out.push({ t: 'nota', texto: texto(el) }); return; }
      if (!el.classList.contains('legend-item')) return;
      const sw = el.querySelector('.legend-color'), sim = el.querySelector('.legend-sym circle');
      const item = { t: 'item', texto: texto(el), forma: 'quad', cor: '#999', borda: null };
      if (sim) { item.forma = 'simbolo'; item.cor = sim.getAttribute('fill'); item.r = Number(sim.getAttribute('r')) || 5; }
      else if (sw) {
        item.cor = sw.style.backgroundColor || sw.style.background || '#999';
        item.borda = sw.style.borderColor || null;
        if (sw.style.borderRadius === '50%' || sw.classList.contains('legend-dot')) item.forma = 'circulo';
        else if (sw.style.height === '3px') item.forma = 'linha';
      }
      out.push(item);
    });
    return out;
  }

  function desenharLegenda(ctx, it, entradas, pxmm, area) {
    if (!entradas.length) return;
    const fT = 9 * PT_MM * pxmm, fI = 8 * PT_MM * pxmm, fN = 7 * PT_MM * pxmm;
    const pad = 2.5 * pxmm, linha = 4.6 * pxmm, sw = 5 * pxmm;
    const fonte = function (tam, neg) { return (neg ? 'bold ' : '') + tam + 'px ' + FONTE_BASE; };

    // 1) tamanho natural
    ctx.save();
    ctx.font = fonte(fT, true);
    let largura = ctx.measureText('Legenda').width, alt = pad + fT * 1.4;
    entradas.forEach(function (e) {
      ctx.font = fonte(e.t === 'nota' ? fN : fI, e.t === 'titulo');
      const w = ctx.measureText(e.texto).width + (e.t === 'item' ? sw + 2 * pxmm : 0);
      largura = Math.max(largura, e.t === 'nota' ? Math.min(w, 50 * pxmm) : w);
      alt += e.t === 'titulo' ? linha * 1.1 : (e.t === 'nota' ? linha * 0.9 : linha);
    });
    const W = largura + 2 * pad, H = alt + pad;

    // 2) posição: o espaço do modelo pode ser menor que a legenda do portal; ancora no canto
    //    mais próximo do canto do mapa e reduz o que for preciso para caber
    let s = 1, x = it.x * pxmm, y = it.y * pxmm;
    if (area) {
      s = Math.min(1, (area.h - 4 * pxmm) / H, (area.w - 4 * pxmm) / W);
      const cx = (it.x + it.w / 2) * pxmm, cy = (it.y + it.h / 2) * pxmm;
      if (cx > area.x + area.w / 2) x = (it.x + it.w) * pxmm - W * s;
      if (cy > area.y + area.h / 2) y = (it.y + it.h) * pxmm - H * s;
      x = Math.max(area.x + 2 * pxmm, Math.min(x, area.x + area.w - W * s - 2 * pxmm));
      y = Math.max(area.y + 2 * pxmm, Math.min(y, area.y + area.h - H * s - 2 * pxmm));
    }

    // 3) desenho
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#444'; ctx.lineWidth = 0.2 * pxmm; ctx.strokeRect(0, 0, W, H);
    ctx.fillStyle = '#000'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = fonte(fT, true); ctx.fillText('Legenda', pad, pad + fT * 0.6);
    let py = pad + fT * 1.4;
    entradas.forEach(function (e) {
      if (e.t === 'titulo') {
        py += linha * 0.2; ctx.font = fonte(fI, true); ctx.fillStyle = '#334155'; ctx.fillText(e.texto, pad, py + linha / 2); ctx.fillStyle = '#000'; py += linha * 0.9; return;
      }
      if (e.t === 'nota') { ctx.font = fonte(fN, false); ctx.fillStyle = '#475569'; ctx.fillText(e.texto.slice(0, 46), pad, py + linha * 0.4); ctx.fillStyle = '#000'; py += linha * 0.9; return; }
      const cx = pad + sw / 2, cy = py + linha / 2;
      ctx.fillStyle = e.cor; ctx.strokeStyle = e.borda || 'rgba(15,23,42,0.45)'; ctx.lineWidth = 0.2 * pxmm;
      if (e.forma === 'circulo') { ctx.beginPath(); ctx.arc(cx, cy, 1.7 * pxmm, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); }
      else if (e.forma === 'simbolo') { ctx.beginPath(); ctx.arc(cx, cy, Math.min(e.r * 0.26 * pxmm, linha * 0.5), 0, 2 * Math.PI); ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke(); }
      else if (e.forma === 'linha') { ctx.fillRect(cx - sw / 2, cy - 0.35 * pxmm, sw, 0.7 * pxmm); }
      else { ctx.fillRect(cx - sw / 2, cy - 1.5 * pxmm, sw, 3 * pxmm); ctx.strokeRect(cx - sw / 2, cy - 1.5 * pxmm, sw, 3 * pxmm); }
      ctx.fillStyle = '#000'; ctx.font = fonte(fI, false); ctx.fillText(e.texto, pad + sw + 2 * pxmm, cy);
      py += linha;
    });
    ctx.restore();
  }

  // ---------- montagem da página ----------
  function substituirTokens(texto, ctxTokens) {
    return String(texto)
      .replace(/\[%\s*@layout_name\s*%\]/gi, ctxTokens.nome)
      .replace(/\[%\s*now\(\)\s*%\]/gi, ctxTokens.data)
      .replace(/\{titulo\}/g, ctxTokens.titulo)
      .replace(/\{data\}/g, ctxTokens.data)
      .replace(/\{escala\}/g, ctxTokens.escala);
  }

  // limites de tudo o que está ligado (com 4% de folga): o mapa fica "perto", ocupando o quadro
  function limitesDasCamadasLigadas() {
    const b = L.latLngBounds([]);
    [[layerMunicipios, geojsonMunicipios], [layerBacias, geojsonBacias], [layerRios, geojsonRios], [layerAcudes, geojsonAcudes], [layerPocos, geojsonPocos]].forEach(function (g) {
      if (!g[1] || !map.hasLayer(g[0])) return;
      g[1].getLayers().forEach(function (l) { if (l.getBounds) b.extend(l.getBounds()); else if (l.getLatLng) b.extend(l.getLatLng()); });
    });
    return b.isValid() ? b.pad(0.04) : map.getBounds();
  }

  function limitesDoMapa(it, opc, modelo) {
    const modo = (opc.mapas && opc.mapas[it.uuid]) || (it.principal ? 'atual' : 'modelo');
    if (modo === 'estado') return limitesDoEstado();
    if (modo === 'camadas') return limitesDasCamadasLigadas();
    if (modo === 'modelo') {
      const b = extensaoDoModeloParaLimites(it.extensao, modelo);
      if (b && b.isValid()) return b;
      return it.principal ? map.getBounds() : limitesDoEstado();
    }
    return map.getBounds();
  }

  async function renderizarModelo(modelo, opc) {
    const dpi = opc.dpi || 150, pxmm = dpi / 25.4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(modelo.pagina[0] * pxmm);
    canvas.height = Math.round(modelo.pagina[1] * pxmm);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);

    const vistas = {};
    modelo.itens.filter(function (i) { return i.tipo === 'mapa'; }).forEach(function (m) {
      vistas[m.uuid] = vistaDoMapa(limitesDoMapa(m, opc, modelo), Math.round(m.w * pxmm), Math.round(m.h * pxmm));
    });
    const principal = modelo.itens.filter(function (i) { return i.tipo === 'mapa' && i.principal; })[0];
    const vp = vistas[principal.uuid];
    const mm = metrosPorPx(vp);
    const tokens = {
      nome: modelo.nome, titulo: opc.titulo || 'Mapa do GeoPortal', data: new Date().toLocaleDateString('pt-BR'),
      escala: Math.round(mm * pxmm * 1000).toLocaleString('pt-BR')
    };

    // só uma legenda do modelo recebe a legenda do portal (a maior); as demais dependem de camadas do QGIS
    const legendas = modelo.itens.filter(function (i) { return i.tipo === 'legenda'; }).sort(function (a, b) { return b.w * b.h - a.w * a.h; });
    const legendaDoPortal = opc.legenda !== false ? legendas[0] : null;
    const entradas = legendaDoPortal ? lerLegendaDaTela() : [];

    const ordem = modelo.itens.slice().sort(function (a, b) { return a.z - b.z; });
    for (let k = 0; k < ordem.length; k++) {
      const it = ordem[k];
      ctx.save();
      if (it.rot) { ctx.translate(it.px * pxmm, it.py * pxmm); ctx.rotate(it.rot * RAD); ctx.translate(-it.px * pxmm, -it.py * pxmm); }
      if (it.tipo === 'mapa') await desenharMapa(ctx, it, vistas[it.uuid], modelo, pxmm);
      else if (it.tipo === 'rotulo') desenharRotulo(ctx, it, substituirTokens((opc.textos && opc.textos[it.uuid] !== undefined) ? opc.textos[it.uuid] : it.texto, tokens), pxmm);
      else if (it.tipo === 'escala') desenharEscala(ctx, it, vistas[it.mapaUuid] || vp, principal.w, pxmm);
      else if (it.tipo === 'legenda') {
        if (it === legendaDoPortal) {
          // área disponível: o mapa que contém o espaço da legenda (ou a página inteira)
          const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
          const dono = modelo.itens.filter(function (m) { return m.tipo === 'mapa' && cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h; })
            .sort(function (a, b) { return a.w * a.h - b.w * b.h; })[0];
          const area = dono ? { x: dono.x * pxmm, y: dono.y * pxmm, w: dono.w * pxmm, h: dono.h * pxmm }
                            : { x: 0, y: 0, w: modelo.pagina[0] * pxmm, h: modelo.pagina[1] * pxmm };
          desenharLegenda(ctx, it, entradas, pxmm, area);
        }
      }
      else if (it.tipo === 'norte') desenharSetaNorte(ctx, it, pxmm);
      else if (it.tipo === 'forma' || it.tipo === 'linha') desenharForma(ctx, it, pxmm);
      ctx.restore();
    }
    return canvas;
  }

  // =============================================================
  // 25. COMPARTILHAR (link com o estado do mapa) E EXPORTAR (imagem / PDF / impressão)
  // =============================================================
  const RADIOS_FUNDO = { osm: 'radioOsm', sat: 'radioSat', esri: 'radioEsri', dark: 'radioDark' };

  // identificador estável da feição para o link (rios não têm ID único: usa a posição)
  function idDe(tipo, layer) {
    const p = layer.feature.properties || {};
    if (tipo === 'municipios') return String(p.CD_MUN);
    if (tipo === 'pocos') return String(p.fid);
    if (tipo === 'acudes' || tipo === 'bacias') return String(p.OBJECTID);
    return '#' + todas[tipo].indexOf(layer);
  }

  function acharPorId(tipo, id) {
    if (!todas[tipo]) return null;
    if (id.charAt(0) === '#') return todas[tipo][Number(id.slice(1))] || null;
    return todas[tipo].find(function (l) { return idDe(tipo, l) === id; }) || null;
  }

  function estadoParaHash() {
    const p = new URLSearchParams();
    const c = map.getCenter();
    p.set('v', c.lat.toFixed(5) + ',' + c.lng.toFixed(5) + ',' + map.getZoom());
    p.set('b', currentBasemap);
    const ligadas = TIPOS_CAMADA.filter(function (t) { const k = chkDe(t); return k && k.checked; });
    p.set('l', ligadas.length ? ligadas.join('.') : '-');
    const t = Object.keys(temas).filter(function (k) { return temas[k] !== 'nenhum'; }).map(function (k) { return k + ':' + temas[k]; });
    if (t.length) p.set('t', t.join(','));
    const f = {};
    TIPOS_CAMADA.forEach(function (tp) { if (filtroAtivo(tp)) f[tp] = filtros[tp]; });
    if (Object.keys(f).length) p.set('f', JSON.stringify(f));
    if (selecionada) p.set('s', selecionada.tipo + ':' + idDe(selecionada.tipo, selecionada.layer));
    return p.toString();
  }

  function aplicarHash(str) {
    if (!str) return;
    const p = new URLSearchParams(str);
    aplicandoHash = true;
    try {
      const b = p.get('b');
      if (b && basemaps[b]) {
        const r = document.getElementById(RADIOS_FUNDO[b]);
        if (r) r.checked = true;
        setBasemap(b);
      }

      const l = p.get('l');
      if (l !== null) {
        const ligadas = l === '-' ? [] : l.split('.');
        TIPOS_CAMADA.forEach(function (tp) {
          const k = chkDe(tp);
          if (k) { k.checked = ligadas.indexOf(tp) >= 0; k.dispatchEvent(new Event('change')); }
        });
      }

      const mapaTemas = {};
      (p.get('t') || '').split(',').forEach(function (par) { const x = par.split(':'); if (x[0]) mapaTemas[x[0]] = x[1]; });
      [['municipios', 'temaMun', aplicarTemaMun], ['acudes', 'temaAcu', aplicarTemaAcudes], ['pocos', 'temaPoc', aplicarTemaPocos]].forEach(function (x) {
        const el = document.getElementById(x[1]);
        let val = mapaTemas[x[0]] || 'nenhum';
        if (el) { el.value = val; if (el.value !== val) { val = 'nenhum'; el.value = 'nenhum'; } }
        if (temas[x[0]] !== val) x[2](val);
      });

      let fobj = {};
      try { fobj = JSON.parse(p.get('f') || '{}') || {}; } catch (e) { fobj = {}; }
      TIPOS_CAMADA.forEach(function (tp) {
        filtros[tp] = (fobj[tp] && typeof fobj[tp] === 'object') ? fobj[tp] : {};
        aplicarFiltros(tp);
      });
      renderizarFiltros(filtroTipoAtual);

      const v = (p.get('v') || '').split(',').map(Number);
      if (v.length === 3 && v.every(isFinite)) map.setView([v[0], v[1]], v[2], { animate: false });

      const s = p.get('s');
      if (s && s.indexOf(':') > 0) {
        const tp = s.split(':')[0], id = s.slice(tp.length + 1);
        const layer = acharPorId(tp, id);
        if (layer) selectLayer(layer, false);
      }
    } finally {
      aplicandoHash = false;
      agendarHash();
    }
  }

  function urlCompartilhavel() { return location.href.split('#')[0] + '#' + estadoParaHash(); }

  // ---------- botão e janela ----------
  const shareModalEl = document.getElementById('shareModal');
  const bsShare = (shareModalEl && typeof bootstrap !== 'undefined') ? new bootstrap.Modal(shareModalEl) : null;
  if (shareModalEl) shareModalEl.addEventListener('hidden.bs.modal', function () { if (btnCompartilhar) btnCompartilhar.focus(); });

  btnCompartilhar = adicionarBotaoFerramenta('Compartilhar e exportar o mapa', 'ph-share-network', function () { abrirCompartilhar(); });

  function abrirCompartilhar() {
    const input = document.getElementById('shareLink');
    if (input) input.value = urlCompartilhavel();
    const aviso = document.getElementById('exportAviso');
    if (aviso) aviso.hidden = currentBasemap !== 'sat';
    mensagemExportacao('');
    atualizarCamposModelo();
    const nativo = document.getElementById('shareNativo');
    if (nativo) nativo.hidden = !navigator.share;
    if (bsShare) bsShare.show();
  }

  const btnCopiarLink = document.getElementById('shareCopiar');
  if (btnCopiarLink) btnCopiarLink.addEventListener('click', function () {
    const input = document.getElementById('shareLink');
    copiarTexto(input.value).then(function () {
      const sp = btnCopiarLink.querySelector('span');
      sp.textContent = 'Copiado!';
      setTimeout(function () { sp.textContent = 'Copiar link'; }, 1600);
    });
  });

  const btnShareNativo = document.getElementById('shareNativo');
  if (btnShareNativo) btnShareNativo.addEventListener('click', function () {
    if (navigator.share) navigator.share({ title: 'GeoPortal', url: document.getElementById('shareLink').value }).catch(function () {});
  });

  // ---------- exportação: layout A4 (modelo do portal ou modelo do QGIS importado) ----------
  const CDN_PDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  const CHAVE_QPT = 'geoportal.modelo.qpt';
  let modeloQgis = null;   // modelo do QGIS (.qpt) embutido em dados/modelo_qpt.js

  // ---------- rótulos predefinidos (título e fonte) ----------
  // Para incluir mais opções, basta acrescentar uma linha nas listas abaixo.
  const PRESETS_TITULO = [
    'Mapa de Poços da Paraíba',
    'Mapa de Açudes da Paraíba',
    'Mapa de Poços e Açudes da Paraíba',
    'Mapa de Municípios da Paraíba',
    'Mapa de Bacias Hidrográficas da Paraíba',
    'Mapa de Rios da Paraíba',
    'Mapa de Poços de João Pessoa',
    'Mapa de Açudes de João Pessoa',
    'Mapa da Paraíba'
  ];
  const PRESETS_FONTE = [
    'Fonte: AESA – Agência Executiva de Gestão das Águas da Paraíba',
    'Fonte: AESA (GeoPortal); limites municipais: IBGE (2025)'
  ];
  const estadoRotulos = {};   // uuid -> texto escolhido/digitado (lembrado ao reabrir a janela)

  // sugere o título conforme as camadas que estão ligadas no mapa
  function tituloSugerido() {
    const on = function (g) { return !!g && map.hasLayer(g); };
    const p = on(layerPocos), a = on(layerAcudes);
    if (p && a) return 'Mapa de Poços e Açudes da Paraíba';
    if (p) return 'Mapa de Poços da Paraíba';
    if (a) return 'Mapa de Açudes da Paraíba';
    if (on(layerBacias)) return 'Mapa de Bacias Hidrográficas da Paraíba';
    if (on(layerRios)) return 'Mapa de Rios da Paraíba';
    if (on(layerMunicipios)) return 'Mapa de Municípios da Paraíba';
    return 'Mapa da Paraíba';
  }

  // um único campo: lista com as opções predefinidas; em "Personalizado…" a lista dá lugar a uma caixa de texto
  function htmlCampoPredefinido(uuid, titulo, opcoes, inicial, multilinha) {
    const id = escapeHtml(uuid), idx = opcoes.indexOf(inicial), custom = idx < 0;
    let h = '<div class="export-campo" data-campo="' + id + '"><label for="expPreset-' + id + '">' + titulo + '</label>' +
      '<select class="form-select form-select-sm"' + (custom ? ' hidden' : '') + ' id="expPreset-' + id + '" data-preset="' + id + '">';
    opcoes.forEach(function (t, i) { h += '<option value="' + i + '"' + (i === idx ? ' selected' : '') + '>' + escapeHtml(t) + '</option>'; });
    h += '<option value="x">Personalizado…</option></select>';
    h += '<div class="d-flex gap-1 align-items-start" data-custom="' + id + '"' + (custom ? '' : ' hidden') + '>' + (multilinha
      ? '<textarea class="form-control form-control-sm" rows="2" maxlength="200" id="expTexto-' + id + '" data-texto="' + id + '">' + escapeHtml(inicial) + '</textarea>'
      : '<input type="text" class="form-control form-control-sm" maxlength="100" id="expTexto-' + id + '" data-texto="' + id + '" value="' + escapeHtml(inicial) + '">') +
      '<button type="button" class="btn btn-outline-secondary btn-sm" data-voltar="' + id + '" title="Voltar às opções predefinidas" aria-label="Voltar às opções predefinidas"><i class="ph ph-list"></i></button></div></div>';
    return h;
  }

  function ligarPredefinidos(alvo, opcoesPorUuid) {
    alvo.querySelectorAll('[data-preset]').forEach(function (sel) {
      const uuid = sel.dataset.preset, def = opcoesPorUuid[uuid];
      const campo = alvo.querySelector('[data-texto="' + uuid + '"]');
      const caixa = alvo.querySelector('[data-custom="' + uuid + '"]');
      const voltar = alvo.querySelector('[data-voltar="' + uuid + '"]');
      if (!campo || !def) return;
      const mostrarCustom = function (sim) { sel.hidden = sim; caixa.hidden = !sim; };
      sel.addEventListener('change', function () {
        if (sel.value === 'x') { mostrarCustom(true); campo.focus(); campo.select(); }
        else { campo.value = def.opcoes[Number(sel.value)]; }
        estadoRotulos[uuid] = campo.value;
      });
      campo.addEventListener('input', function () { estadoRotulos[uuid] = campo.value; });
      voltar.addEventListener('click', function () {
        campo.value = def.padrao();
        sel.value = String(Math.max(0, def.opcoes.indexOf(campo.value)));
        mostrarCustom(false);
        estadoRotulos[uuid] = campo.value;
        sel.focus();
      });
    });
  }

  const elExp = function (id) { return document.getElementById(id); };

  function mensagemExportacao(txt, erro) {
    const st = elExp('exportStatus');
    if (!st) return;
    st.textContent = txt;
    st.className = 'export-status' + (erro ? ' text-danger' : '');
  }

  function infoQpt(txt, erro) {
    const el = elExp('exportQptInfo');
    if (!el) return;
    el.textContent = txt;
    el.className = 'export-qpt-info' + (erro ? ' text-danger' : '');
  }

  function usandoModeloQgis() { return !!modeloQgis; }

  function modeloEscolhido() {
    return usandoModeloQgis() ? modeloQgis : modeloPadrao(elExp('exportOrientacao').value === 'retrato');
  }

  // mostra os campos do modelo do QGIS (ou, se ele não carregou, os do modelo do portal)
  function atualizarCamposModelo() {
    const temModelo = !!modeloQgis;
    elExp('exportBoxPortal').hidden = temModelo;
    elExp('exportBoxQgis').hidden = !temModelo;

    const alvo = elExp('exportCamposModelo');
    alvo.innerHTML = '';
    if (!temModelo) return;

    const m = modeloQgis;
    infoQpt(m.avisos.length ? 'Avisos do modelo: ' + m.avisos.join('; ') : '');

    let html = '';
    m.itens.filter(function (i) { return i.tipo === 'mapa'; }).sort(function (a, b) { return b.principal - a.principal; }).forEach(function (mp) {
      const pad = mp.principal ? 'atual' : 'modelo';
      html += '<div class="export-campo"><label for="expMapa-' + escapeHtml(mp.uuid) + '">Mapa "' + escapeHtml(mp.id || 'sem nome') + '" (' + Math.round(mp.w) + ' × ' + Math.round(mp.h) + ' mm)</label>' +
        '<select class="form-select form-select-sm" id="expMapa-' + escapeHtml(mp.uuid) + '" data-mapa="' + escapeHtml(mp.uuid) + '">' +
        '<option value="atual"' + (pad === 'atual' ? ' selected' : '') + '>Vista atual da tela</option>' +
        '<option value="camadas">Ajustar às camadas ligadas</option>' +
        '<option value="modelo"' + (pad === 'modelo' ? ' selected' : '') + '>Extensão salva no modelo</option>' +
        '<option value="estado">Paraíba inteira</option></select></div>';
    });
    // rótulos de texto, de cima para baixo: o primeiro é o título e o último é a fonte
    const rotulos = m.itens.filter(function (i) { return i.tipo === 'rotulo'; }).sort(function (a, b) { return a.y - b.y; });
    const opcoesPorUuid = {};
    rotulos.forEach(function (r, k) {
      const ehTitulo = k === 0, ehFonte = k === rotulos.length - 1 && rotulos.length > 1;
      if (ehTitulo) {
        opcoesPorUuid[r.uuid] = { opcoes: PRESETS_TITULO, padrao: tituloSugerido };
        html += htmlCampoPredefinido(r.uuid, 'Título do mapa', PRESETS_TITULO, estadoRotulos[r.uuid] !== undefined ? estadoRotulos[r.uuid] : tituloSugerido(), false);
      } else if (ehFonte) {
        opcoesPorUuid[r.uuid] = { opcoes: PRESETS_FONTE, padrao: function () { return PRESETS_FONTE[0]; } };
        html += htmlCampoPredefinido(r.uuid, 'Fonte dos dados', PRESETS_FONTE, estadoRotulos[r.uuid] !== undefined ? estadoRotulos[r.uuid] : PRESETS_FONTE[0], true);
      } else {
        html += '<div class="export-campo"><label for="expTexto-' + escapeHtml(r.uuid) + '">Texto do rótulo ' + (k + 1) + '</label>' +
          '<textarea class="form-control form-control-sm" rows="2" id="expTexto-' + escapeHtml(r.uuid) + '" data-texto="' + escapeHtml(r.uuid) + '">' + escapeHtml(r.texto) + '</textarea></div>';
      }
    });
    alvo.innerHTML = html;
    ligarPredefinidos(alvo, opcoesPorUuid);
  }

  // lê o .qpt embutido (base64 UTF-8) sem precisar de servidor nem de upload
  function carregarModeloEmbutido() {
    try {
      if (!window.MODELO_QPT || !window.MODELO_QPT.base64) throw new Error('modelo embutido não encontrado');
      const bin = atob(window.MODELO_QPT.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      modeloQgis = lerModeloQpt(new TextDecoder('utf-8').decode(bytes));
      // título = rótulo mais ao topo (centralizado); fonte = rótulo mais embaixo (colado no rodapé da página)
      const txt = modeloQgis.itens.filter(function (i) { return i.tipo === 'rotulo'; }).sort(function (a, b) { return a.y - b.y; });
      if (txt.length) txt[0].papel = 'titulo';
      if (txt.length > 1) { const f = txt[txt.length - 1]; f.papel = 'fonte'; if (f.estilo) f.estilo.pt = Math.min(f.estilo.pt, 8.5); }
    } catch (e) {
      console.error('Modelo .qpt embutido não pôde ser lido; usando o modelo do portal.', e);
      modeloQgis = null;
    }
  }

  function lerOpcoesExportacao() {
    const opc = {
      dpi: Number(elExp('exportDpi').value) || 150,
      titulo: (elExp('exportTitulo').value || '').trim() || 'Mapa do GeoPortal',
      legenda: elExp('exportLegenda').checked,
      textos: {}, mapas: {}
    };
    document.querySelectorAll('#exportCamposModelo [data-texto]').forEach(function (el) { opc.textos[el.dataset.texto] = el.value; });
    document.querySelectorAll('#exportCamposModelo [data-mapa]').forEach(function (el) { opc.mapas[el.dataset.mapa] = el.value; });
    if (!usandoModeloQgis()) opc.mapas.mapa = elExp('exportEnquadramento').value;   // modelo do portal: id do mapa = "mapa"
    return opc;
  }

  // imprime a imagem do layout na página exata do modelo (sem margens do navegador)
  function imprimirCanvas(canvas, pagina) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"><title>Layout</title><style>' +
      '@page{size:' + pagina[0] + 'mm ' + pagina[1] + 'mm;margin:0}html,body{margin:0;padding:0}' +
      'img{display:block;width:' + pagina[0] + 'mm;height:' + pagina[1] + 'mm}</style></head><body></body></html>');
    doc.close();
    const img = doc.createElement('img');
    img.onload = function () {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(function () { frame.remove(); }, 60000);
    };
    img.src = canvas.toDataURL('image/png');
    doc.body.appendChild(img);
  }

  async function exportarLayout(formato) {
    const botoes = document.querySelectorAll('#shareModal [data-export]');
    botoes.forEach(function (b) { b.disabled = true; });
    try {
      const modelo = modeloEscolhido();
      const opc = lerOpcoesExportacao();
      mensagemExportacao('Desenhando o layout em ' + opc.dpi + ' dpi… (carregando o mapa de fundo)');
      const canvas = await renderizarModelo(modelo, opc);

      if (formato === 'png') {
        await new Promise(function (resolve, reject) {
          canvas.toBlob(function (b) { if (!b) reject(new Error('Falha ao gerar a imagem.')); else { salvarBlob(b, 'mapa-geoportal.png'); resolve(); } }, 'image/png');
        });
      } else if (formato === 'pdf') {
        await carregarScriptExterno(CDN_PDF, 'jspdf');
        const W = modelo.pagina[0], H = modelo.pagina[1];
        const pdf = new window.jspdf.jsPDF({ orientation: W >= H ? 'landscape' : 'portrait', unit: 'mm', format: [W, H] });
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, H);
        pdf.save('mapa-geoportal.pdf');
      } else {
        if (bsShare) bsShare.hide();
        imprimirCanvas(canvas, modelo.pagina);
      }
      mensagemExportacao('Pronto.');
    } catch (e) {
      console.error(e);
      mensagemExportacao('Não foi possível gerar o layout. ' + (e && e.message ? e.message : ''), true);
    } finally {
      botoes.forEach(function (b) { b.disabled = false; });
    }
  }

  document.querySelectorAll('#shareModal [data-export]').forEach(function (b) {
    b.addEventListener('click', function () { exportarLayout(b.dataset.export); });
  });

  // modelos importados à mão em versões anteriores não são mais usados
  try { localStorage.removeItem(CHAVE_QPT); } catch (e) { /* ignora */ }
  carregarModeloEmbutido();
  atualizarCamposModelo();

  // ---------- atualização contínua do endereço ----------
  map.on('moveend', agendarHash);
  const sidebarEl = document.getElementById('layerSidebar');
  if (sidebarEl) sidebarEl.addEventListener('change', agendarHash);
  window.addEventListener('hashchange', function () {
    aplicarHash(location.hash.replace(/^#/, ''));
  });

  // abre já no estado guardado no link, se houver
  if (location.hash.length > 1) aplicarHash(location.hash.replace(/^#/, ''));

  // =============================================================
  // 26. CONSULTA POR COORDENADAS
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

  // =============================================================
  // 27. GUIA DE PRIMEIRA VISITA ("Como usar")
  // Aparece sozinho na primeira visita (e não em links compartilhados);
  // depois, abre pelo botão "Como usar" do topo ou pela tecla "?".
  // =============================================================
  const CHAVE_GUIA = 'geoportal.guia.visto';
  const veioDeLink = location.hash.length > 1;   // medido agora, antes de o mapa gravar o próprio endereço

  const PASSOS_GUIA = [
    {
      titulo: 'Bem-vindo ao GeoPortal',
      texto: 'Este mapa reúne municípios, açudes, bacias, rios e poços da Paraíba. Em cinco passos rápidos você vê como explorar.',
      extra: 'Pelo teclado: Tab navega pelos botões, as setas movem o mapa, + e − aproximam e Esc fecha os painéis.',
      alvo: null
    },
    {
      titulo: 'Ligue as camadas',
      texto: 'Abra "Gestão de Camadas" para ligar e desligar cada camada, ajustar a opacidade, colorir o mapa por tema e aplicar filtros.',
      alvo: '.map-tool-btn[aria-label="Gestão de Camadas"]'
    },
    {
      titulo: 'Clique numa feição',
      texto: 'Clique em um município, açude, bacia, rio ou poço. A ficha mostra os dados e, na aba "Em números", gráficos e comparações.',
      alvo: '#map'
    },
    {
      titulo: 'Consulte a tabela de atributos',
      texto: 'Na tabela você busca, ordena por coluna e exporta os dados em CSV. Pelo teclado, use as setas para percorrer as linhas e Enter para localizar no mapa.',
      alvo: '.map-tool-btn[aria-label="Abrir Tabela de Atributos"]'
    },
    {
      titulo: 'Compartilhe o que você viu',
      texto: 'Gere um link do mapa exatamente como ele está agora, ou exporte uma imagem ou PDF com título e legenda. Para rever este guia, use "Como usar" no topo da página.',
      alvo: '.map-tool-btn[aria-label="Compartilhar e exportar o mapa"]'
    }
  ];

  let guiaCard = null, guiaAlvo = null, guiaPasso = -1, guiaFocoAntes = null;

  function guiaJaVisto() { try { return localStorage.getItem(CHAVE_GUIA) === '1'; } catch (e) { return false; } }
  function guiaMarcarVisto() { try { localStorage.setItem(CHAVE_GUIA, '1'); } catch (e) { /* ignora */ } }

  function fecharGuia() {
    if (guiaAlvo) { guiaAlvo.classList.remove('guia-alvo'); guiaAlvo = null; }
    if (guiaCard) { guiaCard.remove(); guiaCard = null; }
    guiaPasso = -1;
    guiaMarcarVisto();
    if (guiaFocoAntes && document.contains(guiaFocoAntes)) guiaFocoAntes.focus();
    guiaFocoAntes = null;
  }

  function posicionarGuia() {
    if (!guiaCard) return;
    const estreita = window.innerWidth < 576;
    const alvoMapa = !guiaAlvo || PASSOS_GUIA[guiaPasso].alvo === '#map';
    guiaCard.classList.toggle('guia-rodape', estreita);
    if (estreita) { ['left', 'top', 'right', 'bottom', 'width'].forEach(function (p) { guiaCard.style[p] = ''; }); return; }

    const largura = Math.min(340, window.innerWidth - 24);
    guiaCard.style.width = largura + 'px';
    guiaCard.style.right = 'auto';
    guiaCard.style.bottom = 'auto';
    if (alvoMapa) {
      guiaCard.style.left = Math.max(12, (window.innerWidth - largura) / 2) + 'px';
      guiaCard.style.top = Math.max(12, Math.min(140, window.innerHeight - guiaCard.offsetHeight - 12)) + 'px';
      return;
    }
    const r = guiaAlvo.getBoundingClientRect();
    let left = r.left - largura - 14;
    if (left < 12) left = Math.min(r.right + 14, window.innerWidth - largura - 12);
    const top = Math.max(12, Math.min(r.top, window.innerHeight - guiaCard.offsetHeight - 12));
    guiaCard.style.left = left + 'px';
    guiaCard.style.top = top + 'px';
  }

  function mostrarPassoGuia(i) {
    const passo = PASSOS_GUIA[i];
    if (!passo) { fecharGuia(); return; }
    guiaPasso = i;

    if (guiaAlvo) guiaAlvo.classList.remove('guia-alvo');
    guiaAlvo = passo.alvo ? document.querySelector(passo.alvo) : null;
    if (guiaAlvo && passo.alvo !== '#map') guiaAlvo.classList.add('guia-alvo');

    if (!guiaCard) {
      guiaCard = document.createElement('div');
      guiaCard.className = 'guia-card';
      guiaCard.setAttribute('role', 'dialog');
      guiaCard.setAttribute('aria-modal', 'false');
      guiaCard.setAttribute('aria-labelledby', 'guiaTitulo');
      guiaCard.setAttribute('aria-describedby', 'guiaTexto');
      guiaCard.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); fecharGuia(); } });
      document.body.appendChild(guiaCard);
    }

    const ultimo = i === PASSOS_GUIA.length - 1;
    const pontos = PASSOS_GUIA.map(function (_, k) { return '<span' + (k === i ? ' class="on"' : '') + '></span>'; }).join('');
    guiaCard.innerHTML =
      '<div class="guia-topo"><span class="guia-passo">Passo ' + (i + 1) + ' de ' + PASSOS_GUIA.length + '</span>' +
        '<button type="button" class="guia-fechar" data-guia="fechar" aria-label="Fechar o guia"><i class="ph ph-x"></i></button></div>' +
      '<h2 id="guiaTitulo" class="guia-titulo">' + escapeHtml(passo.titulo) + '</h2>' +
      '<p id="guiaTexto" class="guia-texto">' + escapeHtml(passo.texto) + '</p>' +
      (passo.extra ? '<p class="guia-extra">' + escapeHtml(passo.extra) + '</p>' : '') +
      '<div class="guia-pontos" aria-hidden="true">' + pontos + '</div>' +
      '<div class="guia-botoes">' +
        '<button type="button" class="guia-pular" data-guia="pular">Pular guia</button>' +
        (i > 0 ? '<button type="button" class="btn btn-outline-secondary btn-sm" data-guia="voltar">Voltar</button>' : '') +
        '<button type="button" class="btn btn-primary btn-sm" data-guia="proximo">' + (ultimo ? 'Começar a explorar' : 'Próximo') + '</button>' +
      '</div>';

    guiaCard.querySelectorAll('[data-guia]').forEach(function (b) {
      b.addEventListener('click', function () {
        const acao = b.dataset.guia;
        if (acao === 'proximo') mostrarPassoGuia(i + 1);
        else if (acao === 'voltar') mostrarPassoGuia(i - 1);
        else fecharGuia();
      });
    });

    posicionarGuia();
    const principal = guiaCard.querySelector('[data-guia="proximo"]');
    if (principal) principal.focus();
  }

  function abrirGuia() {
    if (guiaCard) return;
    guiaFocoAntes = document.activeElement;
    mostrarPassoGuia(0);
  }

  window.addEventListener('resize', posicionarGuia);

  const btnAjuda = document.getElementById('btnAjuda');
  if (btnAjuda) btnAjuda.addEventListener('click', abrirGuia);

  document.addEventListener('keydown', function (e) {
    const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if (e.key === '?' && !digitando && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); abrirGuia(); }
  });

  if (!veioDeLink && !guiaJaVisto()) setTimeout(abrirGuia, 900);

}

// =============================================================
// PÁGINA: GALERIA (galeria.html)
// =============================================================
// Cartões clicáveis + visualizador com zoom, arrastar, pinça, navegação e download
function iniciarGaleria() {
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
    img.alt = 'Mapa: ' + m.title;
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
}

// =============================================================
// PÁGINA: DOWNLOADS (downloads.html)
// =============================================================
function iniciarDownloads() {
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

  function garantirJSZip() { return carregarScriptExterno(CDN.jszip, 'JSZip'); }
  function garantirSql()   { return carregarScriptExterno(CDN.sql, 'initSqlJs'); }

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
    const celula = function (v) { return csvCelula(valorTexto(v)); };
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
      let base = semAcentos(k).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'CAMPO';
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
    chips += '<span class="dl-chip"><i class="ph ph-globe-hemisphere-west"></i>' + escapeHtml(c.crs) + '</span>';

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
          '<strong class="d-block text-dark">' + escapeHtml(c.titulo) + '</strong>' +
          '<small class="text-muted d-block">' + escapeHtml(c.desc) + '</small>' +
          '<div class="dl-meta">' + chips + '</div>' +
          (c.fonte ? '<small class="text-muted">Fonte: ' + escapeHtml(c.fonte) + '</small>' : '') +
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
}

// =============================================================
// INICIALIZAÇÃO POR PÁGINA
// =============================================================
document.addEventListener('DOMContentLoaded', function () {
  ocultarIconesDecorativos();
  if (document.getElementById('map')) iniciarMapa();
  if (document.querySelector('.gallery-card')) iniciarGaleria();
  if (document.getElementById('dlItems')) iniciarDownloads();
});