import { Midy } from "https://cdn.jsdelivr.net/gh/marmooo/midy@0.6.2/dist/midy.min.js";
import { MIDIPlayer } from "https://cdn.jsdelivr.net/npm/@marmooo/midi-player@0.0.8/+esm";
import { Modal } from "https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/+esm";
import { MidiLibrary } from "https://marmooo.github.io/free-midi/midi-library.js";

function toggleDarkMode() {
  const html = document.documentElement;
  const newTheme = html.getAttribute("data-bs-theme") === "dark"
    ? "light"
    : "dark";
  html.setAttribute("data-bs-theme", newTheme);
  localStorage.setItem("darkMode", newTheme);
}

function getGlobalCSS() {
  const sheet = new CSSStyleSheet();
  let css = "";
  for (const s of document.styleSheets) {
    try {
      for (const r of s.cssRules) css += r.cssText;
    } catch { /* skip cross-origin sheets */ }
  }
  sheet.replaceSync(css);
  return sheet;
}

async function setProgramChange(channel, programNumber) {
  const bankNumber = channel.isDrum ? 128 : channel.bankLSB;
  const index = midy.soundFontTable[programNumber][bankNumber];
  if (index === undefined) {
    const program = programNumber.toString().padStart(3, "0");
    const baseName = bankNumber === 128 ? "128" : program;
    const path = `${midiPlayer.soundFontURL}/${baseName}.sf3`;
    await midy.loadSoundFont(path);
  }
  channel.setProgramChange(programNumber);
}

function clearAllKeys(pianos) {
  for (let i = 0; i < 16; i++) {
    const keys = pianos[i];
    for (let j = 0; j < keys.length; j++) {
      const style = keys[j].style;
      if (style.fill) style.removeProperty("fill");
    }
  }
}

async function noteOn(channel, target, pressure, pressed) {
  const noteNumber = Number(target.dataset.index);
  if (pressed[noteNumber]) return;
  pressed[noteNumber] = true;
  const velocity = Math.ceil(pressure * 127) || 64;
  setKeyColor(target, velocity);
  target.setAttribute("aria-pressed", "true");
  await channel.noteOn(noteNumber, velocity);
}

function noteOff(channel, target, pressure, pressed) {
  const noteNumber = Number(target.dataset.index);
  pressed[noteNumber] = false;
  const velocity = Math.ceil(pressure * 127) || 64;
  target.style.removeProperty("fill");
  target.setAttribute("aria-pressed", "false");
  channel.noteOff(noteNumber, velocity);
}

function handleMove(channel, root, event, pressed) {
  const elements = root.elementsFromPoint(event.clientX, event.clientY);
  let key;
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element instanceof SVGRectElement) {
      key = element;
      break;
    }
  }
  if (key === currentKey) return;
  if (currentKey) {
    noteOff(channel, currentKey, event.pressure, pressed);
  }
  if (key) {
    noteOn(channel, key, event.pressure, pressed);
  }
  currentKey = key;
}

function release(channel, pressure, pressed) {
  if (!currentKey) return;
  noteOff(channel, currentKey, pressure, pressed);
  currentKey = null;
}

async function releaseAll() {
  const audioContext = midy.audioContext;
  if (!midiPlayer.isPlaying && audioContext.state === "running") {
    const now = midy.audioContext.currentTime;
    await midy.stopNotes(0, true, now);
    await audioContext.suspend();
  }
}

function setPianoEvents(pianoComponent, channel) {
  const pressed = new Array(128).fill(false);
  const root = pianoComponent.shadowRoot;
  pianoComponent.addEventListener("pointerdown", (event) => {
    if (midy.audioContext.state === "suspended") {
      midy.audioContext.resume();
    }
    pianoComponent.setPointerCapture(event.pointerId);
    handleMove(channel, root, event, pressed);
  });
  pianoComponent.addEventListener("pointermove", (event) => {
    if (!event.buttons) return;
    if (midy.audioContext.state === "suspended") {
      midy.audioContext.resume();
    }
    handleMove(channel, root, event, pressed);
  });
  pianoComponent.addEventListener("pointerup", (event) => {
    release(channel, event.pressure, pressed);
  });
  pianoComponent.addEventListener("pointerenter", (event) => {
    globalThis.getSelection()?.removeAllRanges();
    if (!event.buttons) return;
    if (midy.audioContext.state === "suspended") {
      midy.audioContext.resume();
    }
    handleMove(channel, root, event, pressed);
  });
  pianoComponent.addEventListener("pointercancel", async (event) => {
    release(channelNumber, event.pressure, pressed);
    await releaseAll();
  });
  pianoComponent.addEventListener("pointerleave", async (event) => {
    release(channel, event.pressure, pressed);
    await releaseAll();
  });
}

function setKeyColor(key, velocity) {
  const lightness = 30 + velocity / 127 * 40;
  const color = `hsl(200, 80%, ${lightness}%)`;
  key.style.setProperty("fill", color);
}

function visualizerLoop() {
  if (!midiPlayer.isPlaying || midy.isPausing) {
    clearAllKeys(pianos);
    return;
  }
  const { startDelay, timeline } = midy;
  const currentTime = midy.currentTime();
  for (; scheduleIndex < timeline.length; scheduleIndex++) {
    const event = timeline[scheduleIndex];
    const t = event.startTime / midy.tempo + startDelay;
    if (currentTime < t) break;
    switch (event.type) {
      case "noteOn": {
        const key = pianos[event.channel][event.noteNumber];
        setKeyColor(key, event.velocity);
        break;
      }
      case "noteOff":
        pianos[event.channel][event.noteNumber].style.removeProperty("fill");
        break;
      case "controller":
        switch (event.controllerType) {
          case 7:
            volumes[event.channel].value = event.value;
            break;
          case 10:
            pans[event.channel].value = event.value;
            break;
          case 11:
            expressions[event.channel].value = event.value;
            break;
        }
        break;
      case "programChange": {
        const input = programs[event.channel];
        input.value = event.programNumber;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }
  requestAnimationFrame(visualizerLoop);
}

function setEvents() {
  const selector = "#midi-visualizer :is(input, midi-instrument, midi-piano)";
  const nodes = document.querySelectorAll(selector);
  for (let i = 0; i < nodes.length; i += 6) {
    const channelNumber = Math.floor(i / 6);
    const channel = midy.channels[channelNumber];
    const volume = nodes[i];
    volumes.push(volume);
    volume.addEventListener("change", (event) => {
      channel.setVolume(Number(event.target.value));
    });
    const expression = nodes[i + 1];
    expressions.push(expression);
    expression.addEventListener("change", (event) => {
      channel.setExpression(Number(event.target.value));
    });
    const pan = nodes[i + 2];
    pans.push(pan);
    pan.addEventListener("change", (event) => {
      channel.setPan(Number(event.target.value));
    });
    const program = nodes[i + 3];
    programs.push(program);
    program.addEventListener("change", async (event) => {
      const input = event.target;
      input.classList.toggle("is-invalid", !input.checkValidity());
      const programNumber = Number(input.value);
      const select = nodes[i + 4].shadowRoot.querySelector("select");
      select.selectedIndex = programNumber;
      await setProgramChange(channel, programNumber);
    });
    const select = nodes[i + 4].shadowRoot.querySelector("select");
    select.addEventListener("change", async (event) => {
      const programNumber = Number(event.target.selectedIndex);
      nodes[i + 3].value = programNumber;
      await setProgramChange(channel, programNumber);
    });
    const piano = nodes[i + 5];
    pianos.push(piano.shadowRoot.querySelectorAll("rect"));
    setPianoEvents(piano, channel);
  }
}

function initMIDIInstrumentElement() {
  class MIDIInstrument extends HTMLElement {
    constructor() {
      super();
      const template = document.getElementById("midi-instrument");
      const shadow = this.attachShadow({ mode: "open" });
      shadow.adoptedStyleSheets = [globalCSS];
      shadow.appendChild(template.content.cloneNode(true));
    }
  }
  customElements.define("midi-instrument", MIDIInstrument);
}

class MidiPiano extends HTMLElement {
  constructor() {
    super();
    const template = document.getElementById("midi-piano");
    const shadow = this.attachShadow({ mode: "open" });
    shadow.appendChild(template.content.cloneNode(true));
    const wrapper = shadow.querySelector(".wrapper");
    const svg = this.createPianoSVG();
    wrapper.appendChild(svg);
  }

  createPianoSVG() {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    const totalKeys = 128;
    const whiteWidth = 1;
    const blackWidth = 0.5;
    const whiteHeight = 1;
    const blackHeight = 0.6;
    const whitePattern = [0, 2, 4, 5, 7, 9, 11];
    const blackPattern = [1, 3, 6, 8, 10];
    let totalWhiteKeys = 0;
    for (let i = 0; i < totalKeys; i++) {
      if (whitePattern.includes(i % 12)) totalWhiteKeys++;
    }
    svg.setAttribute("viewBox", `0 0 ${totalWhiteKeys} 1`);
    svg.setAttribute("preserveAspectRatio", "none");
    let xPos = 0;
    const whiteXMap = [];
    for (let i = 0; i < totalKeys; i++) {
      const note = i % 12;
      if (whitePattern.includes(note)) {
        const rect = document.createElementNS(svgNS, "rect");
        rect.role = "button";
        rect.setAttribute("x", xPos);
        rect.setAttribute("y", 0);
        rect.setAttribute("width", whiteWidth);
        rect.setAttribute("height", whiteHeight);
        rect.setAttribute("class", "white");
        rect.setAttribute("data-index", i);
        rect.setAttribute("aria-pressed", "false");
        svg.appendChild(rect);
        whiteXMap[i] = xPos;
        xPos += whiteWidth;
      }
    }
    for (let i = 0; i < totalKeys; i++) {
      const note = i % 12;
      if (blackPattern.includes(note)) {
        const rect = document.createElementNS(svgNS, "rect");
        const x = whiteXMap[i - 1] + whiteWidth - blackWidth / 2 || 0;
        rect.setAttribute("x", x);
        rect.setAttribute("y", 0);
        rect.setAttribute("width", blackWidth);
        rect.setAttribute("height", blackHeight);
        rect.setAttribute("class", "black");
        rect.setAttribute("data-index", i);
        svg.appendChild(rect);
      }
    }
    return svg;
  }
}
customElements.define("midi-piano", MidiPiano);

async function loadMIDI(file) {
  if (!file) return;
  await midiPlayer.handleStop();
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  await midiPlayer.loadMIDI(uint8Array);
}

async function loadSoundFont(file) {
  if (!file) return;
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  await midy.loadSoundFont(uint8Array);
}

async function loadFile(file) {
  const extName = file.name.split(".").at(-1).toLowerCase();
  switch (extName) {
    case "mid":
    case "midi":
      return await loadMIDI(file);
    case "sf2":
    case "sf3":
      return await loadSoundFont(file);
  }
}

function setDragEvent() {
  const selectPanel = document.getElementById("selectPanel");
  let dragCounter = 0;
  selectPanel.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragCounter++;
    selectPanel.classList.add("border", "border-secondary");
  });
  selectPanel.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      selectPanel.classList.remove("border", "border-secondary");
    }
  });
  selectPanel.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  selectPanel.addEventListener("drop", (event) => {
    event.preventDefault();
    selectPanel.classList.remove("border", "border-secondary");
    const file = event.dataTransfer.files[0];
    loadFile(file);
  });
}

const htmlLang = document.documentElement.lang;
const globalCSS = getGlobalCSS();
initMIDIInstrumentElement();

// ---------------------------------------------------------------------------
// midi library
// ---------------------------------------------------------------------------

const libraryModal = Modal.getOrCreateInstance(
  document.getElementById("screenLibrary"),
);
Modal.getOrCreateInstance(
  document.getElementById("soundFontLibraryModal"),
);

const midiLibrary = new MidiLibrary({
  table: "libraryTable",
  pagination: "libraryPagination",
  columns: "libraryColumns",
  collections: "libraryCollections",
  instruments: "libraryInstruments",
  lang: htmlLang,
  onSelect: async (row) => {
    const buf = await (await fetch(`https://midi-db.pages.dev/${row.file}`))
      .arrayBuffer();
    await midiPlayer.handleStop();
    await midiPlayer.loadMIDI(new Uint8Array(buf));
    libraryModal.hide();
    await midiPlayer.handlePlay();
  },
});
midiLibrary.load();

// ---------------------------------------------------------------------------
// soundfont library
// ---------------------------------------------------------------------------

const SOUNDFONT_BASE = "https://soundfonts.pages.dev/";
let soundFontListLoaded = false;

async function loadSoundFontLibrary() {
  const el = document.getElementById("soundFontLibraryList");
  try {
    const list = await (await fetch(`${SOUNDFONT_BASE}list.json`)).json();
    el.innerHTML = "";
    list.forEach((sf, i) => {
      const id = `soundFontLibraryItem-${i}`;
      const checked = sf.name === "GeneralUser_GS_v1.471";
      const wrap = document.createElement("div");
      wrap.className = "form-check";
      wrap.innerHTML =
        `<input class="form-check-input" type="radio" name="soundFontLibrary" id="${id}" value="${sf.name}" ${
          checked ? "checked" : ""
        }>` +
        `<label class="form-check-label" for="${id}">${sf.name}</label>`;
      el.appendChild(wrap);
      if (checked) midiPlayer.soundFontURL = SOUNDFONT_BASE + sf.name;
    });
    soundFontListLoaded = true;
  } catch (err) {
    console.error("Failed to load SoundFont library:", err);
    el.textContent = t("soundFontLoadFailed");
  }
}

document.getElementById("soundFontLibraryList").addEventListener(
  "change",
  (e) => {
    if (e.target.name !== "soundFontLibrary") return;
    midiPlayer.soundFontURL = SOUNDFONT_BASE + e.target.value;
  },
);

document.getElementById("openSoundFontLibrary").addEventListener(
  "click",
  () => {
    if (!soundFontListLoaded) loadSoundFontLibrary();
  },
);

// ---------------------------------------------------------------------------
// midy playback events
// ---------------------------------------------------------------------------

const audioContext = new AudioContext();
if (audioContext.state === "running") await audioContext.suspend();
const midy = new Midy(audioContext);
const midiPlayer = new MIDIPlayer(midy);
await midy.loadSoundFont(`${midiPlayer.soundFontURL}/000.sf3`);
midiPlayer.defaultLayout();
midiPlayer.applyTheme(globalCSS, {
  "midi-player-btn": "btn bg-light-subtle p-1",
  "midi-player-text": "p-1",
  "midi-player-range": "form-range",
});
document.getElementById("midi-player").appendChild(midiPlayer.root);
const pianos = [];
const volumes = [];
const pans = [];
const expressions = [];
const programs = [];
let scheduleIndex = 0;
let currentKey;

midy.addEventListener("looped", () => {
  clearAllKeys(pianos);
  scheduleIndex = 0;
  requestAnimationFrame(visualizerLoop);
});
midy.addEventListener("started", () => {
  midiPlayer.isPlaying = true;
  scheduleIndex = 0;
  requestAnimationFrame(visualizerLoop);
});
midy.addEventListener("resumed", () => {
  const time = event.target.value * midy.totalTime;
  scheduleIndex = midy.getQueueIndex(time);
  requestAnimationFrame(visualizerLoop);
});
midy.addEventListener("seeked", () => {
  clearAllKeys(pianos);
  const time = event.target.value * midy.totalTime;
  scheduleIndex = midy.getQueueIndex(time);
});

setEvents();
setDragEvent();

document.getElementById("toggleDarkMode").onclick = toggleDarkMode;

document.getElementById("selectFile").addEventListener(
  "click",
  () => document.getElementById("inputFile").click(),
);
document.getElementById("inputFile").addEventListener("change", (e) => {
  loadFile(e.target.files[0]);
  e.target.value = "";
});
document.addEventListener("paste", (e) => {
  const f = e.clipboardData?.items[0]?.getAsFile();
  if (f) loadFile(f);
});

const selectPanel = document.getElementById("selectPanel");
let dragN = 0;
selectPanel.addEventListener("dragenter", (e) => {
  e.preventDefault();
  if (++dragN === 1) {
    selectPanel.classList.add("drag-active");
  }
});
selectPanel.addEventListener("dragleave", (e) => {
  e.preventDefault();
  if (--dragN === 0) {
    selectPanel.classList.remove("drag-active");
  }
});
selectPanel.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
selectPanel.addEventListener("drop", (e) => {
  e.preventDefault();
  dragN = 0;
  selectPanel.classList.remove("drag-active");
  loadFile(e.dataTransfer.files[0]);
});
