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
let undoStack = [];          // snapshots of "combatants" taken right before each change

// Time-tracking state: when the day started, and how long the party
// has been adventuring since then. "Current time" is never stored
// directly — it's always recalculated from these two.
let timeState = {
  startTime: '8:00 AM',
  durHours: 0,
  durMinutes: 0
};

const STORAGE_KEY = 'dmScreenInitiativeState';
const UNDO_LIMIT = 50; // how many past states the Undo button can step back through

// Call this right before any change to the "combatants" list, so the
// Undo button can restore exactly how things looked beforehand.
function pushUndoSnapshot() {
  undoStack.push(JSON.parse(JSON.stringify(combatants)));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

// Steps the initiative list back one change. Round number and
// selections aren't part of this — just the list of combatants.
function undoLast() {
  if (undoStack.length === 0) {
    showToast('Nothing to undo');
    return;
  }
  combatants = undoStack.pop();
  selectedIds = new Set();
  render();
  showToast('Undid last change');
}

// Small inline icons used for the show/hide (eye) button — no image
// files needed, just plain SVG shapes.
const OPEN_EYE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const CLOSED_EYE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';

// ---- SAVE / LOAD (so refreshing the page doesn't lose your list) ----

let savedMobState = null; // mob attack calculator values restored from storage, applied once on page load

function save() {
  const attacksEl = document.getElementById('mobAttacksInput');
  const bonusEl = document.getElementById('mobBonusInput');
  const acEl = document.getElementById('mobACInput');
  const dmgEl = document.getElementById('mobDmgInput');
  const advEl = document.getElementById('mobAdvCheck');
  const disEl = document.getElementById('mobDisCheck');

  const mob = {
    attacks: attacksEl ? attacksEl.value : '',
    bonus: bonusEl ? bonusEl.value : '',
    ac: acEl ? acEl.value : '',
    dmg: dmgEl ? dmgEl.value : '',
    adv: advEl ? advEl.checked : false,
    dis: disEl ? disEl.checked : false
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify({ combatants, round, mob, time: timeState }));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      combatants = data.combatants || [];
      round = typeof data.round === 'number' ? data.round : 1;
      savedMobState = data.mob || null;
      if (data.time) {
        timeState = {
          startTime: typeof data.time.startTime === 'string' ? data.time.startTime : '8:00 AM',
          durHours: typeof data.time.durHours === 'number' ? data.time.durHours : 0,
          durMinutes: typeof data.time.durMinutes === 'number' ? data.time.durMinutes : 0
        };
      }
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
    'Remove ' + combatant.name + '?',
    [
      { label: 'Remove', value: 'remove', className: 'btn-danger' },
      { label: 'Cancel', value: 'cancel', className: 'btn-secondary' }
    ]
  );

  if (choice === 'remove') {
    pushUndoSnapshot();
    combatants = combatants.filter((c) => c.id !== id);
    render();
  }
}

function toggleVisibility(id) {
  const combatant = combatants.find((c) => c.id === id);
  if (!combatant) return;
  pushUndoSnapshot();
  combatant.isHidden = !combatant.isHidden;
  render();
}

// Clears the entire initiative list, after confirmation.
async function clearAll() {
  const confirmed = await confirmAction('Clear the entire initiative list?');
  if (!confirmed) return;
  pushUndoSnapshot();
  combatants = [];
  selectedIds = new Set();
  document.getElementById('dumpInput').value = '';
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

// Resets the round counter back to 1, after confirmation.
async function resetRound() {
  const confirmed = await confirmAction('Reset the round counter back to 1?');
  if (!confirmed) return;
  round = 1;
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

  pushUndoSnapshot();
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
  pushUndoSnapshot();
  swapArrayPositions(id, neighbor.id);
  render();
}

function moveTieDown(id) {
  const sorted = sortedCombatants();
  const idx = sorted.findIndex((c) => c.id === id);
  if (idx === -1 || idx >= sorted.length - 1) return;
  const neighbor = sorted[idx + 1];
  if (neighbor.initiative !== sorted[idx].initiative) return;
  pushUndoSnapshot();
  swapArrayPositions(id, neighbor.id);
  render();
}

// Called when you click away from (or press Enter in) a name field.
// If the new name matches another combatant already in the list, the
// rename still goes through right away (duplicate names aren't
// blocked) but a pop-up then asks whether to keep the new name or go
// back to what it was called before.
async function commitNameEdit(input) {
  const combatant = combatants.find((c) => c.id === input.dataset.id);
  if (!combatant) return;

  const originalName = combatant.name;
  const newName = input.value.trim();
  if (!newName || newName === originalName) {
    render();
    return;
  }

  pushUndoSnapshot();
  combatant.name = newName;
  const duplicate = combatants.find(
    (c) => c.id !== combatant.id && c.name.toLowerCase() === newName.toLowerCase()
  );

  render();

  if (duplicate) {
    const choice = await showModal(
      '"' + newName + '" is already the name of another combatant (' + duplicate.name + '). Keep the new name, or go back to "' + originalName + '"?',
      [
        { label: 'Keep "' + newName + '"', value: 'keep', className: 'btn-primary' },
        { label: 'Go back to "' + originalName + '"', value: 'revert', className: 'btn-secondary' }
      ]
    );

    if (choice === 'revert') {
      combatant.name = originalName;
      render();
    }
  }
}

// Called when you click away from (or press Enter in) an initiative field.
function commitIniEdit(input) {
  const combatant = combatants.find((c) => c.id === input.dataset.id);
  if (!combatant) return;
  const newIni = parseFloat(input.value);
  if (!isNaN(newIni) && newIni !== combatant.initiative) {
    pushUndoSnapshot();
    combatant.initiative = newIni;
  }
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

// Generic yes/no confirmation popup, used by every Clear/Reset button
// on the page. Returns true if the user confirmed, false if they
// cancelled (or clicked away).
function confirmAction(message, confirmLabel) {
  return showModal(message, [
    { label: confirmLabel || 'Confirm', value: 'confirm', className: 'btn-danger' },
    { label: 'Cancel', value: 'cancel', className: 'btn-secondary' }
  ]).then((choice) => choice === 'confirm');
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
    pushUndoSnapshot();
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
    pushUndoSnapshot();
    existing.initiative = initiative;
    return true;
  }
  return false;
}

// ---- PARSING PASTED TEXT ----
// This is the part that reads whatever you paste into the box and
// turns it into a list of { name, initiative } pairs.
//
// Exactly TWO formats are accepted:
//
//   A) A block copied straight from D&D Beyond's game log. Instead of
//      trying to recognise the whole shape of a log entry (which
//      changes depending on exactly how you copy it — with or without
//      a date, with or without bullet markers, with or without a
//      duplicated name line), this just scans line by line for the
//      one thing that never changes: a line containing the words
//      "Initiative: roll". Whenever it finds one, it grabs the
//      nearest usable line ABOVE it as the name, and the nearest
//      plain number BELOW it as the roll — skipping over blank lines,
//      stray bullet markers, and duplicate name lines along the way.
//      Nothing else about the surrounding text (dates, timestamps,
//      "*" bullets) matters at all.
//
//   B) This app's own "Copy list" output format, pasted back in:
//      "[22] - Zurl" (optionally with leading padding spaces before
//      the bracket, exactly like what Copy list produces). This is
//      matched with a strict pattern — it must have the actual
//      brackets and the " - " separator — so it can never be confused
//      with unrelated text like a timestamp ("37 mins ago").
//
// Any other line in the pasted block (chat messages, other kinds of
// rolls, timestamps, etc.) is simply ignored.

// Cleans a raw name: strips emoji/symbols and any leading junk (bullet
// markers like "* ", "- ", "• ", etc.), then keeps only the first word
// — so "Gronja Stavbärare" becomes "Gronja".
function cleanName(rawName) {
  let cleaned = String(rawName).replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\uFE0F]/gu, '');
  cleaned = cleaned.trim();
  const match = cleaned.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]+/);
  return match ? match[0] : cleaned;
}

// A line that is ONLY a plain number, e.g. the roll result "15" sitting
// on its own line in a D&D Beyond log entry.
const PURE_NUMBER_LINE = /^-?\d+(?:\.\d+)?$/;
// A line that mentions an initiative roll, in any of D&D Beyond's
// phrasings ("Initiative: roll", "Initiative Roll", etc.).
const INITIATIVE_LINE = /initiative\s*:?\s*roll/i;
// This app's own "Copy list" output format, pasted back in:
// "[22] - Zurl". Requires the literal brackets and the " - "
// separator (spacing around the dash is flexible), so it can never
// accidentally match unrelated text — unlike a loose "number, then a
// word" pattern, which is exactly what caused this format to be
// removed once already (it was matching timestamps like "37 mins
// ago" pasted from the D&D Beyond log).
const BRACKET_LINE_PATTERN = /^\[(-?\d+(?:\.\d+)?)\]\s*-\s*(.+)$/;

// Pulls { name, initiative } out of a single "[22] - Zurl" line.
function parseBracketLine(line) {
  const match = BRACKET_LINE_PATTERN.exec(line);
  if (!match) return null;
  const initiative = parseFloat(match[1]);
  const name = cleanName(match[2]);
  if (!name) return null;
  return { name: name, initiative: initiative };
}

// Reads the whole pasted block and returns a list of { name, initiative }.
function parseDump(text) {
  const rawLines = text.split('\n').map((l) => l.trim());
  // Drop blank lines and lines that are nothing but a lone bullet
  // marker (D&D Beyond sometimes pastes these as their own line).
  const lines = rawLines.filter((l) => l !== '' && !/^[*\-•]$/.test(l));

  const entries = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (INITIATIVE_LINE.test(line)) {
      // Look up to 3 lines back for the nearest usable name line.
      let name = '';
      for (let back = i - 1; back >= 0 && back >= i - 3; back--) {
        const candidate = lines[back];
        if (INITIATIVE_LINE.test(candidate) || PURE_NUMBER_LINE.test(candidate)) continue;
        const cleaned = cleanName(candidate);
        if (cleaned) {
          name = cleaned;
          break;
        }
      }

      // Look up to 3 lines ahead for the roll result.
      let initiative = null;
      let numberLineIndex = -1;
      for (let fwd = i + 1; fwd < lines.length && fwd <= i + 3; fwd++) {
        if (PURE_NUMBER_LINE.test(lines[fwd])) {
          initiative = parseFloat(lines[fwd]);
          numberLineIndex = fwd;
          break;
        }
      }

      if (name && initiative !== null) {
        entries.push({ name: name, initiative: initiative });
      }

      i = numberLineIndex !== -1 ? numberLineIndex + 1 : i + 1;
      continue;
    }

    if (BRACKET_LINE_PATTERN.test(line)) {
      const parsed = parseBracketLine(line);
      if (parsed) entries.push(parsed);
    }

    i += 1;
  }

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

// ---- TIME TRACKER ----
// Three header fields: a typed "Starting time", an up/down "Duration
// adventured" (hours + minutes), and a read-only "Current time" that's
// always just startTime + duration, recalculated on every change.

// Turns a typed time string into minutes-since-midnight (0-1439), or
// null if it can't be understood. Accepts 12-hour ("8:00 AM", "8 PM")
// and 24-hour ("20:00", "8:00") formats.
function parseTimeToMinutes(str) {
  if (!str) return null;
  const match = str.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3] ? match[3].toUpperCase() : null;

  if (isNaN(hours) || isNaN(minutes) || minutes < 0 || minutes > 59) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'AM') hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  } else if (hours < 0 || hours > 23) {
    return null;
  }

  return hours * 60 + minutes;
}

// Turns minutes-since-midnight back into a "h:mm AM/PM" display string,
// wrapping anything outside 0-1439 back around a 24-hour clock.
function formatMinutesToTimeString(totalMinutes) {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  let displayHours = hours24 % 12;
  if (displayHours === 0) displayHours = 12;
  return displayHours + ':' + String(minutes).padStart(2, '0') + ' ' + meridiem;
}

// Keeps duration sane after any manual edit or +/- click: rolls extra
// minutes over into hours (and back), and never lets the total drop
// below zero.
function normalizeDuration() {
  let total = timeState.durHours * 60 + timeState.durMinutes;
  if (isNaN(total) || total < 0) total = Math.max(0, total || 0);
  timeState.durHours = Math.floor(total / 60);
  timeState.durMinutes = total % 60;
}

// Recomputes and displays "Current time" from startTime + duration.
// If the typed starting time couldn't be parsed, falls back to
// midnight rather than leaving the field blank.
function updateCurrentTimeDisplay() {
  const startMinutes = parseTimeToMinutes(timeState.startTime);
  const base = startMinutes === null ? 0 : startMinutes;
  const total = base + timeState.durHours * 60 + timeState.durMinutes;
  document.getElementById('currentTimeInput').value = formatMinutesToTimeString(total);
}

// Pushes the current timeState out to all three fields on screen.
function renderTimeControls() {
  document.getElementById('startTimeInput').value = timeState.startTime;
  document.getElementById('durHoursInput').value = timeState.durHours;
  document.getElementById('durMinutesInput').value = timeState.durMinutes;
  updateCurrentTimeDisplay();
}

// Called when the Starting time field loses focus or Enter is pressed.
// Invalid input is rejected (with a toast) and reverted to the last
// good value instead of silently breaking the current-time math.
function commitStartTimeInput(input) {
  const parsed = parseTimeToMinutes(input.value);
  if (parsed === null) {
    showToast('Enter a valid time, like 8:00 AM or 20:00');
    input.value = timeState.startTime;
    return;
  }
  timeState.startTime = formatMinutesToTimeString(parsed);
  input.value = timeState.startTime;
  updateCurrentTimeDisplay();
  save();
}

// Called when the Current time field loses focus or Enter is pressed.
// Current time is normally just a read-out of startTime + duration, but
// typing directly into it works the math backwards instead: it keeps
// Starting time fixed and recalculates Duration adventured to match
// whatever time was typed in. If the typed time is earlier in the day
// than the starting time, it's treated as having wrapped past midnight
// into the next day (e.g. starting at 10:00 PM, typing 2:00 AM gives a
// 4-hour duration instead of a negative one).
function commitCurrentTimeInput(input) {
  const parsed = parseTimeToMinutes(input.value);
  if (parsed === null) {
    showToast('Enter a valid time, like 8:00 AM or 20:00');
    updateCurrentTimeDisplay();
    return;
  }

  const startMinutes = parseTimeToMinutes(timeState.startTime);
  const base = startMinutes === null ? 0 : startMinutes;

  let diff = parsed - base;
  if (diff < 0) diff += 1440;

  timeState.durHours = Math.floor(diff / 60);
  timeState.durMinutes = diff % 60;

  renderTimeControls();
  save();
}

// Called when either duration field loses focus or Enter is pressed —
// this is what lets you type a number directly instead of only using
// the +/- buttons.
function commitDurationInputs() {
  const hoursInput = document.getElementById('durHoursInput');
  const minutesInput = document.getElementById('durMinutesInput');
  const hoursVal = parseInt(hoursInput.value, 10);
  const minutesVal = parseInt(minutesInput.value, 10);

  timeState.durHours = isNaN(hoursVal) ? 0 : hoursVal;
  timeState.durMinutes = isNaN(minutesVal) ? 0 : minutesVal;
  normalizeDuration();
  renderTimeControls();
  save();
}

// Duration +/- buttons: hours step by 1, minutes step by 10.
function adjustDurationHours(delta) {
  timeState.durHours += delta;
  normalizeDuration();
  renderTimeControls();
  save();
}

function adjustDurationMinutes(delta) {
  timeState.durMinutes += delta;
  normalizeDuration();
  renderTimeControls();
  save();
}

// "Next day" button: resets the adventuring clock back to 0h 0m,
// without touching the chosen Starting time. No confirmation pop-up,
// since this isn't a destructive Clear/Reset action.
function resetTime() {
  timeState.durHours = 0;
  timeState.durMinutes = 0;
  renderTimeControls();
  save();
}

// "Reset" button: resets the ENTIRE time tracker back to its default
// state, including the starting time, after confirmation.
async function resetTimeAll() {
  const confirmed = await confirmAction('Reset the time tracker back to its default state (8:00 AM, 0h 0m)?');
  if (!confirmed) return;
  timeState.startTime = '8:00 AM';
  timeState.durHours = 0;
  timeState.durMinutes = 0;
  renderTimeControls();
  save();
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

// Resets the dice roller back to its starting state, after
// confirmation: dice count back to 1, modifier field emptied, and the
// last result cleared.
async function clearDiceRoller() {
  const confirmed = await confirmAction('Clear the dice roller?');
  if (!confirmed) return;
  document.getElementById('diceCountInput').value = 1;
  document.getElementById('modifierInput').value = '';
  document.getElementById('diceResult').innerHTML = '';
}

// ---- DAMAGE PARSING (for the Mob Attack Calculator's optional damage field) ----
// Reads a free-typed damage string like "1d8acid+2d6 piercing" or
// "4d4+2 PierCinG 2d10necrotic" and turns it into a list of dice
// groups: [{ count, sides, modifier, type }, ...]. Damage type is
// optional per group; if the same word doesn't appear near a group,
// that group's type is '' (untyped).
//
// How it works: first every "NdM" dice expression in the string is
// found (e.g. "1d8", "2d6", or just "d4" with no leading number,
// which defaults to a count of 1). Whatever text sits between the end
// of one dice expression and the start of the next one "belongs" to
// the first — that's where its optional +/- modifier and optional
// damage-type word are pulled from.
//
// Each of the fourteen damage types also recognizes a handful of
// common shorthand spellings (e.g. "pierce" or "prc" for piercing),
// listed longest-first so a more specific alias always wins over a
// shorter one that happens to also appear in the text.

const DAMAGE_TYPE_ALIASES = {
  acid: ['acid'],
  bludgeoning: ['bludgeoning', 'bludgeon', 'blunt', 'blud'],
  cold: ['cold'],
  fire: ['fire', 'flame'],
  force: ['force'],
  lightning: ['lightning', 'lightn', 'ltng', 'electric'],
  necrotic: ['necrotic', 'necro'],
  piercing: ['piercing', 'pierce', 'pierc', 'prc'],
  poison: ['poison', 'poisn', 'psn'],
  psychic: ['psychic', 'psych', 'psy'],
  radiant: ['radiant', 'rad'],
  slashing: ['slashing', 'slash', 'slsh'],
  thunder: ['thunder', 'thund']
};

// Flattened to [{ alias, type }, ...] and sorted so the longest alias
// is always checked first, regardless of which type it belongs to.
const DAMAGE_TYPE_ALIAS_LIST = Object.keys(DAMAGE_TYPE_ALIASES)
  .reduce((list, type) => list.concat(DAMAGE_TYPE_ALIASES[type].map((alias) => ({ alias: alias, type: type }))), [])
  .sort((a, b) => b.alias.length - a.alias.length);

function capitalizeWord(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// CSS class used to color a damage type's text (see styles.css for
// the actual colors). Untyped damage gets no special class.
function damageTypeClass(type) {
  return type ? 'dmg-' + type : '';
}

// Formats a damage total for display: keeps one decimal place unless
// the number is a whole number, in which case the decimal is dropped
// entirely (e.g. 16 instead of 16.0, but 16.5 stays 16.5).
function formatDamageNumber(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function parseDamageInput(text) {
  if (!text) return [];
  let str = text.toLowerCase().replace(/[(),]/g, ' ');

  const diceRegex = /(\d*)\s*d\s*(\d+)/g;
  const matches = [];
  let m;
  while ((m = diceRegex.exec(str)) !== null) {
    matches.push({
      index: m.index,
      end: diceRegex.lastIndex,
      count: m[1] ? parseInt(m[1], 10) : 1,
      sides: parseInt(m[2], 10)
    });
  }

  // No dice found at all — if the whole field is just a flat number,
  // treat it as a flat (no-dice) modifier instead of ignoring it.
  if (matches.length === 0) {
    const flat = parseFloat(str);
    if (!isNaN(flat)) {
      return [{ count: 0, sides: 0, modifier: flat, type: '' }];
    }
    return [];
  }

  const groups = [];
  for (let i = 0; i < matches.length; i++) {
    const tailStart = matches[i].end;
    const tailEnd = i + 1 < matches.length ? matches[i + 1].index : str.length;
    const tail = str.slice(tailStart, tailEnd);

    let modifier = 0;
    const modMatch = tail.match(/([+-])\s*(\d+)/);
    if (modMatch) {
      modifier = parseInt(modMatch[2], 10) * (modMatch[1] === '-' ? -1 : 1);
    }

    let type = '';
    for (const entry of DAMAGE_TYPE_ALIAS_LIST) {
      if (tail.includes(entry.alias)) {
        type = entry.type;
        break;
      }
    }

    groups.push({ count: matches[i].count, sides: matches[i].sides, modifier: modifier, type: type });
  }

  return groups;
}

// Average damage per hit for each damage type, added up across every
// dice group that shares that type. Returns { typeKey: averageValue }
// where typeKey is '' for untyped damage.
function averageDamagePerHitByType(groups) {
  const totals = {};
  groups.forEach((g) => {
    const avg = g.count > 0 ? (g.count * (g.sides + 1)) / 2 + g.modifier : g.modifier;
    const key = g.type || '';
    totals[key] = (totals[key] || 0) + avg;
  });
  return totals;
}

// Builds the "Average Total Damage" line for the automatic-hits
// result: the total across however many hits are landing, plus the
// average damage of a SINGLE hit as an "X per hit" figure (shown in
// gold) — this is just the raw per-hit dice average, independent of
// how many hits actually landed. Returns '' if there's no damage
// entered. When more than one damage type is in play, each type's own
// subtotal is broken out afterward in its own color. Whole-number
// totals are shown without a trailing ".0".
function buildAverageDamageHtml(groups, hitsCount) {
  if (groups.length === 0) return '';

  const perHit = averageDamagePerHitByType(groups);
  const types = Object.keys(perHit);
  const totalsByType = {};
  types.forEach((key) => {
    totalsByType[key] = perHit[key] * hitsCount;
  });
  const overallTotal = types.reduce((sum, key) => sum + totalsByType[key], 0);
  const perHitTotal = types.reduce((sum, key) => sum + perHit[key], 0);
  const perHitHtml = `<span class="per-attack-value">${perHitTotal.toFixed(1)}</span> per hit`;

  if (types.length === 1) {
    const cls = damageTypeClass(types[0]);
    return `<br>Average Total Damage: <strong class="${cls}">${formatDamageNumber(overallTotal)}</strong> (${perHitHtml})`;
  }

  const parts = types.map((key) => {
    const cls = damageTypeClass(key);
    const label = key ? capitalizeWord(key) : 'Untyped';
    return `<span class="${cls}">${label}: <strong class="${cls}">${formatDamageNumber(totalsByType[key])}</strong></span>`;
  });
  return `<br>Average Total Damage: <strong>${formatDamageNumber(overallTotal)}</strong> (${perHitHtml}) — ${parts.join(', ')}`;
}

// Rolls the damage for a single hit, doubling the number of dice
// (not the modifier) when isCrit is true. Returns { typeKey: value }
// for that one hit.
function rollDamageForHit(groups, isCrit) {
  const totals = {};
  groups.forEach((g) => {
    let diceSum = 0;
    if (g.count > 0) {
      const diceCount = isCrit ? g.count * 2 : g.count;
      for (let i = 0; i < diceCount; i++) {
        diceSum += rollDie(g.sides);
      }
    }
    const key = g.type || '';
    totals[key] = (totals[key] || 0) + diceSum + g.modifier;
  });
  return totals;
}

// Builds the "Damage" line for the rolled-attacks result from the
// per-hit values collected while rolling (see rollMobAttacks below).
// perTypeValues looks like { '': [{value,isCrit}], fire: [{value,isCrit}] }
// — one entry per hit that dealt that type of damage, in the order the
// hits happened. Any value that came from a critical hit is shown
// larger and bolder (but keeps its damage-type color) so it's easy to
// spot at a glance. Returns '' if there's no damage entered at all.
function buildRolledDamageHtml(groups, perTypeValues) {
  if (groups.length === 0) return '';

  const types = Object.keys(perTypeValues);
  if (types.length === 0) {
    return '<br>Damage: <strong>0</strong>';
  }

  const parts = types.map((key) => {
    const entries = perTypeValues[key];
    const total = entries.reduce((sum, entry) => sum + entry.value, 0);
    const cls = damageTypeClass(key);
    const label = key ? capitalizeWord(key) + ': ' : '';
    const valuesHtml = entries
      .map((entry) => (entry.isCrit ? `<span class="dmg-crit-value">${entry.value}</span>` : `${entry.value}`))
      .join(', ');
    return `<span class="${cls}">${label}<strong class="${cls}">${total}</strong> [${valuesHtml}]</span>`;
  });

  if (types.length === 1) {
    return `<br>Damage: ${parts[0]}`;
  }

  const overallTotal = types.reduce((sum, key) => sum + perTypeValues[key].reduce((s, entry) => s + entry.value, 0), 0);
  return `<br>Damage: <strong>${overallTotal}</strong> (${parts.join(', ')})`;
}

// Builds the per-attack breakdown, one line per attack that hit, e.g.:
// A1: 7 [3, 4]
// A2(crit): 14 [5, 9]
// Numbered in the order the attacks happened. Each attack's label
// ("A1", "A2(crit)") is bold, gold, and underlined; its total damage
// number is bold and gold too; each number inside the brackets keeps
// its own damage-type color (but no longer spells out the type name).
// Returns '' if there's no damage entered, or nothing hit.
function buildPerAttackDamageHtml(groups, hitAttacks) {
  if (groups.length === 0 || hitAttacks.length === 0) return '';

  const lines = hitAttacks.map((hit, index) => {
    const label = `A${index + 1}${hit.isCrit ? '(crit)' : ''}`;
    const typeKeys = Object.keys(hit.damageByType);

    const piecesHtml = typeKeys
      .map((key) => {
        const cls = damageTypeClass(key);
        return `<span class="${cls}">${hit.damageByType[key]}</span>`;
      })
      .join(', ');

    return `<strong class="per-attack-label">${label}</strong>: <strong>${hit.total}</strong> [${piecesHtml}]`;
  });

  return lines.map((line) => `<br>${line}`).join('');
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
// against a worked example, but couldn't 100% confirm the book's exact
// rounding rule against every case. This rounds to the nearest whole
// number, and rounds exactly-.5 ties down — the exact "expected hits"
// number is also shown so you can round it yourself at the table if
// your copy of the DMG handles it differently.

// Rounds to the nearest whole number, except an exact .5 rounds down
// instead of up (unlike Math.round, which always rounds .5 up).
function roundHitsToNearest(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  return fraction > 0.5 ? floor + 1 : floor;
}

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

  save(); // remember the mob calculator's current inputs so a refresh doesn't lose them

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
  const hits = roundHitsToNearest(expected);

  const dmgInput = document.getElementById('mobDmgInput');
  const damageGroups = parseDamageInput(dmgInput ? dmgInput.value : '');
  const damageHtml = buildAverageDamageHtml(damageGroups, hits);

  resultEl.innerHTML = `<strong>${hits}</strong> automatic hits out of ${attacks} &nbsp;<em>(expected ${expected.toFixed(1)} hits)</em>${damageHtml}`;
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

  const dmgInput = document.getElementById('mobDmgInput');
  const damageGroups = parseDamageInput(dmgInput ? dmgInput.value : '');
  const perTypeDamageValues = {}; // type key -> array of { value, isCrit }, one per hit dealing that type
  const hitAttacks = []; // one entry per hit, in the order it happened: { isCrit, damageByType, total }

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

    if (isHit) {
      hitCount += 1;
      const isCrit = die === 20;

      if (damageGroups.length > 0) {
        const hitDamage = rollDamageForHit(damageGroups, isCrit);
        let total = 0;
        Object.keys(hitDamage).forEach((key) => {
          if (!perTypeDamageValues[key]) perTypeDamageValues[key] = [];
          perTypeDamageValues[key].push({ value: hitDamage[key], isCrit: isCrit });
          total += hitDamage[key];
        });
        hitAttacks.push({ isCrit: isCrit, damageByType: hitDamage, total: total });
      } else {
        hitAttacks.push({ isCrit: isCrit, damageByType: {}, total: 0 });
      }
    }

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

  const damageHtml = buildRolledDamageHtml(damageGroups, perTypeDamageValues);
  const perAttackHtml = buildPerAttackDamageHtml(damageGroups, hitAttacks);

  resultEl.innerHTML = `${summary} [${rollsHtml.join(', ')}]${damageHtml}${perAttackHtml}`;
}

// Resets the whole mob attack calculator back to a blank state, after
// confirmation.
async function clearMobCalculator() {
  const confirmed = await confirmAction('Clear the mob attack calculator?');
  if (!confirmed) return;
  document.getElementById('mobAttacksInput').value = '';
  document.getElementById('mobBonusInput').value = '';
  document.getElementById('mobACInput').value = '';
  document.getElementById('mobDmgInput').value = '';
  document.getElementById('mobAdvCheck').checked = false;
  document.getElementById('mobDisCheck').checked = false;
  document.getElementById('mobAutoResult').innerHTML = '';
  document.getElementById('mobRollResult').innerHTML = '';
  save();
}

// ---- GLOSSARY / RULES CROSS-REFERENCES ----
// Anywhere on the page, an important rules term can be a gold clickable
// link (class "gloss-ref", with data-ref="targetId") pointing at a
// <details> element elsewhere on the page — a Rules Glossary entry, a
// Condition, or a whole reference dropdown like Conditions or Jumping.
// Clicking one opens that target AND every dropdown it's nested inside
// (so a glossary entry buried inside the collapsed Rules Glossary
// dropdown still opens correctly), scrolls it into view, and briefly
// flashes it gold so it's easy to spot.
function openReference(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;

  // Open the target itself (if it's a dropdown/entry) plus every
  // <details> ancestor it's nested inside, top-down. Also un-hide it
  // from the search filter (if one is active) so a followed link
  // always reveals its destination, even if the destination didn't
  // match whatever's currently typed in the search box.
  let el = target;
  while (el) {
    if (el.tagName === 'DETAILS') {
      el.open = true;
      el.classList.remove('search-hidden');
    }
    el = el.parentElement;
  }

  // Remember this newly opened state so a page refresh keeps it —
  // but only when there's no active search filter, since a
  // search-driven reveal shouldn't overwrite the saved base layout.
  if (!referenceSearchActive) {
    saveReferenceState();
  }

  // Give the browser a moment to lay out the newly opened content
  // before scrolling, so it lands in the right place.
  requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('reference-flash');
    setTimeout(() => target.classList.remove('reference-flash'), 1500);
  });
}

// ---- REFERENCE PANE STATE (which dropdowns are open) ----
// Saved to sessionStorage rather than localStorage, so refreshing the
// page keeps whatever was open/closed, but closing the browser tab
// starts fresh again next time — matching how the pane behaved before
// this feature existed.

const REFERENCE_STORAGE_KEY = 'dmScreenReferenceState';
// IDs of the dropdowns that are open by default (a brand-new visit,
// or after pressing the Reference pane's Reset button).
const REFERENCE_DEFAULT_OPEN_IDS = ['dropSkills', 'dropCreatureTypes', 'dropCover', 'dropObscured'];

function getAllReferenceDetails() {
  return Array.from(document.querySelectorAll('.lookup-panel details'));
}

function saveReferenceState() {
  const state = {};
  getAllReferenceDetails().forEach((el) => {
    state[el.id] = el.open;
  });
  try {
    sessionStorage.setItem(REFERENCE_STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Could not save reference pane state:', err);
  }
}

function loadReferenceState() {
  try {
    const raw = sessionStorage.getItem(REFERENCE_STORAGE_KEY);
    if (!raw) return; // nothing saved this browser session — keep the HTML's defaults
    const state = JSON.parse(raw);
    getAllReferenceDetails().forEach((el) => {
      if (Object.prototype.hasOwnProperty.call(state, el.id)) {
        el.open = state[el.id];
      }
    });
  } catch (err) {
    console.warn('Could not load saved reference pane state:', err);
  }
}

function applyReferenceDefaults() {
  referenceSearchActive = false;
  const searchInput = document.getElementById('referenceSearchInput');
  if (searchInput) searchInput.value = '';
  clearReferenceHighlights();
  getAllReferenceDetails().forEach((el) => {
    el.classList.remove('search-hidden');
    el.open = REFERENCE_DEFAULT_OPEN_IDS.includes(el.id);
  });
  saveReferenceState();
}

// Resets the Reference pane back to its default open/closed state
// (and clears any active search), after confirmation.
async function resetReferencePane() {
  const confirmed = await confirmAction('Reset the Reference panel back to its default state?');
  if (!confirmed) return;
  applyReferenceDefaults();
}

// ---- REFERENCE PANE SEARCH ----
// Filters every dropdown in the Reference panel live as the DM types.
// True while the search box holds a query, so dropdown toggles and
// gloss-ref link opens don't overwrite the saved pre-search state.
let referenceSearchActive = false;

// Splits a search query into lowercase terms. A "double-quoted"
// chunk is kept together as one exact phrase; anything else is split
// on whitespace into separate terms. A dropdown must contain EVERY
// term somewhere in its own text (summary + body, including anything
// nested inside it) to match — the terms can appear in any order, and
// partial words count (e.g. "cov" matches "Cover").
function parseReferenceSearchTerms(query) {
  const terms = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(query)) !== null) {
    const term = (match[1] !== undefined ? match[1] : match[2]).trim().toLowerCase();
    if (term) terms.push(term);
  }
  return terms;
}

// Collects the text that "belongs" directly to a dropdown — its
// summary plus any of its own paragraphs/lists — WITHOUT pulling in
// text from any dropdown nested inside it. This is what stops a huge
// container like "Lore" (which nests dozens of unrelated entries)
// from falsely matching a search just because the search terms
// happen to appear somewhere, in totally unrelated entries, within
// its enormous combined nested text.
function collectOwnReferenceText(el) {
  let text = '';
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.nodeValue;
    } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'DETAILS') {
      text += collectOwnReferenceText(child);
    }
  });
  return text;
}

// Escapes regex special characters in a string so it can be dropped
// into a `new RegExp(...)` pattern literally.
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reads the Partial word / Whole word dropdown next to the search
// box. Defaults to 'partial' if the element isn't found for some
// reason.
function getReferenceSearchMode() {
  const select = document.getElementById('referenceSearchMode');
  return select && select.value === 'whole' ? 'whole' : 'partial';
}

// Checks whether "term" appears in "text" — as a plain substring in
// Partial word mode (the original behavior), or as a whole word only
// (bounded by word breaks on both sides) in Whole word mode.
function textContainsTerm(text, term, wholeWord) {
  if (!wholeWord) return text.includes(term);
  const pattern = new RegExp('\\b' + escapeRegex(term) + '\\b', 'i');
  return pattern.test(text);
}

// Removes any <mark class="search-highlight"> wrappers left over
// from a previous search, merging the plain text back together.
function clearReferenceHighlights() {
  document.querySelectorAll('.lookup-panel mark.search-highlight').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
}

// Wraps every visible occurrence of any search term in a
// <mark class="search-highlight">, so the DM can immediately see WHY
// a dropdown matched. Only text inside currently-visible (non
// search-hidden) dropdowns is touched.
function highlightReferenceMatches(terms, wholeWord) {
  if (terms.length === 0) return;
  const panel = document.querySelector('.lookup-panel');
  if (!panel) return;

  const escaped = terms.map((term) => escapeRegex(term));
  const pattern = wholeWord
    ? new RegExp('\\b(' + escaped.join('|') + ')\\b', 'gi')
    : new RegExp('(' + escaped.join('|') + ')', 'gi');

  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parentEl = node.parentElement;
      if (!parentEl) return NodeFilter.FILTER_REJECT;
      if (parentEl.closest('.search-hidden')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue;
    pattern.lastIndex = 0;
    if (!pattern.test(text)) return;
    pattern.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = match[0];
      frag.appendChild(mark);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode.replaceChild(frag, textNode);
  });
}

// Re-filters the Reference panel for the current search box value.
// Each dropdown is judged in two passes: first, does its OWN text
// (excluding anything nested inside a further dropdown) contain every
// search term? Second, a dropdown is shown either because it matched
// itself, or because a dropdown nested inside it (at any depth)
// matched — so matching entries stay reachable through their parent
// sections without those parents falsely matching on their own.
// Clearing the box removes the filter and restores whatever was
// open/closed before the search started.
function performReferenceSearch(rawQuery) {
  const allDetails = getAllReferenceDetails();
  const terms = parseReferenceSearchTerms(rawQuery);
  const wholeWord = getReferenceSearchMode() === 'whole';

  clearReferenceHighlights();

  if (terms.length === 0) {
    referenceSearchActive = false;
    allDetails.forEach((el) => el.classList.remove('search-hidden'));
    loadReferenceState();
    return;
  }

  referenceSearchActive = true;

  const ownMatches = new Map();
  allDetails.forEach((el) => {
    const text = collectOwnReferenceText(el).toLowerCase();
    ownMatches.set(el, terms.every((term) => textContainsTerm(text, term, wholeWord)));
  });

  allDetails.forEach((el) => {
    let show = ownMatches.get(el);
    if (!show) {
      show = Array.from(el.querySelectorAll('details')).some((child) => ownMatches.get(child));
    }
    el.classList.toggle('search-hidden', !show);
    if (show) {
      el.open = true;
    }
  });

  highlightReferenceMatches(terms, wholeWord);
}

// ---- DATA-DRIVEN REFERENCE SECTIONS (Lore, Spells) ----
// The Lore and Spells dropdowns are too big to hand-edit as raw HTML,
// so their content lives in separate files (lore-data.js,
// spells-data.js) as plain data — just { id, title, html, children }
// objects — with index.html only holding an empty container for each
// one (id="loreContainer" / id="spellsContainer"). This turns that
// data into the exact same nested <details class="condition-dropdown">
// markup that used to be hand-written in index.html, so every other
// part of the app (search, gloss-ref links, open/close memory) keeps
// working exactly as before without knowing the difference.

// Turns one data entry into a <details class="condition-dropdown">
// block, recursing into "children" (if present) as a nested
// .condition-list — the same nesting pattern Conditions/Rules Glossary
// already use elsewhere in the page.
function buildReferenceEntryHtml(entry) {
  let inner = entry.html || '';
  if (entry.children && entry.children.length) {
    inner += '<div class="condition-list nested-list">' +
      entry.children.map(buildReferenceEntryHtml).join('') +
      '</div>';
  }
  return '<details class="condition-dropdown" id="' + entry.id + '">' +
    '<summary>' + entry.title + '</summary>' +
    '<div class="condition-body">' + inner + '</div>' +
    '</details>';
}

// Fills a container (e.g. #loreContainer) with the full dropdown tree
// built from a data file's { intro, entries } object.
function renderReferenceDataSection(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container || !data) return;
  const entriesHtml = data.entries.map(buildReferenceEntryHtml).join('');
  container.innerHTML = (data.intro || '') + '<div class="condition-list">' + entriesHtml + '</div>';
}

// Called once, right at the start of page load — before anything else
// touches the Reference pane (saved open/closed state, search, etc.),
// since those all work by scanning whatever <details> already exist
// in the page.
function renderDataDrivenReferenceSections() {
  if (typeof LORE_DATA !== 'undefined') renderReferenceDataSection('loreContainer', LORE_DATA);
  if (typeof SPELLS_DATA !== 'undefined') renderReferenceDataSection('spellsContainer', SPELLS_DATA);
}

// ---- NPC REACTIONS ----

// Rolls 2d6 and returns the sum.
function roll2d6() {
  return rollDie(6) + rollDie(6);
}

// Rolls the full monster-reaction chain and returns the finished
// result string, using an arrow (→) between each step.
//
// startingAttitude lets the DM pin down the FIRST roll instead of
// leaving it random: 'hostile' forces a roll in the 3-5 range,
// 'uncertain' forces 6-8, 'friendly' forces 9-11 — matching the three
// middle bands of the normal 2d6 table. Leaving it unset (or any other
// value) rolls the first 2d6 completely at random as before, which
// also leaves the two extreme results (Immediate Attack / Immediate
// Friendly) in play.
function rollMonsterReactionResult(startingAttitude) {
  let first;
  if (startingAttitude === 'hostile') {
    first = 3 + Math.floor(Math.random() * 3); // 3, 4, or 5
  } else if (startingAttitude === 'uncertain') {
    first = 6 + Math.floor(Math.random() * 3); // 6, 7, or 8
  } else if (startingAttitude === 'friendly') {
    first = 9 + Math.floor(Math.random() * 3); // 9, 10, or 11
  } else {
    first = roll2d6();
  }

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
  const select = document.getElementById('monsterReactionAttitude');
  const startingAttitude = select ? select.value : '';
  const result = rollMonsterReactionResult(startingAttitude);
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

  // --- Reach while jumping: the height of the jump itself, plus
  //     1.5x your own height — straight from the High Jump rule
  //     ("you can reach a distance equal to the height of the jump
  //     plus 1½ times your height"). ---
  const heightFeet = getJumpHeightFeetDecimal();

  const runReachVal = runningHigh + heightFeet * 1.5;
  const standReachVal = standingHigh + heightFeet * 1.5;

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
  renderDataDrivenReferenceSections();
  load();
  render();
  renderRound();
  renderTimeControls();
  toggleJumpDexVisibility();
  computeJump();

  // Restore the Reference pane's open/closed dropdowns from this
  // browser session (if any), then start tracking further changes so
  // they're remembered across a page refresh.
  loadReferenceState();
  getAllReferenceDetails().forEach((el) => {
    el.addEventListener('toggle', () => {
      if (!referenceSearchActive) saveReferenceState();
    });
  });

  // Reference pane: search box filters the dropdowns live
  const referenceSearchInput = document.getElementById('referenceSearchInput');
  if (referenceSearchInput) {
    referenceSearchInput.addEventListener('input', (e) => {
      performReferenceSearch(e.target.value);
    });
  }

  // Reference pane: Partial word / Whole word dropdown re-runs the
  // current search whenever it's changed.
  const referenceSearchModeSelect = document.getElementById('referenceSearchMode');
  if (referenceSearchModeSelect) {
    referenceSearchModeSelect.addEventListener('change', () => {
      performReferenceSearch(referenceSearchInput ? referenceSearchInput.value : '');
    });
  }

  // Restore the mob attack calculator's inputs from the last session,
  // then recalculate "Automatic hits" so it's visible right away.
  if (savedMobState) {
    document.getElementById('mobAttacksInput').value = savedMobState.attacks || '';
    document.getElementById('mobBonusInput').value = savedMobState.bonus || '';
    document.getElementById('mobACInput').value = savedMobState.ac || '';
    document.getElementById('mobDmgInput').value = savedMobState.dmg || '';
    document.getElementById('mobAdvCheck').checked = !!savedMobState.adv;
    document.getElementById('mobDisCheck').checked = !!savedMobState.dis;
  }
  updateMobAutoResult();

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

  // Round +/- buttons and reset-round button
  document.getElementById('roundUp').addEventListener('click', incrementRound);
  document.getElementById('roundDown').addEventListener('click', decrementRound);
  document.getElementById('resetRoundBtn').addEventListener('click', resetRound);

  // Time tracker: starting time field
  document.getElementById('startTimeInput').addEventListener('focusout', (e) => commitStartTimeInput(e.target));
  document.getElementById('startTimeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });

  // Time tracker: current time field (typing a time directly recalculates duration)
  document.getElementById('currentTimeInput').addEventListener('focusout', (e) => commitCurrentTimeInput(e.target));
  document.getElementById('currentTimeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });

  // Time tracker: duration fields (typing a number directly)
  document.getElementById('durHoursInput').addEventListener('focusout', commitDurationInputs);
  document.getElementById('durMinutesInput').addEventListener('focusout', commitDurationInputs);
  document.getElementById('durHoursInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });
  document.getElementById('durMinutesInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });

  // Time tracker: duration +/- buttons (hours by 1, minutes by 10)
  document.getElementById('durHoursUp').addEventListener('click', () => adjustDurationHours(1));
  document.getElementById('durHoursDown').addEventListener('click', () => adjustDurationHours(-1));
  document.getElementById('durMinutesUp').addEventListener('click', () => adjustDurationMinutes(10));
  document.getElementById('durMinutesDown').addEventListener('click', () => adjustDurationMinutes(-10));

  // Time tracker: "Next day" (no confirmation) and "Reset" (with confirmation) buttons
  document.getElementById('nextDayBtn').addEventListener('click', resetTime);
  document.getElementById('resetTimeAllBtn').addEventListener('click', resetTimeAll);

  // Bottom control bar
  document.getElementById('swapBtn').addEventListener('click', swapSelected);
  document.getElementById('undoBtn').addEventListener('click', undoLast);
  document.getElementById('copyBtn').addEventListener('click', copyList);
  document.getElementById('clearBtn').addEventListener('click', clearAll);

  // Anywhere on the page: clicking a gold rules-term link (e.g.
  // "AC" inside Cover, "Incapacitated" inside Stunned, or "Conditions
  // dropdown" inside a glossary entry) opens every dropdown it's
  // nested inside, then scrolls to and flashes the target.
  document.addEventListener('click', (e) => {
    const ref = e.target.closest('.gloss-ref');
    if (!ref) return;
    e.preventDefault();
    openReference(ref.dataset.ref);
  });

  // Reference pane: Reset button
  document.getElementById('resetReferenceBtn').addEventListener('click', resetReferencePane);

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
  document.getElementById('mobDmgInput').addEventListener('input', updateMobAutoResult);

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

  // Scroll-to-top button: only visible once the top of the page has
  // scrolled out of view, and scrolls smoothly back to the top on click.
  const scrollTopBtn = document.getElementById('scrollTopBtn');
  if (scrollTopBtn) {
    const toggleScrollTopBtn = () => {
      scrollTopBtn.classList.toggle('visible', window.scrollY > 200);
    };
    toggleScrollTopBtn();
    window.addEventListener('scroll', toggleScrollTopBtn);
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
});
