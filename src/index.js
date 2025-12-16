import { Midy } from "https://cdn.jsdelivr.net/gh/marmooo/midy@0.4.0/dist/midy.min.js";
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

async function noteOn(channelNumber, event, pressed) {
  const noteNumber = Number(event.target.dataset.index);
  if (pressed[noteNumber]) return;
  pressed[noteNumber] = true;
  const velocity = Math.ceil(event.pressure * 127) || 64;
  await midy.noteOn(channelNumber, noteNumber, velocity);
}

function noteOff(channelNumber, event, pressed) {
  const noteNumber = Number(event.target.dataset.index);
  pressed[noteNumber] = false;
  const velocity = Math.ceil(event.pressure * 127) || 64;
  midy.noteOff(channelNumber, noteNumber, velocity);
}

function setPianoEvents(pianoComponent, channelNumber) {
  const pressed = new Array(128);
  const keys = pianoComponent.shadowRoot.querySelectorAll("rect");
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    key.addEventListener("pointerenter", async (event) => {
      if (!event.buttons) return;
      await noteOn(channelNumber, event, pressed);
    });
    key.addEventListener("pointerleave", (event) => {
      noteOff(channelNumber, event, pressed);
    });
    key.addEventListener("pointerdown", async (event) => {
      await noteOn(channelNumber, event, pressed);
    });
    key.addEventListener("pointerup", (event) => {
      noteOff(channelNumber, event, pressed);
    });
    key.addEventListener("pointercancel", (event) => {
      noteOff(channelNumber, event, pressed);
    });
  }
  pianoComponent.addEventListener("pointerenter", async () => {
    if (midy.audioContext.state === "suspended") {
      await midy.audioContext.resume();
    }
  });
  pianoComponent.addEventListener("pointerleave", async () => {
    if (midiPlayer.isPlaying) return;
    midy.stopNotes(0, true, midy.audioContext.currentTime);
    pressed.fill(false);
    await midy.audioContext.suspend();
  });
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
        const lightness = 30 + event.velocity / 127 * 40;
        const color = `hsl(200, 80%, ${lightness}%)`;
        const key = pianos[event.channel][event.noteNumber];
        key.style.setProperty("fill", color);
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
        rect.setAttribute("x", xPos);
        rect.setAttribute("y", 0);
        rect.setAttribute("width", whiteWidth);
        rect.setAttribute("height", whiteHeight);
        rect.setAttribute("class", "white");
        rect.setAttribute("data-index", i);
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

const midy = new Midy(new AudioContext());
await midy.audioContext.suspend();
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
