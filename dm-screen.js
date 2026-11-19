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
let playerProfiles = {};    // remembered AC/HP of manually added combatants, by lowercase name: { gronja: { ac: 17, hp: 45 } }
let undoStack = [];          // snapshots of "combatants" taken right before each change

// Time-tracking state: when the day started, and how long the party
// has been adventuring since then. "Current time" is never stored
// directly — it's always recalculated from these two.
let timeState = {
  startTime: '8:00 AM',
  durHours: 0,
  durMinutes: 0
};

// Date-tracking state: an in-world calendar date sitting next to the
// time tracker. Kept completely separate from timeState so the two
// can be reset independently if that's ever needed.
let dateState = {
  year: 1,
  month: 1,
  day: 1
};

const STORAGE_KEY = 'dmScreenInitiativeState';
const UNDO_LIMIT = 50; // how many past states the Undo button can step back through

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ combatants, round, mob, time: timeState, date: dateState, players: playerProfiles })
  );
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      combatants = data.combatants || [];
      round = typeof data.round === 'number' ? data.round : 1;
      savedMobState = data.mob || null;
      playerProfiles = data.players && typeof data.players === 'object' ? data.players : {};
      if (data.time) {
        timeState = {
          startTime: typeof data.time.startTime === 'string' ? data.time.startTime : '8:00 AM',
          durHours: typeof data.time.durHours === 'number' ? data.time.durHours : 0,
          durMinutes: typeof data.time.durMinutes === 'number' ? data.time.durMinutes : 0
        };
      }
      if (data.date) {
        dateState = {
          year: typeof data.date.year === 'number' ? data.date.year : 1,
          month: typeof data.date.month === 'number' ? data.date.month : 1,
          day: typeof data.date.day === 'number' ? data.date.day : 1
        };
      }
    }
  } catch (err) {
    console.warn('Could not load saved initiative data:', err);
  }
}

// ---- HELPERS ----

// "extra" is only given for monsters added from a stat block:
// { statBlockId, ac, hp }. Anyone else (a player) gets whatever AC and HP
// were remembered for that name.
function makeCombatant(name, initiative, extra) {
  idCounter += 1;
  const combatant = {
    id: 'c-' + Date.now() + '-' + idCounter,
    name: name,
    initiative: initiative,
    isHidden: false,
    ac: null,
    hp: null
  };
  if (extra && extra.statBlockId) {
    combatant.statBlockId = extra.statBlockId;
    combatant.ac = typeof extra.ac === 'number' ? extra.ac : null;
    combatant.hp = typeof extra.hp === 'number' ? extra.hp : null;
  } else {
    const profile = playerProfiles[String(name).trim().toLowerCase()];
    if (profile) {
      if (typeof profile.ac === 'number') combatant.ac = profile.ac;
      if (typeof profile.hp === 'number') combatant.hp = profile.hp;
    }
  }
  return combatant;
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
      <input class="row-stat row-ac" type="number" value="${statFieldValue(c.ac)}" data-id="${c.id}" data-field="ac" placeholder="AC" aria-label="AC" />
      <input class="row-stat row-hp" type="number" value="${statFieldValue(c.hp)}" data-id="${c.id}" data-field="hp" placeholder="HP" aria-label="HP" />
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

  const trackerHead = document.getElementById('trackerHead');
  if (trackerHead) trackerHead.classList.toggle('hidden', sorted.length === 0);
  renderCombatStatBlocks();

  save();
  updateScrollNav();
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
      // Two are already selected: the one that was selected first is dropped.
      selectedIds.delete(selectedIds.values().next().value);
    }
    selectedIds.add(id);
  }
  render();
}

// "Next combatant" button: selects the next combatant in the turn order.
// Nothing selected -> the combatant at the top of the list. One selected ->
// the one below it. Two selected -> the lower of the two counts as the
// current combatant, and both are unselected. Pressing it while the combatant
// at the very bottom is the current one goes back to the top of the list and
// adds one to the round counter.
function selectNextCombatant() {
  const sorted = sortedCombatants();
  if (sorted.length === 0) {
    showToast('There are no combatants yet');
    return;
  }

  let currentIndex = -1;
  sorted.forEach((c, i) => {
    if (selectedIds.has(c.id)) currentIndex = i; // the lowest selected one
  });

  let nextIndex = currentIndex + 1;
  let wrapped = false;
  if (nextIndex >= sorted.length) {
    nextIndex = 0;
    wrapped = currentIndex !== -1;
  }

  selectedIds = new Set([sorted[nextIndex].id]);
  resetReactionBoxes(sorted[nextIndex]);
  if (wrapped) incrementRound();
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
  if (newName === originalName) {
    input.value = originalName; // nothing changed: leave the list alone so Tab keeps working
    return;
  }
  if (!newName) {
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
  if (!isNaN(newIni) && newIni === combatant.initiative) {
    input.value = newIni; // nothing changed: leave the list alone so Tab keeps working
    return;
  }
  if (!isNaN(newIni) && newIni !== combatant.initiative) {
    pushUndoSnapshot();
    combatant.initiative = newIni;
  }
  render();
}

// ---- TOAST (the little confirmation message at the bottom) ----

let toastTimeout;
function showToast(message, duration) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), duration || 2400);
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

// How many lines below an "Initiative: roll" line the parser will look
// for that roll's total. The search ALSO stops at the next "Initiative:
// roll" line, so one roll can never pick up a number that belongs to
// the next person's roll. (This used to be a fixed 3 lines, which was
// too short whenever a roll's entry had extra lines in it — for example
// an advantage/disadvantage roll — and the roll was then dropped
// without any message.)
const MAX_ROLL_LINES_AHEAD = 12;

// Reads the whole pasted block. Returns { entries, skipped }:
//   entries - the list of { name, initiative } that could be read
//   skipped - one name per "Initiative: roll" line that was found but
//             could not be read (no name above it, or no total below
//             it), so the caller can tell you instead of silently
//             ignoring it.
function parseDump(text) {
  const rawLines = text.split('\n').map((l) => l.trim());
  // Drop blank lines and lines that are nothing but a lone bullet
  // marker (D&D Beyond sometimes pastes these as their own line).
  const lines = rawLines.filter((l) => l !== '' && !/^[*\-•]$/.test(l));

  const entries = [];
  const skipped = [];
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

      // This roll's own lines end where the next "Initiative: roll"
      // line begins (or at the end of the pasted text).
      let blockEnd = lines.length;
      for (let next = i + 1; next < lines.length; next++) {
        if (INITIATIVE_LINE.test(lines[next])) {
          blockEnd = next;
          break;
        }
      }
      const searchEnd = Math.min(blockEnd, i + MAX_ROLL_LINES_AHEAD + 1);

      // Look ahead (within this roll's own lines) for the roll result.
      let initiative = null;
      let numberLineIndex = -1;
      for (let fwd = i + 1; fwd < searchEnd; fwd++) {
        if (PURE_NUMBER_LINE.test(lines[fwd])) {
          initiative = parseFloat(lines[fwd]);
          numberLineIndex = fwd;
          break;
        }
      }

      if (name && initiative !== null) {
        entries.push({ name: name, initiative: initiative });
      } else {
        skipped.push(name || '(no name found)');
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

  return { entries: entries, skipped: skipped };
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

// How many whole days the Current time is past the Starting time's own
// day: 0 = still the same day, 1 = past midnight, 2 = past the next
// midnight, and so on. Only the DIFFERENCE between two of these values
// matters (see followClockWithDate below).
function currentDayOffset() {
  const startMinutes = parseTimeToMinutes(timeState.startTime);
  const base = startMinutes === null ? 0 : startMinutes;
  return Math.floor((base + timeState.durHours * 60 + timeState.durMinutes) / 1440);
}

// Called after Duration adventured has been changed. Moves the Date
// tracker forward (or back, if the duration was reduced again) by
// however many midnights the Current time has passed since
// "offsetBefore" (a value taken from currentDayOffset() BEFORE the
// change was made). Does nothing if no midnight was crossed.
function followClockWithDate(offsetBefore) {
  const change = currentDayOffset() - offsetBefore;
  if (change !== 0) {
    incrementDateDay(change);
    renderDateControls();
  }
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
  const offsetBefore = currentDayOffset();

  let diff = parsed - base;
  if (diff < 0) diff += 1440;

  timeState.durHours = Math.floor(diff / 60);
  timeState.durMinutes = diff % 60;

  renderTimeControls();
  followClockWithDate(offsetBefore);
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
  const offsetBefore = currentDayOffset();

  timeState.durHours = isNaN(hoursVal) ? 0 : hoursVal;
  timeState.durMinutes = isNaN(minutesVal) ? 0 : minutesVal;
  normalizeDuration();
  renderTimeControls();
  followClockWithDate(offsetBefore);
  save();
}

// Duration +/- buttons: hours step by 1, minutes step by 10.
function adjustDurationHours(delta) {
  const offsetBefore = currentDayOffset();
  timeState.durHours += delta;
  normalizeDuration();
  renderTimeControls();
  followClockWithDate(offsetBefore);
  save();
}

function adjustDurationMinutes(delta) {
  const offsetBefore = currentDayOffset();
  timeState.durMinutes += delta;
  normalizeDuration();
  renderTimeControls();
  followClockWithDate(offsetBefore);
  save();
}

// "Next day" button: after confirmation, sets the Starting time to
// 8:00 AM, resets the adventuring clock back to 0h 0m, and advances the
// Date tracker by one day (with rollover into the next month/year).
async function resetTime() {
  const confirmed = await confirmAction('Do you want to skip to 8AM the next day?');
  if (!confirmed) return;
  timeState.startTime = '8:00 AM';
  timeState.durHours = 0;
  timeState.durMinutes = 0;
  incrementDateDay(1);
  renderTimeControls();
  renderDateControls();
  save();
}

// "Sleep" button: after confirmation, moves the Starting time to 8
// hours after the CURRENT time (Starting time + Duration adventured),
// then sets Duration adventured back to 0h 0m. If those 8 hours of
// sleep pass midnight (including landing exactly on 12:00 AM), the Date
// tracker also advances by one day, rolling into the next month/year
// when needed.
async function sleepTime() {
  const confirmed = await confirmAction('Do you want to sleep for 8 hours?');
  if (!confirmed) return;
  const startMinutes = parseTimeToMinutes(timeState.startTime);
  const base = startMinutes === null ? 0 : startMinutes;
  // Current time of day, in minutes since midnight (0-1439).
  const currentMinutes = (((base + timeState.durHours * 60 + timeState.durMinutes) % 1440) + 1440) % 1440;
  const wakeMinutes = currentMinutes + 8 * 60; // 1440 or more means the sleep passed midnight
  if (wakeMinutes >= 1440) incrementDateDay(1);
  timeState.startTime = formatMinutesToTimeString(wakeMinutes);
  timeState.durHours = 0;
  timeState.durMinutes = 0;
  renderTimeControls();
  renderDateControls();
  save();
}

// ---- DATE TRACKER ----
// A small in-world calendar sitting to the left of Starting time:
// Year (any integer) / Month (1-12) / Day (limited to however many
// days that month has, factoring in leap years for February).

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

// Number of days in a given month (1-12) of a given year.
function daysInMonthFor(year, month) {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const safeMonth = Math.min(12, Math.max(1, month));
  return lengths[safeMonth - 1];
}

// Pulls the day back within range for whatever month/year it's
// currently sitting in (e.g. day 31 in a month that only has 30).
function clampDateDay() {
  const max = daysInMonthFor(dateState.year, dateState.month);
  if (dateState.day > max) dateState.day = max;
  if (dateState.day < 1) dateState.day = 1;
}

// Steps the day forward/back by "step" days, rolling over into the
// next/previous month (and year) as many times as needed.
function incrementDateDay(step) {
  const amount = step || 1;
  if (amount > 0) {
    for (let i = 0; i < amount; i++) {
      const max = daysInMonthFor(dateState.year, dateState.month);
      if (dateState.day < max) {
        dateState.day += 1;
      } else {
        dateState.day = 1;
        dateState.month += 1;
        if (dateState.month > 12) {
          dateState.month = 1;
          dateState.year += 1;
        }
      }
    }
  } else {
    for (let i = 0; i < -amount; i++) {
      if (dateState.day > 1) {
        dateState.day -= 1;
      } else {
        dateState.month -= 1;
        if (dateState.month < 1) {
          dateState.month = 12;
          dateState.year -= 1;
        }
        dateState.day = daysInMonthFor(dateState.year, dateState.month);
      }
    }
  }
}

// Steps the month forward/back by "step" months, rolling the year
// over as needed, then clamps the day to fit the new month.
function adjustDateMonth(step) {
  dateState.month += step;
  while (dateState.month > 12) {
    dateState.month -= 12;
    dateState.year += 1;
  }
  while (dateState.month < 1) {
    dateState.month += 12;
    dateState.year -= 1;
  }
  clampDateDay();
}

// Steps the year forward/back by "step" years, then clamps the day
// (matters only for Feb 29 moving into/out of a leap year).
function adjustDateYear(step) {
  dateState.year += step;
  clampDateDay();
}

function renderDateControls() {
  document.getElementById('dateYearInput').value = dateState.year;
  document.getElementById('dateMonthInput').value = MONTH_NAMES[dateState.month - 1];
  document.getElementById('dateDayInput').value = dateState.day;
}

function commitDateYearInput() {
  const input = document.getElementById('dateYearInput');
  const val = parseInt(input.value, 10);
  dateState.year = isNaN(val) ? dateState.year : val;
  clampDateDay();
  renderDateControls();
  save();
}

function commitDateDayInput() {
  const input = document.getElementById('dateDayInput');
  let val = parseInt(input.value, 10);
  if (isNaN(val)) val = dateState.day;
  const max = daysInMonthFor(dateState.year, dateState.month);
  val = Math.max(1, Math.min(max, val));
  dateState.day = val;
  renderDateControls();
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

// ---- DATA-DRIVEN REFERENCE SECTIONS ----
// Lore, Spells, Conditions, the Rules Glossary, Classes, Feats, and
// most of the new "Rules" dropdown are all too large (or, for Rules,
// too numerous) to hand-write in index.html, so their content lives
// as plain data (see lore-data.js / spells-data.js / conditions-data.js
// / rules-glossary-data.js / classes-data.js / feats-data.js /
// rules-data.js / items-data.js / magic-items-data.js / monsters-data.js) in the shape
// { intro: "<p>...</p>", entries: [ { id, title, html, children? },
// ... ] }, where "children" (if present) is an array of more entries
// in the same shape, nested as deep as needed. This builds the actual
// <details class="condition-dropdown"> markup from that data, so
// everything downstream (search, gloss-ref links, openReference, the
// per-dropdown search bars, reference pane open/closed state) works
// exactly the same as hand-written HTML.

// Turns one data entry (and any nested children) into its
// <details class="condition-dropdown"> HTML string.
// An entry marked "lazy": true in a data file (every monster) is built as an
// empty dropdown. Its html is kept here and only turned into page elements
// the first time the dropdown is opened (see fillLazyEntry below), so the
// thousands of stat blocks don't slow down the page or the search.
const lazyEntryHtml = new Map();
const lazyEntryText = new Map();
const LAZY_AUTO_OPEN_LIMIT = 12; // a search opens matching lazy entries only when there are this few
let lastHighlight = null;        // the search terms most recently highlighted, so a stat block opened later is highlighted too

function renderDataEntryHtml(entry) {
  if (entry.lazy) {
    lazyEntryHtml.set(entry.id, entry.html || '');
    return (
      '<details class="condition-dropdown" id="' + entry.id + '" data-lazy="1">' +
      '<summary>' + entry.title + '</summary>' +
      '<div class="condition-body"></div>' +
      '</details>'
    );
  }
  const hasChildren = Array.isArray(entry.children) && entry.children.length > 0;
  const bodyHtml = entry.html || '';
  const childrenHtml = hasChildren
    ? '<div class="condition-list">' + entry.children.map(renderDataEntryHtml).join('') + '</div>'
    : '';
  return (
    '<details class="condition-dropdown" id="' + entry.id + '">' +
    '<summary>' + entry.title + '</summary>' +
    '<div class="condition-body">' + bodyHtml + childrenHtml + '</div>' +
    '</details>'
  );
}

// Builds the real contents of a lazy dropdown the first time it is needed.
function fillLazyEntry(el, skipHighlight) {
  if (!el || !el.dataset || el.dataset.lazy !== '1') return;
  el.dataset.lazy = '2';
  const body = el.querySelector(':scope > .condition-body');
  if (!body) return;
  body.innerHTML = lazyEntryHtml.get(el.id) || '';
  enrichStatBlocks(body);
  addSearchBarTo(el);
  if (!skipHighlight && lastHighlight) {
    highlightMatchesWithin(el, lastHighlight.terms, lastHighlight.wholeWord);
  }
}

// The searchable text of a lazy dropdown (its title plus the text of its
// stat block), worked out from the stored html so nothing has to be built.
function lazyOwnText(el) {
  let t = lazyEntryText.get(el.id);
  if (t === undefined) {
    const summary = el.querySelector(':scope > summary');
    const plain = (lazyEntryHtml.get(el.id) || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, '\u00a0')
      .replace(/&mdash;/g, '\u2014')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    t = ((summary ? summary.textContent : '') + plain).toLowerCase();
    lazyEntryText.set(el.id, t);
  }
  return t;
}

// A search that matches only a handful of lazy dropdowns opens them; a search
// that matches hundreds leaves them closed (their names are listed).
function openFewLazyMatches(list) {
  if (list.length === 0 || list.length > LAZY_AUTO_OPEN_LIMIT) return;
  list.forEach((el) => {
    el.open = true;
    fillLazyEntry(el, true);
  });
}

// Renders a whole data object (intro + top-level entries) into the given
// container element id. Does nothing if either the data or the container
// isn't present, so any one of these data files can be added later without
// breaking the others.
function renderDataSection(data, containerId) {
  const container = document.getElementById(containerId);
  if (!container || !data) return;
  let html = '';
  if (data.intro) html += data.intro;
  html += '<div class="condition-list">' + (data.entries || []).map(renderDataEntryHtml).join('') + '</div>';
  container.innerHTML = html;
}

// Inserts a list of data entries into "container" around whatever
// hand-written children it already has (calculator dropdowns with real
// inputs/selects, which can't be plain data), keeping everything in
// alphabetical order by title. Reads each hand-written child's own
// <summary> text (rather than hard-coding their titles) and, for every
// data entry, finds the first hand-written sibling that alphabetically
// follows it, then inserts the entry immediately before that sibling —
// or appends it at the end if every hand-written sibling sorts earlier.
// Because the entries list is already alphabetically sorted and is
// processed in that order, this naturally lands every entry in the
// right slot relative to however many hand-written calculators the
// container happens to contain, without this function needing to know
// their names or how many there are — adding another hand-written
// calculator later only requires placing its <details> in the correct
// alphabetical spot in index.html.
function insertDataEntriesAroundHandWritten(container, entries) {
  if (!container) return;
  const handWrittenChildren = Array.from(container.children);

  (entries || []).forEach((entry) => {
    const title = entry.title.toLowerCase();
    const refChild = handWrittenChildren.find((child) => {
      const summaryEl = child.querySelector(':scope > summary');
      const childTitle = summaryEl ? summaryEl.textContent.trim().toLowerCase() : '';
      return childTitle > title;
    });

    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderDataEntryHtml(entry);
    const newEl = wrapper.firstElementChild;

    if (refChild) {
      container.insertBefore(newEl, refChild);
    } else {
      container.appendChild(newEl);
    }
  });
}

// Renders RULES_DATA.entries (Ability Score Modifiers, Businesses,
// Character Advancement, Cover, Creature Types by Skill, Obscured,
// Skills by Ability, etc.) into the "Rules" dropdown, and
// RULES_DATA.downtimeActivities (Businesses, Craft an Item, etc.) into
// the nested "Downtime Activities" dropdown one level down — each
// using insertDataEntriesAroundHandWritten above, since both
// #rulesContainer and #downtimeActivitiesContainer mix data-driven
// entries with hand-written calculator dropdowns (Carrying &
// Encumbrance and Jumping at the top level; Buy a Magic Item, and
// more to come, inside Downtime Activities).
function renderRulesSection() {
  if (typeof RULES_DATA === 'undefined') return;

  const rulesContainer = document.getElementById('rulesContainer');
  if (rulesContainer && RULES_DATA.intro) {
    rulesContainer.insertAdjacentHTML('afterbegin', RULES_DATA.intro);
  }
  insertDataEntriesAroundHandWritten(rulesContainer, RULES_DATA.entries);

  const downtimeContainer = document.getElementById('downtimeActivitiesContainer');
  insertDataEntriesAroundHandWritten(downtimeContainer, RULES_DATA.downtimeActivities);
}

// Called first thing on page load, before anything else touches the
// Reference pane (saved open/closed state, search indexing, etc.), so the
// dropdowns it builds are already real DOM elements by the time those run.
function renderDataDrivenReferenceSections() {
  renderRulesSection();
  if (typeof RULES_GLOSSARY_DATA !== 'undefined') renderDataSection(RULES_GLOSSARY_DATA, 'glossaryContainer');
  if (typeof CONDITIONS_DATA !== 'undefined') renderDataSection(CONDITIONS_DATA, 'conditionsContainer');
  if (typeof LORE_DATA !== 'undefined') renderDataSection(LORE_DATA, 'loreContainer');
  if (typeof SPELLS_DATA !== 'undefined') renderDataSection(SPELLS_DATA, 'spellsContainer');
  if (typeof CLASSES_DATA !== 'undefined') renderDataSection(CLASSES_DATA, 'classesContainer');
  if (typeof FEATS_DATA !== 'undefined') renderDataSection(FEATS_DATA, 'featsContainer');
  if (typeof ITEMS_DATA !== 'undefined') renderDataSection(ITEMS_DATA, 'itemsContainer');
  // Magic Items isn't its own top-level dropdown -- it's a sibling of
  // Equipment (items-equipment) inside the "Items" dropdown, so instead
  // of rendering into its own container, its single entry is appended
  // right after Equipment inside the same #itemsContainer that
  // renderDataSection(ITEMS_DATA, ...) just built above. MAGIC_ITEMS_DATA
  // is a single {id, title, html, children} entry (not an {intro,
  // entries} wrapper like the other *_DATA objects), so it's rendered
  // directly with renderDataEntryHtml() rather than renderDataSection().
  if (typeof MAGIC_ITEMS_DATA !== 'undefined') {
    const itemsContainer = document.getElementById('itemsContainer');
    const itemsList = itemsContainer ? itemsContainer.querySelector('.condition-list') : null;
    if (itemsList) itemsList.insertAdjacentHTML('beforeend', renderDataEntryHtml(MAGIC_ITEMS_DATA));
  }
  if (typeof MONSTERS_DATA !== 'undefined') renderDataSection(MONSTERS_DATA, 'monstersContainer');
  applyDefaultOpenState();
}

// ---- GLOSSARY / RULES CROSS-REFERENCES ----
// Anywhere on the page, an important rules term can be a gold clickable
// link (class "gloss-ref", with data-ref="targetId") pointing at a
// <details> element elsewhere on the page — a Rules Glossary entry, a
// Condition, or a whole reference dropdown like Conditions or Jumping.
// Clicking one opens that target AND every dropdown it's nested inside
// (so a glossary entry buried inside the collapsed Rules Glossary
// dropdown still opens correctly), scrolls it into view, and briefly
// flashes it gold so it's easy to spot. It also records where you
// jumped FROM, so the "Back" button in the Reference pane's header can
// retrace the whole chain of links one step at a time.
function openAndFlashTarget(target) {
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

  fillLazyEntry(target);
  enrichSpellEntry(target);

  // Remember this newly opened state so a page refresh keeps it —
  // but only when there's no active search filter, since a
  // search-driven reveal shouldn't overwrite the saved base layout.
  if (!referenceSearchActive) {
    saveReferenceState();
  }

  // Give the browser a moment to lay out the newly opened content
  // before scrolling, so it lands in the right place.
  requestAnimationFrame(() => {
    scrollTargetToCenter(target);
    target.classList.add('reference-flash');
    setTimeout(() => target.classList.remove('reference-flash'), 1500);
    updateScrollNav();
  });
}

function openReference(targetId, sourceId) {
  const target = document.getElementById(targetId);
  if (!target) return;

  // A link clicked outside the Reference pane (for example in the Combat
  // pane's stat block) has no source dropdown to return to, so remember
  // which part of the Reference pane was on screen instead.
  const anchor = sourceId ? null : captureReferenceLocation();
  referenceBackStack.push({ scrollY: getReferenceScrollTop(), targetId: sourceId || null, anchor: anchor });
  updateBackButtonVisibility();

  openAndFlashTarget(target);
}

// ---- REFERENCE "BACK" BUTTON ----
// A stack of { scrollY, targetId } entries, one pushed every time a
// gloss-ref link is followed (see openReference above) — targetId is
// the section the link itself was sitting inside AT THE MOMENT it was
// clicked (found by the click handler below via .closest('details')),
// or null if the link wasn't inside any dropdown at all. Pressing Back
// pops the most recent entry: if it has a targetId, that section is
// re-opened, scrolled to, and flashed again exactly like following a
// link does — including the very first link in a chain, since that
// link's enclosing section is captured directly from the DOM rather
// than from a "what was previously opened" variable that starts out
// empty. If there's no targetId (an edge case with no enclosing
// dropdown), it falls back to just scrolling to where the jump
// happened. This retraces the whole chain of jumps one step at a
// time; once the stack is empty the button hides itself again. It
// lives only in memory — it resets on refresh, and is explicitly
// cleared whenever the Reference pane's Reset button is used.

let referenceBackStack = [];

function updateBackButtonVisibility() {
  const btn = document.getElementById('referenceBackBtn');
  if (!btn) return;
  btn.classList.toggle('hidden', referenceBackStack.length === 0);
}

function goBackReference() {
  if (referenceBackStack.length === 0) return;
  const entry = referenceBackStack.pop();
  updateBackButtonVisibility();

  const target = entry.targetId ? document.getElementById(entry.targetId) : null;
  if (target) {
    openAndFlashTarget(target);
  } else {
    if (!restoreReferenceLocation(entry.anchor)) scrollReferenceTo(entry.scrollY);
  }
}

function clearBackChain() {
  referenceBackStack = [];
  updateBackButtonVisibility();
}

// ---- REFERENCE PANE STATE (which dropdowns are open) ----
// Saved to sessionStorage rather than localStorage, so refreshing the
// page keeps whatever was open/closed, but closing the browser tab
// starts fresh again next time — matching how the pane behaved before
// this feature existed.

const REFERENCE_STORAGE_KEY = 'dmScreenReferenceState';
// IDs of the dropdowns that are open by default (a brand-new visit,
// or after pressing the Reference pane's Reset button). Currently
// empty — every dropdown in the Reference pane starts closed. Left as
// a list (rather than removed) so the Reset button, applyDefaultOpenState()
// below, and this mechanism generally are all ready to go if any
// dropdown should default to open again in the future.
const REFERENCE_DEFAULT_OPEN_IDS = [];

function getAllReferenceDetails() {
  return Array.from(document.querySelectorAll('.lookup-panel details'));
}

// Opens every dropdown listed in REFERENCE_DEFAULT_OPEN_IDS (currently
// none, so this is a no-op — see the comment on that constant above).
// Called once right after the data-driven sections are built (see
// renderDataDrivenReferenceSections above), so a brand-new visit
// (nothing saved in sessionStorage yet) shows the same dropdowns open
// as this constant lists — loadReferenceState() further below still
// runs afterward and overrides this with whatever was actually saved.
function applyDefaultOpenState() {
  REFERENCE_DEFAULT_OPEN_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.tagName === 'DETAILS') el.open = true;
  });
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
    document.querySelectorAll('details[data-lazy="1"][open]').forEach((el) => fillLazyEntry(el, true));
  } catch (err) {
    console.warn('Could not load saved reference pane state:', err);
  }
}

// ---- REFERENCE PANE: WORK TO DO AFTER DROPDOWNS OPEN OR CLOSE ----
// A search (or clearing one) can open or close thousands of dropdowns in a
// single moment, and the browser then fires one "toggle" event for each of
// them. Saving the whole pane's state once per event used to make the page
// work through that pile of events for many seconds, and a stat block you
// opened in the meantime stayed empty until the pile was gone. Now the
// events themselves do almost nothing (see the single listener in the
// DOMContentLoaded block at the bottom of this file); the saving and the
// scroll-button update are done ONCE, a moment after the burst has ended.
let referenceHousekeepingTimer = null;

function runReferenceHousekeeping() {
  referenceHousekeepingTimer = null;
  // Safety net: any monster dropdown that is open must have its stat block.
  document.querySelectorAll('.lookup-panel details[data-lazy="1"][open]').forEach((el) => fillLazyEntry(el));
  if (!referenceSearchActive) saveReferenceState();
  updateScrollNav();
}

function scheduleReferenceHousekeeping() {
  if (referenceHousekeepingTimer !== null) clearTimeout(referenceHousekeepingTimer);
  referenceHousekeepingTimer = setTimeout(runReferenceHousekeeping, 120);
}

function applyReferenceDefaults() {
  referenceSearchActive = false;
  const searchInput = document.getElementById('referenceSearchInput');
  if (searchInput) searchInput.value = '';
  clearReferenceHighlights();
  document.querySelectorAll('.dropdown-search-input').forEach((input) => {
    input.value = '';
  });
  document.querySelectorAll('.dropdown-search-mode').forEach((select) => {
    select.value = 'partial';
  });
  getAllReferenceDetails().forEach((el) => {
    el.classList.remove('search-hidden');
    el.open = REFERENCE_DEFAULT_OPEN_IDS.includes(el.id);
  });
  saveReferenceState();
  clearBackChain();
}

// Resets the Reference pane back to its default open/closed state
// (clears any active search, every per-dropdown search box, and the
// Back button's chain of jumps), after confirmation.
async function resetReferencePane() {
  const confirmed = await confirmAction('Reset the Reference panel back to its default state?');
  if (!confirmed) return;
  applyReferenceDefaults();
}

// ---- REFERENCE PANE SEARCH (shared helpers) ----
// These helpers back BOTH the main "Search within Reference
// Information" box at the top of the pane AND every individual
// per-dropdown search box injected by initDropdownSearchBars() below
// — the only difference between the two is which root element they
// search underneath.

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
// text from any dropdown nested inside it, and WITHOUT pulling in the
// text of an injected per-dropdown search box (its placeholder and
// "Partial word / Whole word" option text would otherwise pollute
// every single dropdown's own text with the same boilerplate words).
// This is what stops a huge container like "Lore" (which nests dozens
// of unrelated entries) from falsely matching a search just because
// the search terms happen to appear somewhere in its enormous combined
// nested text.
function collectOwnReferenceText(el) {
  if (el.dataset && el.dataset.lazy) return lazyOwnText(el);
  let text = '';
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.nodeValue;
    } else if (
      child.nodeType === Node.ELEMENT_NODE &&
      child.tagName !== 'DETAILS' &&
      !child.classList.contains('dropdown-search-row') &&
      !child.classList.contains('add-to-combat-row')
    ) {
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

// Checks whether "term" appears in "text" — as a plain substring in
// Partial word mode (the original behavior), or as a whole word only
// (bounded by word breaks on both sides) in Whole word mode.
function textContainsTerm(text, term, wholeWord) {
  if (!wholeWord) return text.includes(term);
  const pattern = new RegExp('\\b' + escapeRegex(term) + '\\b', 'i');
  return pattern.test(text);
}

// Removes any <mark class="search-highlight"> wrappers found anywhere
// underneath rootEl, merging the plain text back together.
function clearHighlightsWithin(rootEl) {
  rootEl.querySelectorAll('mark.search-highlight').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
}

function clearReferenceHighlights() {
  const panel = document.querySelector('.lookup-panel');
  if (panel) clearHighlightsWithin(panel);
}

// Wraps every visible occurrence of any search term (anywhere
// underneath rootEl) in a <mark class="search-highlight">, so it's
// immediately obvious why something matched. Only text inside
// currently-visible (non search-hidden) dropdowns is touched, and text
// belonging to an injected search box itself is skipped.
function highlightMatchesWithin(rootEl, terms, wholeWord) {
  lastHighlight = terms.length > 0 ? { terms: terms, wholeWord: wholeWord } : null;
  if (terms.length === 0) return;
  if (rootEl.closest && rootEl.closest('.search-hidden')) return;

  const escaped = terms.map((term) => escapeRegex(term));
  const pattern = wholeWord
    ? new RegExp('\\b(' + escaped.join('|') + ')\\b', 'gi')
    : new RegExp('(' + escaped.join('|') + ')', 'gi');

  // Hidden dropdowns and injected search boxes are skipped as whole branches
  // (rather than checking every text node inside them one by one).
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (
          node.classList.contains('search-hidden') ||
          node.classList.contains('dropdown-search-row') ||
          node.classList.contains('add-to-combat-row')
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      }
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
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

function highlightReferenceMatches(terms, wholeWord) {
  const panel = document.querySelector('.lookup-panel');
  if (panel) highlightMatchesWithin(panel, terms, wholeWord);
}

// Reads the Partial word / Whole word <select> that sits next to a
// given search <input>, defaulting to 'partial' if it can't be found.
function getSearchModeFor(selectEl) {
  return selectEl && selectEl.value === 'whole' ? 'whole' : 'partial';
}

// Re-filters every dropdown found underneath "scopeEl" (NOT including
// scopeEl itself, so a per-dropdown search box never hides the very
// dropdown it lives inside) for the given query. Each dropdown is
// judged in two passes, exactly like the main pane-wide search: does
// its OWN text contain every term, or does a dropdown nested inside it
// match? Clearing the query simply reveals every dropdown in scope
// again — it doesn't try to restore whatever finer-grained state
// existed before the search started.
function performScopedSearch(scopeEl, rawQuery, wholeWord) {
  const allDetails = Array.from(scopeEl.querySelectorAll('details'));
  const terms = parseReferenceSearchTerms(rawQuery);

  clearHighlightsWithin(scopeEl);

  if (terms.length === 0) {
    lastHighlight = null;
    allDetails.forEach((el) => el.classList.remove('search-hidden'));
    updateScrollNav();
    return;
  }

  const ownMatches = new Map();
  allDetails.forEach((el) => {
    const text = collectOwnReferenceText(el).toLowerCase();
    ownMatches.set(el, terms.every((term) => textContainsTerm(text, term, wholeWord)));
  });

  const matchedLazy = [];
  allDetails.forEach((el) => {
    let show = ownMatches.get(el);
    if (!show) {
      show = Array.from(el.querySelectorAll('details')).some((child) => ownMatches.get(child));
    }
    el.classList.toggle('search-hidden', !show);
    if (show) {
      if (el.dataset.lazy) matchedLazy.push(el);
      else el.open = true;
    }
  });
  openFewLazyMatches(matchedLazy);

  highlightMatchesWithin(scopeEl, terms, wholeWord);
  updateScrollNav();
}

// Re-filters the WHOLE Reference panel for the main search box's
// current value. Clearing the box removes the filter and restores
// whatever was open/closed before the search started.
function performReferenceSearch(rawQuery) {
  const allDetails = getAllReferenceDetails();
  const terms = parseReferenceSearchTerms(rawQuery);
  const wholeWord = getSearchModeFor(document.getElementById('referenceSearchMode')) === 'whole';

  clearReferenceHighlights();

  if (terms.length === 0) {
    referenceSearchActive = false;
    lastHighlight = null;
    allDetails.forEach((el) => el.classList.remove('search-hidden'));
    loadReferenceState();
    updateScrollNav();
    return;
  }

  referenceSearchActive = true;

  const ownMatches = new Map();
  allDetails.forEach((el) => {
    const text = collectOwnReferenceText(el).toLowerCase();
    ownMatches.set(el, terms.every((term) => textContainsTerm(text, term, wholeWord)));
  });

  const matchedLazy = [];
  allDetails.forEach((el) => {
    let show = ownMatches.get(el);
    if (!show) {
      show = Array.from(el.querySelectorAll('details')).some((child) => ownMatches.get(child));
    }
    el.classList.toggle('search-hidden', !show);
    if (show) {
      if (el.dataset.lazy) matchedLazy.push(el);
      else el.open = true;
    }
  });
  openFewLazyMatches(matchedLazy);

  highlightReferenceMatches(terms, wholeWord);
  updateScrollNav();
}

// ---- PER-DROPDOWN SEARCH BARS ----
// Injects a small "Search within '<title>'" box (with its own Partial
// word / Whole word selector, defaulting to Partial) at the very top
// of EVERY dropdown's body in the Reference pane — top-level ones like
// Rules as well as every nested one (an individual spell, a single
// glossary term, a lore entry, a Rules sub-entry like Cover, and so
// on). This is entirely generic: it just walks whatever <details>
// elements already exist in the DOM after the data-driven sections
// have rendered, so a brand-new dropdown added later (by hand or via a
// new data file) automatically gets one too — nothing here needs to
// know what's inside any of them.
function addSearchBarTo(detailsEl) {
  const summaryEl = detailsEl.querySelector(':scope > summary');
  const bodyEl = detailsEl.querySelector(':scope > .dropdown-body, :scope > .condition-body');
  if (!summaryEl || !bodyEl) return;
  if (bodyEl.querySelector(':scope > .dropdown-search-row')) return; // already has one

  const title = summaryEl.textContent.trim();

  const row = document.createElement('div');
  row.className = 'dropdown-search-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'dropdown-search-input';
  input.placeholder = 'Search within "' + title + '"';

  const select = document.createElement('select');
  select.className = 'dropdown-search-mode';
  const optPartial = document.createElement('option');
  optPartial.value = 'partial';
  optPartial.textContent = 'Partial word';
  optPartial.selected = true;
  const optWhole = document.createElement('option');
  optWhole.value = 'whole';
  optWhole.textContent = 'Whole word';
  select.appendChild(optPartial);
  select.appendChild(optWhole);

  row.appendChild(input);
  row.appendChild(select);
  bodyEl.insertBefore(row, bodyEl.firstChild);

  // Monster stat blocks also get an "Add to combat" row right under the search bar.
  addCombatRowTo(detailsEl, bodyEl, row);

  const runSearch = () => {
    performScopedSearch(detailsEl, input.value, getSearchModeFor(select) === 'whole');
  };

  input.addEventListener('input', runSearch);
  select.addEventListener('change', runSearch);

  // Typing/clicking inside the search row shouldn't be treated as a
  // click on the <summary> that closes the dropdown.
  row.addEventListener('click', (e) => e.stopPropagation());
}

function initDropdownSearchBars() {
  // A lazy dropdown gets its search box when it is filled (see fillLazyEntry).
  document.querySelectorAll('.lookup-panel details').forEach((detailsEl) => {
    if (!detailsEl.dataset.lazy) addSearchBarTo(detailsEl);
  });
}

// ---- ADD A MONSTER TO COMBAT (button under each stat block's search bar) ----
// Every monster dropdown (any <details> whose id starts with "monster-")
// automatically gets a yellow "Add to combat" button, plus "Initiative
// advantage" and "Initiative disadvantage" checkboxes, placed directly
// under its search bar (see addSearchBarTo above, which calls
// addCombatRowTo). Pressing the button rolls the monster's initiative
// (d20 + the Initiative modifier printed on its stat block, or with
// advantage/disadvantage if one of the checkboxes is ticked) and puts the
// monster into the turn order. At most one of the two checkboxes can be
// ticked at a time.

// Turns text like "+2", "-1", "−1" (real minus sign), "5" into a number.
// Returns null if there is no number to read.
function parseSignedNumber(text) {
  const match = /([+\-\u2212\u2013])?\s*(\d+)/.exec(String(text));
  if (!match) return null;
  const value = parseInt(match[2], 10);
  return match[1] === '-' || match[1] === '\u2212' || match[1] === '\u2013' ? -value : value;
}

// Reads a monster's initiative modifier from its stat block. First choice
// is the "Initiative +2 (12)" line; if a stat block has no such line, the
// Dexterity modifier from its ability table is used instead; if neither is
// found, the modifier is 0.
function readInitiativeModifier(statBlockEl) {
  if (!statBlockEl) return 0;

  const labels = statBlockEl.querySelectorAll('p > strong');
  for (const label of labels) {
    if (label.textContent.trim() !== 'Initiative') continue;
    const lineMatch = /Initiative\s*([+\-\u2212\u2013]?\s*\d+)/.exec(label.parentElement.textContent);
    if (lineMatch) {
      const value = parseSignedNumber(lineMatch[1]);
      if (value !== null) return value;
    }
  }

  const headers = statBlockEl.querySelectorAll('.stat-abilities tbody th');
  for (const header of headers) {
    if (header.textContent.trim() !== 'Dex') continue;
    const scoreCell = header.nextElementSibling;
    const modCell = scoreCell ? scoreCell.nextElementSibling : null;
    const value = modCell ? parseSignedNumber(modCell.textContent) : null;
    if (value !== null) return value;
  }

  return 0;
}

// Rolls the d20 for an initiative roll. mode is 'normal', 'advantage', or
// 'disadvantage'. Returns { die, rolls }: the die that counts, and every
// die that was rolled (two for advantage/disadvantage, one otherwise).
function rollInitiativeD20(mode) {
  const first = rollDie(20);
  if (mode !== 'advantage' && mode !== 'disadvantage') {
    return { die: first, rolls: [first] };
  }
  const second = rollDie(20);
  const die = mode === 'advantage' ? Math.max(first, second) : Math.min(first, second);
  return { die: die, rolls: [first, second] };
}

// Works out the name for a monster being added to the turn order. The first
// copy keeps its plain name. When a second copy is added, the first one is
// renamed "<name> 1" and the new one becomes "<name> 2", and so on, so
// several of the same monster can be in the list at once.
function claimCombatantName(baseName) {
  const pattern = new RegExp('^' + escapeRegex(baseName) + '(?: (\\d+))?$', 'i');
  const matches = combatants.filter((c) => pattern.test(c.name));
  if (matches.length === 0) return baseName;

  const usedNumbers = new Set();
  const unnumbered = [];
  matches.forEach((c) => {
    const found = pattern.exec(c.name);
    if (found[1]) usedNumbers.add(parseInt(found[1], 10));
    else unnumbered.push(c);
  });

  const takeLowestFreeNumber = () => {
    let n = 1;
    while (usedNumbers.has(n)) n += 1;
    usedNumbers.add(n);
    return n;
  };

  unnumbered.forEach((c) => {
    c.name = c.name + ' ' + takeLowestFreeNumber();
  });
  return baseName + ' ' + takeLowestFreeNumber();
}

// Rolls initiative for one monster and adds it to the turn order.
function addMonsterToCombat(detailsEl, mode) {
  const summaryEl = detailsEl.querySelector(':scope > summary');
  const statBlockEl = detailsEl.querySelector('.stat-block');
  const baseName = (summaryEl ? summaryEl.textContent : detailsEl.id).trim();

  const modifier = readInitiativeModifier(statBlockEl);
  const roll = rollInitiativeD20(mode);
  const total = roll.die + modifier;

  pushUndoSnapshot();
  const name = claimCombatantName(baseName);
  combatants.push(
    makeCombatant(name, total, {
      statBlockId: detailsEl.id,
      ac: readStatBlockNumber(statBlockEl, 'AC'),
      hp: readStatBlockNumber(statBlockEl, 'HP')
    })
  );
  render();

  let rollText;
  if (mode === 'advantage') rollText = 'advantage: ' + roll.rolls.join(', ') + ' \u2192 ' + roll.die;
  else if (mode === 'disadvantage') rollText = 'disadvantage: ' + roll.rolls.join(', ') + ' \u2192 ' + roll.die;
  else rollText = 'd20: ' + roll.die;
  const modText = modifier === 0 ? '' : modifier > 0 ? ' + ' + modifier : ' - ' + Math.abs(modifier);

  showToast(name + ' added to combat \u2014 initiative ' + total + ' (' + rollText + modText + ')', 4000);
}

// Builds the "Add to combat" row and puts it directly after the search bar
// (afterEl) in a monster dropdown's body. Does nothing for any dropdown
// that isn't an individual monster, and never adds a second row.
function addCombatRowTo(detailsEl, bodyEl, afterEl) {
  if (!detailsEl.id || detailsEl.id.indexOf('monster-') !== 0) return;
  if (bodyEl.querySelector(':scope > .add-to-combat-row')) return;

  const row = document.createElement('div');
  row.className = 'add-to-combat-row';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-primary add-to-combat-btn';
  button.textContent = 'Add to combat';

  const advLabel = document.createElement('label');
  advLabel.className = 'mob-check';
  const advInput = document.createElement('input');
  advInput.type = 'checkbox';
  advLabel.appendChild(advInput);
  advLabel.appendChild(document.createTextNode(' Initiative advantage'));

  const disLabel = document.createElement('label');
  disLabel.className = 'mob-check';
  const disInput = document.createElement('input');
  disInput.type = 'checkbox';
  disLabel.appendChild(disInput);
  disLabel.appendChild(document.createTextNode(' Initiative disadvantage'));

  // Only one of the two checkboxes can be ticked at a time.
  advInput.addEventListener('change', () => {
    if (advInput.checked) disInput.checked = false;
  });
  disInput.addEventListener('change', () => {
    if (disInput.checked) advInput.checked = false;
  });

  button.addEventListener('click', () => {
    const mode = advInput.checked ? 'advantage' : disInput.checked ? 'disadvantage' : 'normal';
    addMonsterToCombat(detailsEl, mode);
  });

  // Clicking inside the row shouldn't count as a click on anything beneath it.
  row.addEventListener('click', (e) => e.stopPropagation());

  row.appendChild(button);
  row.appendChild(advLabel);
  row.appendChild(disLabel);
  bodyEl.insertBefore(row, afterEl.nextSibling);
}

// ---- STAT BLOCK PANEL (in the Combat pane, under the turn order and dice rollers) ----
// Every combatant that was added from a monster's stat block remembers which
// stat block that was (its "statBlockId", the monster's dropdown id). That
// link is by id, not by name, so renaming the combatant never breaks it.
// Whenever one or more combatants are selected in the turn order, the stat
// blocks they are linked to are shown in the panel under the turn order.

let combatStatBlockKey = ''; // which stat blocks are currently shown, so nothing is rebuilt needlessly

function getMonsterTitle(id) {
  const el = document.getElementById(id);
  const summaryEl = el ? el.querySelector(':scope > summary') : null;
  return summaryEl ? summaryEl.textContent.trim() : id;
}

// ---- STAT BLOCKS IN THE COMBAT PANE: ONE PER SELECTED COMBATANT ----
// Every selected combatant that was added from a stat block gets its own copy of that stat block
// (with a gap between them), followed by that combatant's own row(s) of checkboxes (see further down).

function getCombatStatBlockEntries() {
  return sortedCombatants().filter((c) => selectedIds.has(c.id) && c.statBlockId && lazyEntryHtml.has(c.statBlockId));
}

// A short text that changes whenever something shown in the panel changes (who is selected, their names,
// their checkboxes), so the panel is only rebuilt when it has to be.
function computeCombatStatBlockKey() {
  return getCombatStatBlockEntries()
    .map((c) => [c.id, c.name, c.statBlockId, JSON.stringify(c.counters || {})].join('~'))
    .join('|');
}

function buildCombatStatBlockEntryHtml(c) {
  const monsterTitle = getMonsterTitle(c.statBlockId);
  const baseName = String(c.name).replace(/\s+\d+$/, '').trim().toLowerCase();
  const showTitle = baseName !== monsterTitle.toLowerCase() && String(c.name).trim().toLowerCase() !== monsterTitle.toLowerCase();
  const heading = escapeHtml(c.name) + (showTitle ? ' <span class="combat-statblock-monster">(' + escapeHtml(monsterTitle) + ')</span>' : '');
  return (
    '<div class="combat-statblock-entry" data-combatant-id="' + escapeHtml(c.id) + '">' +
    '<h4 data-combatant-id="' + escapeHtml(c.id) + '" data-statblock-id="' + escapeHtml(c.statBlockId) + '">' + heading + '</h4>' +
    lazyEntryHtml.get(c.statBlockId) +
    buildCounterPanelHtml(c) +
    '</div>'
  );
}

function renderCombatStatBlocks() {
  const panel = document.getElementById('combatStatBlockPanel');
  const body = document.getElementById('combatStatBlockBody');
  if (!panel || !body) return;

  const entries = getCombatStatBlockEntries();
  const key = computeCombatStatBlockKey();
  if (key === combatStatBlockKey) return;
  combatStatBlockKey = key;

  if (entries.length === 0) {
    panel.classList.add('hidden');
    body.innerHTML = '';
    clearReferencePopups();
    return;
  }

  body.innerHTML = entries.map(buildCombatStatBlockEntryHtml).join('');
  enrichStatBlocks(body);
  panel.classList.remove('hidden');
}

// ---- LIMITED-USE CHECKBOXES (under each stat block in the Combat pane) ----
// A ticked box means "used". What gets boxes is worked out automatically from the stat block's text
// (see the reader above). Each combatant remembers its own ticks in combatant.counters, so they are saved
// with the page, with Undo, and with saved encounters.

let counterGroupCache = new Map(); // stat block id -> its list of checkbox rows
let counterSpellIndex = null;      // the spell names found in the Spells section, so spell lists can be read

function getCounterSpellIndex() {
  if (!counterSpellIndex) {
    const names = [];
    document.querySelectorAll('details[id^="spell-"]').forEach((el) => {
      if (el.id.indexOf('spell-school-') === 0) return;
      const summaryEl = el.querySelector(':scope > summary');
      if (summaryEl) names.push(summaryEl.textContent.trim());
    });
    counterSpellIndex = scMakeSpellIndex(names);
  }
  return counterSpellIndex;
}

// Every stat block gets a Reaction row first (one box, or as many as the stat block says it has).
function getCounterGroups(statBlockId) {
  let groups = counterGroupCache.get(statBlockId);
  if (!groups) {
    const html = lazyEntryHtml.get(statBlockId) || '';
    const reactions = scReactionCount(html);
    groups = [
      { key: 'reactions', kind: 'reaction', label: reactions > 1 ? 'Reactions' : 'Reaction', count: reactions, usedByDefault: 0, tag: '' }
    ].concat(scExtractGroups(html, getCounterSpellIndex()));
    counterGroupCache.set(statBlockId, groups);
  }
  return groups;
}

// The ticks a row starts with (for example 5 Legendary Resistance boxes where 1 only counts in the lair:
// the last box starts ticked).
function getCounterDefaultState(group) {
  const state = [];
  for (let i = 0; i < group.count; i++) state.push(i >= group.count - group.usedByDefault);
  return state;
}

function getCounterState(combatant, group) {
  const state = getCounterDefaultState(group);
  const saved = combatant.counters && combatant.counters[group.key];
  if (Array.isArray(saved)) {
    for (let i = 0; i < state.length; i++) {
      if (typeof saved[i] === 'boolean') state[i] = saved[i];
    }
  }
  return state;
}

function buildCounterPanelHtml(c) {
  const groups = getCounterGroups(c.statBlockId);
  let rows = '';
  groups.forEach((g) => {
    const state = getCounterState(c, g);
    const boxes = state
      .map(
        (used, i) =>
          '<input type="checkbox" class="counter-box" data-key="' + escapeHtml(g.key) + '" data-index="' + i + '"' +
          (used ? ' checked' : '') +
          ' aria-label="' + escapeHtml(g.label) + ' ' + (i + 1) + '" />'
      )
      .join('');
    rows +=
      '<div class="counter-row"><span class="counter-label">' + escapeHtml(g.label) +
      (g.tag ? ' <span class="counter-tag">' + escapeHtml(g.tag) + '</span>' : '') +
      '</span><span class="counter-boxes">' + boxes + '</span></div>';
  });
  return (
    '<div class="counter-panel" data-combatant-id="' + escapeHtml(c.id) + '">' +
    '<div class="counter-head"><span class="counter-title">Uses (ticked = used)</span>' +
    '<button type="button" class="btn-secondary counter-reset-btn">Reset boxes</button></div>' +
    rows +
    '</div>'
  );
}

// Pressing "Next combatant" gives that combatant its reaction back.
function resetReactionBoxes(combatant) {
  if (combatant && combatant.counters && combatant.counters.reactions) delete combatant.counters.reactions;
}

function handleCounterBoxChange(box) {
  const panelEl = box.closest('.counter-panel');
  const rowEl = box.closest('.counter-row');
  if (!panelEl || !rowEl) return;
  const combatant = combatants.find((c) => c.id === panelEl.dataset.combatantId);
  if (!combatant) return;
  if (!combatant.counters) combatant.counters = {};
  combatant.counters[box.dataset.key] = Array.from(rowEl.querySelectorAll('.counter-box')).map((b) => b.checked);
  combatStatBlockKey = computeCombatStatBlockKey(); // the boxes on screen are already up to date: no rebuild needed
  save();
}

async function handleCounterReset(button) {
  const panelEl = button.closest('.counter-panel');
  if (!panelEl) return;
  const combatant = combatants.find((c) => c.id === panelEl.dataset.combatantId);
  if (!combatant) return;
  const confirmed = await confirmAction('Reset all checkboxes for ' + combatant.name + '?', 'Reset');
  if (!confirmed) return;
  delete combatant.counters;
  combatStatBlockKey = '';
  renderCombatStatBlocks();
  save();
}

// ---- SAVED ENCOUNTERS ----
// "Save encounter" stores every combatant in the turn order (with initiative, AC, HP, hidden state and
// checkbox ticks) under a name, in this browser's local storage. In the Reference pane, "Saved Encounters"
// lists them; adding one puts its combatants back into the turn order (without clearing what is there).

const SAVED_ENCOUNTERS_KEY = 'dmScreenSavedEncounters';
let savedEncounters = []; // { id, name, savedAt, combatants: [...] }
let lastEncounterName = '';
let encounterIdCounter = 0;

function loadSavedEncounters() {
  try {
    const raw = localStorage.getItem(SAVED_ENCOUNTERS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    savedEncounters = Array.isArray(data.encounters) ? data.encounters : [];
    lastEncounterName = typeof data.lastName === 'string' ? data.lastName : '';
    encounterIdCounter = savedEncounters.length;
  } catch (err) {
    console.warn('Could not load saved encounters:', err);
  }
}

function persistSavedEncounters() {
  try {
    localStorage.setItem(SAVED_ENCOUNTERS_KEY, JSON.stringify({ encounters: savedEncounters, lastName: lastEncounterName }));
  } catch (err) {
    showToast('Could not store the saved encounters in this browser');
  }
}

function renderSavedEncounters() {
  const list = document.getElementById('savedEncountersList');
  if (!list) return;
  if (savedEncounters.length === 0) {
    list.innerHTML = '<p class="saved-empty">No saved encounters yet. Press "Save encounter" to save the current turn order.</p>';
    return;
  }
  const sorted = [...savedEncounters].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  list.innerHTML = sorted
    .map((enc) => {
      const members = [...enc.combatants]
        .sort((a, b) => b.initiative - a.initiative)
        .map((c) => {
          const bits = ['Init ' + c.initiative];
          if (typeof c.ac === 'number') bits.push('AC ' + c.ac);
          if (typeof c.hp === 'number') bits.push('HP ' + c.hp);
          return '<li>' + escapeHtml(c.name) + (c.isHidden ? ' (hidden)' : '') + ' \u2014 ' + escapeHtml(bits.join(', ')) + '</li>';
        })
        .join('');
      const count = enc.combatants.length;
      return (
        '<details class="condition-dropdown saved-encounter" id="saved-encounter-' + escapeHtml(enc.id) + '">' +
        '<summary>' + escapeHtml(enc.name) + ' <span class="saved-encounter-count">(' + count + (count === 1 ? ' combatant' : ' combatants') + ')</span></summary>' +
        '<div class="condition-body">' +
        '<div class="saved-encounter-actions">' +
        '<button type="button" class="btn-primary" data-enc-action="load" data-enc-id="' + escapeHtml(enc.id) + '">Add to initiative order</button>' +
        '<button type="button" class="btn-secondary" data-enc-action="rename" data-enc-id="' + escapeHtml(enc.id) + '">Rename</button>' +
        '<button type="button" class="btn-danger" data-enc-action="delete" data-enc-id="' + escapeHtml(enc.id) + '">Delete</button>' +
        '</div>' +
        '<ul class="saved-encounter-members">' + members + '</ul>' +
        '</div>' +
        '</details>'
      );
    })
    .join('');
}

// A small pop-up with a text box. Resolves with the text, or null if cancelled.
function showTextPrompt(message, defaultValue, confirmLabel) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modalOverlay');
    const messageEl = document.getElementById('modalMessage');
    const buttonsEl = document.getElementById('modalButtons');

    messageEl.textContent = message;
    buttonsEl.innerHTML = '';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal-input';
    input.value = defaultValue || '';
    messageEl.insertAdjacentElement('afterend', input);

    const finish = (value) => {
      input.remove();
      overlay.classList.add('hidden');
      resolve(value);
    };

    const okBtn = document.createElement('button');
    okBtn.textContent = confirmLabel || 'OK';
    okBtn.className = 'btn-primary';
    okBtn.addEventListener('click', () => finish(input.value));
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.addEventListener('click', () => finish(null));
    buttonsEl.appendChild(okBtn);
    buttonsEl.appendChild(cancelBtn);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    });

    overlay.classList.remove('hidden');
    input.focus();
    input.select();
  });
}

function findSavedEncounterByName(name, exceptId) {
  const wanted = String(name).trim().toLowerCase();
  return savedEncounters.find((e) => e.id !== exceptId && e.name.trim().toLowerCase() === wanted);
}

async function saveCurrentEncounter() {
  if (combatants.length === 0) {
    showToast('There are no combatants to save yet');
    return;
  }
  const answer = await showTextPrompt('Name this encounter:', lastEncounterName, 'Save');
  if (answer === null) return;
  const name = answer.trim();
  if (!name) {
    showToast('Enter a name to save the encounter');
    return;
  }

  const existing = findSavedEncounterByName(name);
  if (existing) {
    const replace = await confirmAction('An encounter called "' + existing.name + '" is already saved. Replace it?', 'Replace');
    if (!replace) return;
  }

  const snapshot = JSON.parse(JSON.stringify(combatants));
  if (existing) {
    existing.name = name;
    existing.savedAt = Date.now();
    existing.combatants = snapshot;
  } else {
    encounterIdCounter += 1;
    savedEncounters.push({ id: 'enc-' + Date.now() + '-' + encounterIdCounter, name: name, savedAt: Date.now(), combatants: snapshot });
  }
  lastEncounterName = name;
  persistSavedEncounters();
  renderSavedEncounters();
  showToast('Encounter saved as "' + name + '"');
}

// The name a loaded combatant gets: its saved name, unless someone in the turn order already has it
// (then it is numbered, exactly like adding a second copy of the same monster).
function nameForLoadedCombatant(name) {
  const taken = combatants.some((c) => c.name.trim().toLowerCase() === String(name).trim().toLowerCase());
  if (!taken) return name;
  const base = String(name).replace(/\s+\d+$/, '').trim() || name;
  return claimCombatantName(base);
}

function loadSavedEncounter(encId) {
  const enc = savedEncounters.find((e) => e.id === encId);
  if (!enc) return;

  pushUndoSnapshot();
  let added = 0;
  let skipped = 0;
  enc.combatants.forEach((saved) => {
    const copy = JSON.parse(JSON.stringify(saved));
    if (copy.statBlockId) {
      copy.name = nameForLoadedCombatant(copy.name);
    } else if (combatants.some((c) => c.name.trim().toLowerCase() === String(copy.name).trim().toLowerCase())) {
      skipped += 1; // a player that is already in the turn order is not added twice
      return;
    }
    idCounter += 1;
    copy.id = 'c-' + Date.now() + '-' + idCounter;
    combatants.push(copy);
    added += 1;
  });

  if (added === 0) undoStack.pop();
  lastEncounterName = enc.name;
  persistSavedEncounters();
  render();

  let message = added + (added === 1 ? ' combatant' : ' combatants') + ' added from "' + enc.name + '"';
  if (skipped > 0) message += ' (' + skipped + ' already in the list, skipped)';
  showToast(message, 4000);
}

async function renameSavedEncounter(encId) {
  const enc = savedEncounters.find((e) => e.id === encId);
  if (!enc) return;
  const answer = await showTextPrompt('Rename this encounter:', enc.name, 'Rename');
  if (answer === null) return;
  const name = answer.trim();
  if (!name || name === enc.name) return;
  if (findSavedEncounterByName(name, enc.id)) {
    showToast('An encounter with that name already exists');
    return;
  }
  enc.name = name;
  persistSavedEncounters();
  renderSavedEncounters();
}

async function deleteSavedEncounter(encId) {
  const enc = savedEncounters.find((e) => e.id === encId);
  if (!enc) return;
  const confirmed = await confirmAction('Delete the saved encounter "' + enc.name + '"?', 'Delete');
  if (!confirmed) return;
  savedEncounters = savedEncounters.filter((e) => e.id !== encId);
  persistSavedEncounters();
  renderSavedEncounters();
}

function setupCounterAndEncounterEvents() {
  const statBlockBody = document.getElementById('combatStatBlockBody');
  if (statBlockBody) {
    statBlockBody.addEventListener('change', (e) => {
      const box = e.target.closest ? e.target.closest('.counter-box') : null;
      if (box) handleCounterBoxChange(box);
    });
    statBlockBody.addEventListener('click', (e) => {
      const btn = e.target.closest ? e.target.closest('.counter-reset-btn') : null;
      if (btn) handleCounterReset(btn);
    });
  }

  ['saveEncounterBtn', 'saveEncounterBtn2'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', saveCurrentEncounter);
  });

  const list = document.getElementById('savedEncountersList');
  if (list) {
    list.addEventListener('click', (e) => {
      const btn = e.target.closest ? e.target.closest('[data-enc-action]') : null;
      if (!btn) return;
      const id = btn.dataset.encId;
      if (btn.dataset.encAction === 'load') loadSavedEncounter(id);
      else if (btn.dataset.encAction === 'rename') renameSavedEncounter(id);
      else if (btn.dataset.encAction === 'delete') deleteSavedEncounter(id);
    });
  }
}

// ---- ROLLABLE DICE IN SPELLS ----
// Spell entries in the Reference pane (and the copies of them shown in the Combat pane) get the same
// clickable dice as stat blocks: every dice expression such as "8d6" or "1d4 + 1" can be rolled.
// (Only dice are made clickable here; stat blocks additionally make "+7" style modifiers clickable.)

const SPELL_DICE_SOURCE = '(\\d*d\\d+(?:\\s*[+\\-\\u2212]\\s*\\d+)?)';

function enrichDiceIn(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (parent && parent.closest('.stat-click, a, button, input, textarea, select, option, script, style, .dropdown-search-row, .add-to-combat-row')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  nodes.forEach((n) => enrichTextNode(n, null, true));
}

function enrichSpellEntry(detailsEl) {
  if (!detailsEl || !detailsEl.id || detailsEl.id.indexOf('spell-') !== 0 || detailsEl.id.indexOf('spell-school-') === 0) return;
  const body = detailsEl.querySelector(':scope > .condition-body, :scope > .dropdown-body');
  if (!body || body.dataset.diceEnriched === '1') return;
  body.dataset.diceEnriched = '1';
  enrichDiceIn(body);
}

// What a spell roll was: "Fire damage", "Damage", "Healing", "Temporary hit points".
function describeSpellRoll(el) {
  const block = el.closest('p, li, td, th') || el.parentElement;
  if (!block) return '';
  const range = document.createRange();
  range.selectNodeContents(block);
  range.setStartAfter(el);
  const after = range.toString().slice(0, 80);
  range.selectNodeContents(block);
  range.setEndBefore(el);
  const before = range.toString().slice(-70);

  if (/^[^.;]{0,25}\btemporary hit points?\b/i.test(after)) return 'Temporary hit points';
  const typed = /^[^.;]{0,30}?\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\b[^.;]{0,25}?\bdamage\b/i.exec(after);
  if (typed) return capitalizeWord(typed[1].toLowerCase()) + ' damage';
  if (/^[^.;]{0,25}\bdamage\b/i.test(after)) return 'Damage';
  if (/\b(regains?|restores?|heals?|recovers?|healing)\b[^.;]{0,50}$/i.test(before) || /^[^.;]{0,25}\bhit points?\b/i.test(after)) return 'Healing';
  return '';
}


// ---- LIMITED-USE CHECKBOXES: READING A STAT BLOCK ----
// Everything in this block reads the HTML of one monster's stat block and works out
// which abilities have a limited number of uses (spell slots, spells with "3/Day",
// legendary actions, legendary resistance, recharge abilities, charges, and so on).
// It only READS text; it never changes anything on the page.
// Result: a list of "groups". Each group is one row of checkboxes:
//   { key, label, count, usedByDefault, kind, tag }

const SC_PERIOD = '(?:short or long rest|short\\/long rest|short rest|long rest|rest|day|week|hour|month|turn|round)';
const SC_NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, once: 1, twice: 2, thrice: 3 };
const SC_ORDINAL_WORDS = { first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th' };

function scDecode(str) {
  return String(str)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}

// HTML -> plain text. A literal "<br>" (written as &lt;br&gt; in some stat blocks)
// becomes a line break, which always ends a spell list.
function scPlain(html) {
  return scDecode(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|li|div|h\d)>/gi, '\n').replace(/<[^>]*>/g, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[ \t\r]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

function scNorm(str) {
  return String(str).replace(/[\u2019\u2018]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

function scNumberFrom(word) {
  const w = String(word).toLowerCase();
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  return SC_NUMBER_WORDS[w] || null;
}

// Splits a stat block into its paragraphs and list items, remembering which heading
// (Traits, Actions, ...) each one sits under, and the bold feature name if it has one.
function scParseBlocks(html) {
  const out = [];
  let section = 'Header';
  const re = /<h4>([\s\S]*?)<\/h4>|<(p|li)((?: [^>]*)?)>([\s\S]*?)<\/\2>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) {
      section = scPlain(m[1]);
      continue;
    }
    if (m[3] && m[3].indexOf('stat-source') !== -1) continue;
    const tag = m[2];
    const inner = m[4];
    const named = tag === 'p' ? /^<strong><em>([\s\S]*?)<\/em><\/strong>([\s\S]*)$/.exec(inner) : null;
    out.push({
      section: section,
      tag: tag,
      name: named ? scPlain(named[1]) : null,
      text: scPlain(named ? named[2] : inner)
    });
  }
  return out;
}

// ---------- usage parentheticals: "(3/Day)", "(Recharge 5-6)", ... ----------

// Reads the text inside one pair of brackets. Returns null if it is not a usage note.
function scUsageFromParen(paren) {
  if (/\brecharge/i.test(paren)) return { kind: 'recharge' };

  const lair = /(\d+)\s*\/\s*day\s+in\s+(?:its\s+|the\s+|their\s+)?lair/i.exec(paren);
  const re = new RegExp('(\\d+)\\s*\\/\\s*(' + SC_PERIOD.slice(3, -1) + ')\\b', 'gi');
  const found = [];
  let m;
  while ((m = re.exec(paren)) !== null) {
    found.push({ n: parseInt(m[1], 10), period: m[2].toLowerCase(), index: m.index });
  }
  if (found.length === 0) return null;

  if (lair) {
    const lairN = parseInt(lair[1], 10);
    const base = found.find((f) => f.index !== lair.index);
    const baseN = base ? base.n : lairN;
    return { kind: 'uses', total: Math.max(lairN, baseN), base: Math.min(lairN, baseN), period: 'day' };
  }
  return { kind: 'uses', total: found[0].n, base: found[0].n, period: found[0].period };
}

// Looks at a feature name (and the start of its text) for a usage note.
// Returns { label, usage } or null.
function scNameUsage(rawName, bodyText) {
  const name = rawName.replace(/[.\s]+$/, '');
  const parens = [];
  const re = /\(([^)]*)(?:\)|$)/g;
  let m;
  while ((m = re.exec(name)) !== null) parens.push({ text: m[1], full: m[0] });

  // Some stat blocks put the note right after the name: "Spellcasting. (3/Day)The ..."
  const lead = /^\s*\(([^)]*)\)/.exec(bodyText || '');
  if (lead) parens.push({ text: lead[1], full: lead[0].trim() });

  const usages = [];
  parens.forEach((p) => {
    const u = scUsageFromParen(p.text);
    if (u) usages.push({ u: u, text: p.text, full: p.full });
  });
  if (usages.length === 0) return null;

  let chosen = usages.find((x) => x.u.kind === 'uses' && x.u.total !== x.u.base);
  if (!chosen) chosen = usages.find((x) => x.u.kind === 'uses');
  if (!chosen) chosen = usages[0];

  let base = name;
  usages.forEach((x) => {
    if (x.full.charAt(0) === '(' && name.indexOf(x.full) !== -1) base = base.replace(x.full, '');
  });
  base = base.replace(/\s+/g, ' ').trim();
  return { label: (base + ' (' + chosen.text.trim() + ')').trim(), usage: chosen.u };
}

// ---------- spells ----------

// Builds the list of spell names the checkbox reader can recognise.
// "names" is a plain array of spell names (from the Spells section of the page).
function scMakeSpellIndex(names) {
  const set = new Set();
  (names || []).forEach((n) => {
    const base = scNorm(n);
    set.add(base);
    if (base.indexOf(' / ') !== -1) {
      set.add(base.replace(/\s*\/\s*/g, '/'));
      base.split(' / ').forEach((p) => set.add(p.trim()));
    }
  });
  const sorted = Array.from(set).sort((a, b) => b.length - a.length);
  return { set: set, sorted: sorted };
}

function scCleanSpellToken(tok) {
  return tok
    .replace(/[_*]/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:and|or)\s+/i, '')
    .replace(/[.;:]+$/, '')
    .trim();
}

// Splits "a, b (c, d), e" at the commas that are not inside brackets.
function scSplitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

// Cuts a spell list off where the sentence ends (first full stop outside brackets, or a line break).
function scCutListEnd(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '\n') return text.slice(0, i);
    if (ch === '.' && depth === 0 && (i === text.length - 1 || /\s/.test(text.charAt(i + 1)))) return text.slice(0, i);
  }
  return text;
}

function scTitleCaseSpell(name) {
  const small = { of: 1, and: 1, the: 1, to: 1, in: 1, on: 1, a: 1, an: 1, with: 1, from: 1, for: 1, as: 1, or: 1 };
  const m = /^([^(]*?)(\s*\(.*)?$/.exec(name);
  const base = m ? m[1] : name;
  const rest = m && m[2] ? m[2] : '';
  const words = base.split(' ').map((w, i) => {
    if (!w) return w;
    const lower = w.toLowerCase();
    if (i > 0 && small[lower]) return lower;
    return w
      .split('/')
      .map((seg) => seg.split('-').map((s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)).join('-'))
      .join('/')
      .replace(/(^|')(\w)/g, (x, a, b) => (a === "'" ? "'" + b.toLowerCase() : x))
      .replace(/^(.)/, (c) => c.toUpperCase());
  });
  return words.join(' ') + rest;
}

// One piece of a spell list -> a clean spell name, or null if it does not look like a spell.
function scSpellFromToken(raw, spellIndex) {
  let tok = scCleanSpellToken(raw);
  if (!tok) return null;
  // repair a list item whose first letter got lost ("eath ward" -> "death ward")
  if (spellIndex && !spellIndex.set.has(scNorm(tok.replace(/\([^)]*\)/g, '').trim()))) {
    const fixes = [];
    for (let c = 97; c <= 122; c++) {
      const cand = String.fromCharCode(c) + scNorm(tok.replace(/\([^)]*\)/g, '').trim());
      if (spellIndex.set.has(cand)) fixes.push(cand);
    }
    if (fixes.length === 1 && /^[a-z]/.test(tok)) tok = fixes[0].charAt(0) + tok;
  }

  // keep a spell name followed by notes in brackets, drop any other text glued on at the end
  const idx = spellIndex ? spellIndex.sorted : [];
  const low = scNorm(tok);
  for (let i = 0; i < idx.length; i++) {
    const nm = idx[i];
    if (low.indexOf(nm) !== 0) continue;
    const after = low.slice(nm.length);
    if (after !== '' && !/^[\s(]/.test(after)) continue;
    // the spell name (keeping its capital letters from the stat block)
    let keep = tok.slice(0, nm.length);
    let rest = tok.slice(nm.length);
    const par = /^\s*\([^)]*\)/.exec(rest);
    if (par) keep += par[0];
    return keep.replace(/\s+/g, ' ').trim();
  }

  // unknown to the site: accept only if it still looks like a spell name
  const plain = tok.replace(/\([^)]*\)/g, '').trim();
  const words = plain.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 6) return null;
  if (/\d/.test(plain)) return null;
  if (/\b(can|must|is|are|has|have|takes?|uses?|casts?|deals?|spent|while|when|that|which|without|requires?|per)\b/i.test(plain)) return null;
  return tok;
}

// Finds the lines in one paragraph/list item that give a number of uses per day to spells,
// like "3/Day Each: misty step, mirror image" or "At will: ... 1/day: geas".
// Every spell in the list gets its own number of uses.
function scSpellSegments(text, spellIndex) {
  const out = [];
  const re = /(?:^|[\s,;.:])(?:(at[ -]will)|(\d+)\s*\/\s*(day|week|month|hour|short or long rest|short rest|long rest|rest))\b(\s+each\b)?(\s*\([^)]*\))?\s*([:\u2013\u2014-])?/gi;
  const heads = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + (m[0].length - m[0].replace(/^[\s,;.:]/, '').length);
    const before = text.slice(0, start).replace(/^[^:]{0,40}?,\s*/, '').trim();
    const atStart = start === 0 || before === '';
    const hasColon = !!m[6];
    heads.push({
      atWill: !!m[1],
      n: m[2] ? parseInt(m[2], 10) : 0,
      period: m[3] ? scPeriodLabel(m[3]) : '',
      start: start,
      end: m.index + m[0].length,
      note: m[5] ? m[5].replace(/^\s*\(|\)\s*$/g, '').trim() : '',
      ok: hasColon || (atStart && !m[5]),
      colon: hasColon
    });
  }

  heads.forEach((h, i) => {
    if (!h.ok || h.atWill) return;
    const nextStart = i + 1 < heads.length ? heads[i + 1].start : text.length;
    const listText = scCutListEnd(text.slice(h.end, nextStart));
    const items = [];
    scSplitTopLevel(listText).forEach((piece) => {
      const spell = scSpellFromToken(piece, spellIndex);
      if (spell) {
        items.push(spell);
      } else {
        // "plane shift and teleport": accept if every part is a known spell
        const parts = scCleanSpellToken(piece).split(/\s+and\s+/i);
        if (parts.length > 1 && spellIndex && parts.every((p) => spellIndex.set.has(scNorm(p.replace(/\([^)]*\)/g, '').trim())))) {
          parts.forEach((p) => items.push(p.trim()));
        }
      }
    });
    if (items.length === 0) return;

    let qualifier = h.note;
    if (!qualifier && i === 0) {
      const pre = text.slice(0, h.start).replace(/[\s,:;]+$/, '').trim();
      if (pre && pre.length <= 30 && !/[.:]/.test(pre)) qualifier = pre;
    }
    out.push({ n: h.n, period: h.period, items: items, qualifier: qualifier });
  });
  return out;
}

// "Name (2/day)" written inside a list of spells.
function scInlineSpellUses(text, spellIndex) {
  const out = [];
  const re = /(?:^|[,;:]\s*)([A-Za-z][A-Za-z\u2019' \/-]{1,40}?)\s*\(\s*(\d+)\s*\/\s*day\s*\)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const spell = scSpellFromToken(m[1], spellIndex);
    if (spell) out.push({ n: parseInt(m[2], 10), name: spell });
  }
  return out;
}

// ---------- spell slots ----------

function scOrdinal(word) {
  const w = String(word).toLowerCase();
  return SC_ORDINAL_WORDS[w] || w;
}

function scSlotLines(text) {
  const out = [];
  const re = /\b(\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)(?:[\s-]*level)?(?:\s*[\u2013-]\s*(\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)(?:[\s-]*level)?)?\s*\(\s*(\d+)\s+(?:(\d+(?:st|nd|rd|th))[- ]level\s+)?(?:spell\s+)?slots?\s*\)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const low = scOrdinal(m[1]);
    const high = m[2] ? scOrdinal(m[2]) : (m[4] ? scOrdinal(m[4]) : null);
    out.push({ level: high || low, range: m[2] ? low + '\u2013' + high : '', n: parseInt(m[3], 10) });
  }
  return out;
}

// ---------- legendary actions ----------

// How many legendary actions the text promises, if it says so.
function scLegendaryCountFromText(text) {
  const re = /\b(?:can|may|could)\s+(?:only\s+)?take\s+(?:up to\s+)?(\d+|one|two|three|four|five|six)\s+legendary\s+actions?\b|\bhas\s+(\d+|one|two|three|four|five|six)\s+legendary\s+actions?\s+it\s+can\s+take/i;
  const m = re.exec(text);
  if (!m) return null;
  return scNumberFrom(m[1] || m[2]);
}

// Some stat blocks have lore text pasted under the "Legendary Actions" heading (before, after, or around
// the real actions). This decides whether one paragraph reads like a real legendary action.
function scLegendaryBlockLooksReal(b) {
  const modal = /\b(might|may|can|could|would|should|will|must)\b/i;
  const action = /^((?:[A-Za-z\u2019'-]+\s+){0,5}?)(makes?|uses?|moves?|casts?|attacks?|regains?|swims?|teleports?|exhales?|releases?|summons?|targets?)\b/;
  if (b.name && /\(\s*(costs?\s+)?\d+(?:-\d+)?\s+actions?\s*\)|\(\s*costs?\b/i.test(b.name)) return true;
  if (/can(?:'|\u2019)?t (?:take|use) this (?:legendary )?(?:action|option) again/i.test(b.text)) return true;
  if (scLegendaryCountFromText((b.name ? b.name + '. ' : '') + b.text) !== null) return true;
  if (b.name && /^legendary actions/i.test(b.name)) return true;
  if (b.name && b.text.length <= 600) {
    const m = action.exec(b.text);
    if (m && !modal.test(m[1])) return true;
  }
  return false;
}

function scLegendaryBlockIsLore(b) {
  return ((!b.name && b.text.length > 150) || (b.name && b.text.length > 700)) && !/legendary action/i.test((b.name || '') + ' ' + b.text);
}

// Keeps only the real legendary actions of each "Legendary Actions" section.
function scTrimLoreFromLegendary(blocks) {
  const out = [];
  let i = 0;
  while (i < blocks.length) {
    if (blocks[i].section !== 'Legendary Actions') {
      out.push(blocks[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < blocks.length && blocks[j].section === 'Legendary Actions') j++;
    const sec = blocks.slice(i, j);
    const start = sec.findIndex((b) => scLegendaryBlockLooksReal(b) && !scLegendaryBlockIsLore(b));
    if (start !== -1) {
      for (let k = start; k < sec.length; k++) {
        if (k > start && scLegendaryBlockIsLore(sec[k])) break;
        out.push(sec[k]);
      }
    }
    i = j;
  }
  return out;
}

function scLegendarySectionIsReal(blocks) {
  return blocks.some((b) => b.section === 'Legendary Actions');
}

// ---------- more ways a stat block can describe limited uses ----------

// "Summon Demon (1/Day): ..." written without bold, or "Flamecharm (Recharges after a Short or Long Rest). ..."
function scPlainNameUsage(text) {
  const out = [];
  const lead = /^([A-Z][A-Za-z\u2019' -]{1,60}?)\s*\(([^)]*)\)(?=\s*(?:[.:]|$)|[A-Z]|\s+[A-Z])/.exec(text);
  if (lead) {
    const u = scUsageFromParen(lead[2]);
    if (u) out.push({ label: lead[1].trim() + ' (' + lead[2].trim() + ')', usage: u });
  }
  return out;
}

function scMidNameUsage(text) {
  const out = [];
  const re = /(?:^|[.!?]\s+)([A-Z][\w\u2019'-]*(?:\s+(?:of|the|and|in|to|a|an|[A-Z][\w\u2019'-]*)){0,5})\s*\(([^)]*)\)\s*[.:]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const u = scUsageFromParen(m[2]);
    if (u) out.push({ label: m[1].trim() + ' (' + m[2].trim() + ')', usage: u });
  }
  return out;
}

const SC_COUNT_RE = '(once|twice|thrice|(?:\\d+|one|two|three|four|five|six)\\s+times?)';
const SC_PER_RE = '(?:per|a|each|every)\\s+(day|week|month|short or long rest|long rest|short rest|rest)';

function scCountFromWord(word) {
  const w = word.toLowerCase().replace(/\s*times?$/, '');
  return scNumberFrom(w);
}

function scPeriodLabel(period) {
  const p = period.toLowerCase();
  if (p === 'day') return 'Day';
  if (p === 'week') return 'Week';
  if (p === 'month') return 'Month';
  if (p === 'short or long rest') return 'Short or Long Rest';
  if (p === 'long rest') return 'Long Rest';
  if (p === 'short rest') return 'Short Rest';
  return 'Rest';
}

// "a, b (c, d) and e" -> ["a", "b (c, d)", "e"]  (splits only outside brackets)
function scSplitClause(clause) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let i = 0;
  while (i < clause.length) {
    const ch = clause.charAt(i);
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0) {
      const rest = clause.slice(i);
      const sep = /^(?:\s*,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+)/.exec(rest);
      if (sep) {
        parts.push(cur);
        cur = '';
        i += sep[0].length;
        continue;
      }
    }
    cur += ch;
    i++;
  }
  parts.push(cur);
  return parts;
}

function scSpellsFromClause(clause, spellIndex) {
  if (!spellIndex) return null;
  const parts = scSplitClause(clause).map((p) => scCleanSpellToken(p)).filter(Boolean);
  if (parts.length === 0) return null;
  const spells = [];
  for (let i = 0; i < parts.length; i++) {
    const base = scNorm(parts[i].replace(/\([^)]*\)/g, '').replace(/^the\s+/, ''));
    if (!spellIndex.set.has(base)) return null;
    spells.push(parts[i].replace(/^the\s+/i, ''));
  }
  return spells;
}

// Sentences that state a limit in plain words: "Once per long rest, the guard can reroll ...",
// "can cast Blur and Major Image once each per long rest", "can't use it again until it finishes a short rest".
function scProseGroups(text, owner, spellIndex, unnamed, hasSpellLines) {
  const out = [];
  const sentences = text.replace(/([.!?])\s+/g, '$1\u0001').split('\u0001');
  sentences.forEach((s, si) => {
    const limitNoise = /\bat least\b|\bno more than\b|\bone to\b|\bto (?:one|two|three|four|five|six) (?:times|wishes)\b|\bnever\b/i.test(s);

    // "Once the djinni has cast it three times, the djinni can't do so again for 365 days."
    const wish = /\bonce\b[^.]{0,40}\bhas cast it (\w+) times?\b[^.]*can(?:'|\u2019)?t do so again for (\d+) days/i.exec(s);
    if (wish && scNumberFrom(wish[1])) {
      const n = scNumberFrom(wish[1]);
      out.push({ key: 'prose:' + scNorm(owner) + ':' + n + '/' + wish[2] + 'days', kind: 'ability', label: (owner || 'Limited use') + ' (' + n + '/' + wish[2] + ' Days)', count: n, usedByDefault: 0 });
      return;
    }

    // "can cast fly and lightning bolt once each without expending a spell slot, but can't do so again until he finishes a short or long rest"
    const slotFree = /\bcan cast ([^.]{3,120}?)\s+(?:once each\s+)?without expending (?:a|an) (?:spell )?slot(?: slot)?,? but (?:(?:he|she|it|they) )?can(?:'|\u2019)?t do so again until (?:(?:he|she|it|they) )?finish(?:es)? a (short or long|long|short) rest/i.exec(s);
    if (slotFree) {
      const spells = scSpellsFromClause(slotFree[1], spellIndex);
      if (spells) {
        const per = scPeriodLabel(slotFree[2] + ' rest');
        spells.forEach((sp) => {
          const label = scTitleCaseSpell(sp);
          out.push({ key: 'spell:' + scNorm(label) + ':1', kind: 'spell', label: label, count: 1, usedByDefault: 0, tag: '1/' + per });
        });
        return;
      }
    }

    // "Once this property is used, it can't be used again until the next dawn." and similar "can't use it again" limits
    const cant = /\bcan(?:'|\u2019)?t\s+(?:use|do so|make|perform|cast|breathe|activate|create|change|assume|transform|take on|be used)\b[^.]{0,90}?\bagain\s+(until|for)\s+([^.]*)/i.exec(s);
    if (cant && /\bonce (?:a|an|any) creature\b|\breceived\b/i.test(s)) return;
    if (cant && !/\bnext turn\b|\bstart of (?:its|her|his|their|the)\b|\bend of (?:its|her|his|their|the)\b/i.test(cant[2])) {
      const when = cant[1] + ' ' + cant[2];
      let period = '';
      const rest = /finish(?:es)? a (short or long|long|short)? ?rest/i.exec(when);
      if (rest) period = '1/' + scPeriodLabel((rest[1] ? rest[1] + ' ' : '') + 'rest');
      else if (/next dawn|next sunrise/i.test(when)) period = '1/Day';
      else {
        const hrs = /for (\d+) (hours|days)/i.exec(when);
        period = hrs ? '1 per ' + hrs[1] + ' ' + hrs[2] : '1 use';
      }
      let base = owner;
      const first = sentences[0].replace(/^[\u2022\s-]+/, '').replace(/[.]+$/, '');
      if (unnamed && si > 0 && first.length <= 45 && /^[A-Z]/.test(first)) base = (owner ? owner + ': ' : '') + first;
      else if (!base) base = first.slice(0, 60);
      out.push({ key: 'prose:' + scNorm(base) + ':' + period, kind: 'ability', label: base + ' (' + period + ')', count: 1, usedByDefault: 0 });
      return;
    }

    // "once before the next sunrise"
    const dawn = /\bonce (?:before|until) the next (?:sunrise|dawn)\b/i.exec(s);
    if (dawn && /\b(can|may)\b/i.test(s)) {
      out.push({ key: 'prose:' + scNorm(owner) + ':1/day', kind: 'ability', label: (owner || 'Limited use') + ' (1/Day)', count: 1, usedByDefault: 0 });
      return;
    }

    // "once per day", "3 times per long rest", "once each per long rest", "three times each day"
    const re = new RegExp('\\b(?:(each)\\s+)?' + SC_COUNT_RE + '\\s+(each\\s+)?' + SC_PER_RE + '(\\s+each)?\\b', 'i');
    if (limitNoise) return;
    const m = re.exec(s);
    if (!m) {
      // "once per 30 days", and "N/day" written inside a sentence ("can use both plane shift and teleport 1/day")
      const long = /\bonce per (\d+) days\b/i.exec(s);
      if (long && /\b(can|may)\b/i.test(s)) {
        out.push({ key: 'prose:' + scNorm(owner) + ':1/' + long[1] + 'days', kind: 'ability', label: (owner || 'Limited use') + ' (1/' + long[1] + ' Days)', count: 1, usedByDefault: 0 });
        return;
      }
      const slash = /\b(\d+)\s*\/\s*(day|week|month)\b/i.exec(s);
      if (slash && /\b(can|may)\b/i.test(s) && !/\brate of\b/i.test(s) && !hasSpellLines && s.indexOf(':') === -1 && !/\bfollowing spells\b/i.test(s)) {
        const n2 = parseInt(slash[1], 10);
        let count2 = 1;
        let each2 = /\beach\b/i.test(s.slice(slash.index, slash.index + 20));
        if (/\bthese spells\b/i.test(s)) {
          let sum = 0;
          (text.match(/\b(one|two|three|four|five|six|\d+)\s+(?:\d+(?:st|nd|rd|th)[- ]level\s+)?spells?\b/gi) || []).forEach((x) => { sum += scNumberFrom(x.split(/\s+/)[0]) || 0; });
          if (sum > 0) count2 = sum;
        }
        out.push({ key: 'prose:' + scNorm(owner) + ':' + n2 + '/' + slash[2], kind: 'ability', label: (owner || 'Limited use') + (/\bthese spells\b/i.test(s) ? ' spells' : '') + ' (' + n2 + '/' + scPeriodLabel(slash[2]) + (each2 ? ' each' : '') + ')', count: /\bthese spells\b/i.test(s) ? count2 : n2, usedByDefault: 0 });
      }
      return;
    }
    const atStart = m.index === 0 || /^(?:as an? [a-z ]+ )?$/i.test(s.slice(0, m.index));
    const gateOpen = /\b(can|may)\b/i.test(s) || atStart;
    if (/\beach one\b|\beach of (?:these|those)\b/i.test(s)) return;
    const n = scCountFromWord(m[2]);
    if (!n) return;
    const eachFlag = !!(m[1] || m[3] || m[5]);
    const per = scPeriodLabel(m[4]);

    // is it a list of known spells ("can innately cast Blur, Disguise Self, and Major Image once each per long rest")?
    const before = s.slice(0, m.index);
    let clause = before;
    const castMatches = Array.from(before.matchAll(/\bcast\s+(?:the\s+)?/gi));
    if (castMatches.length > 0) {
      const last = castMatches[castMatches.length - 1];
      clause = before.slice(last.index + last[0].length);
    }
    clause = clause
      .replace(/^.*\bat will\b[,\s]*(?:and\s+)?/i, '')
      .replace(/\s+(?:spells?|innately)$/i, '')
      .replace(/^.*\bas a cantrip\b[,\s]*(?:and\s+)?/i, '')
      .trim();
    const spells = clause ? scSpellsFromClause(clause, spellIndex) : null;
    if (spells && spells.length > 0 && (castMatches.length > 0 || eachFlag)) {
      const joinedByOr = /\sor\s/i.test(clause) && !/\sand\s/i.test(clause);
      if (spells.length === 1 || !joinedByOr) {
        spells.forEach((sp) => {
          const label = scTitleCaseSpell(sp);
          out.push({ key: 'spell:' + scNorm(label) + ':' + n, kind: 'spell', label: label, count: n, usedByDefault: 0, tag: n + '/' + per, via: 'prose' });
        });
      } else {
        const label = spells.map(scTitleCaseSpell).join(' or ');
        out.push({ key: 'spell:' + scNorm(label) + ':' + n, kind: 'spell', label: label, count: n, usedByDefault: 0, tag: n + '/' + per + ' total', via: 'prose' });
      }
      return;
    }

    if (!gateOpen) return;
    const label = (owner || 'Limited use') + ' (' + n + '/' + per + ')';
    out.push({ key: 'prose:' + scNorm(owner) + ':' + n + '/' + per, kind: 'ability', label: label, count: n, usedByDefault: 0 });
  });
  return out;
}

// "The staff has 7 charges" -> a row of 7 checkboxes.
function scChargeGroups(text, owner) {
  const out = [];
  const re = /\b(?:has|have|with)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+charges?\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = scNumberFrom(m[1]);
    if (!n) continue;
    out.push({ key: 'charges:' + scNorm(owner) + ':' + n, kind: 'ability', label: (owner ? owner + ': ' : '') + 'charges', count: n, usedByDefault: 0 });
  }
  return out;
}

// ---------- reactions ----------

// How many reactions the stat block says it has. Normally 1.
function scReactionCount(html) {
  const text = scPlain(html.replace(/<h4>[\s\S]*?<\/h4>/g, ' '));
  let best = 1;
  let m;
  const re1 = /\b(?:can|may)\s+take\s+(\d+|one|two|three|four|five|six)\s+reactions?\s+(?:per|each|every)\s+round/gi;
  while ((m = re1.exec(text)) !== null) best = Math.max(best, scNumberFrom(m[1]) || 1);
  const re2 = /\b(?:has|have)\s+(\d+|one|two|three|four|five|six)\s+reactions?\b/gi;
  while ((m = re2.exec(text)) !== null) best = Math.max(best, scNumberFrom(m[1]) || 1);
  const re3 = /\b(?:gets|gains|has|have)\s+(?:up to\s+)?(\d+|one|two|three|four|five|six)\s+extra\s+reactions?\b/gi;
  while ((m = re3.exec(text)) !== null) best = Math.max(best, 1 + (scNumberFrom(m[1]) || 0));
  return best;
}

// ---------- the main reader ----------

function scOwnerForProse(b, ctxName) {
  return b.name ? b.name.replace(/[.\s]+$/, '') : ctxName;
}

function scSectionIsUsable(section, legendaryReal) {
  if (section === 'Traits' || section === 'Actions' || section === 'Bonus Actions' || section === 'Reactions') return true;
  if (section === 'Legendary Actions') return legendaryReal;
  return false;
}

function scExtractGroups(html, spellIndex) {
  const blocks = scTrimLoreFromLegendary(scParseBlocks(html));
  const groups = [];
  const keyCount = {};
  let ctxName = '';
  let ctxSection = '';
  let curBlock = -1;

  function add(group) {
    group.owner = ctxName;
    group.block = curBlock;
    group.section = ctxSection;
    if (keyCount[group.key]) return; // the same checkbox row is never listed twice
    keyCount[group.key] = 1;
    groups.push(group);
  }

  const legendaryReal = scLegendarySectionIsReal(blocks);

  // legendary action count: from a sentence, or from a name like "Legendary Actions (3/Turn)"
  let legendaryCount = null;
  blocks.forEach((b) => {
    if (!scSectionIsUsable(b.section, legendaryReal)) return;
    const n = scLegendaryCountFromText((b.name ? b.name + '. ' : '') + b.text);
    if (n !== null && legendaryCount === null) legendaryCount = n;
    if (b.name && /^legendary actions?\b/i.test(b.name)) {
      const u = scNameUsage(b.name, b.text);
      if (u && u.usage.kind === 'uses' && legendaryCount === null) legendaryCount = u.usage.total;
    }
  });
  if (legendaryCount === null && legendaryReal) legendaryCount = 3;
  let legendaryAdded = false;

  blocks.forEach((b, bi) => {
    curBlock = bi;
    if (b.section !== ctxSection) {
      ctxSection = b.section;
      ctxName = '';
    }
    if (!scSectionIsUsable(b.section, legendaryReal)) return;
    if (b.name) ctxName = b.name.replace(/[.\s]+$/, '');

    if (b.section === 'Legendary Actions' && !legendaryAdded && legendaryCount !== null) {
      add({ key: 'legendary-actions', kind: 'legendary', label: 'Legendary Actions', count: legendaryCount, usedByDefault: 0, tag: '' });
      legendaryAdded = true;
    }

    let handledAsNameCounter = false;

    // 1. a usage note in the feature's name: "Legendary Resistance (3/Day)", "Fire Breath (Recharge 5-6)"
    if (b.name) {
      const nu = scNameUsage(b.name, b.text);
      if (nu && !/^legendary actions?\b/i.test(b.name)) {
        handledAsNameCounter = true;
        if (nu.usage.kind === 'recharge') {
          add({ key: 'ability:' + scNorm(nu.label), kind: 'recharge', label: nu.label, count: 1, usedByDefault: 0, tag: '' });
        } else {
          add({ key: 'ability:' + scNorm(nu.label), kind: 'ability', label: nu.label, count: nu.usage.total, usedByDefault: nu.usage.total - nu.usage.base, tag: '' });
        }
      }
    }

    // 1b. usage notes written without bold, or in the middle of a paragraph
    if (!handledAsNameCounter) {
      const found = [];
      if (!b.name) scPlainNameUsage(b.text).forEach((x) => found.push(x));
      scMidNameUsage(b.text).forEach((x) => found.push(x));
      found.forEach((nu) => {
        if (nu.usage.kind === 'recharge') {
          add({ key: 'ability:' + scNorm(nu.label), kind: 'recharge', label: nu.label, count: 1, usedByDefault: 0, tag: '' });
        } else {
          add({ key: 'ability:' + scNorm(nu.label), kind: 'ability', label: nu.label, count: nu.usage.total, usedByDefault: nu.usage.total - nu.usage.base, tag: '' });
        }
      });
      if (found.length > 0) handledAsNameCounter = true;
    }

    // 2. spell slots
    scSlotLines(b.text).forEach((s) => {
      add({
        key: 'slots:' + s.level + (s.range ? ':' + s.range : ''),
        kind: 'slots',
        label: s.level + ' level slots' + (s.range ? ' (' + s.range + ')' : ''),
        count: s.n,
        usedByDefault: 0,
        tag: ''
      });
    });

    // 3. spells with uses per day (the list may even start in the bold name: "1/day each.")
    const spellText = b.name && /^\d+\s*\/\s*(?:day|week|month|hour|rest|short rest|long rest)(?:\s+each)?\.?$/i.test(b.name) ? b.name.replace(/\.$/, '') + ': ' + b.text : b.text;
    if (/\(\s*\d+\s*\/\s*day\s*\)/i.test(b.text) && /spell|magic|cast/i.test(ctxName + ' ' + b.text)) {
      scInlineSpellUses(b.text, spellIndex).forEach((u) => {
        const label = scTitleCaseSpell(u.name);
        add({ key: 'spell:' + scNorm(label) + ':' + u.n + 'Day', kind: 'spell', label: label, count: u.n, usedByDefault: 0, tag: u.n + '/Day' });
      });
    }
    const spellSegments = scSpellSegments(spellText, spellIndex);
    spellSegments.forEach((seg) => {
      seg.items.forEach((spell) => {
        const label = scTitleCaseSpell(spell) + (seg.qualifier ? ' (' + seg.qualifier + ')' : '');
        add({ key: 'spell:' + scNorm(label) + ':' + seg.n + seg.period, kind: 'spell', label: label, count: seg.n, usedByDefault: 0, tag: seg.n + '/' + seg.period });
      });
    });
    // 4. limits written in plain words, and charges
    if (!handledAsNameCounter && !b.name || (b.name && !handledAsNameCounter)) {
      scProseGroups(b.text, scOwnerForProse(b, ctxName), spellIndex, !b.name, spellSegments.length > 0).forEach((g) => add(g));
    }
    scChargeGroups(b.text, scOwnerForProse(b, ctxName)).forEach((g) => add(g));
  });

  return groups;
}


// ---- AC / HP FIELDS IN THE TURN ORDER ----

// What to show in an AC / HP field: the number, or nothing if there isn't one.
function statFieldValue(value) {
  return typeof value === 'number' && !isNaN(value) ? value : '';
}

// Reads the AC or HP number printed on a stat block ("AC 19 (...)",
// "HP 212 (25d8 + 100)"). label is 'AC' or 'HP'. Returns null if not found.
function readStatBlockNumber(statBlockEl, label) {
  if (!statBlockEl) return null;
  const labels = statBlockEl.querySelectorAll('p > strong');
  for (const el of labels) {
    if (el.textContent.trim() !== label) continue;
    const match = new RegExp('\\b' + label + '\\s*([\\d,]+)').exec(el.parentElement.textContent);
    if (match) {
      const value = parseInt(match[1].replace(/,/g, ''), 10);
      if (!isNaN(value)) return value;
    }
  }
  return null;
}

// Players (combatants that did NOT come from a stat block) get their AC and
// HP remembered by name, so the next time that name is added the fields are
// already filled in. Monsters are never remembered.
function rememberPlayerStat(combatant, field) {
  if (combatant.statBlockId) return;
  const key = String(combatant.name).trim().toLowerCase();
  if (!key) return;
  const profile = playerProfiles[key] || {};
  if (typeof combatant[field] === 'number') profile[field] = combatant[field];
  else delete profile[field];
  if (Object.keys(profile).length === 0) delete playerProfiles[key];
  else playerProfiles[key] = profile;
}

// Called when you click away from (or press Enter in) an AC or HP field.
// The list is deliberately NOT rebuilt here (AC/HP never change the order),
// so pressing Tab to jump from one field to the next keeps working.
function commitStatEdit(input) {
  const combatant = combatants.find((c) => c.id === input.dataset.id);
  if (!combatant) return;
  const field = input.dataset.field === 'hp' ? 'hp' : 'ac';

  const raw = input.value.trim();
  const parsed = raw === '' ? null : parseFloat(raw);
  const value = parsed === null || isNaN(parsed) ? null : parsed;
  input.value = value === null ? '' : value;

  const current = typeof combatant[field] === 'number' ? combatant[field] : null;
  if (value === current) return;

  pushUndoSnapshot();
  combatant[field] = value;
  rememberPlayerStat(combatant, field);
  save();
}

// ---- CLICKABLE TEXT IN STAT BLOCKS ----
// Done the same way Improved Initiative does it. Inside every stat block (in
// the Reference pane and in the Combat pane) the text is scanned and:
//   - dice expressions ("2d6 + 2") and loose modifiers ("+7", "-1") become
//     rollable. A loose modifier rolls a d20 plus that modifier.
//   - the name of every spell on this site, and the name of every condition,
//     becomes a link to its entry in the Reference pane.
// There are no exceptions or context rules: every match is clickable (matching
// ignores capitalization and whole words only, like Improved Initiative).
// This runs automatically on every stat block the moment it is built, so any
// stat block added in the future gets it too.

const STAT_DICE_SOURCE = '(\\d*d\\d+(?:\\s*[+\\-\\u2212]\\s*\\d+)?|[+\\-\\u2212]\\s*\\d+)';
let statRefIndex = null;

// Builds (once) the list of spell and condition names found in the Reference
// pane, and one regular expression that finds any of them.
function getStatRefIndex() {
  if (statRefIndex) return statRefIndex;

  const targets = new Map(); // lowercase name -> id of its Reference entry
  const addName = (name, id) => {
    const key = String(name).replace(/\u2019/g, "'").trim().toLowerCase();
    if (key.length > 2 && !targets.has(key)) targets.set(key, id);
  };

  document.querySelectorAll('details[id^="spell-"]').forEach((el) => {
    if (el.id.indexOf('spell-school-') === 0) return;
    const summaryEl = el.querySelector(':scope > summary');
    if (!summaryEl) return;
    const title = summaryEl.textContent.trim();
    addName(title, el.id);
    // "Blindness / Deafness": also match "Blindness/Deafness" and each half.
    if (title.indexOf(' / ') !== -1) {
      addName(title.replace(/\s*\/\s*/g, '/'), el.id);
      title.split(' / ').forEach((part) => addName(part, el.id));
    }
  });

  document.querySelectorAll('details[id^="condition-"]').forEach((el) => {
    const summaryEl = el.querySelector(':scope > summary');
    if (summaryEl) addName(summaryEl.textContent.trim(), el.id);
  });

  const names = Array.from(targets.keys()).sort((a, b) => b.length - a.length);
  const regexSource = names.length > 0 ? '\\b(' + names.map(escapeRegex).join('|') + ')\\b' : null;
  statRefIndex = { targets: targets, regexSource: regexSource };
  return statRefIndex;
}

// Turns "2d6 + 2", "d20", "+7", "- 1" into { count, sides, modifier }.
// A loose modifier means a d20 roll.
function parseRollExpression(raw) {
  const text = String(raw).replace(/\u2212/g, '-').trim();
  const dice = /^(\d*)d(\d+)\s*([+\-]\s*\d+)?$/i.exec(text);
  if (dice) {
    return {
      count: dice[1] === '' ? 1 : parseInt(dice[1], 10),
      sides: Math.max(1, parseInt(dice[2], 10)),
      modifier: dice[3] ? parseInt(dice[3].replace(/\s+/g, ''), 10) : 0
    };
  }
  const loose = /^([+\-])\s*(\d+)$/.exec(text);
  if (loose) return { count: 1, sides: 20, modifier: parseInt(loose[1] + loose[2], 10) };
  return null;
}

function rollParsedExpression(parsed) {
  const count = Math.min(Math.max(parsed.count, 0), 200);
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(rollDie(parsed.sides));
  const total = rolls.reduce((sum, r) => sum + r, 0) + parsed.modifier;
  return { rolls: rolls, total: total };
}

function formatRollModifier(modifier) {
  if (modifier === 0) return '';
  return ' ' + (modifier > 0 ? '+' : '-') + ' ' + Math.abs(modifier);
}

// Finds the dice, spell names and condition names inside one piece of text
// and wraps each in a clickable <span class="stat-click ...">.
function enrichTextNode(node, refIndex, diceOnly) {
  const text = node.nodeValue;
  const norm = text.replace(/\u2019/g, "'"); // same length as text, so positions line up
  const found = [];
  let m;

  const diceRe = new RegExp(diceOnly ? SPELL_DICE_SOURCE : STAT_DICE_SOURCE, 'gi');
  while ((m = diceRe.exec(norm)) !== null) {
    const first = m[0].charAt(0);
    const startsWithDie = /[0-9dD]/.test(first);
    const prev = m.index > 0 ? norm.charAt(m.index - 1) : '';
    const next = norm.charAt(m.index + m[0].length);
    if (startsWithDie && (/[A-Za-z0-9]/.test(prev) || /[A-Za-z]/.test(next))) continue; // part of a longer word
    found.push({ start: m.index, end: m.index + m[0].length, kind: 'roll', value: m[0] });
  }

  if (!diceOnly && refIndex.regexSource) {
    const refRe = new RegExp(refIndex.regexSource, 'gi');
    while ((m = refRe.exec(norm)) !== null) {
      const id = refIndex.targets.get(m[0].toLowerCase());
      if (id) found.push({ start: m.index, end: m.index + m[0].length, kind: 'ref', value: id });
    }
  }
  if (found.length === 0) return;

  // When two matches overlap, the earlier one wins (a dice roll wins a tie).
  found.sort((a, b) => a.start - b.start || (a.kind === 'roll' ? -1 : 1) - (b.kind === 'roll' ? -1 : 1) || b.end - a.end);
  const accepted = [];
  let lastEnd = 0;
  found.forEach((f) => {
    if (f.start >= lastEnd) {
      accepted.push(f);
      lastEnd = f.end;
    }
  });

  const frag = document.createDocumentFragment();
  let pos = 0;
  accepted.forEach((f) => {
    if (f.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, f.start)));
    const span = document.createElement('span');
    span.tabIndex = 0;
    if (f.kind === 'roll') {
      span.className = 'stat-click stat-roll';
      span.dataset.roll = f.value.replace(/\s+/g, ' ').trim();
      span.setAttribute('role', 'button');
    } else {
      span.className = 'stat-click stat-ref';
      span.dataset.ref = f.value;
      span.setAttribute('role', 'link');
    }
    span.textContent = text.slice(f.start, f.end);
    frag.appendChild(span);
    pos = f.end;
  });
  if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
  node.parentNode.replaceChild(frag, node);
}

function enrichStatBlock(block) {
  if (block.dataset.enriched === '1') return;
  block.dataset.enriched = '1';
  const refIndex = getStatRefIndex();

  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (parent && parent.closest('.stat-click, a, button, input, textarea, script, style, .stat-source')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  nodes.forEach((n) => enrichTextNode(n, refIndex));
}

// Makes every stat block inside rootEl (or rootEl itself) clickable.
function enrichStatBlocks(rootEl) {
  if (!rootEl) return;
  if (rootEl.matches && rootEl.matches('.stat-block')) enrichStatBlock(rootEl);
  rootEl.querySelectorAll('.stat-block').forEach(enrichStatBlock);
}

// ---- DICE ROLL POP-UPS ----
// Clicking a rollable value rolls it and shows a small square (a "card")
// floating over the lower-left corner of the Combat pane, with the total,
// the individual dice, and a Reroll button. If the Combat pane is hidden (or
// scrolled out of reach) the result is shown as a message instead.

// Rolls the expression once, or twice for advantage / disadvantage (keeping the higher / lower total).
// The discarded roll is kept so the pop-up can show it.
function rollWithMode(parsed, mode) {
  const first = rollParsedExpression(parsed);
  if (mode !== 'advantage' && mode !== 'disadvantage') return first;
  const second = rollParsedExpression(parsed);
  const keepFirst = mode === 'advantage' ? first.total >= second.total : first.total <= second.total;
  const kept = keepFirst ? first : second;
  const dropped = keepFirst ? second : first;
  return { rolls: kept.rolls, total: kept.total, mode: mode, dropped: dropped };
}

function appendRollChips(container, parsed, rolls, total) {
  rolls.forEach((value) => {
    const chip = document.createElement('span');
    chip.className = 'roll-chip';
    if (value === parsed.sides) chip.classList.add('roll-chip-max');
    if (value === 1) chip.classList.add('roll-chip-min');
    chip.textContent = value;
    container.appendChild(chip);
  });
  const calc = document.createElement('span');
  calc.textContent = (formatRollModifier(parsed.modifier).trim() + ' = ' + total).trim();
  container.appendChild(calc);
}

function updateRollCard(card, parsed, result) {
  card.querySelector('.roll-card-total').textContent = result.total;
  const modeText = result.mode === 'advantage' ? ' (advantage)' : result.mode === 'disadvantage' ? ' (disadvantage)' : '';
  card.querySelector('.roll-card-expr').textContent =
    'Rolled ' + parsed.count + 'd' + parsed.sides + formatRollModifier(parsed.modifier) + modeText;

  const rollsEl = card.querySelector('.roll-card-rolls');
  rollsEl.innerHTML = '';
  appendRollChips(rollsEl, parsed, result.rolls, result.total);

  const droppedEl = card.querySelector('.roll-card-dropped');
  droppedEl.innerHTML = '';
  if (result.dropped) {
    const label = document.createElement('span');
    label.className = 'roll-card-dropped-label';
    label.textContent = 'Discarded:';
    droppedEl.appendChild(label);
    appendRollChips(droppedEl, parsed, result.dropped.rolls, result.dropped.total);
  }
}

// How many roll pop-ups fit side by side across the screen (always at least 4). When the window gets
// narrower, the oldest pop-ups are closed to make room (see trimRollCards).
const ROLL_CARD_WIDTH = 150; // keep in step with .roll-card in styles.css
const ROLL_CARD_GAP = 8;     // keep in step with .roll-cards in styles.css

function getMaxRollCards() {
  const dock = document.getElementById('rollDock');
  const left = dock ? parseFloat(dock.style.left) : NaN;
  const startX = isNaN(left) ? 8 : left;
  const available = window.innerWidth - startX - 8;
  return Math.max(4, Math.floor((available + ROLL_CARD_GAP) / (ROLL_CARD_WIDTH + ROLL_CARD_GAP)));
}

function trimRollCards() {
  const cardsEl = document.getElementById('rollCards');
  if (!cardsEl) return;
  const max = getMaxRollCards();
  while (cardsEl.children.length > max) cardsEl.removeChild(cardsEl.firstChild);
  updateRollDock();
}

// Lines the roll cards up with the left edge of the Combat pane. Returns
// false if the Combat pane isn't on screen.
function syncRollDock() {
  const dock = document.getElementById('rollDock');
  const pane = document.getElementById('paneGroup');
  if (!dock || !pane) return false;
  const hidden = pane.classList.contains('column-collapsed') || pane.getBoundingClientRect().width < 100;
  dock.classList.toggle('hidden', hidden);
  if (hidden) return false;
  dock.style.left = Math.max(8, pane.getBoundingClientRect().left + 8) + 'px';
  return true;
}

const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

// Who made a roll: the creature whose stat block it is in (or the spell / entry the dice are in). In the
// Combat pane, each stat block belongs to one combatant, so that combatant's own name is used
// (for example "Goblin 2").
function getRollOwnerName(el) {
  const refCard = el.closest('.combat-ref-card');
  if (refCard) {
    const titleEl = refCard.querySelector('.combat-ref-title');
    return titleEl ? titleEl.textContent.trim() : '';
  }
  const spell = el.closest('details[id^="spell-"]');
  if (spell) return getMonsterTitle(spell.id);
  const monster = el.closest('details[id^="monster-"]');
  if (monster) return getMonsterTitle(monster.id);
  const block = el.closest('.stat-block');
  const head = block ? block.previousElementSibling : null;
  if (head && head.tagName === 'H4') {
    const owner = head.dataset.combatantId ? combatants.find((c) => c.id === head.dataset.combatantId) : null;
    return owner ? owner.name : head.textContent.trim();
  }
  return '';
}

// What the roll was, worked out from where it sits in the stat block:
// "Dexterity save", "Arcana check", "Initiative", "Scimitar attack",
// "Scimitar damage", ...
function getRollDescription(el, expression) {
  if (el.closest('details[id^="spell-"], .combat-ref-card')) return describeSpellRoll(el);

  const cell = el.closest('td');
  if (cell && cell.closest('.stat-abilities')) {
    let abilityCell = null;
    for (let n = cell.previousElementSibling; n; n = n.previousElementSibling) {
      if (n.tagName === 'TH') {
        abilityCell = n;
        break;
      }
    }
    const headRow = cell.closest('table').querySelector('thead tr');
    const index = Array.prototype.indexOf.call(cell.parentElement.children, cell);
    const headCell = headRow ? headRow.children[index] : null;
    const kind = headCell ? headCell.textContent.trim().toLowerCase() : '';
    const abbreviation = abilityCell ? abilityCell.textContent.trim().toLowerCase() : '';
    const name = ABILITY_NAMES[abbreviation] || (abilityCell ? abilityCell.textContent.trim() : 'Ability');
    return name + (kind === 'save' ? ' save' : kind === 'mod' ? ' check' : '');
  }

  const block = el.closest('p, li');
  if (!block) return '';

  // The closest bold label in front of the roll: "Initiative", "Skills",
  // "Scimitar", and so on.
  let strong = null;
  block.querySelectorAll('strong').forEach((s) => {
    if (s.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) strong = s;
  });
  const label = strong
    ? strong.textContent.trim().replace(/[.:]+$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim()
    : '';
  const lower = label.toLowerCase();

  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEndBefore(el);
  const before = range.toString();
  range.selectNodeContents(block);
  range.setStartAfter(el);
  const after = range.toString().slice(0, 90);

  if (lower === 'initiative') return 'Initiative';
  if (lower === 'skills') {
    const skill = before.split(/[,;]/).pop().replace(/^\s*Skills\s*/i, '').trim();
    return skill ? skill + ' check' : 'Skill check';
  }
  if (lower === 'saves' || lower === 'saving throws' || lower === 'saving throw') {
    const ability = before.split(/[,;]/).pop().replace(/^\s*(Saves|Saving Throws?)\s*/i, '').trim().toLowerCase();
    return (ABILITY_NAMES[ability.slice(0, 3)] || ability || 'Saving') + ' save';
  }
  if (lower === 'hp') return 'Hit points';
  if (lower === 'ac') return 'Armor class';
  if (lower === 'cr') return /PB\s*$/i.test(before) ? 'Proficiency bonus' : 'Challenge rating';
  if (!label) return '';
  if (/^\s*to hit/i.test(after)) return label + ' attack';
  if (/d\d/i.test(expression) && /^[^.]{0,70}\bdamage\b/i.test(after)) return label + ' damage';
  return label;
}

function describeRollSource(el) {
  return { who: getRollOwnerName(el), what: getRollDescription(el, el.dataset.roll || '') };
}

// The "close all" cross is only shown while two or more roll cards are open.
function updateRollDock() {
  const cardsEl = document.getElementById('rollCards');
  const clearBtn = document.getElementById('rollDockClearAll');
  if (cardsEl && clearBtn) clearBtn.classList.toggle('hidden', cardsEl.children.length < 2);
}

function rollFromStatBlock(expression, sourceEl) {
  const parsed = parseRollExpression(expression);
  if (!parsed) {
    showToast('Could not read "' + expression + '" as a roll');
    return;
  }
  const result = rollParsedExpression(parsed);
  const source = sourceEl ? describeRollSource(sourceEl) : { who: '', what: '' };

  const cardsEl = document.getElementById('rollCards');
  if (!cardsEl || !syncRollDock()) {
    const who = [source.who, source.what].filter(Boolean).join(' \u00b7 ');
    showToast(
      (who ? who + ': ' : '') +
        'Rolled ' + parsed.count + 'd' + parsed.sides + formatRollModifier(parsed.modifier) +
        ': [' + result.rolls.join(', ') + ']' + formatRollModifier(parsed.modifier) + ' = ' + result.total,
      5000
    );
    return;
  }

  const card = document.createElement('div');
  card.className = 'roll-card';
  card.innerHTML =
    '<button type="button" class="roll-card-close" aria-label="Close">\u00d7</button>' +
    '<div class="roll-card-who"></div>' +
    '<div class="roll-card-what"></div>' +
    '<div class="roll-card-total"></div>' +
    '<div class="roll-card-expr"></div>' +
    '<div class="roll-card-rolls"></div>' +
    '<div class="roll-card-dropped"></div>' +
    '<div class="roll-card-actions">' +
    '<button type="button" class="btn-secondary roll-card-reroll">Reroll</button>' +
    '<button type="button" class="roll-card-adv" title="Reroll with advantage" aria-label="Reroll with advantage">A</button>' +
    '<button type="button" class="roll-card-dis" title="Reroll with disadvantage" aria-label="Reroll with disadvantage">D</button>' +
    '</div>';
  const whoEl = card.querySelector('.roll-card-who');
  const whatEl = card.querySelector('.roll-card-what');
  whoEl.textContent = source.who;
  whatEl.textContent = source.what;
  card.title = [source.who, source.what].filter(Boolean).join(' \u00b7 ');
  updateRollCard(card, parsed, result);

  card.querySelector('.roll-card-close').addEventListener('click', () => {
    card.remove();
    updateRollDock();
  });
  card.querySelector('.roll-card-reroll').addEventListener('click', () => {
    updateRollCard(card, parsed, rollWithMode(parsed, ''));
  });
  card.querySelector('.roll-card-adv').addEventListener('click', () => {
    updateRollCard(card, parsed, rollWithMode(parsed, 'advantage'));
  });
  card.querySelector('.roll-card-dis').addEventListener('click', () => {
    updateRollCard(card, parsed, rollWithMode(parsed, 'disadvantage'));
  });

  cardsEl.appendChild(card);
  trimRollCards();
}

// ---- REFERENCE POP-UPS IN THE COMBAT PANE ----
// When the Reference pane is hidden (the Combat pane is maximized), clicking a
// spell or condition in the Combat pane's stat block shows that Reference
// entry in a box under the stat block instead of jumping to the Reference pane.

function isReferencePaneCollapsed() {
  const pane = document.getElementById('paneLookup');
  return !pane || pane.classList.contains('column-collapsed');
}

function clearReferencePopups() {
  const container = document.getElementById('combatReferencePopups');
  if (container) container.innerHTML = '';
}

function showReferencePopup(targetId) {
  const target = document.getElementById(targetId);
  const container = document.getElementById('combatReferencePopups');
  if (!target || !container) {
    showToast('That entry could not be found');
    return;
  }
  fillLazyEntry(target, true);
  enrichSpellEntry(target);

  const summaryEl = target.querySelector(':scope > summary');
  const bodyEl = target.querySelector(':scope > .condition-body, :scope > .dropdown-body');

  Array.from(container.children).forEach((existing) => {
    if (existing.dataset.target === targetId) container.removeChild(existing);
  });

  const card = document.createElement('div');
  card.className = 'combat-ref-card';
  card.dataset.target = targetId;

  const head = document.createElement('div');
  head.className = 'combat-ref-head';
  const title = document.createElement('h4');
  title.className = 'combat-ref-title';
  title.textContent = summaryEl ? summaryEl.textContent.trim() : targetId;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'combat-ref-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', () => card.remove());
  head.appendChild(title);
  head.appendChild(closeBtn);
  card.appendChild(head);

  // Copy the entry's own content (not its search bars or nested entries).
  const content = document.createElement('div');
  content.className = 'dropdown-body combat-ref-body';
  if (bodyEl) {
    Array.from(bodyEl.children).forEach((child) => {
      if (
        child.tagName === 'DETAILS' ||
        child.classList.contains('dropdown-search-row') ||
        child.classList.contains('add-to-combat-row') ||
        child.classList.contains('condition-list')
      ) {
        return;
      }
      content.appendChild(child.cloneNode(true));
    });
  }
  card.appendChild(content);

  container.appendChild(card);
  while (container.children.length > 6) container.removeChild(container.firstChild);
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// A click on a spell or condition name inside a stat block.
function openStatReference(targetId, sourceEl) {
  if (!document.getElementById(targetId)) {
    showToast('That entry could not be found');
    return;
  }
  if (sourceEl.closest('#paneGroup') && isReferencePaneCollapsed()) {
    showReferencePopup(targetId);
    return;
  }
  const sourceDetails = sourceEl.closest('details');
  openReference(targetId, sourceDetails ? sourceDetails.id : null);
}

function handleStatClick(el) {
  if (el.dataset.roll) rollFromStatBlock(el.dataset.roll, el);
  else if (el.dataset.ref) openStatReference(el.dataset.ref, el);
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

// ---- CARRYING & ENCUMBRANCE CALCULATOR ----
// A Small or Medium creature can carry 15 x its Strength score in
// pounds and can drag, push, or lift twice that amount — this is the
// same rule already summarized as a flat table in the Rules Glossary's
// "Carrying Capacity" entry, just calculated live here instead. Each
// size category above Medium doubles both totals (Large x2, Huge x4,
// Gargantuan x8); a Tiny creature halves them (x0.5). The optional
// Encumbrance thresholds (5x/10x/15x Strength) scale by the same size
// multiplier.

// Formats a carrying-capacity weight for display: drops the decimal
// entirely for whole numbers, otherwise keeps exactly one decimal
// place (weights here are always either whole or an exact half, since
// Strength is always a whole number and the size multiplier is always
// 0.5, 1, 2, 4, or 8).
function formatCarryWeight(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// Recalculates every Carrying & Encumbrance result from the current
// Strength score and chosen size, and writes the results into the page.
function computeCarryingEncumbrance() {
  const strRaw = parseFloat(document.getElementById('carryStr').value);
  const str = isNaN(strRaw) ? 10 : strRaw;
  const sizeMod = parseFloat(document.getElementById('carrySize').value) || 1;

  // "Size Mod" is only shown in the calculation text when it isn't 1 —
  // Small and Medium creatures use the base 15x/30x/5x/10x/15x formula
  // with no size multiplier called out at all, matching how the
  // official rule is normally written.
  const sizeModDisplay = sizeMod === 0.5 ? '½' : String(sizeMod);
  const sizeSuffix = sizeMod !== 1 ? ' x Size Mod [x' + sizeModDisplay + ']' : '';

  const carryCapacity = 15 * str * sizeMod;
  const dragPushLift = 30 * str * sizeMod;
  const regularMax = 5 * str * sizeMod;
  const heavyThreshold = 10 * str * sizeMod;
  const overThreshold = 15 * str * sizeMod;

  document.getElementById('carryStrHeader1').textContent = str;
  document.getElementById('carryStrHeader2').textContent = str;

  document.getElementById('carryCalcCarry').textContent = '15 x Str [' + str + ']' + sizeSuffix;
  document.getElementById('carryResultCarry').textContent = formatCarryWeight(carryCapacity) + ' lbs.';

  document.getElementById('carryCalcDrag').textContent = '2x or 30 x Str [' + str + ']' + sizeSuffix;
  document.getElementById('carryResultDrag').textContent = formatCarryWeight(dragPushLift) + ' lbs.';

  document.getElementById('carryCalcRegular').textContent = '\u2264 5 x Str [' + str + ']' + sizeSuffix;
  document.getElementById('carryResultRegular').textContent = '\u2264 ' + formatCarryWeight(regularMax) + ' lbs.';

  document.getElementById('carryCalcEncumbered').textContent = '> 5 x Str [' + str + ']' + sizeSuffix;
  document.getElementById('carryResultEncumbered').textContent = '> ' + formatCarryWeight(regularMax) + ' lbs.';

  document.getElementById('carryCalcHeavy').textContent = '> 10 x Str [' + str + ']' + sizeSuffix;
  document.getElementById('carryResultHeavy').textContent = '> ' + formatCarryWeight(heavyThreshold) + ' lbs.';

  document.getElementById('carryCalcOver').textContent = '> 15 x Str [' + str + ']' + sizeSuffix;
  document.getElementById('carryResultOver').textContent = '> ' + formatCarryWeight(overThreshold) + ' lbs.';
}

// ---- DOWNTIME: BUY A MAGIC ITEM CALCULATOR ----
// Xanathar's Guide to Everything: finding a magic item to buy takes at
// least 1 workweek and 100 gp. Every additional 100 gp spent (beyond
// the first 100) or every additional workweek spent (beyond the
// first) gives a cumulative +1 bonus on the Persuasion check, up to a
// combined maximum of +10 from both sources together.

// Recalculates the live "search bonus" display from the money/time
// fields, and returns the numeric bonus for use when rolling.
function computeBuyMagicItemSearchBonus() {
  const moneyRaw = parseFloat(document.getElementById('buyItemMoneySpent').value);
  const timeRaw = parseFloat(document.getElementById('buyItemTimeSpent').value);
  const money = isNaN(moneyRaw) ? 100 : moneyRaw;
  const time = isNaN(timeRaw) ? 1 : timeRaw;

  const moneyBonus = Math.max(0, Math.floor((money - 100) / 100));
  const timeBonus = Math.max(0, Math.floor(time - 1));
  const combined = Math.min(moneyBonus + timeBonus, 10);

  document.getElementById('buyItemSearchBonus').textContent = (combined >= 0 ? '+' : '') + combined;
  return combined;
}

// Looks up the "Items Available" row for a given Persuasion check total.
function buyMagicItemResultForTotal(total) {
  if (total <= 5) return 'Roll 1d6 times on Magic Item Table A';
  if (total <= 10) return 'Roll 1d4 times on Magic Item Table B';
  if (total <= 15) return 'Roll 1d4 times on Magic Item Table C';
  if (total <= 20) return 'Roll 1d4 times on Magic Item Table D';
  if (total <= 25) return 'Roll 1d4 times on Magic Item Table E';
  if (total <= 30) return 'Roll 1d4 times on Magic Item Table F';
  if (total <= 35) return 'Roll 1d4 times on Magic Item Table G';
  if (total <= 40) return 'Roll 1d4 times on Magic Item Table H';
  return 'Roll 1d4 times on Magic Item Table I';
}

// Rolls 1d20 and adds the Persuasion modifier, the live search bonus,
// and the chosen campaign modifier, then displays the breakdown and
// the resulting Items Available row.
function rollBuyMagicItemCheck() {
  const searchBonus = computeBuyMagicItemSearchBonus();
  const persuasionRaw = parseFloat(document.getElementById('buyItemPersuasionMod').value);
  const persuasionMod = isNaN(persuasionRaw) ? 0 : persuasionRaw;
  const campaignMod = parseFloat(document.getElementById('buyItemCampaignMod').value) || 0;

  const d20 = rollDie(20);
  const total = d20 + persuasionMod + searchBonus + campaignMod;

  let html = `<strong>${d20}</strong> [d20] + ${persuasionMod} [Persuasion] + ${searchBonus} [search bonus]`;
  if (campaignMod !== 0) {
    html += ` ${campaignMod > 0 ? '+' : '-'} ${Math.abs(campaignMod)} [campaign]`;
  }
  html += ` = <strong>${total}</strong><br>${buyMagicItemResultForTotal(total)}`;

  document.getElementById('buyItemRollResult').innerHTML = html;
}

// Rolls 1d12 on the (optional) Magic Item Purchase Complication table.
const BUY_MAGIC_ITEM_COMPLICATIONS = {
  1: "The item is a fake, planted by an enemy.†",
  2: "The item is stolen by the party's enemies.†",
  3: "The item is cursed by a god.",
  4: "The item's original owner will kill to reclaim it; the party's enemies spread news of its sale.†",
  5: "The item is at the center of a dark prophecy.",
  6: "The seller is murdered before the sale.",
  7: "The seller is a devil looking to make a bargain.",
  8: "The item is the key to freeing an evil entity.",
  9: "A third party bids on the item, doubling its price.†",
  10: "The item is an enslaved, intelligent entity.",
  11: "The item is tied to a cult.",
  12: "The party's enemies spread rumors that the item is an artifact of evil.†"
};

function rollBuyMagicItemComplication() {
  const roll = rollDie(12);
  document.getElementById('buyItemComplicationResult').innerHTML =
    `<strong>d12 = ${roll}</strong>: ${BUY_MAGIC_ITEM_COMPLICATIONS[roll]}`;
}

// ---- DOWNTIME: CAROUSING CALCULATOR ----
// A single Persuasion check against a flat lookup table — social class
// only affects the gp cost (shown for reference in the dropdown text),
// not the check itself, so the calculator just needs the modifier.

function carousingResultForTotal(total) {
  if (total <= 5) return 'The character has made a hostile contact.';
  if (total <= 10) return 'The character makes no new contacts.';
  if (total <= 15) return 'The character makes one allied contact.';
  if (total <= 20) return 'The character makes two allied contacts.';
  return 'The character makes three allied contacts.';
}

function rollCarousing() {
  const modRaw = parseFloat(document.getElementById('carousePersuasionMod').value);
  const mod = isNaN(modRaw) ? 0 : modRaw;
  const d20 = rollDie(20);
  const total = d20 + mod;
  document.getElementById('carouseRollResult').innerHTML =
    `<strong>${d20}</strong> [d20] + ${mod} [Persuasion] = <strong>${total}</strong><br>${carousingResultForTotal(total)}`;
}

// ---- SHARED HELPER: rolling several checks and counting successes ----
// Used by Crime (same DC for all checks), and Gambling/Pit Fighting
// (each check gets its own randomly rolled DC of 5 + 2d10, representing
// a different opponent or bout). Returns an array of
// { label, mod, dc, roll, total, success }.
function rollChecksAgainstDCs(checks, fixedDC) {
  return checks.map((c) => {
    const dc = fixedDC !== undefined ? fixedDC : (5 + rollDie(10) + rollDie(10));
    const roll = rollDie(20);
    const total = roll + c.mod;
    return { label: c.label, mod: c.mod, dc: dc, roll: roll, total: total, success: total >= dc };
  });
}

// Builds one line per check, showing its DC (only if perCheckDC is
// true, since Crime's DC is already shown once, up front), roll,
// modifier, total, and a checkmark/cross for success.
function buildCheckBreakdownHtml(results, perCheckDC) {
  return results
    .map((c) => {
      const dcPart = perCheckDC ? ` (DC ${c.dc})` : '';
      const mark = c.success ? '<span class="crit-hit">\u2713</span>' : '<span class="crit-miss">\u2717</span>';
      return `${c.label}${dcPart}: <strong>${c.roll}</strong> + ${c.mod} = <strong>${c.total}</strong> ${mark}`;
    })
    .join('<br>');
}

// ---- DOWNTIME: CRIME CALCULATOR ----
// Three checks (Stealth, Thieves' Tools, and a third skill of the
// player's choice) all against the same DC, set by the chosen target.
// 3 successes = full loot, 2 = half loot, 1 = escape with nothing,
// 0 = caught (fine equal to the full loot value, or a workweek in
// jail per 25 gp owed).

function rollCrime() {
  const [dcStr, lootStr] = document.getElementById('crimeTarget').value.split('|');
  const dc = parseInt(dcStr, 10);
  const loot = parseInt(lootStr, 10);

  const stealthMod = parseFloat(document.getElementById('crimeStealthMod').value) || 0;
  const toolsMod = parseFloat(document.getElementById('crimeToolsMod').value) || 0;
  const thirdMod = parseFloat(document.getElementById('crimeThirdMod').value) || 0;

  const results = rollChecksAgainstDCs(
    [
      { label: 'Stealth', mod: stealthMod },
      { label: "Thieves' Tools", mod: toolsMod },
      { label: 'Third check', mod: thirdMod }
    ],
    dc
  );
  const successes = results.filter((c) => c.success).length;

  let outcome;
  if (successes === 3) {
    outcome = `Full success \u2014 the character earns <strong>${loot} gp</strong>.`;
  } else if (successes === 2) {
    outcome = `Partial success \u2014 the character earns <strong>${Math.floor(loot / 2)} gp</strong>.`;
  } else if (successes === 1) {
    outcome = 'The heist fails, but the character escapes unnoticed.';
  } else {
    const jailWeeks = Math.ceil(loot / 25);
    outcome = `Caught! Pay a <strong>${loot} gp</strong> fine, or spend <strong>${jailWeeks}</strong> workweek${jailWeeks === 1 ? '' : 's'} in jail.`;
  }

  const breakdown = buildCheckBreakdownHtml(results, false);
  document.getElementById('crimeRollResult').innerHTML =
    `DC ${dc}<br>${breakdown}<br><strong>${successes} success${successes === 1 ? '' : 'es'}</strong> \u2014 ${outcome}`;
}

// ---- DOWNTIME: GAMBLING CALCULATOR ----
// Three checks (Insight, Deception, Intimidation), each against its
// own randomly rolled DC of 5 + 2d10. 3 successes doubles the bet, 2
// wins 1.5x, 1 loses half the bet, 0 loses the whole bet plus an
// equal debt.

function rollGambling() {
  const betRaw = parseFloat(document.getElementById('gambleBet').value);
  const bet = isNaN(betRaw) || betRaw < 0 ? 10 : betRaw;

  const insightMod = parseFloat(document.getElementById('gambleInsightMod').value) || 0;
  const deceptionMod = parseFloat(document.getElementById('gambleDeceptionMod').value) || 0;
  const intimidationMod = parseFloat(document.getElementById('gambleIntimidationMod').value) || 0;

  const results = rollChecksAgainstDCs([
    { label: 'Insight', mod: insightMod },
    { label: 'Deception', mod: deceptionMod },
    { label: 'Intimidation', mod: intimidationMod }
  ]);
  const successes = results.filter((c) => c.success).length;

  let outcome;
  if (successes === 3) {
    outcome = `Win <strong>${formatCarryWeight(bet * 2)} gp</strong> (twice the bet).`;
  } else if (successes === 2) {
    outcome = `Win <strong>${formatCarryWeight(bet * 1.5)} gp</strong> (the bet plus half again).`;
  } else if (successes === 1) {
    outcome = `Lose <strong>${formatCarryWeight(bet / 2)} gp</strong> (half the bet).`;
  } else {
    outcome = `Lose the entire <strong>${formatCarryWeight(bet)} gp</strong> bet, and accrue a debt of ${formatCarryWeight(bet)} gp.`;
  }

  const breakdown = buildCheckBreakdownHtml(results, true);
  document.getElementById('gambleRollResult').innerHTML =
    `${breakdown}<br><strong>${successes} success${successes === 1 ? '' : 'es'}</strong> \u2014 ${outcome}`;
}

// ---- DOWNTIME: PIT FIGHTING CALCULATOR ----
// Three checks (Athletics, Acrobatics, Constitution + largest Hit
// Die), each against its own randomly rolled DC of 5 + 2d10.
// 0/1/2/3 successes earn 0/50/100/200 gp.

function rollPitFighting() {
  const athleticsMod = parseFloat(document.getElementById('pitAthleticsMod').value) || 0;
  const acrobaticsMod = parseFloat(document.getElementById('pitAcrobaticsMod').value) || 0;
  const conMod = parseFloat(document.getElementById('pitConMod').value) || 0;

  const results = rollChecksAgainstDCs([
    { label: 'Athletics', mod: athleticsMod },
    { label: 'Acrobatics', mod: acrobaticsMod },
    { label: 'Constitution', mod: conMod }
  ]);
  const successes = results.filter((c) => c.success).length;
  const winnings = [0, 50, 100, 200][successes];
  const outcome = successes === 0 ? 'Lose all bouts, earning nothing.' : `Win <strong>${winnings} gp</strong>.`;

  const breakdown = buildCheckBreakdownHtml(results, true);
  document.getElementById('pitRollResult').innerHTML =
    `${breakdown}<br><strong>${successes} success${successes === 1 ? '' : 'es'}</strong> \u2014 ${outcome}`;
}

// ---- DOWNTIME: RESEARCH CALCULATOR ----
// A single Intelligence check, boosted by gold spent (+1 per 100 gp
// beyond the base 50 gp, capped at +6) and optionally rolled with
// Advantage if the character has library/sage access.

function computeResearchGoldBonus() {
  const goldRaw = parseFloat(document.getElementById('researchGoldSpent').value);
  const gold = isNaN(goldRaw) ? 50 : goldRaw;
  const bonus = Math.min(Math.max(0, Math.floor((gold - 50) / 100)), 6);
  document.getElementById('researchGoldBonus').textContent = '+' + bonus;
  return bonus;
}

function researchResultForTotal(total) {
  if (total <= 5) return 'No useful information is found.';
  if (total <= 10) return 'The character learns one piece of information relevant to their research.';
  if (total <= 20) return 'The character learns two pieces of information relevant to their research.';
  return 'The character learns three pieces of information relevant to their research.';
}

function rollResearch() {
  const goldBonus = computeResearchGoldBonus();
  const intRaw = parseFloat(document.getElementById('researchIntMod').value);
  const intMod = isNaN(intRaw) ? 0 : intRaw;
  const hasAdvantage = document.getElementById('researchAdvantage').value === '1';

  let d20, rollLabel;
  if (hasAdvantage) {
    const a = rollDie(20);
    const b = rollDie(20);
    d20 = Math.max(a, b);
    rollLabel = `[${a}, ${b}, Advantage]`;
  } else {
    d20 = rollDie(20);
    rollLabel = '[d20]';
  }
  const total = d20 + intMod + goldBonus;

  document.getElementById('researchRollResult').innerHTML =
    `<strong>${d20}</strong> ${rollLabel} + ${intMod} [Intelligence] + ${goldBonus} [gold bonus] = <strong>${total}</strong><br>${researchResultForTotal(total)}`;
}

// ---- STICKY COLUMNS (each pane scrolls to ITS bottom, then stays put) ----
// On a wide screen the two panes (the left wrapper box, and Reference
// Information) sit side by side and are both "sticky"; inside the
// wrapper box, the Initiative column and the Dice Roller / Mob Attack
// Calculator column are sticky within it as well. Each one gets its own
// sticky "top" value:
//   - something SHORTER than the screen is pinned just under the site
//     header, so it stays in view while the page scrolls;
//   - something TALLER than the screen gets a negative "top", which
//     makes it scroll normally until ITS OWN bottom reaches the bottom
//     of the screen, and then stay fixed there while the rest keeps
//     scrolling.
// The values depend on current heights, so they are recalculated
// whenever a size changes or the window is resized.

const STICKY_LAYOUT_QUERY = '(min-width: 1100px)'; // must match the media query in styles.css

// The gap left under the site header is the --gap value in styles.css,
// and the gap left at the bottom is the padding at the bottom of
// <body>, so both are read from the page's own styles. That way
// changing the spacing in styles.css never leaves this file out of step.
function readCssPixels(value, fallback) {
  const number = parseFloat(value);
  return isNaN(number) ? fallback : number;
}

// A column inside the wrapper box ends a little above the wrapper's own
// bottom edge (the wrapper's padding and border). Returns that distance,
// so the column's "stay fixed" position can allow for it. Zero for the
// wrapper box itself and for the Reference pane.
function stickyExtraBottomGap(pane) {
  const outer = pane.closest('.column-group');
  if (!outer || outer === pane || !pane.parentElement) return 0;
  const gap = outer.getBoundingClientRect().bottom - pane.parentElement.getBoundingClientRect().bottom;
  return gap > 0 ? gap : 0;
}

// Nothing is "sticky" any more. On a wide screen each of the two panes is its
// own scrolling area (see styles.css), and on a narrow screen the page scrolls
// normally, so this only removes any "top" value that an older version set.
function updateStickyColumns() {
  document.querySelectorAll('.column-group, .column').forEach((pane) => {
    pane.style.top = '';
  });
}

// ---- SCROLLING: WHICH THING SCROLLS ----
// Wide screen (side by side): the Combat pane and the Reference pane each
// scroll on their own. Narrow screen (stacked): the whole page scrolls.

function isPaneScrollLayout() {
  return window.matchMedia(STICKY_LAYOUT_QUERY).matches;
}

// The panes that can currently scroll on their own (none when stacked, and a
// pane that is hidden because the other one is maximized doesn't count).
function getPaneScrollers() {
  if (!isPaneScrollLayout()) return [];
  return ['paneGroup', 'paneLookup']
    .map((id) => document.getElementById(id))
    .filter((el) => el && !el.classList.contains('column-collapsed'));
}

function getReferenceScrollTop() {
  const pane = document.getElementById('paneLookup');
  return isPaneScrollLayout() && pane ? pane.scrollTop : window.scrollY;
}

function scrollReferenceTo(top) {
  const pane = document.getElementById('paneLookup');
  if (isPaneScrollLayout() && pane) pane.scrollTo({ top: top, behavior: 'smooth' });
  else window.scrollTo({ top: top, behavior: 'smooth' });
}

// Moves the Reference pane's contents up or down right away (no animation).
function nudgeReferenceScroll(delta) {
  const pane = document.getElementById('paneLookup');
  if (isPaneScrollLayout() && pane) pane.scrollTop += delta;
  else window.scrollBy(0, delta);
}

// Remembers which part of the Reference pane is on screen: the element just
// below its search bar, and where on the screen that element is.
function captureReferenceLocation() {
  const panel = document.querySelector('.lookup-panel');
  const header = document.querySelector('.lookup-sticky-top');
  if (!panel || !header) return null;
  const panelRect = panel.getBoundingClientRect();
  if (panelRect.width < 50) return null;

  const x = panelRect.left + panelRect.width / 2;
  const y = Math.min(Math.max(header.getBoundingClientRect().bottom + 24, 0), window.innerHeight - 8);
  const hit = document.elementFromPoint(x, y);
  if (!hit || !panel.contains(hit)) return null;
  const el = hit.closest('summary, p, li, h4, h5, tr, details');
  if (!el || !panel.contains(el)) return null;
  return { el: el, top: el.getBoundingClientRect().top };
}

// Scrolls the Reference pane back so that remembered element is at the same
// place on the screen again. Returns false if that isn't possible any more.
function restoreReferenceLocation(anchor) {
  if (!anchor || !anchor.el.isConnected || anchor.el.getClientRects().length === 0) return false;
  for (let i = 0; i < 3; i++) {
    const delta = anchor.el.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) < 1) break;
    nudgeReferenceScroll(delta);
  }
  return true;
}

// Scrolls the page so that "target" ends up in the vertical middle of
// the screen. This replaces scrollIntoView for the Reference links:
// a pane that is currently pinned (sticky) is drawn away from the spot
// it would normally occupy, and scrollIntoView doesn't know that, so
// it could scroll the wrong distance. This works out where the target
// would normally sit and scrolls to centre THAT.
function scrollTargetToCenter(target) {
  const pane = isPaneScrollLayout() ? target.closest('#paneLookup, #paneGroup') : null;
  const rect = target.getBoundingClientRect();
  if (pane) {
    const paneRect = pane.getBoundingClientRect();
    const delta = rect.top + rect.height / 2 - (paneRect.top + pane.clientHeight / 2);
    pane.scrollBy({ top: delta, behavior: 'smooth' });
    return;
  }
  const delta = rect.top + rect.height / 2 - document.documentElement.clientHeight / 2;
  window.scrollBy({ top: delta, behavior: 'smooth' });
}

// ---- PANE MAXIMIZE / MINIMIZE ----
// The page has two panes, each with its own maximize button: the
// left-half wrapper box (Initiative + Dice Roller + Mob Attack
// Calculator, one combined pane) and the Reference pane. Pressing a
// pane's button hides the other pane (collapsed via CSS rather than
// removed from the DOM, so nothing about its state is lost) and lets
// the pressed pane fill the page, with the site header hidden out of
// the way too; pressing it again (now showing as a minimize icon)
// brings everything back. Only one pane can be maximized at a time.

const PANE_MAXIMIZE_ANIM_MS = 340; // must stay >= the CSS transition duration used on .column-maximized

let paneMaximizeAnimTimeout = null;

function togglePaneMaximize(columnId) {
  const wrap = document.querySelector('.columns-wrap');
  const column = document.getElementById(columnId);
  if (!wrap || !column) return;

  clearTimeout(paneMaximizeAnimTimeout);

  // The other pane (a direct child of the page row): the Reference
  // pane while the wrapper box is pressed, and vice versa.
  const otherPanes = Array.from(wrap.children).filter(
    (el) => el !== column && (el.classList.contains('column-group') || el.classList.contains('column'))
  );

  const wasMaximized = column.classList.contains('column-maximized');

  if (wasMaximized) {
    // MINIMIZING. The other pane is kept fully collapsed (zero width,
    // no transition on it) until the delay below has passed. Only then
    // does it (and the site header) reappear.
    wrap.classList.remove('has-maximized');
    updatePaneMaximizeButtons();

    paneMaximizeAnimTimeout = setTimeout(() => {
      otherPanes.forEach((el) => el.classList.remove('column-collapsed'));
      column.classList.remove('column-maximized');
      document.body.classList.remove('pane-maximized');
      updatePaneMaximizeButtons();
      updateScrollNav();
      syncLookupHeaderMask();
      updateStickyColumns();
    }, PANE_MAXIMIZE_ANIM_MS);
  } else {
    // MAXIMIZING. The other pane collapses instantly (no transition on
    // it at all — see .column-collapsed), so the pressed pane already
    // has the full row width to expand into.
    document.body.classList.add('pane-maximized');
    window.scrollTo({ top: 0, behavior: 'auto' });
    otherPanes.forEach((el) => el.classList.add('column-collapsed'));
    column.classList.add('column-maximized');
    // Force layout to flush the instant collapse above before adding
    // has-maximized, so the browser has something concrete (0 width)
    // to grow away from rather than possibly batching both changes
    // into a single frame.
    void wrap.offsetWidth;
    wrap.classList.add('has-maximized');
    updatePaneMaximizeButtons();
    syncLookupHeaderMask();

    paneMaximizeAnimTimeout = setTimeout(() => {
      updateScrollNav();
      syncLookupHeaderMask();
    }, PANE_MAXIMIZE_ANIM_MS);
  }
}

function updatePaneMaximizeButtons() {
  document.querySelectorAll('.pane-maximize-btn').forEach((btn) => {
    const columnId = btn.dataset.column;
    const column = columnId ? document.getElementById(columnId) : null;
    const isMax = !!(column && column.classList.contains('column-maximized'));
    btn.classList.toggle('is-maximized', isMax);
    btn.setAttribute('aria-label', (isMax ? 'Minimize' : 'Maximize') + ' pane');
  });
  syncRollDock(); // hide the dice roll cards while the Combat pane is hidden
}

// ---- SCROLL NAV (combined up / down button) ----
// A single circular control, bottom-center, that can show:
//   - nothing, if the whole page already fits on screen
//   - a full circle with just an up arrow, if you're at the bottom
//   - a full circle with just a down arrow, if you're at the top
//   - two joined semicircles (up on top, down below), if scrolling
//     further is currently possible in both directions
// ---- REFERENCE PANE HEADER MASK ----
// Keeps the fixed-position mask (see .lookup-header-mask in styles.css)
// aligned with the Reference column's current left edge and width.
// Needs re-syncing whenever that width can change: on load, on window
// resize (including the narrow/wide breakpoint that stacks the
// columns), and whenever a pane is maximized or minimized.
function syncLookupHeaderMask() {
  const mask = document.getElementById('lookupHeaderMask');
  const panel = document.querySelector('.lookup-panel');
  if (!mask || !panel) return;
  const rect = panel.getBoundingClientRect();
  mask.style.left = rect.left + 'px';
  mask.style.width = rect.width + 'px';
}

function updateScrollNav() {
  const nav = document.getElementById('scrollNav');
  const upBtn = document.getElementById('scrollUpBtn');
  const downBtn = document.getElementById('scrollDownBtn');
  if (!nav || !upBtn || !downBtn) return;

  const EPS = 4;
  const scrollers = getPaneScrollers();
  let canScrollUp;
  let canScrollDown;
  if (scrollers.length > 0) {
    canScrollUp = scrollers.some((pane) => pane.scrollTop > EPS);
    canScrollDown = scrollers.some((pane) => pane.scrollTop + pane.clientHeight < pane.scrollHeight - EPS);
  } else {
    canScrollUp = window.scrollY > EPS;
    canScrollDown = window.scrollY + window.innerHeight < document.documentElement.scrollHeight - EPS;
  }

  upBtn.classList.toggle('shown', canScrollUp);
  downBtn.classList.toggle('shown', canScrollDown);

  nav.classList.toggle('both-visible', canScrollUp && canScrollDown);
  nav.classList.toggle('visible', canScrollUp || canScrollDown);
}

// ---- WIRING EVERYTHING UP ----

document.addEventListener('DOMContentLoaded', () => {
  renderDataDrivenReferenceSections();
  initDropdownSearchBars();
  enrichStatBlocks(document.querySelector('.lookup-panel'));

  // The header is pinned (position: sticky) to the top of the viewport;
  // its height varies with screen width and with its own content (it
  // grew when the Date fields were added), so it's measured here and
  // exposed as a CSS variable that the sticky reference columns offset
  // below. A ResizeObserver (rather than only a window resize
  // listener) catches every reason that height could change —
  // including web fonts finishing their async load after first paint,
  // which could otherwise leave the reference pane's sticky header
  // pinned a few pixels too high and peeking above the app header.
  const headerEl = document.querySelector('.app-header');
  const syncHeaderHeight = () => {
    if (!headerEl) return;
    document.documentElement.style.setProperty('--header-h', headerEl.offsetHeight + 'px');
    updateStickyColumns();
  };
  syncHeaderHeight();
  if (headerEl && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncHeaderHeight).observe(headerEl);
  } else {
    window.addEventListener('resize', syncHeaderHeight);
  }
  window.addEventListener('resize', syncHeaderHeight);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncHeaderHeight);
  }

  // The mask that covers the gap above the Reference pane's own
  // sticky header (see .lookup-header-mask) needs its left/width kept
  // in sync with the Reference column's actual on-screen bounds,
  // since position:fixed elements don't automatically track a flex
  // sibling's dynamic width. A ResizeObserver on the lookup panel
  // itself catches width changes from window resizing, the
  // narrow/wide layout breakpoint, and pane maximize/minimize (which
  // is also handled explicitly in togglePaneMaximize for the exact
  // moment its animation completes).
  syncLookupHeaderMask();
  const lookupPanelEl = document.querySelector('.lookup-panel');
  if (lookupPanelEl && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncLookupHeaderMask).observe(lookupPanelEl);
  }
  window.addEventListener('resize', syncLookupHeaderMask);

  // Sticky panes: recalculate each pane's sticky position whenever
  // anything changes height (combatants added, dropdowns opened or
  // closed, search filtering, roll results appearing, ...) and
  // whenever the window is resized.
  updateStickyColumns();
  if (typeof ResizeObserver !== 'undefined') {
    const stickyObserver = new ResizeObserver(updateStickyColumns);
    document.querySelectorAll('.column-group, .column').forEach((pane) => stickyObserver.observe(pane));
  }
  window.addEventListener('resize', updateStickyColumns);

  load();
  render();
  renderRound();
  renderTimeControls();
  renderDateControls();
  toggleJumpDexVisibility();
  computeJump();
  computeCarryingEncumbrance();
  computeBuyMagicItemSearchBonus();
  computeResearchGoldBonus();
  loadSavedEncounters();
  renderSavedEncounters();
  setupCounterAndEncounterEvents();

  // Restore the Reference pane's open/closed dropdowns from this
  // browser session (if any), then start tracking further changes so
  // they're remembered across a page refresh.
  loadReferenceState();

  // One listener for the whole Reference pane (instead of one per dropdown).
  // "toggle" events don't bubble, so this listens in the capture phase.
  // Opening a dropdown fills in a monster's stat block immediately; the
  // slower work (saving which dropdowns are open, updating the scroll
  // button) is postponed until things have settled.
  const referencePanelEl = document.querySelector('.lookup-panel');
  if (referencePanelEl) {
    referencePanelEl.addEventListener(
      'toggle',
      (e) => {
        const el = e.target;
        if (!el || el.tagName !== 'DETAILS') return;
        if (el.open) {
          fillLazyEntry(el);
          enrichSpellEntry(el);
        }
        scheduleReferenceHousekeeping();
      },
      true
    );

    // Clicking a monster's title fills in its stat block at the moment of the
    // click, before the dropdown opens, so it can never open empty.
    referencePanelEl.addEventListener(
      'click',
      (e) => {
        const summary = e.target && e.target.closest ? e.target.closest('summary') : null;
        const details = summary ? summary.parentElement : null;
        if (details && details.dataset && details.dataset.lazy === '1') fillLazyEntry(details);
      },
      true
    );
  }
  window.addEventListener('pagehide', () => {
    if (referenceHousekeepingTimer !== null) {
      clearTimeout(referenceHousekeepingTimer);
      runReferenceHousekeeping();
    }
  });

  // Reference pane: main search box filters the whole pane live
  const referenceSearchInput = document.getElementById('referenceSearchInput');
  if (referenceSearchInput) {
    referenceSearchInput.addEventListener('input', (e) => {
      performReferenceSearch(e.target.value);
    });
  }

  // Reference pane: Partial word / Whole word dropdown re-runs the
  // current main search whenever it's changed.
  const referenceSearchModeSelect = document.getElementById('referenceSearchMode');
  if (referenceSearchModeSelect) {
    referenceSearchModeSelect.addEventListener('change', () => {
      performReferenceSearch(referenceSearchInput ? referenceSearchInput.value : '');
    });
  }

  // Reference pane: "Back" button, hidden until at least one gloss-ref
  // link has been followed.
  const referenceBackBtn = document.getElementById('referenceBackBtn');
  if (referenceBackBtn) {
    referenceBackBtn.addEventListener('click', goBackReference);
  }

  // Reference pane: pane maximize/minimize buttons (Initiative, Dice,
  // and Reference Information all have one).
  document.querySelectorAll('.pane-maximize-btn').forEach((btn) => {
    btn.addEventListener('click', () => togglePaneMaximize(btn.dataset.column));
  });
  updatePaneMaximizeButtons();

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
    const parsed = parseDump(textarea.value);
    const entries = parsed.entries;
    const skipped = parsed.skipped;

    if (entries.length === 0 && skipped.length === 0) {
      showToast('No valid rolls found in the pasted text');
      return;
    }

    const addedCount = entries.length > 0 ? await processParsedEntries(entries) : 0;

    if (skipped.length > 0) {
      // Some "Initiative: roll" lines were spotted but couldn't be read.
      // Say so, and leave the pasted text in the box so it can be looked at.
      await showModal(
        'These initiative rolls were found in the pasted text but could not be read, so they were not added: ' +
        skipped.join(', ') + '. Please add them manually above. The pasted text has been left in the box.',
        [{ label: 'OK', value: 'ok', className: 'btn-primary' }]
      );
    } else {
      textarea.value = '';
    }

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
    else if (e.target.classList.contains('row-stat')) commitStatEdit(e.target);
  });

  // Pressing Enter in a name/initiative field also saves it
  document.getElementById('trackerList').addEventListener('keydown', (e) => {
    if (
      e.key === 'Enter' &&
      (e.target.classList.contains('row-name') ||
        e.target.classList.contains('row-ini') ||
        e.target.classList.contains('row-stat'))
    ) {
      e.target.blur();
    }
  });

  // Round +/- buttons and reset-round button
  document.getElementById('roundUp').addEventListener('click', incrementRound);
  document.getElementById('roundDown').addEventListener('click', decrementRound);
  document.getElementById('resetRoundBtn').addEventListener('click', resetRound);
  document.getElementById('nextCombatantBtn').addEventListener('click', selectNextCombatant);

  // Date tracker: year/month/day fields (typing directly)
  document.getElementById('dateYearInput').addEventListener('focusout', commitDateYearInput);
  document.getElementById('dateYearInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });
  document.getElementById('dateMonthInput').addEventListener('keydown', (e) => {
    e.preventDefault();
  });
  document.getElementById('dateDayInput').addEventListener('focusout', commitDateDayInput);
  document.getElementById('dateDayInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });

  // Date tracker: +/- buttons (with rollover into the next/previous month/year)
  document.getElementById('dateYearUp').addEventListener('click', () => {
    adjustDateYear(1);
    renderDateControls();
    save();
  });
  document.getElementById('dateYearDown').addEventListener('click', () => {
    adjustDateYear(-1);
    renderDateControls();
    save();
  });
  document.getElementById('dateMonthUp').addEventListener('click', () => {
    adjustDateMonth(1);
    renderDateControls();
    save();
  });
  document.getElementById('dateMonthDown').addEventListener('click', () => {
    adjustDateMonth(-1);
    renderDateControls();
    save();
  });
  document.getElementById('dateDayUp').addEventListener('click', () => {
    incrementDateDay(1);
    renderDateControls();
    save();
  });
  document.getElementById('dateDayDown').addEventListener('click', () => {
    incrementDateDay(-1);
    renderDateControls();
    save();
  });

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

  // Time tracker: "Next day" and "Sleep" buttons (each asks for confirmation first)
  document.getElementById('nextDayBtn').addEventListener('click', resetTime);
  document.getElementById('sleepBtn').addEventListener('click', sleepTime);

  // Bottom control bar
  document.getElementById('swapBtn').addEventListener('click', swapSelected);
  document.getElementById('undoBtn').addEventListener('click', undoLast);
  document.getElementById('copyBtn').addEventListener('click', copyList);
  document.getElementById('clearBtn').addEventListener('click', clearAll);

  // Anywhere on the page: clicking a gold rules-term link (e.g.
  // "AC" inside Cover, "Incapacitated" inside Stunned, or "Conditions
  // dropdown" inside a glossary entry) opens every dropdown it's
  // nested inside, then scrolls to and flashes the target. The
  // nearest enclosing <details> the link itself lives in is captured
  // here (not tracked via a "last opened" variable) so the Back
  // button can correctly flash that source section too, even on the
  // very last step of a chain (the first link ever clicked).
  document.addEventListener('click', (e) => {
    const ref = e.target.closest('.gloss-ref');
    if (!ref) return;
    e.preventDefault();
    if (ref.closest('#paneGroup') && isReferencePaneCollapsed()) {
      showReferencePopup(ref.dataset.ref);
      return;
    }
    const sourceDetails = ref.closest('details');
    openReference(ref.dataset.ref, sourceDetails ? sourceDetails.id : null);
  });

  // Clickable text inside stat blocks (dice rolls, spells, conditions).
  document.addEventListener('click', (e) => {
    const el = e.target.closest ? e.target.closest('.stat-click') : null;
    if (!el) return;
    e.preventDefault();
    handleStatClick(el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest ? e.target.closest('.stat-click') : null;
    if (!el) return;
    e.preventDefault();
    handleStatClick(el);
  });
  window.addEventListener('resize', () => {
    syncRollDock();
    trimRollCards();
  });
  const rollClearAllBtn = document.getElementById('rollDockClearAll');
  if (rollClearAllBtn) {
    rollClearAllBtn.addEventListener('click', () => {
      const cardsEl = document.getElementById('rollCards');
      if (cardsEl) cardsEl.innerHTML = '';
      updateRollDock();
    });
  }

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

  // Carrying & Encumbrance calculator: Strength score and Size both
  // recalculate every result live, with no separate "calculate" button.
  document.getElementById('carryStr').addEventListener('input', computeCarryingEncumbrance);
  document.getElementById('carrySize').addEventListener('change', computeCarryingEncumbrance);

  // Downtime — Buy a Magic Item: the search bonus recalculates live as
  // money/time change; rolling the actual check is a button (it uses
  // real dice), same split as every other calculator on this page.
  document.getElementById('buyItemMoneySpent').addEventListener('input', computeBuyMagicItemSearchBonus);
  document.getElementById('buyItemTimeSpent').addEventListener('input', computeBuyMagicItemSearchBonus);
  document.getElementById('buyItemRollBtn').addEventListener('click', rollBuyMagicItemCheck);
  document.getElementById('buyItemComplicationBtn').addEventListener('click', rollBuyMagicItemComplication);

  // Downtime — Carousing, Crime, Gambling, Pit Fighting: each is a
  // single "roll the checks" button (all involve real dice, so there's
  // nothing to precompute live the way search/gold bonuses are).
  document.getElementById('carouseRollBtn').addEventListener('click', rollCarousing);
  document.getElementById('crimeRollBtn').addEventListener('click', rollCrime);
  document.getElementById('gambleRollBtn').addEventListener('click', rollGambling);
  document.getElementById('pitRollBtn').addEventListener('click', rollPitFighting);

  // Downtime — Research: gold bonus recalculates live as gold spent
  // changes, same split as Buy a Magic Item's search bonus.
  document.getElementById('researchGoldSpent').addEventListener('input', computeResearchGoldBonus);
  document.getElementById('researchRollBtn').addEventListener('click', rollResearch);

  // NPC Reactions: monster reaction roller and humanoid attitude randomizer
  document.getElementById('monsterReactionBtn').addEventListener('click', rollMonsterReaction);
  document.getElementById('randomizeAttitudeBtn').addEventListener('click', randomizeAttitude);

  // Scroll nav: up half scrolls to the very top, down half scrolls to
  // the very bottom. Visibility/shape is recalculated on scroll,
  // resize, and anywhere else page height can change (handled above
  // and inside the relevant functions).
  const scrollUpBtn = document.getElementById('scrollUpBtn');
  const scrollDownBtn = document.getElementById('scrollDownBtn');
  if (scrollUpBtn && scrollDownBtn) {
    updateScrollNav();
    window.addEventListener('scroll', updateScrollNav);
    window.addEventListener('resize', updateScrollNav);
    ['paneGroup', 'paneLookup'].forEach((id) => {
      const pane = document.getElementById(id);
      if (pane) pane.addEventListener('scroll', updateScrollNav);
    });
    // On a wide screen the arrows move BOTH panes; on a narrow screen, the page.
    scrollUpBtn.addEventListener('click', () => {
      const scrollers = getPaneScrollers();
      if (scrollers.length > 0) scrollers.forEach((pane) => pane.scrollTo({ top: 0, behavior: 'smooth' }));
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    scrollDownBtn.addEventListener('click', () => {
      const scrollers = getPaneScrollers();
      if (scrollers.length > 0) {
        scrollers.forEach((pane) => pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' }));
      } else {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      }
    });

    // Scroll wheel on a wide screen: over a pane, only that pane scrolls (the
    // browser does that by itself). Anywhere else (the gap between the panes,
    // the top bar, the page edges), BOTH panes scroll together.
    document.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || !isPaneScrollLayout()) return;
        const target = e.target;
        if (!target || !target.closest) return;
        if (target.closest('.modal-overlay:not(.hidden)')) return;

        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 40;
        else if (e.deltaMode === 2) delta *= window.innerHeight;
        if (delta === 0) return;

        // The dice roll cards float over the Combat pane, so they count as it.
        if (target.closest('#rollDock')) {
          const combat = document.getElementById('paneGroup');
          if (combat) {
            e.preventDefault();
            combat.scrollTop += delta;
          }
          return;
        }
        if (target.closest('#paneGroup, #paneLookup')) return;

        e.preventDefault();
        getPaneScrollers().forEach((pane) => {
          pane.scrollTop += delta;
        });
      },
      { passive: false }
    );
  }
});
