/* ==========================================================
   1. GLOBAL CONFIG + MAP INIT + BASEMAPS
========================================================== */
console.log("CloudMap NAVY FULL AI — app.js loaded");

const map = L.map("map", { zoomControl: false }).setView([15.5, 108], 6);

let renameMap = {};
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

function setLoadingProgress(percent, text = "") {
    const bar = document.getElementById("cloudProgressBar");
    const label = document.getElementById("cloudLoadingText");
    bar.style.width = percent + "%";

    if (text) label.innerText = text;
}


async function loadVietnam() {
    try {
        setLoadingProgress(10, "Đang tải dữ liệu Toàn Quốc…");

        const res = await fetch("https://data.phongphu-hcm-2003.workers.dev/data?file=toanquoc");
        setLoadingProgress(30, "Đang xử lý dữ liệu Toàn Quốc…");

        VN_GEOJSON = await res.json();
        setLoadingProgress(50, "Đang dựng lớp biên giới…");

        VN_LAYER = L.geoJSON(VN_GEOJSON, {
            style: styleProvince,
            onEachFeature: provinceEvents
        }).addTo(map);

        setLoadingProgress(65, "Đang vẽ nhãn các tỉnh…");
        drawLabels(false);

        setLoadingProgress(80, "Đang căn chỉnh bản đồ…");
        map.fitBounds(VN_LAYER.getBounds());

        setLoadingProgress(100, "Hoàn thành!");

        // Ẩn loading sau 0.5 giây cho mượt
        setTimeout(() => {
            document.getElementById("cloudLoader").classList.add("hidden");
        }, 500);

    } catch (err) {
        alert("Không load được ToanQuoc từ Cloudflare Worker");
        console.error(err);
    }
}
loadVietnam();


let LN_GEOJSON = null;

async function loadLamNghiep() {
    try {
        setLoadingProgress(85, "Đang tải dữ liệu Lâm nghiệp…");

        const res = await fetch("https://data.phongphu-hcm-2003.workers.dev/data?file=lamnghiep");
        setLoadingProgress(92, "Đang xử lý Lâm nghiệp…");

        LN_GEOJSON = await res.json();

        console.log("LamNghiep loaded:", LN_GEOJSON);
        setLoadingProgress(100, "Hoàn thành!");

    } catch (err) {
        console.error("Không load được LamNghiep.geojson", err);
    }
}

loadLamNghiep();

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

function addUserLayer(layer, name, gj) {
    let type = "Unknown";
    try {
        type = gj.features?.[0]?.geometry?.type || "Unknown";
    } catch {}

    USER_LAYERS.push({
        layer,
        name,
        type,
        gj
    });

    layer.addTo(map);
    refreshLayerList();
}




/* ======== GeoJSON ======== */
function loadGeoJSONFile(file) {
    const reader = new FileReader();

    reader.onload = async () => {   // <--- FIX
        const gj = JSON.parse(reader.result);

        // AI rename
        const fields = Object.keys(gj.features[0].properties || {});
        renameMap = await aiRenameFields(fields);

        const layer = L.geoJSON(gj, {
            style: userStyle,
            onEachFeature: universalPopup
        }).addTo(map);

        addUserLayer(layer, file.name, gj);
        map.fitBounds(layer.getBounds());
    };

    reader.readAsText(file);
}

/* ======== KML ======== */
function loadKMLFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
        const parser = new DOMParser();
        const kml = parser.parseFromString(reader.result, "text/xml");
        const converted = toGeoJSON.kml(kml);

        const fields = Object.keys(converted.features[0].properties || {});
        renameMap = await aiRenameFields(fields);

        const layer = L.geoJSON(converted, {
            style: userStyle,
            onEachFeature: universalPopup
        }).addTo(map);

        addUserLayer(layer, file.name, converted);
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

        const fields = Object.keys(converted.features[0].properties || {});
        renameMap = await aiRenameFields(fields);

        const layer = L.geoJSON(converted, {
            style: userStyle,
            onEachFeature: universalPopup
        }).addTo(map);

        addUserLayer(layer, file.name, converted);
        map.fitBounds(layer.getBounds());
    };
    reader.readAsArrayBuffer(file);
}


/* ======== SHP.zip ======== */
function loadSHPFile(file) {
    shp(file).then(async gj => {
        const fields = Object.keys(gj.features[0].properties || {});
        renameMap = await aiRenameFields(fields);

        const layer = L.geoJSON(gj, {
            style: userStyle,
            onEachFeature: universalPopup
        }).addTo(map);

        addUserLayer(layer, file.name, gj);
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
                if (opt.opacity !== undefined) {
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

function analyzeUserDataset(gj) {

    if (!gj || !gj.features || !gj.features.length) {
        document.getElementById("analyticsPanel").innerHTML =
            "<div style='padding:10px;'>Dataset không có thuộc tính.</div>";
        return;
    }

    const rows = gj.features.map(f => f.properties || {});
    const fields = Object.keys(rows[0] || {});

    // Các field không nên thống kê
    const skip = ["id", "fid", "objectid", "shape_length", "shape_area", "stt"];

    let numericStats = [];
    let textStats = [];

    fields.forEach(key => {

        const keyLower = key.toLowerCase();
        if (skip.includes(keyLower)) return;

        const valuesRaw = rows.map(r => r[key]).filter(v => v !== null && v !== undefined);

        if (!valuesRaw.length) return;

        const allNumeric = valuesRaw.every(v => typeof v === "number");

        // ======= FIELD DẠNG SỐ =======
        if (allNumeric) {
            const sum = valuesRaw.reduce((s, x) => s + x, 0);
            const avg = sum / valuesRaw.length;
            const min = Math.min(...valuesRaw);
            const max = Math.max(...valuesRaw);

            numericStats.push({
                key,
                sum,
                avg,
                min,
                max
            });
        }

        // ======= FIELD DẠNG CHUỖI =======
        else {
            const freq = {};
            valuesRaw.forEach(v => freq[v] = (freq[v] || 0) + 1);
            const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];

            textStats.push({
                key,
                topValue: top[0],
                topCount: top[1]
            });
        }
    });

    // ======= RENDER HTML =======
    let html = `
        <div style="padding:10px;">
            <div style="font-size:18px;font-weight:600;margin-bottom:10px;">
                Thống kê Dataset
            </div>
    `;

    // ----------------------------
    // Phần dạng số
    // ----------------------------
    if (numericStats.length) {
        html += `
            <div style="font-weight:600;margin-top:10px;margin-bottom:4px;">
                📊 Các trường dạng số
            </div>
        `;

        numericStats.forEach(s => {
            const label = renameMap[s.key] || s.key.replace(/_/g, " ");
            html += `
                <div style="padding:6px 0;">
                    <div style="font-weight:600">${label}</div>
                    <div>– Tổng: ${s.sum.toLocaleString()}</div>
                    <div>– Trung bình: ${s.avg.toLocaleString()}</div>
                    <div>– Nhỏ nhất: ${s.min.toLocaleString()}</div>
                    <div>– Lớn nhất: ${s.max.toLocaleString()}</div>
                </div>
                <hr>
            `;
        });
    }

    // ----------------------------
    // Phần dạng chuỗi
    // ----------------------------
    if (textStats.length) {
        html += `
            <div style="font-weight:600;margin-top:10px;margin-bottom:4px;">
                🔠 Các trường dạng chuỗi
            </div>
        `;

        textStats.forEach(s => {
            const label = renameMap[s.key] || s.key.replace(/_/g, " ");
            html += `
                <div style="padding:6px 0;">
                    <div style="font-weight:600">${label}</div>
                    <div>– Phổ biến nhất: ${s.topValue} (${s.topCount} lần)</div>
                </div>
                <hr>
            `;
        });
    }

    html += "</div>";

    document.getElementById("analyticsPanel").innerHTML = html;
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
        ? VN_GEOJSON.features.map(f => ({
            ten_tinh: f.properties.ten_tinh,
            dtich_km2: f.properties.dtich_km2,
            dan_so: f.properties.dan_so,
            matdo_km2: f.properties.matdo_km2
            }))
        : [];

        const lamnghiepData = LN_GEOJSON
        ? LN_GEOJSON.features.slice(0, 200).map(f => ({   // hạn chế 200 feature
            ten: f.properties.ten || f.properties.name,
            loai: f.properties.loai || f.properties.type,
            dientich: f.properties.dientich || f.properties.area
            }))
        : [];

        const systemPrompt = `
Bạn tên là CloudMap — trợ lý thông tin các tỉnh/thành Việt Nam.

Dữ liệu tỉnh/thành (tên, diện tích, dân số, mật độ):
${JSON.stringify(provinceData)}

Dữ liệu lâm nghiệp (tối giản 200 đối tượng):
${JSON.stringify(lamnghiepData)}



QUY TẮC TRẢ LỜI:
- Không nhắc đến GeoJSON, JSON, field, thuộc tính, layer…
- Không mô tả cách bạn lấy dữ liệu.
- Chỉ trả lời nội dung cuối cùng: “Hà Nội có dân số…”
- Dùng ngôn ngữ đời thường.
- Nếu bị hỏi cách hoạt động:
  “Tôi được xây dựng để cung cấp thông tin đã chuẩn hoá về các tỉnh/thành Việt Nam.”
- Nếu câu trả lời liên quan đến một tỉnh/thành cụ thể, hãy thêm dòng [map-focus: TÊN_TỈNH] ở cuối.
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

        if (!res.ok) {
    addChat("bot", "⚠️ AI server đang gặp lỗi (mã " + res.status + ").");
    console.error("AI error:", res.status);
    return;
        }

        let data;
        try {
            data = await res.json();
        } catch (err) {
            addChat("bot", "⚠️ Lỗi đọc dữ liệu từ AI server.");
            console.error("JSON parse fail:", err);
            return;
        }

        console.log("Worker response:", data);

        if (!data.choices || !data.choices[0]) {
            addChat("bot", "⚠️ API không phản hồi đúng.");
            return;
        }

        addChat("bot",
    data.choices[0].message.content.replace(/\[map-focus:.*?\]/, "").trim());

    } catch (err) {
        console.error(err);
        const fullText = data.choices[0].message.content;
        const focusMatch = fullText.match(/\[map-focus:\s*(.+?)\]/i);

        if (focusMatch) {
            const provinceName = focusMatch[1].trim();

            // Delay nhẹ để tin nhắn hiển thị trước
            setTimeout(() => {
                focusProvinceByName(provinceName);
            }, 250);
        }
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
   10. ICONS FOR GEOMETRY TYPES
========================================================== */
function getGeometryIcon(type) {
    switch (type) {
        case "Point":
        case "MultiPoint": return "📍";
        case "LineString":
        case "MultiLineString": return "🛣️";
        case "Polygon":
        case "MultiPolygon": return "🟦";
        default: return "📄";
    }
}

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
                <span class="layer-icon">${getGeometryIcon(obj.type)}</span>
                <span class="layer-name" title="${obj.name}">${obj.name}</span>
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
            </div>`;

        list.appendChild(div);
    });

    bindLayerTools();
    bindLayerToolsBubble();

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

/* =====================================================
   CONTEXT BUBBLE MENU — NEW UI (căn phải)
===================================================== */

let OPEN_BUBBLE = null;

function closeBubble() {
    if (OPEN_BUBBLE) {
        OPEN_BUBBLE.remove();
        OPEN_BUBBLE = null;
    }
}

// Đóng khi click ra ngoài
document.addEventListener("click", function(e) {
    if (OPEN_BUBBLE && !e.target.closest(".layer-menu-bubble") 
        && !e.target.closest(".layer-menu-btn"))
        closeBubble();
});

// Bổ sung menu mới cho layer
function bindLayerToolsBubble() {
    document.querySelectorAll(".layer-menu-btn").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();

            // Nếu menu đang mở và thuộc đúng nút này → đóng
            if (OPEN_BUBBLE && OPEN_BUBBLE.dataset.from === btn.dataset.i) {
                closeBubble();
                return;
            }

            // Nếu đang mở menu của nút khác → đóng trước
            closeBubble();

            const i = Number(btn.dataset.i);
            const rect = btn.getBoundingClientRect();

            const bubble = document.createElement("div");
            bubble.className = "layer-menu-bubble";
            bubble.dataset.from = btn.dataset.i;  // <=== đánh dấu để toggle

            bubble.innerHTML = `
            <div class="layer-menu-arrow"></div>
            
            <div class="layer-menu-bubble-item" data-act="stats" data-i="${i}" title="Thống kê dữ liệu">
                <span class="gicon">bar_chart</span>
            </div>

            <div class="layer-menu-bubble-item" data-act="style" data-i="${i}" title="Đổi màu">
                <span class="gicon">palette</span>
            </div>

            <div class="layer-menu-bubble-item" data-act="zoom" data-i="${i}" title="Phóng to lớp">
                <span class="gicon">zoom_in</span>
            </div>

            <div class="layer-menu-bubble-item" data-act="export" data-i="${i}" title="Xuất GeoJSON">
                <span class="gicon">save</span>
            </div>

            <div class="layer-menu-bubble-item" data-act="rename" data-i="${i}" title="Đổi tên">
                <span class="gicon">edit</span>
            </div>

            <div class="layer-menu-bubble-item" data-act="delete" data-i="${i}" title="Xóa lớp">
                <span class="gicon">delete</span>
            </div>

            `;
            document.body.appendChild(bubble);

            // vị trí bubble
            bubble.style.top  = (rect.bottom + 6) + "px";
            bubble.style.left = (rect.right - bubble.offsetWidth + 4) + "px";

            requestAnimationFrame(() => bubble.classList.add("open"));
            OPEN_BUBBLE = bubble;
            // LAYER INDEX
            const obj = USER_LAYERS[i];

            /* Xử lý chọn màu tự do */
            const custom = bubble.querySelector(".color-custom");
            if (custom) {
                custom.oninput = (e) => {
                    const color = e.target.value;

                    obj.layer.setStyle({
                        color,
                        fillColor: color
                    });

                    obj.color = color;
                };
            }

            bubble.querySelectorAll(".layer-menu-bubble-item").forEach(item => {
                item.onclick = () => {
                    const act = item.dataset.act;
                    layerToolAction(act, i);
                    closeBubble();
                };
            });
        };
    });
}

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
        case "stats":
            openPanel("analyticsPanel");
            analyzeUserDataset(USER_LAYERS[i].gj);
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
    LABEL_LAYER = L.layerGroup();

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
function universalPopup(f, layer) {

    const p = f.properties || {};

    // Field cần bỏ qua
    const skip = [
        "OBJECTID", "FID", "Shape_Length", "Shape_Area",
        "Shape__Length", "Shape__Area", "ID"
    ];

    // Tìm tiêu đề thông minh
    const title = 
        p.ten || p.name || p.ten_tinh || p.title || p.label
        || p.Ten || p.Names || "Thông tin đối tượng";

    let html = `
    <div style="
        font-family: Inter, sans-serif;
        padding: 12px 14px;
        border-radius: 12px;
        background: white;
        min-width: 240px;
        max-width: 320px;
        max-height: 320px;
        overflow-y: auto;
        box-shadow: 0 4px 18px rgba(0,0,0,0.15);
        line-height: 1.5;
    ">
        <div style="font-size: 17px; font-weight: 600; margin-bottom: 6px;">
            ${title}
        </div>
        <div style="border-bottom: 1px solid #eee; margin-bottom: 8px;"></div>
    `;

    // Render phần thuộc tính
    for (let key in p) {

        if (!p[key] && p[key] !== 0) continue;
        if (skip.includes(key)) continue;
        

        const label = renameMap[key] || key.replace(/_/g, " ");

        const value = p[key];

        // FORMAT:
        let displayValue = value;

        // 1) Nếu là số → thêm dấu phẩy
        if (typeof value === "number") {
            displayValue = value.toLocaleString();
        }

        // 2) Nếu là URL ảnh
        if (typeof value === "string" && value.startsWith("http") && /\.(jpg|png|jpeg)$/i.test(value)) {
            displayValue = `<img src="${value}" style="width:100%; border-radius:8px; margin-top:4px;">`;
        }

        // 3) Nếu là URL website
        if (typeof value === "string" && value.startsWith("http") && !/\.(jpg|png|jpeg)$/i.test(value)) {
            displayValue = `<a href="${value}" target="_blank">${value}</a>`;
        }

        html += `
            <div style="font-size: 14px; margin-bottom: 4px;">
                <strong>${label}:</strong> ${displayValue}
            </div>
        `;
    }

    html += `</div>`;

    layer.bindPopup(html);
}

function focusProvinceByName(name) {
    if (!VN_LAYER || !VN_GEOJSON) return;

    VN_LAYER.eachLayer(layer => {
        const p = layer.feature.properties;
        if (!p) return;

        // So khớp tên tỉnh
        if (p.ten_tinh.toLowerCase() === name.toLowerCase()) {

            // Highlight
            layer.setStyle({
                weight: 4,
                color: "#FFD700",
                fillOpacity: 0.75
            });

            // Zoom
            map.fitBounds(layer.getBounds(), {
                padding: [30, 30]
            });

            // Cập nhật panel info (nếu thích)
            updateInfoPanel(p);
            openPanel("infoPanel", true);
        }
    });
}
/* ==========================================================
   20. GLOBAL VARIABLES
========================================================== */
async function aiRenameFields(fields) {
    try {
        const prompt = `
Bạn là AI chuyên đổi tên trường dữ liệu GIS sang Tiếng Việt có dấu, đẹp và dễ hiểu.
Hãy đổi tên các trường sang Tiếng Việt có dấu, đẹp và dễ hiểu.
Nếu tên trường là tiếng Anh thì giữ nguyên nghĩa khi dịch.
tru_so → trụ sở
dtich_km2 → diện tích (km²)
dan_so → dân số
matdo_km2 → mật độ (người/km²)
ten_tinh → tên tỉnh
quy_mo → quy mô
sap_nhap → sáp nhập

QUY TẮC ĐẶT TÊN:
Nếu tên trường đã rõ nghĩa thì chỉ cần thêm dấu và viết hoa đúng cách.
Nếu tên trường khó hiểu, hãy dựa vào ngữ cảnh để đặt tên phù hợp.
Xem xét ngữ cảnh dữ liệu GIS về địa lý, hành chính, dân số, địa danh ở Việt Nam.
Kiểm tra kỹ từng tên trường để tránh nhầm lẫn.
Kiểm tra thuộc tính dữ liệu và ngữ cảnh để đặt tên chính xác.
Chỉ trả JSON thuần, KHÔNG dùng \`\`\` hay markdown.
Danh sách trường:
${JSON.stringify(fields)}
        `;

        const res = await fetch("https://chatbot.phongphu-hcm-2003.workers.dev/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: "Bạn là AI chuẩn hoá tên trường dữ liệu GIS. Chỉ trả về JSON thuần."},
                    { role: "user", content: prompt }
                ]
            })
        });

        const data = await res.json();
        let text = data.choices[0].message.content;

        // LOẠI BỎ ```json ... ``` TRONG TRẢ LỜI CỦA AI
        text = text.replace(/```json/gi, "")
                   .replace(/```/g, "")
                   .trim();

        return JSON.parse(text);

    } catch (err) {
        console.error("AI rename error:", err);
        return {};
    }
}
let vnVisible = true;

document.querySelector(".vn-toggle").onclick = () => {
    vnVisible = !vnVisible;

    if (vnVisible) {
        map.addLayer(VN_LAYER);
        document.querySelector(".vn-toggle").innerText = "visibility";
    } else {
        map.removeLayer(VN_LAYER);
        document.querySelector(".vn-toggle").innerText = "visibility_off";
    }
};
document.querySelector(".vn-border").onclick = () => {
    const pick = document.createElement("input");
    pick.type = "color";
    pick.style.position = "fixed";
    pick.style.left = "-9999px";

    pick.oninput = (e) => {
        VN_LAYER.setStyle({ color: e.target.value });
    };

    document.body.appendChild(pick);
    pick.click();
};
document.querySelector(".vn-fill").onclick = () => {
    const pick = document.createElement("input");
    pick.type = "color";
    pick.style.position = "fixed";
    pick.style.left = "-9999px";

    pick.oninput = (e) => {
        VN_LAYER.setStyle({ fillColor: e.target.value });
    };

    document.body.appendChild(pick);
    pick.click();
};
document.querySelector(".vn-weight").onclick = () => {
    const amount = prompt("Độ dày viền (1–10):", 2);
    const w = Number(amount);

    if (!isNaN(w) && w > 0) {
        VN_LAYER.setStyle({ weight: w });
    }
};

