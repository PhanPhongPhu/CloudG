/* ==========================================================
   1. GLOBAL CONFIG + MAP INIT + BASEMAPS
========================================================== */
console.log("CloudMap NAVY FULL AI — app.js loaded");

const map = L.map("map", { zoomControl: false }).setView([15.5, 108], 6);

let ACTIVE_LAYER = null;
let LABEL_LAYER = null;
let USER_LAYERS = [];
let BASEMAP_ACTIVE = null;

const basemaps = {
    osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20 }),
    esri: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20 }),
    google: L.tileLayer("https://mts0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", { maxZoom: 20 }),
    sat: L.tileLayer("https://mts0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", { maxZoom: 20 }),
    hybrid: L.tileLayer("https://mts0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", { maxZoom: 20 }),
    light: L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSLightGray/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20 })
};

function setBasemap(key) {
    if (BASEMAP_ACTIVE) map.removeLayer(BASEMAP_ACTIVE);
    BASEMAP_ACTIVE = basemaps[key];
    BASEMAP_ACTIVE.addTo(map);
}
setBasemap("google");

/* ==========================================================
   2. UI HANDLERS — SIDEBAR + PANELS
========================================================== */
const sidebar = document.getElementById("sidebar");
function toggleSidebar() {
    sidebar.classList.toggle("collapsed");
}

function openPanel(id, fromMap = false) {

    if (!fromMap) {
        const panel = document.getElementById(id);
        if (panel.classList.contains("open")) {
            panel.classList.remove("open");
            return;
        }
    }

    document.querySelectorAll(".panel").forEach(p => p.classList.remove("open"));

    const panel = document.getElementById(id);
    panel.classList.add("open");

    if (id === "analyticsPanel") analyzeDataset();

    if (id === "infoPanel" && !lastClicked) {
        document.getElementById("info-default").style.display = "block";
        document.getElementById("infoContent").classList.add("hidden");
    }
}
/* ==========================================================
   3. LOAD VIETNAM BASE LAYER
========================================================== */
let VN_GEOJSON = null;
let VN_LAYER = null;
let provinceCentroids = {};

async function loadVietnam() {
    try {
        const res = await fetch("https://dl.dropboxusercontent.com/scl/fi/eqp8i6o5nytqas19zedk5/ToanQuoc.geojson?rlkey=y5b2ictgxcfz41n80mgobr5qi");
        VN_GEOJSON = await res.json();

        VN_LAYER = L.geoJSON(VN_GEOJSON, {
            style: styleProvince,
            onEachFeature: provinceEvents
        }).addTo(map);

        map.fitBounds(VN_LAYER.getBounds());
        drawLabels(false); //


        document.getElementById("mapLoading").style.display = "none";
    } catch (err) {
        alert("Không load được ToanQuoc.geojson từ Dropbox");
        console.error(err);
    }
}

loadVietnam();
/* ============================
   SEARCH — TÌM TỈNH (cải tiến)
   ============================ */

function normalizeString(str) {
    if (!str) return "";
    // chuyển Unicode về dạng NFD rồi loại dấu để so sánh không dấu
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function searchProvince() {
    const qEl = document.getElementById("searchProvince");
    const resultEl = document.getElementById("searchResult");
    const qRaw = qEl.value || "";
    const q = normalizeString(qRaw.trim());

    // clean previous results
    resultEl.innerHTML = "";

    if (!q || !VN_GEOJSON) {
        // nếu rỗng thì không hiển thị gì
        return;
    }

    // tìm các feature có tên tỉnh chứa chuỗi tìm kiếm (không dấu, không phân biệt hoa thường)
    const matches = VN_GEOJSON.features.filter(f => {
        const name = f.properties && (f.properties.ten_tinh || "");
        return normalizeString(name).includes(q);
    });

    if (!matches.length) {
        const li = document.createElement("li");
        li.textContent = "Không tìm thấy";
        li.style.padding = "8px";
        resultEl.appendChild(li);
        return;
    }

    // hiển thị tối đa 10 kết quả
    matches.slice(0, 10).forEach(f => {
        const name = f.properties.ten_tinh || "—";
        const li = document.createElement("li");
        li.textContent = name;
        li.style.padding = "8px";
        li.style.cursor = "pointer";

        li.onclick = () => {
            // tìm layer tương ứng trong VN_LAYER (L.geoJSON)
            if (VN_LAYER) {
                VN_LAYER.eachLayer(layer => {
                    if (layer.feature && layer.feature.properties &&
                        layer.feature.properties.ten_tinh === f.properties.ten_tinh) {
                        // gọi selectProvince để highlight + mở panel + zoom
                        selectProvince(layer.feature, layer);
                    }
                });
            }

            // dọn UI tìm kiếm
            resultEl.innerHTML = "";
            qEl.value = "";
        };

        resultEl.appendChild(li);
    });
}

// Nếu muốn: đóng kết quả khi click ra ngoài
document.addEventListener("click", (e) => {
    if (!e.target.closest("#searchResult") && !e.target.closest("#searchProvince")) {
        const resultEl = document.getElementById("searchResult");
        if (resultEl) resultEl.innerHTML = "";
    }
});

/* ==========================================================
   4. IMPORTER — GEOJSON + SHP.zip + KML + KMZ
========================================================== */
async function handleUpload(evt) {
    const file = evt.target.files[0];
    if (!file) return;

    const name = file.name.toLowerCase();

    if (name.endsWith(".geojson") || name.endsWith(".json")) {
        loadGeoJSONFile(file);
    }
    else if (name.endsWith(".kml")) {
        loadKMLFile(file);
    }
    else if (name.endsWith(".kmz")) {
        loadKMZFile(file);
    }
    else if (name.endsWith(".zip")) {
        loadSHPFile(file);
    }
}

function addUserLayer(layer, name) {
    USER_LAYERS.push({ layer, name });
    layer.addTo(map);
    refreshLayerList();
}

/* ======== GeoJSON ======== */
function loadGeoJSONFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        const gj = JSON.parse(reader.result);
        const layer = L.geoJSON(gj, { style: userStyle }).addTo(map);
        addUserLayer(layer, file.name);
        map.fitBounds(layer.getBounds());
    };
    reader.readAsText(file);
}

/* ======== KML ======== */
function loadKMLFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        const parser = new DOMParser();
        const kml = parser.parseFromString(reader.result, "text/xml");
        const converted = toGeoJSON.kml(kml);
        const layer = L.geoJSON(converted, { style: userStyle }).addTo(map);
        addUserLayer(layer, file.name);
        map.fitBounds(layer.getBounds());
    };
    reader.readAsText(file);
}

/* ======== KMZ ======== */
function loadKMZFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
        const zip = await JSZip.loadAsync(reader.result);
        const kmlText = await zip.file(/\.kml$/i)[0].async("string");
        const xml = new DOMParser().parseFromString(kmlText, "text/xml");
        const converted = toGeoJSON.kml(xml);
        const layer = L.geoJSON(converted, { style: userStyle }).addTo(map);
        addUserLayer(layer, file.name);
        map.fitBounds(layer.getBounds());
    };
    reader.readAsArrayBuffer(file);
}

/* ======== SHP.zip ======== */
function loadSHPFile(file) {
    shp(file).then(gj => {
        const layer = L.geoJSON(gj, { style: userStyle }).addTo(map);
        addUserLayer(layer, file.name);
        map.fitBounds(layer.getBounds());
    });
}
/* ==========================================================
   5. STYLE ENGINE (Auto symbol)
========================================================== */
function styleProvince(f) {
    const colors = ["#4EA8FF", "#6AC4FF", "#90D7FF", "#B5E9FF", "#D8F5FF"];
    const idx = Number(f.properties.ma_tinh) % colors.length;
    return {
        color: "#1D2256",
        weight: 1,
        fillColor: colors[idx],
        fillOpacity: 0.65
    };
}

function userStyle() {
    return {
        color: "#1D2256",
        weight: 1.2,
        fillColor: "#4EA8FF",
        fillOpacity: 0.45
    };
}

/* ==========================================================
   6. FEATURE EVENTS — HOVER + CLICK
========================================================== */
let lastClicked = null;

function provinceEvents(f, layer) {
    layer.on({
        mouseover: () => layer.setStyle({ weight: 3, color: "white" }),

        mouseout: () => {
            if (layer !== lastClicked) {
                VN_LAYER.resetStyle(layer);

                // Giữ opacity theo user
                const opt = layer.options;
                if (opt.opacity) {
                    layer.setStyle({
                        opacity: opt.opacity,
                        fillOpacity: opt.fillOpacity
                    });
                }
            }
        },

        click: () => selectProvince(f, layer)
    });
}

function selectProvince(f, layer) {
    if (lastClicked) VN_LAYER.resetStyle(lastClicked);
    lastClicked = layer;

    const opt = layer.options;

    layer.setStyle({
        weight: 3,
        color: "#FFD700",
        fillOpacity: opt.fillOpacity ?? 0.85,
        opacity: opt.opacity ?? 1
    });

    openPanel("infoPanel", true);
    updateInfoPanel(f.properties);
    map.fitBounds(layer.getBounds());
}
/* ==========================================================
   7. INFO PANEL — ADVANCED TABLE
========================================================== */
function updateInfoPanel(p) {
    document.getElementById("info-default").style.display = "none";

    const box = document.getElementById("infoContent");
    box.classList.remove("hidden");

    // cập nhật tiêu đề
    document.getElementById("info-title-text").innerText = p.ten_tinh;

    box.innerHTML = `
        ${row("Diện tích", p.dtich_km2.toLocaleString() + " km²", "dtich_km2")}
        ${row("Dân số", p.dan_so.toLocaleString(), "dan_so")}
        ${row("Mật độ", p.matdo_km2.toLocaleString() + " người/km²", "matdo_km2")}

        <div class="info-divider"></div>

        ${row("Trụ sở", p.tru_so || "—", "tru_so")}
        ${row("Quy mô", p.quy_mo || "—", "quy_mo")}
        ${row("Sáp nhập", p.sap_nhap || "—", "sap_nhap")}
    `;

    ACTIVE_EDIT_DATA = p; // lưu lại để sửa
}


function row(label, value, key) {
    return `
        <div class="info-row" data-key="${key}">
            <div class="info-label">${label}</div>
            <div class="info-value" data-view>${value}</div>
            <input class="info-input" data-edit value="${value}" style="display:none;">
        </div>
    `;
}


/* ==========================================================
   8. ANALYTICS ENGINE — LEVEL 2
========================================================== */
function analyzeDataset() {
    if (!VN_GEOJSON) return;

    const features = VN_GEOJSON.features.map(f => f.properties);

    const totalArea = features.reduce((s, p) => s + p.dtich_km2, 0);
    const totalPop  = features.reduce((s, p) => s + p.dan_so, 0);

    const topArea = [...features].sort((a,b) => b.dtich_km2 - a.dtich_km2).slice(0,5);
    const topPop  = [...features].sort((a,b) => b.dan_so - a.dan_so).slice(0,5);

    document.getElementById("analytics-summary").innerHTML = `
        <div class="row"><strong>Tổng diện tích:</strong> ${totalArea.toLocaleString()} km²</div>
        <div class="row"><strong>Tổng dân số:</strong> ${totalPop.toLocaleString()}</div>
        <div class="row"><strong>Tỉnh lớn nhất:</strong> ${topArea[0].ten_tinh}</div>
        <div class="row"><strong>Đông dân nhất:</strong> ${topPop[0].ten_tinh}</div>
    `;

    document.getElementById("topArea").innerHTML =
        topArea.map(t => `
            <tr><td>${t.ten_tinh}</td><td>${t.dtich_km2.toLocaleString()}</td></tr>
        `).join("");

    document.getElementById("topPopulation").innerHTML =
        topPop.map(t => `
            <tr><td>${t.ten_tinh}</td><td>${t.dan_so.toLocaleString()}</td></tr>
        `).join("");

    drawChart("chartArea",
        features.map(p => p.ten_tinh).slice(0,20),
        features.map(p => p.dtich_km2).slice(0,20),
        "Diện tích các tỉnh");

    drawChart("chartPopulation",
        features.map(p => p.ten_tinh).slice(0,20),
        features.map(p => p.dan_so).slice(0,20),
        "Dân số");

    drawChart("chartDensity",
        features.map(p => p.ten_tinh).slice(0,20),
        features.map(p => p.matdo_km2).slice(0,20),
        "Mật độ dân số");

    highlightProvince(topArea[0].ten_tinh);
}
/* ==========================================================
   9. AI ENGINE — GROQ (3 MODES)
========================================================== */
async function askAI() {
    const input = document.getElementById("aiInput");
    const q = input.value.trim();
    if (!q) return;

    addChat("user", q);
    input.value = "";

    try {
        const provinceData = VN_GEOJSON
            ? VN_GEOJSON.features.map(f => f.properties)
            : [];

        const systemPrompt = `
Bạn tên là CloudMap — trợ lý thông tin các tỉnh Việt Nam.

Dưới đây là danh sách tỉnh và thông số:
${JSON.stringify(provinceData)}

QUY TẮC TRẢ LỜI:
- Không nhắc đến GeoJSON, JSON, field, thuộc tính, layer…
- Không mô tả cách bạn lấy dữ liệu.
- Chỉ trả lời nội dung cuối cùng: “Hà Nội có dân số…”
- Dùng ngôn ngữ đời thường.
- Nếu bị hỏi cách hoạt động:
  “Tôi được xây dựng để cung cấp thông tin đã chuẩn hoá về các tỉnh Việt Nam.”
`;

        const res = await fetch("https://chatbot.phongphu-hcm-2003.workers.dev/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: q }
                ]
            })
        });

        const data = await res.json();
        console.log("Worker response:", data);

        if (!data.choices || !data.choices[0]) {
            addChat("bot", "⚠️ API không phản hồi đúng.");
            return;
        }

        addChat("bot", data.choices[0].message.content);

    } catch (err) {
        console.error(err);
        addChat("bot", "⚠️ Không thể kết nối server AI.");
    }
}



// =============================================
// Chat UI
// =============================================
function addChat(role, text) {
    const box = document.getElementById("aiMessages");

    const div = document.createElement("div");
    div.className = "chat-msg " + role;

    // Tối ưu xuống dòng tự nhiên
    div.innerText = text;

    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}


/* ENTER → SEND CHAT */
document.getElementById("aiInput").addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        askAI();
    }
});
/* ==========================================================
   10. LAYER MANAGER — UI SYNC
========================================================== */

function refreshLayerList() {
    const list = document.getElementById("layerList");
    list.innerHTML = "";

    USER_LAYERS.forEach((obj, i) => {
        const div = document.createElement("div");
        div.className = "layer-item-pro";

        div.innerHTML = `
            <div class="layer-left">
                <input type="checkbox" 
                       ${map.hasLayer(obj.layer) ? "checked" : ""} 
                       class="layer-toggle" 
                       data-i="${i}">
                <span class="layer-name">${obj.name}</span>
            </div>

            <div class="layer-tools">
                <input type="range" min="0.1" max="1" step="0.1"
                       value="${obj.opacity || 1}"
                       class="opacity-slider"
                       data-i="${i}"
                       title="Độ mờ">

                <span class="tool-btn layer-menu-btn" 
                      data-i="${i}" 
                      title="Tùy chọn">⋮</span>
            </div>

            <div class="layer-menu" id="layerMenu-${i}">
                <div class="layer-menu-item" data-act="style" data-i="${i}">🎨 Đổi màu</div>
                <div class="layer-menu-item" data-act="zoom"  data-i="${i}">🔍 Zoom đến lớp</div>
                <div class="layer-menu-item" data-act="export" data-i="${i}">💾 Xuất GeoJSON</div>
                <div class="layer-menu-item" data-act="rename" data-i="${i}">✏️ Đổi tên</div>
                <div class="layer-menu-item" data-act="delete" data-i="${i}">❌ Xóa lớp</div>
            </div>
        `;

        list.appendChild(div);
    });

    bindLayerTools();
}


/* ==========================================================
   11. LAYER MENU — TOOLS + POSITION FIXED
========================================================== */

function bindLayerTools() {

    /* Checkbox toggle */
    document.querySelectorAll(".layer-toggle").forEach(chk => {
        chk.onchange = () => toggleUserLayer(Number(chk.dataset.i));
    });

    /* Opacity slider */
    document.querySelectorAll(".opacity-slider").forEach(sl => {
        sl.oninput = () => setLayerOpacity(Number(sl.dataset.i), sl.value);
    });

    /* Menu toggle */
document.querySelectorAll(".layer-menu-btn").forEach(btn => { 
    btn.onclick = (e) => {
        e.stopPropagation();

        const id = Number(btn.dataset.i);
        const menu = document.getElementById(`layerMenu-${id}`);

        // đóng menu khác
        document.querySelectorAll(".layer-menu")
            .forEach(m => m.classList.remove("open"));

        // bật/tắt menu
        menu.classList.toggle("open");
    };
});

// đóng khi click ra ngoài
document.addEventListener("click", () => {
    document.querySelectorAll(".layer-menu")
        .forEach(m => m.classList.remove("open"));
});


    /* Menu item click */
    document.querySelectorAll(".layer-menu-item").forEach(item => {
        item.onclick = () => layerToolAction(item.dataset.act, Number(item.dataset.i));
    });
}

/* Đóng tất cả menu nếu click ra ngoài */
document.addEventListener("click", (e) => {
    if (!e.target.closest(".layer-menu") &&
        !e.target.closest(".layer-menu-btn")) {
        document.querySelectorAll(".layer-menu").forEach(m => m.classList.remove("open"));
    }
});


/* ==========================================================
   12. LAYER ACTIONS
========================================================== */

function toggleUserLayer(i) {
    const obj = USER_LAYERS[i];
    if (!obj) return;

    if (map.hasLayer(obj.layer)) map.removeLayer(obj.layer);
    else map.addLayer(obj.layer);
}

function setLayerOpacity(i, value) {
    const obj = USER_LAYERS[i];
    if (!obj) return;

    obj.opacity = value;

    obj.layer.setStyle({
        opacity: value,
        fillOpacity: value * 0.6
    });

    // ghi lại vào option để hover không reset
    obj.layer.options.opacity = value;
    obj.layer.options.fillOpacity = value * 0.6;
}

function layerToolAction(act, i) {
    const obj = USER_LAYERS[i];
    if (!obj) return;

    switch(act) {

        case "style":
            const color = prompt("Chọn màu (#RRGGBB):", obj.color || "#4EA8FF");
            if (color) {
                obj.color = color;
                obj.layer.setStyle({
                    color,
                    fillColor: color,
                    fillOpacity: obj.opacity || 0.6,
                    weight: 2
                });
            }
            break;

        case "zoom":
            map.fitBounds(obj.layer.getBounds());
            break;

        case "export":
            exportLayer(obj.name, obj.layer.toGeoJSON());
            break;

        case "rename":
            const newName = prompt("Tên mới:", obj.name);
            if (newName) {
                obj.name = newName;
                refreshLayerList();
            }
            break;

        case "delete":
            map.removeLayer(obj.layer);
            USER_LAYERS.splice(i, 1);
            refreshLayerList();
            break;
    }

    document.getElementById(`layerMenu-${i}`).classList.remove("open");
}


/* ==========================================================
   13. EXPORT LAYER
========================================================== */

function exportLayer(name, data) {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = name + ".geojson";
    a.click();

    URL.revokeObjectURL(url);
}
/* ==========================================================
   14. LABELS — PROVINCE NAMES
========================================================== */

function drawLabels() {
    LABEL_LAYER = L.layerGroup(); // ❌ KHÔNG addTo(map) ở đây

    VN_GEOJSON.features.forEach(f => {
        const c = turf.centroid(f).geometry.coordinates;

        L.marker([c[1], c[0]], {
            icon: L.divIcon({
                className: "province-label",
                html: f.properties.ten_tinh
            })
        }).addTo(LABEL_LAYER);
    });
}


function toggleLabels() {
    if (map.hasLayer(LABEL_LAYER)) map.removeLayer(LABEL_LAYER);
    else map.addLayer(LABEL_LAYER);
}


/* ==========================================================
   15. ZOOM TO VIETNAM (RESET VIEW)
========================================================== */
function zoomToVietnam() {
    if (VN_LAYER) {
        map.fitBounds(VN_LAYER.getBounds());
    }
}


/* ==========================================================
   16. CHART BUILDER — BAR CHART
========================================================== */

function drawChart(id, labels, data, labelText) {
    const ctx = document.getElementById(id);
    if (!ctx) return;

    new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: labelText,
                data,
                backgroundColor: "rgba(78,168,255,0.5)",
                borderColor: "#1D2256",
                borderWidth: 1
            }]
        },
        options: {
            plugins: { legend: { display: false }},
            scales: { y: { beginAtZero: true }}
        }
    });
}


/* ==========================================================
   17. HIGHLIGHT PROVINCE IN ANALYTICS MODE
========================================================== */

function highlightProvince(name) {
    if (!VN_LAYER) return;

    VN_LAYER.eachLayer(layer => {
        const p = layer.feature.properties;
        if (p.ten_tinh === name) {
            layer.setStyle({
                weight: 4,
                color: "#FF9800",
                fillColor: "#FFD180",
                fillOpacity: 0.75
            });
            map.fitBounds(layer.getBounds());
        }
    });
}


/* ==========================================================
   18. FILE UPLOAD LISTENER (GEOJSON / SHP / KML / KMZ)
========================================================== */

document.getElementById("fileLoader")
    .addEventListener("change", handleUpload);


/* ==========================================================
   19. CLOSE ALL LAYER MENUS WHEN CLICK OUTSIDE
========================================================== */

document.addEventListener("click", (e) => {
    if (!e.target.closest(".layer-menu") &&
        !e.target.closest(".layer-menu-btn")) {

        document.querySelectorAll(".layer-menu")
            .forEach(m => m.classList.remove("open"));
    }
});
let EDIT_MODE = false;
let ACTIVE_EDIT_DATA = null;

function toggleEditInfo() {
    EDIT_MODE = !EDIT_MODE;

    const rows = document.querySelectorAll("#infoContent .info-row");

    rows.forEach(r => {
        const view = r.querySelector("[data-view]");
        const edit = r.querySelector("[data-edit]");

        if (EDIT_MODE) {
            view.style.display = "none";
            edit.style.display = "block";
        } else {
            view.style.display = "block";
            edit.style.display = "none";
        }
    });

    // đổi icon
    document.getElementById("editInfoBtn").innerText = EDIT_MODE ? "💾" : "🛠";

    // nếu tắt edit → lưu thay đổi
    if (!EDIT_MODE) saveEditInfo();
}
function saveEditInfo() {
    if (!ACTIVE_EDIT_DATA) return;

    const rows = document.querySelectorAll("#infoContent .info-row");

    rows.forEach(r => {
        const key = r.dataset.key;
        const edit = r.querySelector("[data-edit]");

        let val = edit.value.trim();

        // xử lý số
        if (["dan_so","dtich_km2","matdo_km2"].includes(key)) {
            val = Number(val.replace(/\D/g, ""));
        }

        ACTIVE_EDIT_DATA[key] = val;
    });

    // cập nhật lại panel
    updateInfoPanel(ACTIVE_EDIT_DATA);
}
