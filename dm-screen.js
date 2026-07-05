/* =========================================================
   DM SCREEN — INITIATIVE TRACKER
   This file controls everything on the page: adding
   combatants, sorting them, the round counter, saving data
   in the browser, and the paste-parser with its pop-ups.
   ========================================================= */

// ---- STATE ----
let combatants = [];   // list of { id, name, initiative }
let round = 1;          // current round number, controlled by the +/- buttons
let idCounter = 0;      // used to give each combatant a unique id

const STORAGE_KEY = 'dmScreenInitiativeState';

// ---- SAVE / LOAD (so refreshing the page doesn't lose your list) ----

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ combatants, round }));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      combatants = data.combatants || [];
      round = typeof data.round === 'number' ? data.round : 1;
    }
  } catch (err) {
    console.warn('Could not load saved initiative data:', err);
  }
}

// ---- HELPERS ----

function makeCombatant(name, initiative) {
  idCounter += 1;
  return { id: 'c-' + Date.now() + '-' + idCounter, name: name, initiative: initiative };
}

// Returns the list sorted highest initiative first.
function sortedCombatants() {
  return [...combatants].sort((a, b) => b.initiative - a.initiative);
}

// Safely inserts text (prevents broken layout if a name contains
// special characters like < or &).
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- RENDERING ----

function render() {
  const list = document.getElementById('trackerList');
  const emptyHint = document.getElementById('emptyHint');
  const sorted = sortedCombatants();

  list.innerHTML = '';
  emptyHint.style.display = sorted.length === 0 ? 'block' : 'none';

  sorted.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'tracker-row';
    li.dataset.id = c.id;
    li.innerHTML = `
      <span class="row-ini">${c.initiative}</span>
      <span class="row-name">${escapeHtml(c.name)}</span>
      <button class="remove-btn" aria-label="Remove ${escapeHtml(c.name)}" data-id="${c.id}">×</button>
    `;
    list.appendChild(li);
  });

  save();
}

function renderRound() {
  document.getElementById('roundNumber').textContent = round;
}

// ---- ACTIONS ----

function removeCombatant(id) {
  combatants = combatants.filter((c) => c.id !== id);
  render();
}

function clearAll() {
  const confirmed = confirm('Clear the entire initiative list? This cannot be undone.');
  if (!confirmed) return;
  combatants = [];
  render();
}

function incrementRound() {
  round += 1;
  renderRound();
  save();
}

function decrementRound() {
  round = Math.max(1, round - 1);
  renderRound();
  save();
}

function copyList() {
  const sorted = sortedCombatants();
  if (sorted.length === 0) {
    showToast('Nothing to copy yet');
    return;
  }
  // Same "Initiative Name" format used for pasting, e.g. "18 Aragorn"
  const text = sorted.map((c) => `${c.initiative} ${c.name}`).join('\n');

  navigator.clipboard
    .writeText(text)
    .then(() => showToast('List copied to clipboard'))
    .catch(() => showToast('Could not copy — try selecting the text manually'));
}

// ---- TOAST (the little confirmation message at the bottom) ----

let toastTimeout;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), 2400);
}

// ---- MODAL (pop-up questions) ----
// Shows a message with one or more buttons and waits for a click.
// "buttons" looks like: [{ label: 'Advantage', value: 18 }, ...]
// Returns a Promise that resolves with whichever button's value was clicked.

function showModal(message, buttons) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modalOverlay');
    const messageEl = document.getElementById('modalMessage');
    const buttonsEl = document.getElementById('modalButtons');

    messageEl.textContent = message;
    buttonsEl.innerHTML = '';

    buttons.forEach((buttonInfo) => {
      const btn = document.createElement('button');
      btn.textContent = buttonInfo.label;
      btn.className = buttonInfo.className || 'btn-secondary';
      btn.addEventListener('click', () => {
        overlay.classList.add('hidden');
        resolve(buttonInfo.value);
      });
      buttonsEl.appendChild(btn);
    });

    overlay.classList.remove('hidden');
  });
}

// ---- PARSING PASTED TEXT ----

// Cleans a raw name: strips emoji/symbols, then keeps only the first word.
function cleanName(rawName) {
  let cleaned = rawName.replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\uFE0F]/gu, '');
  cleaned = cleaned.trim();
  const match = cleaned.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]+/);
  return match ? match[0] : cleaned;
}

// Reads the pasted text and pulls out { name, initiative } pairs.
// Understands two styles:
//   1) A quick one-liner: "Initiative Name", e.g. "18 Aragorn"
//      (a comma also works: "18, Aragorn")
//   2) Blocks copied from a dice-roller log, like:
//        *
//        Player Name
//        Initiative: roll
//        18
//        7/2/2026 10:14 PM
function parseDump(text) {
  const rawLines = text.split('\n').map((l) => l.trim());
  const entries = [];
  let pendingName = null;

  const bulletPattern = /^\*\s*$/;
  const labelPattern = /^initiative\s*:?\s*roll$/i;
  const timestampPattern = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}.*\d{1,2}:\d{2}/;
  const pureNumberPattern = /^-?\d+(\.\d+)?$/;
  const inlinePairPattern = /^(-?\d+(?:\.\d+)?)[,\s]+(.+)$/;

  for (const line of rawLines) {
    if (line === '') continue;
    if (bulletPattern.test(line)) continue;
    if (labelPattern.test(line)) continue;
    if (timestampPattern.test(line)) continue;

    // Style 1: "18 Aragorn" (or "18, Aragorn") all on one line
    const inlineMatch = line.match(inlinePairPattern);
    if (inlineMatch) {
      entries.push({ name: cleanName(inlineMatch[2]), initiative: parseFloat(inlineMatch[1]) });
      pendingName = null;
      continue;
    }

    // A line that's just a number closes out whichever name came before it
    if (pureNumberPattern.test(line)) {
      if (pendingName !== null) {
        entries.push({ name: cleanName(pendingName), initiative: parseFloat(line) });
        pendingName = null;
      }
      continue;
    }

    // Otherwise, treat this line as a name, waiting for its number
    pendingName = line;
  }

  return entries;
}

// Groups entries by name: { "Zurl": [22], "Dvalin": [10, 16], ... }
function groupEntriesByName(entries) {
  const groups = {};
  entries.forEach((entry) => {
    if (!groups[entry.name]) groups[entry.name] = [];
    groups[entry.name].push(entry.initiative);
  });
  return groups;
}

// Walks through every parsed name and decides what to do:
//   - 1 roll               -> add it directly
//   - 2 rolls, same value  -> add it once, no pop-up needed
//   - 2 rolls, different   -> ask Advantage / Disadvantage
//   - 3+ rolls             -> show an error pop-up, skip that name
async function processParsedEntries(entries) {
  const groups = groupEntriesByName(entries);
  const names = Object.keys(groups);
  let addedCount = 0;

  for (const name of names) {
    const values = groups[name];

    if (values.length === 1) {
      combatants.push(makeCombatant(name, values[0]));
      addedCount += 1;
      render();
    } else if (values.length === 2) {
      if (values[0] === values[1]) {
        combatants.push(makeCombatant(name, values[0]));
        addedCount += 1;
        render();
      } else {
        const high = Math.max(values[0], values[1]);
        const low = Math.min(values[0], values[1]);
        const choice = await showModal(
          name + ' rolled initiative twice: ' + high + ' and ' + low + '. Did they roll with advantage or disadvantage?',
          [
            { label: 'Advantage (use ' + high + ')', value: high, className: 'btn-primary' },
            { label: 'Disadvantage (use ' + low + ')', value: low, className: 'btn-secondary' }
          ]
        );
        combatants.push(makeCombatant(name, choice));
        addedCount += 1;
        render();
      }
    } else {
      await showModal(
        name + ' has ' + values.length + ' initiative rolls pasted in, so it is not clear which one to use. ' +
          name + ' was not added — please add them manually above with the correct number.',
        [{ label: 'OK', value: 'ok', className: 'btn-primary' }]
      );
    }
  }

  return addedCount;
}

// ---- WIRING EVERYTHING UP ----

document.addEventListener('DOMContentLoaded', () => {
  load();
  render();
  renderRound();

  // Manual "Add a combatant" form
  document.getElementById('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('nameInput');
    const iniInput = document.getElementById('iniInput');

    const name = nameInput.value.trim();
    const ini = parseFloat(iniInput.value);

    if (!name || isNaN(ini)) return;

    combatants.push(makeCombatant(name, ini));
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
  document.getElementById('parseBtn').addEventListener('click', async () => {
    const textarea = document.getElementById('dumpInput');
    const entries = parseDump(textarea.value);

    if (entries.length === 0) {
      showToast('No valid rolls found in the pasted text');
      return;
    }

    const addedCount = await processParsedEntries(entries);
    textarea.value = '';

    if (addedCount > 0) {
      showToast(addedCount + (addedCount === 1 ? ' combatant added' : ' combatants added'));
    } else {
      showToast('No combatants were added');
    }
  });

  // Clicking the × button on any row
  document.getElementById('trackerList').addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-btn');
    if (btn) removeCombatant(btn.dataset.id);
  });

  // Round +/- buttons
  document.getElementById('roundUp').addEventListener('click', incrementRound);
  document.getElementById('roundDown').addEventListener('click', decrementRound);

  // Bottom control bar
  document.getElementById('copyBtn').addEventListener('click', copyList);
  document.getElementById('clearBtn').addEventListener('click', clearAll);
});
