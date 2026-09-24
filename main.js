var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
});

var googleSat = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    attribution: '&copy; Google'
});

var acudesStyle = {
    "color": "#2eacbf",
    "fillColor": "#2a9fb0",
    "weight": 2,
};

var municipiosStyle = {
    "color": "#666666",
    "fillColor": "#cccccc",
    "weight": 1,
    "fillOpacity": 0.1,
};

var baciasStyle = {
    "color": "#ff7800",
    "fillColor": "#ffbb00",
    "weight": 2,
    "fillOpacity": 0.2,
};

var riosStyle = {
    "color": "#0055ff",
    "weight": 1.5,
};

function onEachFeature(feature, layer) {
    // does this feature have a property named popupContent?
    if (feature.properties && feature.properties.Nome) {
       var popUp = `
       <strong>Nome: </strong>${feature.properties.Nome || 'Sem dados' }<br>
       <strong>Município: </strong>${feature.properties. Municipio || 'Sem dados' }<br>
       <strong>Finalidade: </strong>${feature.properties.Finalidade || 'Sem dados' }<br>
       <strong>Executor: </strong>${feature.properties. Executor || 'Sem dados' }<br>
       `
       layer.bindPopup(popUp);
        }
    }

    function onEachFeatureMunicipios(feature, layer) {
    if (feature.properties) {
        var popUp =`
        <strong>Município: </strong>${feature.properties.Nome || feature.properties.Nome || 'Sem dados'}`;
        layer.bindPopup(popUp);
    }
}

function onEachFeatureBacias(feature, layer) {
    if (feature.properties) {
        var popUp = `
        <strong>Bacia Hidrográfica: </strong>${feature.properties.Nome || feature.properties.Nome || 'Sem dados'}`;
        layer.bindPopup(popUp);
    }
}

var acudesLayer = L.geoJSON(acudes,{
    style:acudesStyle,
    onEachFeature: onEachFeature
});

var baciasLayer = L.geoJSON(bacias,{
    style:baciasStyle,
    onEachFeature: onEachFeatureBacias
});

var municipiosLayer = L.geoJSON(municipios,{
    style:municipiosStyle,
    onEachFeature: onEachFeatureMunicipios
});

var riosLayer = L.geoJSON(rios,{
    style:riosStyle,
});

var map = L.map('map', 
{ center: [-7.23714814, -36.24114990], 
 zoom: 8,
 layers: [acudesLayer, osm]
    }); 

var baseMaps = {
    "OpenStreetMap": osm,
    "Google Satélite": googleSat,
    
};

var overlayMaps = {
    "Açudes": acudesLayer,
    "Municípios": municipiosLayer,
    "Bacias Hidrográficas": baciasLayer,
    "Rios": riosLayer
};

var layerControl = L.control.layers(baseMaps, overlayMaps).addTo(map);

