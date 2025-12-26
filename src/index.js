import { Midy } from "https://cdn.jsdelivr.net/gh/marmooo/midy@0.4.1/dist/midy.min.js";
import { MIDIPlayer } from "https://cdn.jsdelivr.net/npm/@marmooo/midi-player@0.0.4/+esm";

loadConfig();

function applyTheme(midiPlayer) {
  const root = midiPlayer.root;
  for (const btn of root.getElementsByClassName("midi-player-btn")) {
    btn.classList.add("btn", "btn-light", "p-1");
  }
  for (const btn of root.getElementsByClassName("midi-player-text")) {
    btn.classList.add("p-1");
  }
  for (const btn of root.getElementsByClassName("midi-player-range")) {
    btn.classList.add("form-range", "p-1");
  }
}

function loadConfig() {
  if (localStorage.getItem("darkMode") == 1) {
    document.documentElement.setAttribute("data-bs-theme", "dark");
  }
}

function toggleDarkMode() {
  if (localStorage.getItem("darkMode") == 1) {
    localStorage.setItem("darkMode", 0);
    document.documentElement.setAttribute("data-bs-theme", "light");
  } else {
    localStorage.setItem("darkMode", 1);
    document.documentElement.setAttribute("data-bs-theme", "dark");
  }
}

async function setProgramChange(channelNumber, programNumber, scheduleTime) {
  const channel = midy.channels[channelNumber];
  const bankNumber = channel.isDrum ? 128 : channel.bankLSB;
  const index = midy.soundFontTable[programNumber][bankNumber];
  if (index === undefined) {
    const program = programNumber.toString().padStart(3, "0");
    const baseName = bankNumber === 128 ? "128" : program;
    const path = `${midiPlayer.soundFontURL}/${baseName}.sf3`;
    await midy.loadSoundFont(path);
  }
  midy.setProgramChange(channelNumber, programNumber, scheduleTime);
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

async function noteOn(channelNumber, target, pressure, pressed) {
  const noteNumber = Number(target.dataset.index);
  if (pressed[noteNumber]) return;
  pressed[noteNumber] = true;
  const velocity = Math.ceil(pressure * 127) || 64;
  setKeyColor(target, velocity);
  target.setAttribute("aria-pressed", "true");
  await midy.noteOn(channelNumber, noteNumber, velocity);
}

function noteOff(channelNumber, target, pressure, pressed) {
  const noteNumber = Number(target.dataset.index);
  pressed[noteNumber] = false;
  const velocity = Math.ceil(pressure * 127) || 64;
  target.style.removeProperty("fill");
  target.setAttribute("aria-pressed", "false");
  midy.noteOff(channelNumber, noteNumber, velocity);
}

function handleMove(channelNumber, root, event, pressed) {
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
    noteOff(channelNumber, currentKey, event.pressure, pressed);
  }
  if (key) {
    noteOn(channelNumber, key, event.pressure, pressed);
  }
  currentKey = key;
}

function release(channelNumber, pressure, pressed) {
  if (!currentKey) return;
  noteOff(channelNumber, currentKey, pressure, pressed);
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

function setPianoEvents(pianoComponent, channelNumber) {
  const pressed = new Array(128).fill(false);
  const root = pianoComponent.shadowRoot;
  pianoComponent.addEventListener("pointerdown", (event) => {
    if (midy.audioContext.state === "suspended") {
      midy.audioContext.resume();
    }
    pianoComponent.setPointerCapture(event.pointerId);
    handleMove(channelNumber, root, event, pressed);
  });
  pianoComponent.addEventListener("pointermove", (event) => {
    if (!event.buttons) return;
    if (midy.audioContext.state === "suspended") {
      midy.audioContext.resume();
    }
    handleMove(channelNumber, root, event, pressed);
  });
  pianoComponent.addEventListener("pointerup", (event) => {
    release(channelNumber, event.pressure, pressed);
  });
  pianoComponent.addEventListener("pointerenter", (event) => {
    globalThis.getSelection()?.removeAllRanges();
    if (!event.buttons) return;
    if (midy.audioContext.state === "suspended") {
      midy.audioContext.resume();
    }
    handleMove(channelNumber, root, event, pressed);
  });
  pianoComponent.addEventListener("pointercancel", async (event) => {
    release(channelNumber, event.pressure, pressed);
    await releaseAll();
  });
  pianoComponent.addEventListener("pointerleave", async (event) => {
    release(channelNumber, event.pressure, pressed);
    await releaseAll();
  });
}

function setKeyColor(key, velocity) {
  const lightness = 30 + velocity / 127 * 40;
  const color = `hsl(200, 80%, ${lightness}%)`;
  key.style.setProperty("fill", color);
}

function visualizerLoop() {
  if (!midiPlayer.isPlaying) {
    clearAllKeys(pianos);
    return;
  }
  const { startDelay, timeline } = midy;
  const currentTime = midy.currentTime();
  for (; scheduleIndex < timeline.length; scheduleIndex++) {
    const event = timeline[scheduleIndex];
    if (currentTime < event.startTime + startDelay) break;
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
    const volume = nodes[i];
    volumes.push(volume);
    volume.addEventListener("change", (event) => {
      const now = midy.audioContext.currentTime;
      midy.setVolume(channelNumber, Number(event.target.value), now);
    });
    const expression = nodes[i + 1];
    expressions.push(expression);
    expression.addEventListener("change", (event) => {
      const now = midy.audioContext.currentTime;
      midy.setExpression(channelNumber, Number(event.target.value), now);
    });
    const pan = nodes[i + 2];
    pans.push(pan);
    pan.addEventListener("change", (event) => {
      const now = midy.audioContext.currentTime;
      midy.setPan(channelNumber, Number(event.target.value), now);
    });
    const program = nodes[i + 3];
    programs.push(program);
    program.addEventListener("change", async (event) => {
      const input = event.target;
      input.classList.toggle("is-invalid", !input.checkValidity());
      const now = midy.audioContext.currentTime;
      const programNumber = Number(input.value);
      const select = nodes[i + 4].shadowRoot.querySelector("select");
      select.selectedIndex = programNumber;
      await setProgramChange(channelNumber, programNumber, now);
    });
    const select = nodes[i + 4].shadowRoot.querySelector("select");
    select.addEventListener("change", async (event) => {
      const now = midy.audioContext.currentTime;
      const programNumber = Number(event.target.selectedIndex);
      nodes[i + 3].value = programNumber;
      await setProgramChange(channelNumber, programNumber, now);
    });
    const piano = nodes[i + 5];
    pianos.push(piano.shadowRoot.querySelectorAll("rect"));
    setPianoEvents(piano, channelNumber);
  }
}

function getGlobalCSS() {
  let cssText = "";
  for (const stylesheet of document.styleSheets) {
    for (const rule of stylesheet.cssRules) {
      cssText += rule.cssText;
    }
  }
  const css = new CSSStyleSheet();
  css.replaceSync(cssText);
  return css;
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

const globalCSS = getGlobalCSS();
initMIDIInstrumentElement();

const audioContext = new AudioContext();
if (audioContext.state === "running") await audioContext.suspend();
const midy = new Midy(audioContext);
const midiPlayer = new MIDIPlayer(midy);
await midy.loadSoundFont(`${midiPlayer.soundFontURL}/000.sf3`);
midiPlayer.defaultLayout();
applyTheme(midiPlayer);
document.getElementById("midi-player").appendChild(midiPlayer.root);
const pianos = [];
const volumes = [];
const pans = [];
const expressions = [];
const programs = [];
let scheduleIndex = 0;
let currentKey;

midiPlayer.playNode.addEventListener("click", () => {
  midiPlayer.isPlaying = true;
  scheduleIndex = 0;
  requestAnimationFrame(visualizerLoop);
});
midiPlayer.resumeNode.addEventListener("click", () => {
  requestAnimationFrame(visualizerLoop);
});
midiPlayer.pauseNode.addEventListener("click", () => {
});
midiPlayer.seekBarNode.addEventListener("change", () => {
  clearAllKeys(pianos);
  const time = event.target.value * midy.totalTime;
  scheduleIndex = midy.getQueueIndex(time);
});

setEvents();

document.getElementById("toggleDarkMode").onclick = toggleDarkMode;
document.getElementById("selectFile").onclick = () => {
  document.getElementById("inputFile").click();
};
document.getElementById("inputFile").addEventListener("change", (event) => {
  loadFile(event.target.files[0]);
});
globalThis.ondragover = (event) => {
  event.preventDefault();
};
globalThis.ondrop = (event) => {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  loadFile(file);
};
globalThis.addEventListener("paste", (event) => {
  const item = event.clipboardData.items[0];
  const file = item.getAsFile();
  if (!file) return;
  loadFile(file);
});
