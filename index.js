/* =========================================================
   DM SCREEN — INITIATIVE TRACKER
   This file controls all the behavior of the page:
   adding combatants, sorting them, tracking whose turn it
   is, saving data in the browser, and the copy/clear buttons.
   ========================================================= */

// ---- STATE ----
// This is the "memory" of the app while the page is open.
let combatants = [];   // list of { id, name, initiative, type }
let round = 1;         // current combat round
let activeId = null;   // id of whoever's turn it currently is
let idCounter = 0;     // used to give each combatant a unique id

const STORAGE_KEY = 'dmScreenInitiativeState';

// ---- SAVING / LOADING (so refreshing the page doesn't lose your list) ----

function save() {
  const data = { combatants, round, activeId };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      combatants = data.combatants || [];
      round = data.round || 1;
      activeId = data.activeId || null;
    }
  } catch (err) {
    console.warn('Could not load saved initiative data:', err);
  }
}

// ---- HELPERS ----

function makeCombatant(name, initiative, type) {
  idCounter += 1;
  return {
    id: 'c-' + Date.now() + '-' + idCounter,
    name: name,
    initiative: initiative,
    type: type // 'player' or 'monster'
  };
}

// Returns the list sorted highest initiative first.
function sortedCombatants() {
  return [...combatants].sort((a, b) => b.initiative - a.initiative);
}

// Makes sure "activeId" always points at someone who still
// exists in the list. If not, it defaults to the top of the order.
function ensureActiveId() {
  const sorted = sortedCombatants();
  if (sorted.length === 0) {
    activeId = null;
    return;
  }
  if (!sorted.some((c) => c.id === activeId)) {
    activeId = sorted[0].id;
  }
}

// Safely inserts text (prevents broken layout if a name contains
// special characters like < or &).
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- RENDERING ----
// Rebuilds the on-screen list to match the current state.

function render() {
  ensureActiveId();

  const list = document.getElementById('trackerList');
  const emptyHint = document.getElementById('emptyHint');
  const sorted = sortedCombatants();

  list.innerHTML = '';
  emptyHint.style.display = sorted.length === 0 ? 'block' : 'none';

  sorted.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'tracker-row ' + c.type + (c.id === activeId ? ' active' : '');
    li.dataset.id = c.id;
    li.innerHTML = `
      <span class="turn-marker">➤</span>
      <span class="row-ini">${c.initiative}</span>
      <span class="row-name">${escapeHtml(c.name)}</span>
      <span class="row-tag">${c.type === 'player' ? 'Player' : 'Monster'}</span>
      <button class="remove-btn" aria-label="Remove ${escapeHtml(c.name)}" data-id="${c.id}">×</button>
    `;
    list.appendChild(li);
  });

  document.getElementById('roundNumber').textContent = round;
  save();
}

// ---- ACTIONS ----

function removeCombatant(id) {
  combatants = combatants.filter((c) => c.id !== id);
  render();
}

function nextTurn() {
  const sorted = sortedCombatants();
  if (sorted.length === 0) return;

  const idx = sorted.findIndex((c) => c.id === activeId);
  const nextIdx = idx === -1 ? 0 : (idx + 1) % sorted.length;

  // If we wrapped back to the top of the order, a new round begins.
  if (nextIdx === 0 && idx !== -1) {
    round += 1;
  }

  activeId = sorted[nextIdx].id;
  render();
}

function clearAll() {
  const confirmed = confirm('Clear the entire initiative list? This cannot be undone.');
  if (!confirmed) return;
  combatants = [];
  round = 1;
  activeId = null;
  render();
}

function copyList() {
  const sorted = sortedCombatants();
  if (sorted.length === 0) {
    showToast('Nothing to copy yet');
    return;
  }
  const text = sorted
    .map((c) => `[${c.initiative}] ${c.name}${c.type === 'monster' ? ' (Monster)' : ''}`)
    .join('\n');

  navigator.clipboard
    .writeText(text)
    .then(() => showToast('List copied to clipboard'))
    .catch(() => showToast('Could not copy — try selecting the text manually'));
}

// Parses pasted text like:
//   Aragorn, 18
//   Goblin, 12
// One line per combatant. Also tolerates lines without a comma
// by grabbing the first number it finds on the line.
function parseDump(text, defaultType) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let added = 0;

  lines.forEach((line) => {
    let name, ini;

    if (line.includes(',')) {
      const parts = line.split(',');
      const last = parts[parts.length - 1].trim();
      if (last !== '' && !isNaN(parseFloat(last))) {
        ini = parseFloat(last);
        name = parts.slice(0, -1).join(',').trim();
      }
    }

    if (ini === undefined) {
      const match = line.match(/-?\d+(\.\d+)?/);
      if (match) {
        ini = parseFloat(match[0]);
        name = (line.slice(0, match.index) + line.slice(match.index + match[0].length))
          .replace(/[-,:]+/g, ' ')
          .trim();
      }
    }

    if (name && ini !== undefined && !isNaN(ini)) {
      combatants.push(makeCombatant(name, ini, defaultType));
      added += 1;
    }
  });

  return added;
}

// ---- TOAST (the little confirmation message at the bottom) ----

let toastTimeout;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), 2200);
}

// ---- TYPE TOGGLE BUTTONS (Player / Monster pills) ----

function setupTypeToggle(container) {
  if (!container) return;
  const buttons = container.querySelectorAll('.type-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function getSelectedType(containerId) {
  const container = document.getElementById(containerId);
  const activeBtn = container.querySelector('.type-btn.active');
  return activeBtn ? activeBtn.dataset.type : 'player';
}

// ---- WIRING EVERYTHING UP ----
// This runs once the page has finished loading.

document.addEventListener('DOMContentLoaded', () => {
  load();
  render();

  setupTypeToggle(document.getElementById('addTypeToggle'));
  setupTypeToggle(document.getElementById('dumpTypeToggle'));

  // Manual "Add a combatant" form
  document.getElementById('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('nameInput');
    const iniInput = document.getElementById('iniInput');
    const type = getSelectedType('addTypeToggle');

    const name = nameInput.value.trim();
    const ini = parseFloat(iniInput.value);

    if (!name || isNaN(ini)) return;

    combatants.push(makeCombatant(name, ini, type));
    nameInput.value = '';
    iniInput.value = '';
    nameInput.focus();
    render();
  });

  // Show/hide the "paste a list" section
  document.getElementById('toggleDump').addEventListener('click', () => {
    const area = document.getElementById('dumpArea');
    const btn = document.getElementById('toggleDump');
    const nowHidden = area.classList.toggle('hidden');
    btn.textContent = nowHidden ? '+ Paste a list instead' : '- Hide paste option';
  });

  // "Parse & add" button for the pasted list
  document.getElementById('parseBtn').addEventListener('click', () => {
    const textarea = document.getElementById('dumpInput');
    const type = getSelectedType('dumpTypeToggle');
    const added = parseDump(textarea.value, type);

    if (added > 0) {
      textarea.value = '';
      render();
      showToast(added + (added === 1 ? ' combatant added' : ' combatants added'));
    } else {
      showToast('No valid lines found — use "Name, Initiative" per line');
    }
  });

  // Clicking the × button on any row
  document.getElementById('trackerList').addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-btn');
    if (btn) removeCombatant(btn.dataset.id);
  });

  // Bottom control bar
  document.getElementById('nextTurnBtn').addEventListener('click', nextTurn);
  document.getElementById('copyBtn').addEventListener('click', copyList);
  document.getElementById('clearBtn').addEventListener('click', clearAll);
});
