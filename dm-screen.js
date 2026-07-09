/* =========================================================
   DM SCREEN — INITIATIVE TRACKER & DICE ROLLER
   This file controls everything on the page: adding
   combatants, editing them in place, selecting/swapping,
   reordering ties, hiding combatants from the copied list,
   the round counter, saving data in the browser, the
   paste-parser with its pop-ups, the dice roller, the mob
   attack calculator, the reference dropdowns, and the jump
   calculator.
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

// Builds the "[initiative] - Name" copy text. Initiative numbers are
// right-aligned by padding shorter ones with leading spaces (before
// the bracket, not inside it), so every "[" lines up regardless of
// how many digits each combatant's initiative has.
function buildCopyText(list) {
  const numberStrings = list.map((c) => String(c.initiative));
  const maxLen = numberStrings.reduce((max, s) => Math.max(max, s.length), 0);

  return list
    .map((c, i) => {
      const numStr = numberStrings[i];
      const padding = ' '.repeat(maxLen - numStr.length);
      return `${padding}[${numStr}] - ${c.name}`;
    })
    .join('\n');
}

function copyList() {
  const sorted = sortedCombatants().filter((c) => !c.isHidden);
  if (sorted.length === 0) {
    showToast('Nothing to copy yet');
    return;
  }
  const text = buildCopyText(sorted);

  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    showToast('Could not copy — try selecting the text manually');
    return;
  }

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
// If the new name matches another combatant already in the list, the
// rename still goes through (duplicate names aren't blocked) but a
// warning pop-up lets you know, in case it was a typo.
async function commitNameEdit(input) {
  const combatant = combatants.find((c) => c.id === input.dataset.id);
  if (!combatant) return;

  const newName = input.value.trim();
  let duplicate = null;

  if (newName) {
    combatant.name = newName;
    duplicate = combatants.find(
      (c) => c.id !== combatant.id && c.name.toLowerCase() === newName.toLowerCase()
    );
  }

  render();

  if (duplicate) {
    await showModal(
      'Heads up — "' + duplicate.name + '" is already the name of another combatant in the list.',
      [{ label: 'OK', value: 'ok', className: 'btn-primary' }]
    );
  }
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
// replaced (or already correct), false if the replace was cancelled
// (in which case the caller should NOT clear whatever the user typed).
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
//   A) A quick one-liner, typed by hand — in EITHER order:
//      number-first, like "18 Aragorn", "18, Aragorn", or
//      "[18] - Aragorn" (the same shape this app copies out), OR
//      name-first, like "Aragorn 18", "Aragorn, 18" or "Aragorn - 18"
//      (name-first only recognizes a single-word name right before
//      the number, so it doesn't accidentally swallow a stray line
//      out of a multi-line dice-log block below).
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

// Number-first quick entry: "18 Aragorn", "18, Aragorn", "[18] - Aragorn".
const QUICK_LINE_PATTERN = /^\[?-?\d+(?:\.\d+)?\]?[\s,-]+\S.*$/;
// Name-first quick entry: "Aragorn 18", "Aragorn, 18", "Aragorn - 18".
// The name portion is deliberately restricted to a single word with no
// internal spaces AND no digits — no spaces so a stray line from a
// multi-line dice-log block (which usually has several words before
// its number) doesn't get mistaken for a quick entry, and no digits so
// a numbered name like "Goblin2 15" can't have its "2" mistaken for
// the initiative instead of the real number, "15".
const QUICK_LINE_PATTERN_NAME_FIRST = /^[^\s,[\]0-9-]+[\s,-]+-?\d+(?:\.\d+)?\]?$/;
const TIMESTAMP_PATTERN = /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?/i;

// Stage 1: break the pasted text into records. Each record remembers
// whether it was a "quick" one-liner or a dice-log style block, since
// they get checked differently in stage 2.
function splitIntoRecords(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const records = [];
  let current = [];

  lines.forEach((line) => {
    const isQuickLine =
      (QUICK_LINE_PATTERN.test(line) || QUICK_LINE_PATTERN_NAME_FIRST.test(line)) &&
      !TIMESTAMP_PATTERN.test(line);

    if (isQuickLine) {
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

// Stage 2: pull { name, initiative } out of one record. Works the same
// way regardless of whether the number came before or after the name —
// it just finds "the number" and treats everything else as "the name".
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

// Groups entries by name (case-insensitively, so "Aragorn" and
// "aragorn" pasted on different lines count as the same person), while
// remembering the exact spelling first seen for display purposes.
// { "aragorn": { displayName: "Aragorn", values: [22] }, ... }
function groupEntriesByName(entries) {
  const groups = {};
  entries.forEach((entry) => {
    const key = entry.name.toLowerCase();
    if (!groups[key]) {
      groups[key] = { displayName: entry.name, values: [] };
    }
    groups[key].values.push(entry.initiative);
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
  const keys = Object.keys(groups);
  let addedCount = 0;

  for (const key of keys) {
    const displayName = groups[key].displayName;
    const values = groups[key].values;
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
          displayName + ' rolled initiative twice: ' + high + ' and ' + low + '. Did they roll with advantage or disadvantage?',
          [
            { label: 'Advantage (use ' + high + ')', value: high, className: 'btn-primary' },
            { label: 'Disadvantage (use ' + low + ')', value: low, className: 'btn-secondary' }
          ]
        );
      }
    } else {
      await showModal(
        displayName + ' has ' + values.length + ' initiative rolls pasted in, so it is not clear which one to use. ' +
        displayName + ' was not added — please add them manually above with the correct number.',
        [{ label: 'OK', value: 'ok', className: 'btn-primary' }]
      );
      continue;
    }

    const wasAdded = await addOrReplaceCombatant(displayName, finalValue);
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
// - an explicit modifier of exactly 0 is treated the same as no
//   modifier at all, so it doesn't clutter the line with "+ 0 ="
function renderDiceResult(sides, rolls) {
  const sum = rolls.reduce((a, b) => a + b, 0);

  const modInput = document.getElementById('modifierInput');
  const modRaw = modInput.value.trim();
  const modifier = parseFloat(modRaw);
  const hasModifier = modRaw !== '' && !isNaN(modifier) && modifier !== 0;
  const total = hasModifier ? sum + modifier : sum;

  const rollsHtml = rolls
    .map((r) => {
      let cls = '';
      if (r === sides) cls = 'die-max';
      else if (r === 1) cls = 'die-min';
      return cls ? `<span class="${cls}">${r}</span>` : `<span>${r}</span>`;
    })
    .join(', ');

  let html = `<strong>${sum}</strong> [${rollsHtml}]`;
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

// ---- MOB ATTACK CALCULATOR (2024 DMG model) ----
// The 2024 DMG replaced the old 2014 "how many attackers per hit"
// lookup table with a probability-based one. Rather than hard-code a
// copy of that table (which only lists a handful of mob sizes), this
// works out the same underlying math directly: the real chance a
// single attacker's roll hits, multiplied across the whole mob, using
// the real Advantage/Disadvantage formula (roll twice, keep the
// higher/lower result) instead of the old flat +-5 approximation.
//
// Heads-up: I confirmed the general approach (probability x mob size)
// against a worked example, but couldn't 100% confirm whether the book
// rounds the final number up or down. The general 2024 rule is to
// round DOWN on fractions, so that's what this uses — the exact
// "expected hits" number is also shown so you can round it yourself
// at the table if your copy of the DMG says otherwise.

// Chance that a single attack with the given "roll needed" number
// hits, accounting for the fact that a natural 1 always misses and a
// natural 20 always hits, no matter what the target number is.
function singleAttackHitChance(targetNumber) {
  let hitFaces = 1; // a natural 20 is always a hit
  for (let face = 2; face <= 19; face++) {
    if (face >= targetNumber) hitFaces += 1;
  }
  return hitFaces / 20;
}

// Applies real Advantage/Disadvantage math on top of the single-attack
// chance above (mode is 'normal', 'advantage', or 'disadvantage').
function mobHitChance(targetNumber, mode) {
  const p = singleAttackHitChance(targetNumber);
  if (mode === 'advantage') return 1 - (1 - p) * (1 - p);
  if (mode === 'disadvantage') return p * p;
  return p;
}

// Recalculates "Automatic hits" any time the attacks, bonus, AC,
// advantage, or disadvantage fields change.
function updateMobAutoResult() {
  const resultEl = document.getElementById('mobAutoResult');

  const attacks = parseInt(document.getElementById('mobAttacksInput').value, 10);
  const ac = parseFloat(document.getElementById('mobACInput').value);

  if (isNaN(attacks) || attacks < 1 || isNaN(ac)) {
    resultEl.innerHTML = '';
    return;
  }

  const rawBonus = parseFloat(document.getElementById('mobBonusInput').value);
  const bonus = isNaN(rawBonus) ? 0 : rawBonus;
  const targetNumber = ac - bonus;

  const advChecked = document.getElementById('mobAdvCheck').checked;
  const disChecked = document.getElementById('mobDisCheck').checked;
  const mode = advChecked ? 'advantage' : (disChecked ? 'disadvantage' : 'normal');

  const chance = mobHitChance(targetNumber, mode);
  const expected = chance * attacks;
  const hits = Math.floor(expected);

  resultEl.innerHTML = `<strong>${hits}</strong> automatic hits out of ${attacks} &nbsp;(expected ${expected.toFixed(1)})`;
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
// (no +5/-5) is then added to whichever die was kept. (Left exactly
// as it was — this real 2d20 mechanic hasn't changed between editions.)
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
  let critHits = 0;
  let critMisses = 0;
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
    if (die === 1) {
      isHit = false;
      critMisses += 1;
    } else if (die === 20) {
      isHit = true;
      critHits += 1;
    } else {
      isHit = die + baseBonus >= ac;
    }

    if (isHit) hitCount += 1;

    let cls;
    if (die === 20) cls = 'crit-hit';
    else if (die === 1) cls = 'crit-miss';
    else cls = isHit ? 'die-max' : 'die-min';

    rollsHtml.push(`<span class="${cls}">${die}</span>`);
  }

  // Regular (non-crit) hits, so the crit hits can be called out separately.
  const normalHits = hitCount - critHits;

  let summary = `<strong>${normalHits}</strong> hit${normalHits === 1 ? '' : 's'}`;
  if (critHits > 0) {
    summary += ` and <strong>${critHits}</strong> crit${critHits === 1 ? '' : 's'}`;
  }
  summary += ` out of ${attacks}`;
  if (critMisses > 0) {
    summary += ` (<strong>${critMisses}</strong> critical miss${critMisses === 1 ? '' : 'es'})`;
  }

  resultEl.innerHTML = `${summary} [${rollsHtml.join(', ')}]`;
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

// ---- REFERENCE DROPDOWNS (remember open/closed state for this browser session) ----

const DROPDOWN_IDS = ['dropSkills', 'dropCreatureTypes', 'dropCover', 'dropObscured', 'dropConditions', 'dropJumping', 'dropNpcReactions'];

function initDropdownPersistence() {
  DROPDOWN_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    const saved = sessionStorage.getItem('dropdown_' + id);
    if (saved !== null) {
      el.open = saved === 'true';
    }

    el.addEventListener('toggle', () => {
      sessionStorage.setItem('dropdown_' + id, el.open);
    });
  });
}

// ---- NPC REACTIONS ----

// Rolls 2d6 and returns the sum.
function roll2d6() {
  return rollDie(6) + rollDie(6);
}

// Rolls the full monster-reaction chain and returns the finished
// result string, using an arrow (→) between each step.
function rollMonsterReactionResult() {
  const first = roll2d6();

  if (first === 2) return 'Immediate Attack';
  if (first === 12) return 'Immediate Friendly';

  if (first >= 3 && first <= 5) {
    const parts = ['Hostile'];
    const second = roll2d6();
    if (second >= 2 && second <= 8) {
      parts.push('Attack');
    } else {
      parts.push('Uncertain');
      const third = roll2d6();
      if (third >= 2 && third <= 5) parts.push('Attack');
      else if (third >= 6 && third <= 8) parts.push('Leave');
      else parts.push('Friendly');
    }
    return parts.join(' → ');
  }

  if (first >= 6 && first <= 8) {
    const parts = ['Uncertain'];
    const second = roll2d6();
    if (second >= 2 && second <= 5) {
      parts.push('Attack');
    } else if (second >= 9 && second <= 12) {
      parts.push('Friendly');
    } else {
      parts.push('Negotiate');
      const third = roll2d6();
      if (third >= 2 && third <= 5) parts.push('Attack');
      else if (third >= 6 && third <= 8) parts.push('Leave');
      else parts.push('Friendly');
    }
    return parts.join(' → ');
  }

  // first is 9-11
  const second = roll2d6();
  if (second >= 6 && second <= 12) {
    return 'Friendly';
  }
  const parts = ['Friendly', 'Uncertain'];
  const third = roll2d6();
  if (third >= 2 && third <= 5) parts.push('Attack');
  else if (third >= 6 && third <= 8) parts.push('Leave');
  else parts.push('Friendly');
  return parts.join(' → ');
}

function rollMonsterReaction() {
  const result = rollMonsterReactionResult();
  document.getElementById('monsterReactionResult').textContent = result;
}

// Picks Friendly, Indifferent, or Hostile at random for the humanoid
// attitude grid.
function randomizeAttitude() {
  const options = ['Friendly', 'Indifferent', 'Hostile'];
  const pick = options[Math.floor(Math.random() * options.length)];
  document.getElementById('attitudeResult').textContent = pick;
}

// ---- JUMP CALCULATOR ----
// Based on the long jump / high jump rules, which are identical in the
// 2014 and 2024 Player's Handbooks: your Strength score is your long
// jump distance (with a running start), and 3 + your Strength modifier
// is your high jump height (with a running start) — half either
// without a running start. The modifier checkboxes below (feats,
// subclass features, spell, magic item) are also all confirmed
// unchanged between the two editions, with one exception: Second-Story
// Work. The 2014 PHB only adds your Dexterity modifier to a running
// jump; the 2024 PHB instead lets you calculate your jump using
// Dexterity in place of Strength entirely — which is what the
// "whichever is higher" logic below already does, so no change was
// needed there for this update.

// Reads the height fields and returns the total height in decimal feet
// (e.g. 5 feet 6 inches becomes 5.5).
function getJumpHeightFeetDecimal() {
  const feet = parseFloat(document.getElementById('jumpFeet').value) || 0;
  const inches = parseFloat(document.getElementById('jumpInches').value) || 0;
  return feet + inches / 12;
}

// Called when the feet or inches field changes — recalculates the cm
// field to match, then re-runs the jump math.
function syncHeightFromFeetInches() {
  const feet = parseFloat(document.getElementById('jumpFeet').value) || 0;
  const inches = parseFloat(document.getElementById('jumpInches').value) || 0;
  const totalInches = feet * 12 + inches;
  const cm = totalInches * 2.54;
  document.getElementById('jumpCm').value = Math.round(cm * 10) / 10;
  computeJump();
}

// Called when the cm field changes — recalculates feet/inches to
// match, then re-runs the jump math.
function syncHeightFromCm() {
  const cm = parseFloat(document.getElementById('jumpCm').value) || 0;
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round((totalInches - feet * 12) * 10) / 10;
  document.getElementById('jumpFeet').value = feet;
  document.getElementById('jumpInches').value = inches;
  computeJump();
}

// Shows the Dexterity score field only when Second-Story Work is
// checked, since that's the only modifier that uses it.
function toggleJumpDexVisibility() {
  const rogueChecked = document.getElementById('jumpRogue').checked;
  document.getElementById('jumpDexRow').classList.toggle('hidden', !rogueChecked);
}

// Rounds a jump result to the nearest half-foot and formats it for
// display, dropping the decimal point entirely for whole numbers
// (e.g. 10 stays "10", but 1.5 stays "1.5").
function formatJumpNumber(value) {
  const rounded = Math.round(value * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// Recalculates every jump result from the current Strength, Dexterity,
// height, and checked modifiers, and writes the results into the page.
function computeJump() {
  const strRaw = parseFloat(document.getElementById('jumpStr').value);
  const dexRaw = parseFloat(document.getElementById('jumpDex').value);
  const strScore = isNaN(strRaw) ? 10 : strRaw;
  const dexScore = isNaN(dexRaw) ? 10 : dexRaw;
  const strMod = Math.floor((strScore - 10) / 2);
  const dexMod = Math.floor((dexScore - 10) / 2);

  const tiger = document.getElementById('jumpTiger').checked;     // Barbarian Totem: Tiger (while raging)
  const champion = document.getElementById('jumpChampion').checked; // Fighter Champion: Remarkable Athlete
  const monk = document.getElementById('jumpMonk').checked;       // Monk: Step of the Wind
  const rogue = document.getElementById('jumpRogue').checked;     // Rogue Thief: Second-Story Work
  const spell = document.getElementById('jumpSpell').checked;     // Spell: Jump
  const feat = document.getElementById('jumpFeat').checked;       // Feat: Athlete
  const boots = document.getElementById('jumpBoots').checked;     // Boots of Striding and Springing

  // Second-Story Work (2024): calculate jump distance using Dexterity
  // instead of Strength, using whichever of the two scores is higher
  // (ties default to Strength).
  let baseScore = strScore;
  let baseMod = strMod;
  if (rogue && dexScore > strScore) {
    baseScore = dexScore;
    baseMod = dexMod;
  }

  // --- Long jump ---
  let runningLong = baseScore;
  if (champion) runningLong += strMod; // Remarkable Athlete only boosts the running long jump
  if (tiger) runningLong += 10;        // Totem Spirit: Tiger adds a flat 10 feet (while raging)

  let standingLong = baseScore / 2;
  if (tiger) standingLong += 10;       // ...to both running and standing long jumps

  // --- High jump ---
  let runningHigh = Math.max(0, 3 + baseMod);
  if (tiger) runningHigh += 3;         // Totem Spirit: Tiger adds a flat 3 feet (while raging)

  let standingHigh = Math.max(0, 3 + baseMod) / 2;
  if (tiger) standingHigh += 3;        // ...to both running and standing high jumps

  // --- Multipliers that double/triple total jump distance ---
  const multiplier = (monk ? 2 : 1) * (spell ? 3 : 1) * (boots ? 3 : 1);
  runningLong *= multiplier;
  standingLong *= multiplier;
  runningHigh *= multiplier;
  standingHigh *= multiplier;

  // --- Reach while jumping: standing reach (based on height) + how
  //     high you jump. Not an official rule in either edition — see
  //     the note under the Jumping dropdown. ---
  const heightFeet = getJumpHeightFeetDecimal();
  const standingReach = Math.round(heightFeet * 1.3);

  const runReachVal = standingReach + runningHigh;
  const standReachVal = standingReach + standingHigh;

  document.getElementById('runLongJump').textContent = formatJumpNumber(Math.max(0, runningLong));
  document.getElementById('runHighJump').textContent = formatJumpNumber(Math.max(0, runningHigh));
  document.getElementById('runReach').textContent = formatJumpNumber(Math.max(0, runReachVal));

  document.getElementById('standLongJump').textContent = formatJumpNumber(Math.max(0, standingLong));
  document.getElementById('standHighJump').textContent = formatJumpNumber(Math.max(0, standingHigh));
  document.getElementById('standReach').textContent = formatJumpNumber(Math.max(0, standReachVal));

  // The Athlete feat shortens the running start needed from 10 feet
  // to 5 feet — unchanged between 2014 and 2024 — and does not change
  // how far or high you actually jump.
  document.getElementById('runningStartFeet').textContent = feat ? '5' : '10';
}

// ---- WIRING EVERYTHING UP ----

document.addEventListener('DOMContentLoaded', () => {
  load();
  render();
  renderRound();
  initDropdownPersistence();
  toggleJumpDexVisibility();
  computeJump();

  // Manual "Add a combatant" form
  document.getElementById('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('nameInput');
    const iniInput = document.getElementById('iniInput');

    const name = nameInput.value.trim();
    const ini = parseFloat(iniInput.value);

    if (!name || isNaN(ini)) return;

    const wasAdded = await addOrReplaceCombatant(name, ini);
    if (wasAdded) {
      nameInput.value = '';
      iniInput.value = '';
      nameInput.focus();
    }
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

  // Mob attack calculator: recalculate automatic hits whenever
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

  // Jump calculator: ability scores and most modifier checkboxes just
  // trigger a recalculation.
  ['jumpStr', 'jumpDex', 'jumpTiger', 'jumpChampion', 'jumpMonk', 'jumpSpell', 'jumpFeat', 'jumpBoots']
    .forEach((id) => {
      document.getElementById(id).addEventListener('input', computeJump);
      document.getElementById(id).addEventListener('change', computeJump);
    });

  // Jump calculator: Second-Story Work also shows/hides the Dexterity field
  document.getElementById('jumpRogue').addEventListener('change', () => {
    toggleJumpDexVisibility();
    computeJump();
  });

  // Jump calculator: height fields sync with each other (feet/inches <-> cm)
  document.getElementById('jumpFeet').addEventListener('input', syncHeightFromFeetInches);
  document.getElementById('jumpInches').addEventListener('input', syncHeightFromFeetInches);
  document.getElementById('jumpCm').addEventListener('input', syncHeightFromCm);

  // NPC Reactions: monster reaction roller and humanoid attitude randomizer
  document.getElementById('monsterReactionBtn').addEventListener('click', rollMonsterReaction);
  document.getElementById('randomizeAttitudeBtn').addEventListener('click', randomizeAttitude);
});
