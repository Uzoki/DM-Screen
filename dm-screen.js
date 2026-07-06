/* =========================================================
   DM SCREEN — INITIATIVE TRACKER & DICE ROLLER
   This file controls everything on the page: adding
   combatants, editing them in place, selecting/swapping,
   reordering ties, hiding combatants from the copied list,
   the round counter, saving data in the browser, the
   paste-parser with its pop-ups, the dice roller, and the
   mob attack calculator.
   ========================================================= */

// ---- STATE ----
let combatants = [];        // list of { id, name, initiative, isHidden }
let round = 1;               // current round number, controlled by the +/- buttons
let idCounter = 0;           // used to give each combatant a unique id
let selectedIds = new Set(); // ids of the combatant(s) currently highlighted for swapping

const STORAGE_KEY = 'dmScreenInitiativeState';

// Small inline icons used for the show/hide (eye) button — no image
// files needed, just plain SVG shapes.
const OPEN_EYE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const CLOSED_EYE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';

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
  return { id: 'c-' + Date.now() + '-' + idCounter, name: name, initiative: initiative, isHidden: false };
}

// Returns the list sorted highest initiative first. When two combatants
// tie, they keep whatever relative order they already have — which is
// exactly what the tie-arrows below let you change.
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

  sorted.forEach((c, i) => {
    const showUp = i > 0 && sorted[i - 1].initiative === c.initiative;
    const showDown = i < sorted.length - 1 && sorted[i + 1].initiative === c.initiative;

    const li = document.createElement('li');
    li.className = 'tracker-row' + (selectedIds.has(c.id) ? ' selected' : '') + (c.isHidden ? ' row-hidden' : '');
    li.dataset.id = c.id;
    li.innerHTML = `
      <input class="row-ini" type="number" value="${escapeHtml(c.initiative)}" data-id="${c.id}" />
      <div class="name-cell"><input class="row-name" type="text" value="${escapeHtml(c.name)}" data-id="${c.id}" /></div>
      <div class="tie-arrows">
        ${showUp ? `<button class="tie-btn tie-up" data-id="${c.id}" aria-label="Move up">▲</button>` : ''}
        ${showDown ? `<button class="tie-btn tie-down" data-id="${c.id}" aria-label="Move down">▼</button>` : ''}
      </div>
      <button class="visibility-btn" data-id="${c.id}" aria-label="${c.isHidden ? 'Show' : 'Hide'} ${escapeHtml(c.name)}">
        ${c.isHidden ? CLOSED_EYE_SVG : OPEN_EYE_SVG}
      </button>
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

async function confirmRemove(id) {
  const combatant = combatants.find((c) => c.id === id);
  if (!combatant) return;

  const choice = await showModal(
    'Remove ' + combatant.name + '? This cannot be undone.',
    [
      { label: 'Remove', value: 'remove', className: 'btn-danger' },
      { label: 'Cancel', value: 'cancel', className: 'btn-secondary' }
    ]
  );

  if (choice === 'remove') {
    combatants = combatants.filter((c) => c.id !== id);
    render();
  }
}

function toggleVisibility(id) {
  const combatant = combatants.find((c) => c.id === id);
  if (!combatant) return;
  combatant.isHidden = !combatant.isHidden;
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
  const sorted = sortedCombatants().filter((c) => !c.isHidden);
  if (sorted.length === 0) {
    showToast('Nothing to copy yet');
    return;
  }
  const text = sorted.map((c) => `[${c.initiative}] - ${c.name}`).join('\n');

  navigator.clipboard
    .writeText(text)
    .then(() => showToast('List copied to clipboard'))
    .catch(() => showToast('Could not copy — try selecting the text manually'));
}

// Clicking a row (anywhere except the editable name/initiative fields,
// the tie-arrows, the eye button, or the remove button) toggles whether
// it's selected. Once exactly two rows are selected, the Swap button
// appears.
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

// Swaps two combatants' positions in the underlying list, WITHOUT
// touching their initiative values. Since ties keep their relative
// order when sorted, this is what actually moves a tied combatant
// up or down past another tied combatant.
function swapArrayPositions(idA, idB) {
  const indexA = combatants.findIndex((c) => c.id === idA);
  const indexB = combatants.findIndex((c) => c.id === idB);
  if (indexA === -1 || indexB === -1) return;
  const temp = combatants[indexA];
  combatants[indexA] = combatants[indexB];
  combatants[indexB] = temp;
}

function moveTieUp(id) {
  const sorted = sortedCombatants();
  const idx = sorted.findIndex((c) => c.id === id);
  if (idx <= 0) return;
  const neighbor = sorted[idx - 1];
  if (neighbor.initiative !== sorted[idx].initiative) return;
  swapArrayPositions(id, neighbor.id);
  render();
}

function moveTieDown(id) {
  const sorted = sortedCombatants();
  const idx = sorted.findIndex((c) => c.id === id);
  if (idx === -1 || idx >= sorted.length - 1) return;
  const neighbor = sorted[idx + 1];
  if (neighbor.initiative !== sorted[idx].initiative) return;
  swapArrayPositions(id, neighbor.id);
  render();
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

// Adds a new combatant — unless that name is already in the list.
// If it's already there with the SAME initiative, nothing needs to
// happen (no pop-up). If it's there with a DIFFERENT initiative, it
// asks whether to replace it. Returns true if something was added or
// replaced (or already correct), false if the replace was cancelled.
async function addOrReplaceCombatant(name, initiative) {
  const existing = combatants.find((c) => c.name.toLowerCase() === name.toLowerCase());

  if (!existing) {
    combatants.push(makeCombatant(name, initiative));
    return true;
  }

  if (existing.initiative === initiative) {
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
// It understands two very different kinds of lines:
//
//   A) A quick one-liner, typed by hand: "18 Aragorn", "18, Aragorn",
//      or even "[18] - Aragorn" (the same shape this app copies out).
//      Each of these lines is already a complete, standalone entry.
//
//   B) A block copied from a dice-roller log, which can be spread over
//      several lines or crammed onto one, and always ends with a
//      timestamp like "7/2/2026 10:14 PM". Everything from the end of
//      the previous timestamp up to and including the next timestamp
//      is treated as one entry. An entry like this is only accepted if
//      it actually contains the words "Initiative: roll" somewhere in
//      it — so a Nature check, an attack roll, or anything else that
//      isn't an initiative roll gets skipped automatically. Anything
//      left over at the very end with no timestamp (an incomplete,
//      cut-off entry) is dropped too.

// Cleans a raw name: strips emoji/symbols, then keeps only the first word.
function cleanName(rawName) {
  let cleaned = rawName.replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\uFE0F]/gu, '');
  cleaned = cleaned.trim();
  const match = cleaned.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]+/);
  return match ? match[0] : cleaned;
}

const QUICK_LINE_PATTERN = /^\[?-?\d+(?:\.\d+)?\]?[\s,-]+\S.*$/;
const TIMESTAMP_PATTERN = /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?/i;

// Stage 1: break the pasted text into records. Each record remembers
// whether it was a "quick" one-liner or a dice-log style block, since
// they get checked differently in stage 2.
function splitIntoRecords(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const records = [];
  let current = [];

  lines.forEach((line) => {
    if (QUICK_LINE_PATTERN.test(line) && !TIMESTAMP_PATTERN.test(line)) {
      current = [];
      records.push({ text: line, isQuick: true });
      return;
    }

    current.push(line);
    if (TIMESTAMP_PATTERN.test(line)) {
      records.push({ text: current.join(' '), isQuick: false });
      current = [];
    }
  });
  // Anything left in "current" never reached a timestamp — an
  // incomplete entry, so it's intentionally left out.

  return records;
}

// Stage 2: pull { name, initiative } out of one record.
function parseRecord(record) {
  let text = record.text;

  if (!record.isQuick) {
    // Only accept dice-log blocks that are actually an initiative roll.
    const isInitiativeRoll = /initiative\s*:?\s*roll/i.test(text);
    if (!isInitiativeRoll) return null;

    text = text.replace(/initiative\s*:?\s*roll/gi, ' ');
    text = text.replace(TIMESTAMP_PATTERN, ' ');
  }

  text = text.replace(/\s+/g, ' ').trim();
  if (text === '') return null;

  const numberMatch = text.match(/-?\d+(?:\.\d+)?/);
  if (!numberMatch) return null;

  const initiative = parseFloat(numberMatch[0]);
  let rawName = (text.slice(0, numberMatch.index) + text.slice(numberMatch.index + numberMatch[0].length))
    .replace(/[,:*[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip a leftover leading dash, e.g. from "[18] - Aragorn" style input.
  rawName = rawName.replace(/^-\s*/, '').trim();

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

// ---- DICE ROLLER ----

// Rolls one die with the given number of sides.
function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

// Rolls "count" dice with the given number of sides, keeping them in
// the exact order they were rolled (no sorting).
function rollDice(sides, count) {
  const rolls = [];
  for (let i = 0; i < count; i++) {
    rolls.push(rollDie(sides));
  }
  return rolls;
}

// Reads the "number of dice" field, always returning at least 1.
function getDiceCount() {
  const input = document.getElementById('diceCountInput');
  const val = parseInt(input.value, 10);
  return isNaN(val) || val < 1 ? 1 : val;
}

// Builds and displays the result line for a roll:
// SUM (roll1, roll2, ...) + modifier = TOTAL
// - the sum and the final total are bold
// - any individual die that rolled its maximum value is green
// - any individual die that rolled a 1 is red
function renderDiceResult(sides, rolls) {
  const sum = rolls.reduce((a, b) => a + b, 0);

  const modInput = document.getElementById('modifierInput');
  const modRaw = modInput.value.trim();
  const modifier = parseFloat(modRaw);
  const hasModifier = modRaw !== '' && !isNaN(modifier);
  const total = hasModifier ? sum + modifier : sum;

  const rollsHtml = rolls
    .map((r) => {
      let cls = '';
      if (r === sides) cls = 'die-max';
      else if (r === 1) cls = 'die-min';
      return cls ? `<span class="${cls}">${r}</span>` : `<span>${r}</span>`;
    })
    .join(', ');

  let html = `<strong>${sum}</strong> (${rollsHtml})`;
  if (hasModifier) {
    html += ` + ${modifier} = <strong>${total}</strong>`;
  }

  document.getElementById('diceResult').innerHTML = html;
}

// Resets the dice roller back to its starting state: dice count back
// to 1, modifier field emptied, and the last result cleared.
function clearDiceRoller() {
  document.getElementById('diceCountInput').value = 1;
  document.getElementById('modifierInput').value = '';
  document.getElementById('diceResult').innerHTML = '';
}

// ---- MOB ATTACK CALCULATOR ----

// The number of attacks needed to guarantee one hit, based on the
// target number (the d20 roll needed to hit, after subtracting the
// attack bonus from the target's AC). This mirrors the mob-attack
// "how many mooks does it take" table used at the table.
function attacksNeededPerHit(targetNumber) {
  if (targetNumber <= 5) return 1;
  if (targetNumber <= 12) return 2;
  if (targetNumber <= 14) return 3;
  if (targetNumber <= 16) return 4;
  if (targetNumber <= 18) return 5;
  if (targetNumber === 19) return 10;
  return 20; // 20 or higher
}

// Reads the attack bonus field and folds in advantage (+5) or
// disadvantage (-5), whichever checkbox (if either) is checked.
function getMobEffectiveBonus() {
  const rawBonus = parseFloat(document.getElementById('mobBonusInput').value);
  const baseBonus = isNaN(rawBonus) ? 0 : rawBonus;

  const advChecked = document.getElementById('mobAdvCheck').checked;
  const disChecked = document.getElementById('mobDisCheck').checked;

  if (advChecked) return baseBonus + 5;
  if (disChecked) return baseBonus - 5;
  return baseBonus;
}

// Recalculates "Automatic hits" / "Attacks wasted" any time the
// attacks, bonus, AC, advantage, or disadvantage fields change.
function updateMobAutoResult() {
  const resultEl = document.getElementById('mobAutoResult');

  const attacks = parseInt(document.getElementById('mobAttacksInput').value, 10);
  const ac = parseFloat(document.getElementById('mobACInput').value);

  if (isNaN(attacks) || attacks < 1 || isNaN(ac)) {
    resultEl.innerHTML = '';
    return;
  }

  const effectiveBonus = getMobEffectiveBonus();
  const targetNumber = ac - effectiveBonus;
  const neededPerHit = attacksNeededPerHit(targetNumber);

  const hits = Math.floor(attacks / neededPerHit);
  const wasted = attacks % neededPerHit;

  resultEl.innerHTML = `<strong>${hits}</strong> automatic hits &nbsp;/&nbsp; <strong>${wasted}</strong> attacks wasted`;
}

// Makes sure advantage and disadvantage can't both be checked at once.
// Whichever one was just checked wins, unchecking the other.
function handleMobAdvDisChange(justChecked) {
  if (justChecked === 'adv' && document.getElementById('mobAdvCheck').checked) {
    document.getElementById('mobDisCheck').checked = false;
  }
  if (justChecked === 'dis' && document.getElementById('mobDisCheck').checked) {
    document.getElementById('mobAdvCheck').checked = false;
  }
  updateMobAutoResult();
}

// Actually rolls the attacks one at a time: a natural 1 always misses,
// a natural 20 always hits, otherwise it hits if roll + bonus >= AC.
//
// Advantage/Disadvantage work differently here than in the automatic
// hits math above: instead of adjusting the bonus by +5/-5, each
// attack rolls 2d20 and keeps only one of them — the higher die on
// Advantage, the lower die on Disadvantage. The plain attack bonus
// (no +5/-5) is then added to whichever die was kept.
function rollMobAttacks() {
  const resultEl = document.getElementById('mobRollResult');

  const attacks = parseInt(document.getElementById('mobAttacksInput').value, 10);
  const ac = parseFloat(document.getElementById('mobACInput').value);

  if (isNaN(attacks) || attacks < 1 || isNaN(ac)) {
    resultEl.innerHTML = 'Enter attacks and target AC first';
    return;
  }

  const rawBonus = parseFloat(document.getElementById('mobBonusInput').value);
  const baseBonus = isNaN(rawBonus) ? 0 : rawBonus;

  const advChecked = document.getElementById('mobAdvCheck').checked;
  const disChecked = document.getElementById('mobDisCheck').checked;

  let hitCount = 0;
  const rollsHtml = [];

  for (let i = 0; i < attacks; i++) {
    let die;

    if (advChecked || disChecked) {
      const dieA = rollDie(20);
      const dieB = rollDie(20);
      die = advChecked ? Math.max(dieA, dieB) : Math.min(dieA, dieB);
    } else {
      die = rollDie(20);
    }

    let isHit;
    if (die === 1) isHit = false;
    else if (die === 20) isHit = true;
    else isHit = die + baseBonus >= ac;

    if (isHit) hitCount += 1;

    const cls = isHit ? 'die-max' : 'die-min';
    rollsHtml.push(`<span class="${cls}">${die}</span>`);
  }

  resultEl.innerHTML = `<strong>${hitCount}</strong> hit${hitCount === 1 ? '' : 's'} out of ${attacks} (${rollsHtml.join(', ')})`;
}

// Resets the whole mob attack calculator back to a blank state.
function clearMobCalculator() {
  document.getElementById('mobAttacksInput').value = '';
  document.getElementById('mobBonusInput').value = '';
  document.getElementById('mobACInput').value = '';
  document.getElementById('mobAdvCheck').checked = false;
  document.getElementById('mobDisCheck').checked = false;
  document.getElementById('mobAutoResult').innerHTML = '';
  document.getElementById('mobRollResult').innerHTML = '';
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

  // Clicks inside the turn-order list: remove, tie-arrows, eye toggle, or select a row
  document.getElementById('trackerList').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.remove-btn');
    if (removeBtn) {
      confirmRemove(removeBtn.dataset.id);
      return;
    }

    const visBtn = e.target.closest('.visibility-btn');
    if (visBtn) {
      toggleVisibility(visBtn.dataset.id);
      return;
    }

    const upBtn = e.target.closest('.tie-up');
    if (upBtn) {
      moveTieUp(upBtn.dataset.id);
      return;
    }

    const downBtn = e.target.closest('.tie-down');
    if (downBtn) {
      moveTieDown(downBtn.dataset.id);
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

  // Dice roller: +/- buttons for the dice count field
  document.getElementById('diceCountUp').addEventListener('click', () => {
    document.getElementById('diceCountInput').value = getDiceCount() + 1;
  });
  document.getElementById('diceCountDown').addEventListener('click', () => {
    document.getElementById('diceCountInput').value = Math.max(1, getDiceCount() - 1);
  });

  // Dice roller: die-type buttons
  document.querySelectorAll('.die-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sides = parseInt(btn.dataset.sides, 10);
      const count = getDiceCount();
      const rolls = rollDice(sides, count);
      renderDiceResult(sides, rolls);
    });
  });

  // Dice roller: clear button
  document.getElementById('diceClearBtn').addEventListener('click', clearDiceRoller);

  // Mob attack calculator: recalculate automatic hits/wasted whenever
  // attacks, bonus, or AC change
  document.getElementById('mobAttacksInput').addEventListener('input', updateMobAutoResult);
  document.getElementById('mobBonusInput').addEventListener('input', updateMobAutoResult);
  document.getElementById('mobACInput').addEventListener('input', updateMobAutoResult);

  // Mob attack calculator: advantage / disadvantage checkboxes (mutually exclusive)
  document.getElementById('mobAdvCheck').addEventListener('change', () => handleMobAdvDisChange('adv'));
  document.getElementById('mobDisCheck').addEventListener('change', () => handleMobAdvDisChange('dis'));

  // Mob attack calculator: roll button and clear button
  document.getElementById('mobRollBtn').addEventListener('click', rollMobAttacks);
  document.getElementById('mobClearBtn').addEventListener('click', clearMobCalculator);
});
