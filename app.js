/* LeafLoom — เครื่องมือ PDF ที่ทำงานในเบราว์เซอร์ล้วน
 * ไลบรารี: pdf-lib (MIT), pdf.js (Apache-2.0), JSZip (MIT)
 * ไม่มีการส่งไฟล์ผู้ใช้ออกจากเครื่อง (F-07)
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const libsReady = typeof PDFLib !== 'undefined' && typeof pdfjsLib !== 'undefined' && typeof JSZip !== 'undefined';
  const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib || {};
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  const BIG_DOC = 300;

  // ---------- ส่วนกลาง ----------
  const statusEl = $('status');
  function say(msg, kind = '') {
    statusEl.textContent = msg;
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }
  function fail(err, fallback) {
    console.error(err);
    const m = String(err && err.message || err);
    if (/encrypt|password/i.test(m)) say('ไฟล์นี้มีรหัสผ่านป้องกัน LeafLoom ไม่เปิดไฟล์ที่ถูกล็อก', 'err');
    else if (/Invalid PDF|No PDF header|Failed to parse/i.test(m)) say('ไฟล์นี้ไม่ใช่ PDF ที่อ่านได้ หรืออาจเสียหาย', 'err');
    else say(fallback || 'เกิดข้อผิดพลาด: ' + m, 'err');
  }
  const baseName = (name) => name.replace(/\.[^.]+$/, '') || 'document';
  const fmtSize = (n) => n < 1024 * 1024 ? (n / 1024).toFixed(0) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
  const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

  function download(data, filename, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function busy(btn, label, fn) {
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = label;
    try { await fn(); } finally { btn.textContent = old; btn.disabled = false; }
  }

  async function loadPdfLib(bytes) {
    return PDFDocument.load(bytes); // ไฟล์ที่เข้ารหัสจะโยน error ออกมา — เราไม่ปลดล็อก
  }

  /** แปลงข้อความช่วงหน้า "1-3, 5, 8-" เป็นดัชนีเริ่ม 0 */
  function parseRanges(text, total) {
    const out = [];
    const parts = text.split(/[,\s]+/).filter(Boolean);
    if (!parts.length) throw new Error('กรุณาพิมพ์ช่วงหน้า เช่น 1-3, 5');
    for (const p of parts) {
      const m = p.match(/^(\d*)-(\d*)$|^(\d+)$/);
      if (!m || p === '-') throw new Error(`รูปแบบ "${p}" ไม่ถูกต้อง`);
      let a, b;
      if (m[3]) { a = b = +m[3]; }
      else { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
      if (a < 1 || b > total || a > b) throw new Error(`ช่วง "${p}" อยู่นอกจำนวนหน้า (มี ${total} หน้า)`);
      for (let i = a; i <= b; i++) out.push(i - 1);
    }
    return out;
  }

  // ---------- แท็บ ----------
  const tabs = [...document.querySelectorAll('[role=tab]')];
  function showTab(tool, focus) {
    tabs.forEach((t) => {
      const on = t.dataset.tool === tool;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    });
    say('');
    try { localStorage.setItem('leafloom.tab', tool); } catch (_) { /* ไม่เป็นไร */ }
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showTab(t.dataset.tool));
    t.addEventListener('keydown', (e) => {
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = tabs.length - 1;
      if (j !== null) { e.preventDefault(); showTab(tabs[j].dataset.tool, true); }
    });
  });
  let first = 'merge';
  try { first = localStorage.getItem('leafloom.tab') || first; } catch (_) {}
  showTab(tabs.some((t) => t.dataset.tool === first) ? first : 'merge');

  // ---------- กล่องลากวาง ----------
  const handlers = {};
  function onFiles(inputId, fn) { handlers[inputId] = fn; }
  document.querySelectorAll('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => $(b.dataset.pick).click()));
  document.querySelectorAll('input[type=file]').forEach((inp) =>
    inp.addEventListener('change', () => {
      if (inp.files.length) handlers[inp.id]([...inp.files]);
      inp.value = '';
    }));
  document.querySelectorAll('.drop').forEach((zone) => {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('over');
      const files = [...e.dataTransfer.files];
      if (files.length) handlers[zone.dataset.input](files);
    });
  });
  // กันเบราว์เซอร์เปิดไฟล์แทนเมื่อวางพลาดกล่อง
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  if (!libsReady) {
    say('โหลดไลบรารีไม่สำเร็จ กรุณาตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วรีเฟรชหน้า', 'err');
    return;
  }

  /** รายการไฟล์แบบเลื่อนลำดับได้ (ใช้กับ F-01 และ F-04) */
  function makeList(listEl, items, onChange, renderExtra) {
    function render() {
      listEl.replaceChildren();
      items.forEach((it, i) => {
        const li = document.createElement('li');
        const num = document.createElement('span');
        num.className = 'num'; num.textContent = i + 1;
        li.append(num);
        if (renderExtra) renderExtra(li, it);
        const name = document.createElement('span');
        name.className = 'name'; name.textContent = it.file.name;
        const meta = document.createElement('span');
        meta.className = 'meta'; meta.textContent = it.meta || fmtSize(it.file.size);
        li.append(name, meta);
        const mk = (txt, aria, fn, dis) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'btn ghost'; b.textContent = txt;
          b.setAttribute('aria-label', aria + ' ' + it.file.name);
          b.disabled = dis; b.addEventListener('click', fn);
          return b;
        };
        li.append(
          mk('↑', 'เลื่อนขึ้น', () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); }, i === 0),
          mk('↓', 'เลื่อนลง', () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; render(); }, i === items.length - 1),
          mk('✕', 'เอาออก', () => { items.splice(i, 1); render(); }, false),
        );
        listEl.append(li);
      });
      onChange();
    }
    return render;
  }

  // ---------- F-01 รวม PDF ----------
  const mergeItems = [];
  const mergeGo = $('merge-go');
  const renderMerge = makeList($('merge-list'), mergeItems, () => { mergeGo.disabled = mergeItems.length < 2; });
  onFiles('in-merge', async (files) => {
    const pdfs = files.filter(isPdf);
    if (pdfs.length < files.length) say('ข้ามไฟล์ที่ไม่ใช่ PDF ไป ' + (files.length - pdfs.length) + ' ไฟล์', 'err');
    else say('');
    for (const file of pdfs) {
      try {
        const bytes = await file.arrayBuffer();
        const doc = await loadPdfLib(bytes);
        mergeItems.push({ file, bytes, meta: doc.getPageCount() + ' หน้า · ' + fmtSize(file.size) });
      } catch (e) { fail(e, `เปิดไฟล์ "${file.name}" ไม่ได้`); }
    }
    renderMerge();
  });
  $('merge-clear').addEventListener('click', () => { mergeItems.length = 0; renderMerge(); say(''); });
  mergeGo.addEventListener('click', () => busy(mergeGo, 'กำลังรวม…', async () => {
    try {
      const out = await PDFDocument.create();
      for (const it of mergeItems) {
        const src = await loadPdfLib(it.bytes);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      download(await out.save(), 'leafloom-รวมไฟล์.pdf', 'application/pdf');
      say(`รวม ${mergeItems.length} ไฟล์ ได้ ${out.getPageCount()} หน้า`, 'ok');
    } catch (e) { fail(e); }
  }));
  mergeGo.disabled = true;

  // ---------- ตัวช่วยเรนเดอร์ภาพหน้าด้วย pdf.js ----------
  async function openPdfJs(bytes) {
    // pdf.js ย้ายความเป็นเจ้าของ buffer ไปยัง worker จึงส่งสำเนาไป
    return pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  }
  async function renderPage(pdf, n, scale) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    // intent 'print' ไม่พึ่ง requestAnimationFrame จึงไม่ค้างเมื่อผู้ใช้สลับไปแท็บอื่นระหว่างแปลง
    await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
    page.cleanup();
    return c;
  }

  // ---------- F-02 จัดหน้า ----------
  const org = { file: null, bytes: null, pages: [], thumbs: [] };
  const orgGrid = $('org-grid');
  const orgGo = $('org-go');
  const orgReset = $('org-reset');
  let dragFrom = null;

  function renderOrg() {
    orgGrid.replaceChildren();
    org.pages.forEach((p, i) => {
      const li = document.createElement('li');
      li.draggable = true;
      li.setAttribute('aria-label', `ตำแหน่ง ${i + 1}: หน้าเดิม ${p.src + 1}` + (p.rot ? ` หมุน ${p.rot}°` : ''));
      const box = document.createElement('div'); box.className = 'thumb';
      const thumb = org.thumbs[p.src];
      if (thumb) {
        const c = document.createElement('canvas');
        c.width = thumb.width; c.height = thumb.height;
        c.getContext('2d').drawImage(thumb, 0, 0);
        c.style.transform = `rotate(${p.rot}deg)`;
        box.append(c);
      } else { box.textContent = '…'; }
      const label = document.createElement('span'); label.className = 'label';
      label.textContent = `${i + 1} (เดิม ${p.src + 1})`;
      const tools = document.createElement('div'); tools.className = 'tools';
      const mk = (txt, aria, fn, dis) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn ghost'; b.textContent = txt; b.title = aria;
        b.setAttribute('aria-label', `${aria} ตำแหน่ง ${i + 1}`); b.disabled = !!dis;
        b.addEventListener('click', () => { fn(); renderOrg(); });
        return b;
      };
      tools.append(
        mk('←', 'ย้ายไปซ้าย', () => { [org.pages[i - 1], org.pages[i]] = [org.pages[i], org.pages[i - 1]]; }, i === 0),
        mk('⟲', 'หมุนทวนเข็ม', () => { p.rot = (p.rot + 270) % 360; }),
        mk('⟳', 'หมุนตามเข็ม', () => { p.rot = (p.rot + 90) % 360; }),
        mk('✕', 'ลบหน้า', () => { org.pages.splice(i, 1); }),
        mk('→', 'ย้ายไปขวา', () => { [org.pages[i + 1], org.pages[i]] = [org.pages[i], org.pages[i + 1]]; }, i === org.pages.length - 1),
      );
      li.append(box, label, tools);
      // ลากวาง (มีปุ่ม ← → เป็นทางเลือกสำหรับคีย์บอร์ด)
      li.addEventListener('dragstart', (e) => { dragFrom = i; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
      li.addEventListener('dragend', () => { dragFrom = null; li.classList.remove('dragging'); });
      li.addEventListener('dragover', (e) => { if (dragFrom !== null) { e.preventDefault(); e.stopPropagation(); li.classList.add('target'); } });
      li.addEventListener('dragleave', () => li.classList.remove('target'));
      li.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation(); li.classList.remove('target');
        if (dragFrom === null || dragFrom === i) return;
        const [moved] = org.pages.splice(dragFrom, 1);
        org.pages.splice(i, 0, moved);
        dragFrom = null; renderOrg();
      });
      orgGrid.append(li);
    });
    orgGo.disabled = !org.pages.length;
    orgReset.disabled = !org.bytes;
    if (org.bytes) $('org-info').textContent = `${org.file.name} · เหลือ ${org.pages.length} หน้า (เดิม ${org.thumbs.length} หน้า)`;
  }

  onFiles('in-organize', async ([file]) => {
    if (!isPdf(file)) return say('กรุณาเลือกไฟล์ PDF', 'err');
    try {
      say('กำลังเปิดไฟล์…');
      const bytes = await file.arrayBuffer();
      await loadPdfLib(bytes); // ตรวจว่าเปิดได้/ไม่ได้ล็อก
      const pdf = await openPdfJs(bytes);
      Object.assign(org, { file, bytes, pages: [], thumbs: new Array(pdf.numPages).fill(null) });
      for (let i = 0; i < pdf.numPages; i++) org.pages.push({ src: i, rot: 0 });
      renderOrg();
      if (pdf.numPages > BIG_DOC) say(`ไฟล์นี้มี ${pdf.numPages} หน้า อาจใช้เวลาสร้างภาพย่อนาน`);
      for (let n = 1; n <= pdf.numPages; n++) {
        if (org.bytes !== bytes) return; // ผู้ใช้เปิดไฟล์อื่นแล้ว
        const page = await pdf.getPage(n);
        const s = 110 / Math.max(page.getViewport({ scale: 1 }).width, page.getViewport({ scale: 1 }).height);
        org.thumbs[n - 1] = await renderPage(pdf, n, s);
        if (n % 8 === 0 || n === pdf.numPages) renderOrg();
      }
      pdf.destroy();
      say('');
    } catch (e) { fail(e); }
  });
  orgReset.addEventListener('click', () => {
    org.pages = org.thumbs.map((_, i) => ({ src: i, rot: 0 }));
    renderOrg(); say('คืนค่าลำดับเดิมแล้ว');
  });
  orgGo.addEventListener('click', () => busy(orgGo, 'กำลังบันทึก…', async () => {
    try {
      const src = await loadPdfLib(org.bytes);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, org.pages.map((p) => p.src));
      copied.forEach((pg, k) => {
        const extra = org.pages[k].rot;
        if (extra) pg.setRotation(degrees((pg.getRotation().angle + extra) % 360));
        out.addPage(pg);
      });
      download(await out.save(), baseName(org.file.name) + '-จัดหน้า.pdf', 'application/pdf');
      say(`บันทึกแล้ว ${out.getPageCount()} หน้า`, 'ok');
    } catch (e) { fail(e); }
  }));

  // ---------- F-03 แยก/ดึงหน้า ----------
  const split = { file: null, bytes: null, count: 0 };
  const splitGo = $('split-go');
  onFiles('in-split', async ([file]) => {
    if (!isPdf(file)) return say('กรุณาเลือกไฟล์ PDF', 'err');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await loadPdfLib(bytes);
      Object.assign(split, { file, bytes, count: doc.getPageCount() });
      $('split-info').textContent = `${file.name} · ${split.count} หน้า`;
      splitGo.disabled = false; say('');
    } catch (e) { fail(e); }
  });
  $('split-range').addEventListener('focus', () => { document.querySelector('input[name=split-mode][value=range]').checked = true; });
  splitGo.addEventListener('click', () => busy(splitGo, 'กำลังแยก…', async () => {
    try {
      const mode = document.querySelector('input[name=split-mode]:checked').value;
      const src = await loadPdfLib(split.bytes);
      const base = baseName(split.file.name);
      if (mode === 'range') {
        let idx;
        try { idx = parseRanges($('split-range').value, split.count); }
        catch (e) { $('split-range').focus(); return say(e.message, 'err'); }
        const out = await PDFDocument.create();
        (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
        download(await out.save(), `${base}-หน้าที่เลือก.pdf`, 'application/pdf');
        say(`ได้ไฟล์ใหม่ ${idx.length} หน้า`, 'ok');
      } else {
        const zip = new JSZip();
        const pad = String(split.count).length;
        for (let i = 0; i < split.count; i++) {
          const out = await PDFDocument.create();
          const [p] = await out.copyPages(src, [i]);
          out.addPage(p);
          zip.file(`${base}-${String(i + 1).padStart(pad, '0')}.pdf`, await out.save());
          if (i % 10 === 0) say(`กำลังแยกหน้า ${i + 1}/${split.count}…`);
        }
        download(await zip.generateAsync({ type: 'blob' }), `${base}-แยกหน้า.zip`);
        say(`แยกแล้ว ${split.count} ไฟล์`, 'ok');
      }
    } catch (e) { fail(e); }
  }));

  // ---------- F-04 รูป → PDF ----------
  const imgItems = [];
  const imgGo = $('img-go');
  const renderImgs = makeList($('img-list'), imgItems, () => { imgGo.disabled = !imgItems.length; },
    (li, it) => { const im = document.createElement('img'); im.src = it.url; im.alt = ''; li.append(im); });
  onFiles('in-img', (files) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (imgs.length < files.length) say('ข้ามไฟล์ที่ไม่ใช่รูป ' + (files.length - imgs.length) + ' ไฟล์', 'err');
    else say('');
    imgs.forEach((file) => imgItems.push({ file, url: URL.createObjectURL(file) }));
    renderImgs();
  });
  $('img-clear').addEventListener('click', () => {
    imgItems.forEach((it) => URL.revokeObjectURL(it.url));
    imgItems.length = 0; renderImgs(); say('');
  });
  /** วาดรูปผ่าน canvas เพื่อให้หมุนตาม EXIF และรองรับ WebP/GIF ได้ */
  async function imageToBytes(file) {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    const asJpg = file.type === 'image/jpeg';
    if (asJpg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(bmp, 0, 0); bmp.close();
    const blob = await new Promise((r) => c.toBlob(r, asJpg ? 'image/jpeg' : 'image/png', 0.92));
    return { bytes: await blob.arrayBuffer(), jpg: asJpg, w: c.width, h: c.height };
  }
  imgGo.addEventListener('click', () => busy(imgGo, 'กำลังสร้าง…', async () => {
    try {
      const size = $('img-size').value;
      const margin = +$('img-margin').value;
      const A4 = [595.28, 841.89];
      const out = await PDFDocument.create();
      for (const [k, it] of imgItems.entries()) {
        say(`กำลังใส่รูป ${k + 1}/${imgItems.length}…`);
        const im = await imageToBytes(it.file);
        const emb = im.jpg ? await out.embedJpg(im.bytes) : await out.embedPng(im.bytes);
        let pw, ph;
        if (size === 'fit') { pw = im.w * 0.75 + margin * 2; ph = im.h * 0.75 + margin * 2; } // px → pt
        else if (size === 'a4auto' && im.w > im.h) { [pw, ph] = [A4[1], A4[0]]; }
        else { [pw, ph] = A4; }
        const page = out.addPage([pw, ph]);
        const s = Math.min((pw - margin * 2) / im.w, (ph - margin * 2) / im.h);
        const w = im.w * s, h = im.h * s;
        page.drawImage(emb, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      }
      download(await out.save(), 'leafloom-รูปภาพ.pdf', 'application/pdf');
      say(`สร้าง PDF ${imgItems.length} หน้าแล้ว`, 'ok');
    } catch (e) { fail(e, 'อ่านรูปบางไฟล์ไม่ได้ ลองบันทึกรูปเป็น JPG หรือ PNG ใหม่'); }
  }));

  // ---------- F-05 PDF → รูป ----------
  const p2i = { file: null, bytes: null };
  const p2iGo = $('p2i-go');
  onFiles('in-p2i', async ([file]) => {
    if (!isPdf(file)) return say('กรุณาเลือกไฟล์ PDF', 'err');
    try {
      const bytes = await file.arrayBuffer();
      const pdf = await openPdfJs(bytes);
      Object.assign(p2i, { file, bytes });
      $('p2i-info').textContent = `${file.name} · ${pdf.numPages} หน้า`;
      pdf.destroy();
      p2iGo.disabled = false; say('');
    } catch (e) { fail(e); }
  });
  p2iGo.addEventListener('click', () => busy(p2iGo, 'กำลังแปลง…', async () => {
    try {
      const scale = +$('p2i-scale').value;
      const fmt = $('p2i-fmt').value;
      const ext = fmt === 'png' ? 'png' : 'jpg';
      const base = baseName(p2i.file.name);
      const pdf = await openPdfJs(p2i.bytes);
      const pad = String(pdf.numPages).length;
      const blobs = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        say(`กำลังแปลงหน้า ${n}/${pdf.numPages}…`);
        const c = await renderPage(pdf, n, scale);
        blobs.push(await new Promise((r) => c.toBlob(r, 'image/' + fmt, 0.9)));
        c.width = c.height = 0;
      }
      pdf.destroy();
      if (blobs.length === 1) download(blobs[0], `${base}.${ext}`);
      else {
        const zip = new JSZip();
        blobs.forEach((b, i) => zip.file(`${base}-${String(i + 1).padStart(pad, '0')}.${ext}`, b));
        download(await zip.generateAsync({ type: 'blob' }), `${base}-รูป.zip`);
      }
      say(`แปลงแล้ว ${blobs.length} รูป`, 'ok');
    } catch (e) { fail(e); }
  }));

  // ---------- F-06 เลขหน้าและลายน้ำ ----------
  const stamp = { file: null, bytes: null };
  const stampGo = $('stamp-go');
  onFiles('in-stamp', async ([file]) => {
    if (!isPdf(file)) return say('กรุณาเลือกไฟล์ PDF', 'err');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await loadPdfLib(bytes);
      Object.assign(stamp, { file, bytes });
      $('stamp-info').textContent = `${file.name} · ${doc.getPageCount()} หน้า`;
      stampGo.disabled = false; say('');
    } catch (e) { fail(e); }
  });
  /** วาดข้อความลายน้ำลง canvas แล้วใช้เป็นรูป — รองรับภาษาไทยโดยไม่ต้องฝังไฟล์ฟอนต์ */
  async function watermarkPng(text) {
    const px = 120;
    const font = `bold ${px}px "Noto Sans Thai", "Leelawadee UI", Tahoma, sans-serif`;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 40;
    c.width = w; c.height = Math.ceil(px * 1.6);
    ctx.font = font; ctx.fillStyle = '#7a1f1f'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, c.height / 2);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return { bytes: await blob.arrayBuffer(), ratio: c.height / c.width };
  }
  stampGo.addEventListener('click', () => busy(stampGo, 'กำลังประทับ…', async () => {
    try {
      const numOn = $('num-on').checked;
      const wmOn = $('wm-on').checked;
      const wmText = $('wm-text').value.trim();
      if (!numOn && !wmOn) return say('เลือกอย่างน้อยหนึ่งอย่าง: เลขหน้า หรือ ลายน้ำ', 'err');
      if (wmOn && !wmText) { $('wm-text').focus(); return say('กรุณาพิมพ์ข้อความลายน้ำ', 'err'); }
      const doc = await loadPdfLib(stamp.bytes);
      const pages = doc.getPages();
      const total = pages.length;
      const start = Math.max(0, parseInt($('num-start').value, 10) || 0);
      const fmt = $('num-fmt').value;
      const pos = $('num-pos').value;
      const helv = await doc.embedFont(StandardFonts.Helvetica);
      let wm = null;
      if (wmOn) {
        const png = await watermarkPng(wmText);
        wm = { img: await doc.embedPng(png.bytes), ratio: png.ratio };
      }
      const opacity = +$('wm-opacity').value / 100;
      const angle = +$('wm-angle').value;
      pages.forEach((page, i) => {
        const { width: pw, height: ph } = page.getSize();
        if (wm) {
          const t = angle * Math.PI / 180;
          const w = angle ? Math.hypot(pw, ph) * 0.6 : pw * 0.75;
          const h = w * wm.ratio;
          // จุดหมุนของ pdf-lib คือมุมล่างซ้ายของรูป จึงคำนวณให้ศูนย์กลางรูปอยู่กลางหน้า
          const x = pw / 2 - (w / 2 * Math.cos(t) - h / 2 * Math.sin(t));
          const y = ph / 2 - (w / 2 * Math.sin(t) + h / 2 * Math.cos(t));
          page.drawImage(wm.img, { x, y, width: w, height: h, rotate: degrees(angle), opacity });
        }
        if (numOn) {
          const n = start + i;
          const label = fmt === 'n/t' ? `${n} / ${start + total - 1}` : fmt === '-n-' ? `- ${n} -` : String(n);
          const size = 10;
          const tw = helv.widthOfTextAtSize(label, size);
          const m = 28;
          const x = pos === 'bc' ? (pw - tw) / 2 : pw - m - tw;
          const y = pos === 'tr' ? ph - m : m - size / 2;
          page.drawText(label, { x, y, size, font: helv, color: rgb(0.2, 0.2, 0.2) });
        }
      });
      download(await doc.save(), baseName(stamp.file.name) + '-ประทับ.pdf', 'application/pdf');
      say(`ประทับแล้ว ${total} หน้า`, 'ok');
    } catch (e) { fail(e); }
  }));

  // ให้หน้าทดสอบเรียกฟังก์ชันล้วนได้
  window.LeafLoom = { parseRanges };
})();
