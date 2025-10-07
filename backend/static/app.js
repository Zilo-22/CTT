const els = {
  upload: document.getElementById("csvFile"),
  fileName: document.getElementById("fileName"),
  templateSelect: document.getElementById("templateSelect"),
  loadFieldsBtn: document.getElementById("loadFieldsBtn"),
  mapBox: document.getElementById("mappingContainer"),
  enableCleanup: document.getElementById("enableTextCleanup"),
  cleanupOptions: document.getElementById("cleanupOptions"),
  cleanupColumnSelect: document.getElementById("cleanupColumnSelect"),
  addCleanupColumn: document.getElementById("addCleanupColumn"),
  selectedColumns: document.getElementById("selectedColumns"),
  previewButton: document.getElementById("previewButton"),
  previewResults: document.getElementById("previewResults"),
  transform: document.getElementById("transformButton"),
  log: document.getElementById("log"),
};

let state = {
  file: null,
  templates: [],
  template: null,
  mapping: {},
  csvColumns: [],
  selectedCleanupColumns: [],
  previewData: null,
};

function log(m) {
  console.log(m);
  if (els.log) els.log.textContent += m + "\n";
}

/* -------------------- LOAD TEMPLATES -------------------- */
async function loadTemplates() {
  try {
    const res = await fetch("/templates");
    if (!res.ok) throw new Error("Failed to load templates");
    const data = await res.json();
    state.templates = data.templates || [];

    const select = els.templateSelect;
    select.innerHTML = '<option value="">-- Select Template --</option>';
    state.templates.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.templateKey;
      opt.textContent = t.templateName || t.templateKey;
      select.appendChild(opt);
    });

    log(`✅ Loaded ${state.templates.length} templates`);
  } catch (err) {
    console.error(err);
    log("❌ Failed to load templates: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", loadTemplates);

/* -------------------- FILE UPLOAD -------------------- */
els.upload.addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) {
    state.file = null;
    els.fileName.textContent = "No file selected";
    return;
  }
  if (!f.name.toLowerCase().endsWith(".csv")) {
    log("⚠️ Please select a .csv file");
    return;
  }
  state.file = f;
  els.fileName.textContent = f.name;

  // Read headers
  const text = await f.text();
  const firstLine = text.split("\n")[0];
  state.csvColumns = firstLine
    .split(",")
    .map((h) => h.trim().replace(/"/g, ""));
  populateCleanupColumns();
  log(`📄 CSV loaded with ${state.csvColumns.length} columns`);
});

/* -------------------- TEMPLATE SELECTION -------------------- */
els.templateSelect.addEventListener("change", (e) => {
  const key = e.target.value;
  state.template = state.templates.find((t) => t.templateKey === key) || null;
  els.loadFieldsBtn.disabled = !state.template;
});

els.loadFieldsBtn.addEventListener("click", () => {
  if (!state.template) return alert("Select a template first.");
  
  // Disable preview button initially
  els.previewButton.disabled = true;

  const candidates = state.csvColumns.length
    ? state.csvColumns
    : [
        "Handle",
        "Title",
        "Body (HTML)",
        "Vendor",
        "Type",
        "Tags",
        "Published",
        "Option1 Value",
        "Option2 Value",
        "Option3 Value",
        "Variant SKU",
        "Variant Price",
        "Variant Compare At Price",
        "Image Src",
        "Image Position",
        "Variant Barcode",
      ];

  els.mapBox.innerHTML = "";
  state.mapping = {};

  // First pass: identify auto-mapped image labels
  const autoMappedLabels = new Set();
  state.template.fields.forEach((f) => {
    if (f.type === "image" && f.autoMap) {
      autoMappedLabels.add(f.label);
    }
  });

  state.template.fields.forEach((f) => {
    if (f.type === "image" && f.autoMap) {
      const div = document.createElement("div");
      div.className = "mapping-row auto";
      div.innerHTML = `<label>${f.label}</label><span>Auto from Image Src/Position</span>`;
      els.mapBox.appendChild(div);
      return;
    }

    // Skip text fields that have auto-mapped image equivalents
    if (autoMappedLabels.has(f.label)) {
      return;
    }

    const div = document.createElement("div");
    div.className = "mapping-row";
    div.innerHTML = `
      <label>${f.label}</label>
      <select>
        <option value="">-- Select Shopify Field --</option>
        ${candidates.map((c) => `<option value="${c}">${c}</option>`).join("")}
      </select>
    `;
    div.querySelector("select").addEventListener("change", (ev) => {
      state.mapping[f.key] = ev.target.value;
      // Hide preview when mapping changes
      els.previewResults.style.display = "none";
      els.transform.style.display = "none";
      
      // Enable preview button if required field is mapped
      const requiredField = state.template.exportRules?.requiredFieldKey || "product_handle";
      els.previewButton.disabled = !state.mapping[requiredField];
    });
    els.mapBox.appendChild(div);
  });

  log(`🧭 Mapping editor ready (${state.template.fields.length} fields)`);
  
  // Add validation for required field
  const requiredField = state.template.exportRules?.requiredFieldKey || "product_handle";
  const requiredFieldLabel = state.template.fields.find(f => f.key === requiredField)?.label || requiredField;
  log(`⚠️ Note: "${requiredFieldLabel}" is required and must be mapped to proceed`);
});

/* -------------------- CLEANUP OPTIONS -------------------- */
function populateCleanupColumns() {
  const sel = els.cleanupColumnSelect;
  sel.innerHTML = '<option value="">-- Select Column --</option>';
  state.csvColumns.forEach((c) => {
    if (!state.selectedCleanupColumns.includes(c)) {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      sel.appendChild(o);
    }
  });
}

els.enableCleanup.addEventListener("change", (e) => {
  els.cleanupOptions.style.display = e.target.checked ? "block" : "none";
});

els.addCleanupColumn.addEventListener("click", () => {
  const col = els.cleanupColumnSelect.value;
  if (!col) return;
  if (!state.selectedCleanupColumns.includes(col)) {
    state.selectedCleanupColumns.push(col);
    updateSelectedColumnsDisplay();
    populateCleanupColumns();
  }
});

function updateSelectedColumnsDisplay() {
  els.selectedColumns.innerHTML = "";
  state.selectedCleanupColumns.forEach((c) => {
    const tag = document.createElement("div");
    tag.className = "selected-column-tag";
    tag.innerHTML = `${c} <button data-col="${c}">×</button>`;
    tag.querySelector("button").addEventListener("click", (e) => {
      const colToRemove = e.target.dataset.col;
      state.selectedCleanupColumns = state.selectedCleanupColumns.filter(
        (x) => x !== colToRemove
      );
      updateSelectedColumnsDisplay();
      populateCleanupColumns();
    });
    els.selectedColumns.appendChild(tag);
  });
}

/* -------------------- PREVIEW -------------------- */
els.previewButton?.addEventListener("click", async () => {
  if (!state.file || !state.template)
    return alert("Upload CSV and select a template first");

  // Check if required fields are mapped
  const requiredField = state.template.exportRules?.requiredFieldKey || "product_handle";
  if (!state.mapping[requiredField]) {
    log(`❌ Please map the required field: "${requiredField}"`);
    return;
  }

  const fd = new FormData();
  fd.append("file", state.file);
  fd.append("templateKey", state.template.templateKey);
  fd.append("mapping", JSON.stringify(state.mapping));
  fd.append(
    "textCleanup",
    state.selectedCleanupColumns.length
      ? JSON.stringify({ columns: state.selectedCleanupColumns })
      : ""
  );
  fd.append("preview", "true");

  log("🔍 Generating preview...");
  try {
    const res = await fetch("/transform", { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    displayPreview(data);
    els.previewResults.style.display = "block";
    els.transform.style.display = "inline-block";
    log("✅ Preview ready!");
  } catch (err) {
    log("❌ Preview failed: " + err.message);
  }
});

function displayPreview(data) {
  const c = els.previewResults;
  c.innerHTML = `
    <h3>Preview Results (First 10 rows)</h3>
    <div class="preview-stats">
      <p><strong>Total rows:</strong> ${data.totalRows}</p>
      <p><strong>Columns:</strong> ${data.headers.length}</p>
      ${state.selectedCleanupColumns.length > 0 ? `<p><strong>HTML cleanup applied to:</strong> ${state.selectedCleanupColumns.join(", ")}</p>` : ""}
    </div>
  `;
  
  const table = document.createElement("table");
  table.className = "preview-table";
  
  // Create header row
  const headerRow = document.createElement("tr");
  data.headers.forEach(header => {
    const th = document.createElement("th");
    th.textContent = header;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);
  
  // Create data rows
  data.rows.slice(0, 10).forEach(row => {
    const tr = document.createElement("tr");
    row.forEach(cell => {
      const td = document.createElement("td");
      td.textContent = cell || "";
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  
  c.appendChild(table);
}

/* -------------------- TRANSFORM & DOWNLOAD -------------------- */
els.transform.addEventListener("click", async () => {
  if (!state.file || !state.template)
    return alert("Please upload a CSV and select a template first.");

  log("⚙️ Transforming data and generating CSV...");

  const fd = new FormData();
  fd.append("file", state.file);
  fd.append("templateKey", state.template.templateKey);
  fd.append("mapping", JSON.stringify(state.mapping));
  fd.append(
    "textCleanup",
    state.selectedCleanupColumns.length
      ? JSON.stringify({ columns: state.selectedCleanupColumns })
      : ""
  );
  fd.append("filename", `zilo_export_${state.template.templateKey}.csv`);

  try {
    const res = await fetch("/transform", { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zilo_export_${state.template.templateKey}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    log("✅ Transformed CSV downloaded!");
  } catch (err) {
    log("❌ Transform failed: " + err.message);
  }
});
