/* =========================================================
   DM SCREEN — INITIATIVE TRACKER
   This file controls everything on the page: adding
   combatants, editing them in place, selecting/swapping,
   the round counter, saving data in the browser, and the
   paste-parser with its pop-ups.
   ========================================================= */

// ---- STATE ----
let combatants = [];        // list of { id, name, initiative }
let round = 1;               // current round number, controlled by the +/- buttons
let idCounter = 0;           // used to give each combatant a unique id
let selectedIds = new Set(); // ids of the combatant(s) currently highlighted for swapping

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

// Makes text safe to drop into HTML (including inside quoted attributes
// like value="..."), so names with special characters can't break the page.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- RENDERING ----

function render() {
  // If a selected combatant was removed, drop it from the selection too.
  selectedIds = new Set([...selectedIds].filter((id) => combatants.some((c) => c.id === id)));

  const list = document.getElementById('trackerList');
  const sorted = sortedCombatants();

  list.innerHTML = '';

  sorted.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'tracker-row' + (selectedIds.has(c.id) ? ' selected' : '');
    li.dataset.id = c.id;
    li.innerHTML = `
      <input class="row-ini" type="number" value="${escapeHtml(c.initiative)}" data-id="${c.id}" />
      <input class="row-name" type="text" value="${escapeHtml(c.name)}" data-id="${c.id}" />
      <button class="remove-btn" aria-label="Remove ${escapeHtml(c.name)}" data-id="${c.id}">×</button>
    `;
    list.appendChild(li);
  });

  document.getElementById('swapBtn').classList.toggle('hidden', selectedIds.size !== 2);

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
  selectedIds = new Set();
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

// Clicking a row (anywhere except the editable name/initiative fields
// or the remove button) toggles whether it's selected. Once exactly
// two rows are selected, the Swap button appears.
function toggleSelect(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    if (selectedIds.size >= 2) {
      showToast('Only two can be selected — tap one to deselect it first');
      return;
    }
    selectedIds.add(id);
  }
  render();
}

function swapSelected() {
  const ids = [...selectedIds];
  if (ids.length !== 2) return;
  const first = combatants.find((c) => c.id === ids[0]);
  const second = combatants.find((c) => c.id === ids[1]);
  if (!first || !second) return;

  const temp = first.initiative;
  first.initiative = second.initiative;
  second.initiative = temp;

  selectedIds = new Set();
  render();
  showToast('Initiative swapped');
}

// Called when you click away from (or press Enter in) a name field.
function commitNameEdit(input) {
  const combatant = combatants.find((c) => c.id === input.dataset.id);
  if (!combatant) return;
  const newName = input.value.trim();
  if (newName) combatant.name = newName;
  render();
}

// Called when you click away from (or press Enter in) an initiative field.
function commitIniEdit(input) {
  const combatant = combatants.find((c) => c.id === input.dataset.id);
  if (!combatant) return;
  const newIni = parseFloat(input.value);
  if (!isNaN(newIni)) combatant.initiative = newIni;
  render();
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

// Adds a new combatant — unless that name is already in the list, in
// which case it asks whether to replace their current initiative.
// Returns true if something was added or replaced, false if cancelled.
async function addOrReplaceCombatant(name, initiative) {
  const existing = combatants.find((c) => c.name.toLowerCase() === name.toLowerCase());

  if (!existing) {
    combatants.push(makeCombatant(name, initiative));
    return true;
  }

  const choice = await showModal(
    name + ' is already in the list (currently ' + existing.initiative + '). Replace their initiative with ' + initiative + '?',
    [
      { label: 'Replace', value: 'replace', className: 'btn-primary' },
      { label: 'Cancel', value: 'cancel', className: 'btn-secondary' }
    ]
  );

  if (choice === 'replace') {
    existing.initiative = initiative;
    return true;
  }
  return false;
}

// ---- PARSING PASTED TEXT ----
// This is the part that reads whatever you paste into the box and
// turns it into a list of { name, initiative } pairs.
//
// It works in two stages:
//   1) Break the pasted text into one "record" per combatant. A record
//      starts wherever a line begins with "*". Everything until the
//      NEXT "*" belongs to that same record — no matter whether your
//      dice-roller put it all on one line, or spread across five lines.
//      If there are no "*" bullets at all, every line is treated as
//      its own record instead (for quick manual typing).
//   2) For each record, strip out the parts we don't need (the words
//      "Initiative: roll" and the date/time stamp), then whatever
//      number is left over is the initiative roll, and whatever text
//      is left over is the name.

// Cleans a raw name: strips emoji/symbols, then keeps only the first word.
function cleanName(rawName) {
  let cleaned = rawName.replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\uFE0F]/gu, '');
  cleaned = cleaned.trim();
  const match = cleaned.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]+/);
  return match ? match[0] : cleaned;
}

// Stage 1: break the pasted text into one record per combatant.
function splitIntoRecords(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const records = [];
  let current = [];
  let sawBullet = false;

  lines.forEach((line) => {
    if (line === '') return;
    if (/^\*/.test(line)) {
      if (current.length > 0) records.push(current.join(' '));
      current = [line.replace(/^\*\s*/, '')];
      sawBullet = true;
    } else {
      current.push(line);
    }
  });
  if (current.length > 0) records.push(current.join(' '));

  if (!sawBullet) {
    // No "*" bullets anywhere — treat every non-empty line as its own record.
    return lines.filter((l) => l !== '');
  }

  return records.map((r) => r.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// Stage 2: pull { name, initiative } out of one record's text.
function parseRecord(record) {
  let text = record;

  // Remove the "Initiative: roll" label, wherever it appears.
  text = text.replace(/initiative\s*:?\s*roll/gi, ' ');

  // Remove a date/time stamp like "7/2/2026 10:14 PM", wherever it appears.
  text = text.replace(/\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?/gi, ' ');

  text = text.replace(/\s+/g, ' ').trim();
  if (text === '') return null;

  // Whatever number is left over is the initiative roll.
  const numberMatch = text.match(/-?\d+(?:\.\d+)?/);
  if (!numberMatch) return null;

  const initiative = parseFloat(numberMatch[0]);
  const rawName = (text.slice(0, numberMatch.index) + text.slice(numberMatch.index + numberMatch[0].length))
    .replace(/[,:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!rawName) return null;

  return { name: cleanName(rawName), initiative: initiative };
}

// Puts stage 1 and stage 2 together.
function parseDump(text) {
  const records = splitIntoRecords(text);
  const entries = [];
  records.forEach((record) => {
    const parsed = parseRecord(record);
    if (parsed) entries.push(parsed);
  });
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
//   - 1 roll               -> use it directly
//   - 2 rolls, same value  -> use it, no pop-up needed
//   - 2 rolls, different   -> ask Advantage / Disadvantage
//   - 3+ rolls             -> show an error pop-up, skip that name
// Whatever value is settled on then goes through addOrReplaceCombatant,
// which handles the "already in the list" pop-up if needed.
async function processParsedEntries(entries) {
  const groups = groupEntriesByName(entries);
  const names = Object.keys(groups);
  let addedCount = 0;

  for (const name of names) {
    const values = groups[name];
    let finalValue;

    if (values.length === 1) {
      finalValue = values[0];
    } else if (values.length === 2) {
      if (values[0] === values[1]) {
        finalValue = values[0];
      } else {
        const high = Math.max(values[0], values[1]);
        const low = Math.min(values[0], values[1]);
        finalValue = await showModal(
          name + ' rolled initiative twice: ' + high + ' and ' + low + '. Did they roll with advantage or disadvantage?',
          [
            { label: 'Advantage (use ' + high + ')', value: high, className: 'btn-primary' },
            { label: 'Disadvantage (use ' + low + ')', value: low, className: 'btn-secondary' }
          ]
        );
      }
    } else {
      await showModal(
        name + ' has ' + values.length + ' initiative rolls pasted in, so it is not clear which one to use. ' +
          name + ' was not added — please add them manually above with the correct number.',
        [{ label: 'OK', value: 'ok', className: 'btn-primary' }]
      );
      continue;
    }

    const wasAdded = await addOrReplaceCombatant(name, finalValue);
    if (wasAdded) addedCount += 1;
    render();
  }

  return addedCount;
}

// ---- WIRING EVERYTHING UP ----

document.addEventListener('DOMContentLoaded', () => {
  load();
  render();
  renderRound();

  // Manual "Add a combatant" form
  document.getElementById('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('nameInput');
    const iniInput = document.getElementById('iniInput');

    const name = nameInput.value.trim();
    const ini = parseFloat(iniInput.value);

    if (!name || isNaN(ini)) return;

    await addOrReplaceCombatant(name, ini);
    nameInput.value = '';
    iniInput.value = '';
    nameInput.focus();
    render();
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

  // Clicks inside the turn-order list: remove button, or select a row
  document.getElementById('trackerList').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.remove-btn');
    if (removeBtn) {
      removeCombatant(removeBtn.dataset.id);
      return;
    }
    if (e.target.tagName === 'INPUT') return; // clicking a field edits it, doesn't select the row
    const row = e.target.closest('.tracker-row');
    if (row) toggleSelect(row.dataset.id);
  });

  // Saving edits made to a name or initiative field once you click away
  document.getElementById('trackerList').addEventListener('focusout', (e) => {
    if (e.target.classList.contains('row-name')) commitNameEdit(e.target);
    else if (e.target.classList.contains('row-ini')) commitIniEdit(e.target);
  });

  // Pressing Enter in a name/initiative field also saves it
  document.getElementById('trackerList').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target.classList.contains('row-name') || e.target.classList.contains('row-ini'))) {
      e.target.blur();
    }
  });

  // Round +/- buttons
  document.getElementById('roundUp').addEventListener('click', incrementRound);
  document.getElementById('roundDown').addEventListener('click', decrementRound);

  // Bottom control bar
  document.getElementById('swapBtn').addEventListener('click', swapSelected);
  document.getElementById('copyBtn').addEventListener('click', copyList);
  document.getElementById('clearBtn').addEventListener('click', clearAll);
});
