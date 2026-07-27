import { getAll, put, remove, getByIndex, seedPlants } from './db.js';
import { PLANTS, SUBTASK_DEFAULTS, PLANT_SLUGS } from './plants.js';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let currentPage = 'calendar';

// Init
async function init() {
  await seedPlants(PLANTS);
  registerSW();
  requestNotifications();
  renderMonthStrip();
  renderCalendar();
}

const VAPID_PUBLIC_KEY = 'BOvIr2PLl-9ZYtR_Z5jgKqq7iEWWc4v9eD3YEMcReAXpDriYP-h8FeuqkFXmC7blJkOzjSJzhtRJkZsEeZSztsM';
const PUSH_SERVER = 'https://garden-push.tunde-a.workers.dev';

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      subscribeToPush(reg);
    });
  }
}

async function subscribeToPush(registration) {
  if (!('PushManager' in window)) return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key
    });
  }

  // Send subscription to push server
  try {
    await fetch(PUSH_SERVER + '/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
  } catch (e) {
    console.log('Push subscription stored locally, server not yet available');
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function requestNotifications() {
  // handled by subscribeToPush
}

// Navigation
window.showPage = function(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

  if (page === 'detail') {
    document.getElementById('page-detail').classList.add('active');
    document.getElementById('tab-garden').classList.add('active');
  } else {
    document.getElementById(`page-${page}`).classList.add('active');
    document.getElementById(`tab-${page}`).classList.add('active');
  }

  document.getElementById('fab').style.display = page === 'reminders' ? 'block' : 'none';

  const titles = { calendar: 'Tasks', search: 'Add Plant', garden: 'My Garden', reminders: 'Reminders', detail: 'Plant Detail' };
  document.getElementById('headerTitle').textContent = titles[page] || 'Garden Planner';

  if (page === 'calendar') renderCalendar();
  if (page === 'garden') renderGarden();
  if (page === 'reminders') renderReminders();
};

// Year/Month navigation
window.changeYear = function(delta) {
  currentYear += delta;
  document.getElementById('yearLabel').textContent = currentYear;
  renderCalendar();
};

window.selectMonth = function(month) {
  currentMonth = month;
  renderMonthStrip();
  renderCalendar();
};

function renderMonthStrip() {
  document.getElementById('yearLabel').textContent = currentYear;
  const strip = document.getElementById('monthStrip');
  strip.innerHTML = MONTHS.map((m, i) => `
    <button class="month-btn ${i + 1 === currentMonth ? 'active' : ''}" onclick="selectMonth(${i + 1})">
      ${m}
    </button>
  `).join('');
  strip.children[currentMonth - 1]?.scrollIntoView({ inline: 'center', behavior: 'smooth' });
}

// Calendar rendering
async function renderCalendar() {
  const tasks = await getAll('tasks');
  const subTasks = await getAll('subTasks');
  const recurring = await getAll('recurringTasks');

  const monthTasks = tasks.filter(t => {
    if (t.year !== currentYear) return false;
    const range = monthRange(t.startMonth, t.endMonth);
    return range.includes(currentMonth);
  });

  // Cadence tasks that are due show as incomplete even if previously done
  const incomplete = monthTasks.filter(t => !t.isCompleted || (t.cadence && isTaskCadenceDue(t)));
  const completed = monthTasks.filter(t => t.isCompleted && !(t.cadence && isTaskCadenceDue(t)));
  const dueRecurring = recurring.filter(r => isDue(r));

  let html = '';

  if (dueRecurring.length > 0) {
    html += '<div class="section-header">Due Now</div>';
    html += dueRecurring.map(r => `
      <div class="card">
        <div class="task-row">
          <div class="task-icon">🔄</div>
          <div class="task-info">
            <div class="task-name">${r.title}</div>
            <div class="task-meta">${r.interval} • Due now</div>
            ${r.notes ? `<div class="task-notes">${r.notes}</div>` : ''}
          </div>
          <button class="task-check" onclick="completeRecurring('${r.id}')">✓</button>
        </div>
      </div>
    `).join('');
  }

  if (incomplete.length > 0) {
    html += '<div class="section-header">To Do</div>';
    html += incomplete.sort((a, b) => a.taskType.localeCompare(b.taskType)).map(t => renderTaskCard(t, subTasks)).join('');
  }

  if (completed.length > 0) {
    html += `<div class="completed-toggle" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
      Completed (${completed.length}) ▾
    </div><div style="display:none">`;
    html += completed.map(t => renderTaskCard(t, subTasks)).join('');
    html += '</div>';
  }

  if (incomplete.length === 0 && completed.length === 0 && dueRecurring.length === 0) {
    html = `<div class="empty-state"><div class="icon">🌱</div><p>No tasks in ${MONTH_FULL[currentMonth - 1]}</p></div>`;
  }

  document.getElementById('calendarTasks').innerHTML = html;
}

function renderTaskCard(task, subTasks) {
  const subs = subTasks.filter(s => s.taskId === task.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const icon = taskIcon(task.taskType);
  const color = taskColor(task.taskType);
  const monthText = task.startMonth === task.endMonth ? MONTHS[task.startMonth - 1] : `${MONTHS[task.startMonth - 1]}–${MONTHS[task.endMonth - 1]}`;
  const subProgress = subs.length > 0 ? ` • ${subs.filter(s => s.isCompleted).length}/${subs.length}` : '';

  // Cadence info
  let cadenceText = '';
  let cadenceDue = false;
  if (task.cadence) {
    cadenceText = ` • Repeat: ${task.cadence}`;
    cadenceDue = isTaskCadenceDue(task);
  }

  // For cadence tasks, show "done" button that resets the timer rather than completing forever
  const hasCadence = !!task.cadence;
  let actionBtn;
  if (hasCadence) {
    actionBtn = cadenceDue
      ? `<button class="task-check" onclick="completeCadenceTask('${task.id}')" title="Mark done (resets timer)">✓</button>`
      : `<span style="font-size:11px;color:var(--gray)">done</span>`;
  } else if (subs.length === 0) {
    actionBtn = `<button class="task-check ${task.isCompleted ? 'done' : ''}" onclick="toggleTask('${task.id}')">✓</button>`;
  } else {
    actionBtn = `<span style="color:var(--gray);font-size:12px">▾</span>`;
  }

  let html = `<div class="card" style="opacity:${task.isCompleted && !hasCadence ? 0.6 : 1}">
    <div class="task-row">
      <div class="task-icon" style="color:${color}">${icon}</div>
      <div class="task-info" onclick="toggleSubtasks('${task.id}')" style="cursor:pointer">
        <div class="task-name">${task.plantName} ${task.variety || ''}</div>
        <div class="task-meta">${task.taskType} • ${monthText}${cadenceText}${subProgress}</div>
        ${cadenceDue ? '<div class="task-notes" style="color:var(--red);font-weight:600">Due now</div>' : ''}
        ${task.notes ? `<div class="task-notes">${task.notes}</div>` : ''}
      </div>
      ${actionBtn}
    </div>
    <div class="subtasks" id="subs-${task.id}" style="display:none">
      ${subs.map(s => `
        <div class="subtask-row">
          <button class="subtask-check ${s.isCompleted ? 'done' : ''}" onclick="toggleSubTask('${s.id}','${task.id}')">✓</button>
          <span class="subtask-text ${s.isCompleted ? 'done' : ''}">${s.title}</span>
          <button class="task-delete" onclick="deleteSubTask('${s.id}')">×</button>
        </div>
      `).join('')}
      <div class="subtask-add">
        <input type="text" placeholder="Add subtask..." id="sub-input-${task.id}" onkeydown="if(event.key==='Enter')addSubTask('${task.id}')">
        <button onclick="addSubTask('${task.id}')">Add</button>
      </div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--gray-light);display:flex;justify-content:space-between;align-items:center">
        <div>
          <label style="font-size:11px;color:var(--gray);font-weight:600">Repeat:</label>
          <select style="font-size:12px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;margin-left:4px" onchange="setCadence('${task.id}',this.value)">
            <option value="" ${!task.cadence ? 'selected' : ''}>None</option>
            <option value="Weekly" ${task.cadence === 'Weekly' ? 'selected' : ''}>Weekly</option>
            <option value="Every 2 Weeks" ${task.cadence === 'Every 2 Weeks' ? 'selected' : ''}>Every 2 Weeks</option>
            <option value="Monthly" ${task.cadence === 'Monthly' ? 'selected' : ''}>Monthly</option>
          </select>
        </div>
        <button onclick="deleteTask('${task.id}')" style="background:none;border:none;color:var(--red);font-size:12px;cursor:pointer;padding:4px 8px">Delete task</button>
      </div>
    </div>
  </div>`;
  return html;
}

window.toggleSubtasks = function(taskId) {
  const el = document.getElementById(`subs-${taskId}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

window.setCadence = async function(taskId, cadence) {
  const tasks = await getAll('tasks');
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  task.cadence = cadence || null;
  task.lastCadenceCompleted = null;
  if (cadence) task.isCompleted = false;
  await put('tasks', task);
  if (currentPage === 'detail') {
    renderDetail(task.plantName, task.variety);
  } else {
    renderCalendar();
  }
};

window.completeCadenceTask = async function(taskId) {
  const tasks = await getAll('tasks');
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  task.lastCadenceCompleted = new Date().toISOString();
  await put('tasks', task);
  if (currentPage === 'detail') {
    renderDetail(task.plantName, task.variety);
  } else {
    renderCalendar();
  }
};

function isTaskCadenceDue(task) {
  if (!task.cadence) return false;
  const currentMo = new Date().getMonth() + 1;
  const range = monthRange(task.startMonth, task.endMonth);
  if (!range.includes(currentMo)) return false;
  if (!task.lastCadenceCompleted) return true;
  const last = new Date(task.lastCadenceCompleted);
  const days = Math.floor((Date.now() - last.getTime()) / 86400000);
  const interval = task.cadence === 'Weekly' ? 7 : task.cadence === 'Every 2 Weeks' ? 14 : 30;
  return days >= interval;
}

window.toggleTask = async function(taskId) {
  const tasks = await getAll('tasks');
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  task.isCompleted = !task.isCompleted;
  if (!task.isCompleted) {
    const subs = (await getAll('subTasks')).filter(s => s.taskId === taskId);
    for (const s of subs) { s.isCompleted = false; await put('subTasks', s); }
  }
  await put('tasks', task);
  renderCalendar();
};

window.toggleSubTask = async function(subId, taskId) {
  const subs = await getAll('subTasks');
  const sub = subs.find(s => s.id === subId);
  if (!sub) return;
  sub.isCompleted = !sub.isCompleted;
  await put('subTasks', sub);

  const taskSubs = subs.filter(s => s.taskId === taskId);
  const allDone = taskSubs.every(s => s.id === subId ? sub.isCompleted : s.isCompleted);
  const tasks = await getAll('tasks');
  const task = tasks.find(t => t.id === taskId);
  if (task) { task.isCompleted = allDone; await put('tasks', task); }

  if (currentPage === 'detail') renderDetail(task.plantName, task.variety);
  else renderCalendar();
};

window.addSubTask = async function(taskId) {
  const input = document.getElementById(`sub-input-${taskId}`);
  if (!input || !input.value.trim()) return;
  const subs = (await getAll('subTasks')).filter(s => s.taskId === taskId);
  await put('subTasks', { id: crypto.randomUUID(), taskId, title: input.value.trim(), sortOrder: subs.length, isCompleted: false });
  input.value = '';
  if (currentPage === 'detail') {
    const tasks = await getAll('tasks');
    const task = tasks.find(t => t.id === taskId);
    if (task) renderDetail(task.plantName, task.variety);
  } else renderCalendar();
};

window.deleteSubTask = async function(subId) {
  await remove('subTasks', subId);
  if (currentPage === 'detail' && window._detailPlant) {
    renderDetail(window._detailPlant.name, window._detailPlant.variety || '');
  } else renderCalendar();
};

window.deleteTask = async function(taskId) {
  if (!confirm('Delete this task?')) return;
  // Delete subtasks first
  const subs = await getAll('subTasks');
  for (const s of subs.filter(s => s.taskId === taskId)) {
    await remove('subTasks', s.id);
  }
  await remove('tasks', taskId);
  if (currentPage === 'detail' && window._detailPlant) {
    renderDetail(window._detailPlant.name, window._detailPlant.variety || '');
  } else renderCalendar();
};

window.completeRecurring = async function(id) {
  const tasks = await getAll('recurringTasks');
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.lastCompleted = new Date().toISOString();
  await put('recurringTasks', task);
  renderCalendar();
};

// Search
window.onSearch = async function(query) {
  const container = document.getElementById('searchResults');
  if (query.length < 2) { container.innerHTML = ''; return; }

  const lower = query.toLowerCase();
  const plants = await getAll('plants');
  const local = plants.filter(p =>
    p.name.toLowerCase().includes(lower) || (p.variety || '').toLowerCase().includes(lower)
  );

  // Group local results by genus
  const genusList = {};
  for (const p of local) {
    if (!genusList[p.name]) genusList[p.name] = [];
    genusList[p.name].push(p);
  }

  // Online results grouped by genus
  const online = PLANT_SLUGS.filter(s => s.name.toLowerCase().includes(lower)).slice(0, 30);
  const onlineGenus = {};
  for (const o of online) {
    const parts = o.name.split(' ');
    const genus = parts[0];
    if (!onlineGenus[genus]) onlineGenus[genus] = [];
    onlineGenus[genus].push(o);
  }

  // Community plants
  let communityPlants = [];
  try {
    const resp = await fetch(PUSH_SERVER + '/plants?q=' + encodeURIComponent(query));
    if (resp.ok) communityPlants = await resp.json();
  } catch(e) {}

  let html = '';

  // Local - grouped by genus
  const genusKeys = Object.keys(genusList).sort().slice(0, 15);
  if (genusKeys.length > 0) {
    html += '<div class="section-header">Local Database</div>';
    for (const genus of genusKeys) {
      const varieties = genusList[genus];
      if (varieties.length === 1 && !varieties[0].variety) {
        html += `<div class="search-result" onclick="addPlantToGarden('${varieties[0].id}')">
          <div>🌿</div>
          <div><div class="name">${genus}</div><div class="variety">${varieties[0].category}</div></div>
          <span class="badge">${varieties[0].category}</span>
        </div>`;
      } else {
        html += `<div class="search-result" onclick="toggleGenusExpand('local-${genus.replace(/\s/g,'-')}')" style="cursor:pointer">
          <div>🌿</div>
          <div><div class="name">${genus}</div><div class="variety">${varieties.length} varieties • ${varieties[0].category}</div></div>
          <span style="color:var(--gray);font-size:12px">▾</span>
        </div>`;
        html += `<div id="local-${genus.replace(/\s/g,'-')}" style="display:none;padding-left:20px">`;
        for (const p of varieties.slice(0, 10)) {
          html += `<div class="search-result" onclick="addPlantToGarden('${p.id}')">
            <div style="font-size:12px">↳</div>
            <div><div class="name">${p.variety || genus}</div></div>
            <span class="badge">${p.category}</span>
          </div>`;
        }
        html += '</div>';
      }
    }
  }

  // Online - grouped by genus
  const onlineGenusKeys = Object.keys(onlineGenus).sort().slice(0, 10);
  if (onlineGenusKeys.length > 0) {
    html += '<div class="section-header">Online (Gardeners\' World)</div>';
    for (const genus of onlineGenusKeys) {
      const varieties = onlineGenus[genus];
      if (varieties.length === 1) {
        html += `<div class="search-result" onclick="addOnlinePlant('${varieties[0].slug}')">
          <div>🌐</div>
          <div><div class="name">${varieties[0].name}</div></div>
          <span class="badge online-badge">Online</span>
        </div>`;
      } else {
        html += `<div class="search-result" onclick="toggleGenusExpand('online-${genus.replace(/\s/g,'-')}')" style="cursor:pointer">
          <div>🌐</div>
          <div><div class="name">${genus}</div><div class="variety">${varieties.length} varieties</div></div>
          <span style="color:var(--gray);font-size:12px">▾</span>
        </div>`;
        html += `<div id="online-${genus.replace(/\s/g,'-')}" style="display:none;padding-left:20px">`;
        for (const o of varieties) {
          html += `<div class="search-result" onclick="addOnlinePlant('${o.slug}')">
            <div style="font-size:12px">↳</div>
            <div><div class="name">${o.name}</div></div>
            <span class="badge online-badge">Online</span>
          </div>`;
        }
        html += '</div>';
      }
    }
  }

  // Community
  if (communityPlants.length > 0) {
    html += '<div class="section-header">Community Added</div>';
    html += communityPlants.map(p => `
      <div class="search-result" onclick="addCommunityPlant('${encodeURIComponent(JSON.stringify(p))}')">
        <div>👥</div>
        <div><div class="name">${p.name} ${p.variety || ''}</div><div class="variety">${p.tasks?.length || 0} tasks</div></div>
        <span class="badge" style="background:#fef3c7;color:#92400e">Community</span>
      </div>
    `).join('');
  }

  if (!html) html = '<div class="empty-state"><p>No results found. Try "+ Add plant manually" above.</p></div>';
  container.innerHTML = html;
};

window.toggleGenusExpand = function(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

window.addCommunityPlant = async function(encoded) {
  const plant = JSON.parse(decodeURIComponent(encoded));
  const plantId = crypto.randomUUID();
  const year = currentYear;

  await put('gardenPlants', { id: crypto.randomUUID(), plantId, name: plant.name, variety: plant.variety || '', addedDate: new Date().toISOString() });

  for (const t of (plant.tasks || [])) {
    const task = {
      id: crypto.randomUUID(),
      plantId,
      plantName: plant.name,
      variety: plant.variety || '',
      taskType: t.taskType,
      startMonth: t.startMonth,
      endMonth: t.endMonth,
      year,
      isCompleted: false,
      notes: t.notes || '',
    };
    await put('tasks', task);
  }

  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = `<div class="empty-state"><p>✓ Added ${plant.name} ${plant.variety || ''} from community</p></div>`;
};

window.addPlantToGarden = async function(plantId) {
  const plants = await getAll('plants');
  const plant = plants.find(p => p.id === plantId);
  if (!plant) return;

  const gardenPlant = { id: crypto.randomUUID(), plantId: plant.id, name: plant.name, variety: plant.variety || '', addedDate: new Date().toISOString() };
  await put('gardenPlants', gardenPlant);

  const year = currentYear;
  const tasks = generateTasks(plant, year);
  for (const task of tasks) {
    await put('tasks', task);
    await generateSubTasksForTask(task, plant.name);
  }

  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = `<div class="empty-state"><p>✓ Added ${plant.name} ${plant.variety || ''} to your garden</p></div>`;
  scheduleWeeklyReminder();
};

window.addOnlinePlant = async function(slug) {
  document.getElementById('searchResults').innerHTML = '<div class="empty-state"><p>Fetching data...</p></div>';

  try {
    const resp = await fetch(`https://www.gardenersworld.com/plants/${slug}/`);
    const html = await resp.text();
    const calendar = parseCalendarHTML(html);

    if (Object.keys(calendar).length === 0) {
      document.getElementById('searchResults').innerHTML = '<div class="empty-state"><p>No calendar data found for this plant</p></div>';
      return;
    }

    const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const parts = name.split(' ');
    const genus = parts[0];
    const variety = parts.slice(1).join(' ');

    const plant = {
      id: crypto.randomUUID(),
      name: genus,
      variety: variety,
      category: 'Flower',
      sowIndoorsStart: calendar['Sow']?.[0] || null,
      sowIndoorsEnd: calendar['Sow']?.slice(-1)[0] || null,
      plantOutStart: calendar['Plant']?.[0] || calendar['Plant Out']?.[0] || null,
      plantOutEnd: calendar['Plant']?.slice(-1)[0] || calendar['Plant Out']?.slice(-1)[0] || null,
      harvestStart: calendar['Flowers']?.[0] || calendar['Harvest']?.[0] || null,
      harvestEnd: calendar['Flowers']?.slice(-1)[0] || calendar['Harvest']?.slice(-1)[0] || null,
      pruneStart: calendar['Prune']?.[0] || null,
      pruneEnd: calendar['Prune']?.slice(-1)[0] || null,
      cutBackStart: calendar['Cut Back']?.[0] || null,
      cutBackEnd: calendar['Cut Back']?.slice(-1)[0] || null,
      divideStart: calendar['Divide']?.[0] || null,
      divideEnd: calendar['Divide']?.slice(-1)[0] || null,
    };

    await put('plants', plant);
    await addPlantToGarden(plant.id);
  } catch (e) {
    document.getElementById('searchResults').innerHTML = `<div class="empty-state"><p>Error fetching data. The site may be blocking requests.</p></div>`;
  }
};

function parseCalendarHTML(html) {
  const result = {};
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const tables = doc.querySelectorAll('table');

  for (const table of tables) {
    const headers = table.querySelectorAll('th');
    const hasMonths = Array.from(headers).some(h => h.textContent.trim() === 'Jan' || h.getAttribute('aria-label')?.includes('January'));
    if (!hasMonths) continue;

    const rows = table.querySelectorAll('tbody tr');
    for (const row of rows) {
      const th = row.querySelector('th');
      const taskName = th?.textContent?.trim();
      if (!taskName) continue;

      const cells = row.querySelectorAll('td');
      const active = [];
      cells.forEach((cell, i) => {
        if (cell.textContent.trim()) active.push(i + 1);
      });
      if (active.length > 0) result[taskName] = active;
    }
    break;
  }
  return result;
}

// Garden
async function renderGarden() {
  const gardenPlants = await getAll('gardenPlants');
  const tasks = await getAll('tasks');

  if (gardenPlants.length === 0) {
    document.getElementById('gardenList').innerHTML = '<div class="empty-state"><div class="icon">🌱</div><p>No plants yet. Use Add Plant to get started.</p></div>';
    return;
  }

  const html = gardenPlants.map(gp => {
    const plantTasks = tasks.filter(t => t.plantName === gp.name && t.variety === (gp.variety || ''));
    const remaining = plantTasks.filter(t => !t.isCompleted).length;
    const total = plantTasks.length;
    return `<div class="plant-card" onclick="showPlantDetail('${gp.name}','${gp.variety || ''}')">
      <div class="plant-icon">🌿</div>
      <div class="plant-info">
        <div class="plant-name">${gp.name} ${gp.variety || ''}</div>
        <div class="plant-progress">${remaining} of ${total} tasks remaining</div>
      </div>
      ${remaining === 0 && total > 0 ? '<span style="color:var(--green)">✓</span>' : ''}
    </div>`;
  }).join('');

  document.getElementById('gardenList').innerHTML = html;
}

window.showPlantDetail = function(name, variety) {
  showPage('detail');
  document.getElementById('headerTitle').textContent = `${name} ${variety}`;
  document.getElementById('detailTitle').textContent = `${name} ${variety}`;
  window._detailPlant = { name, variety };
  renderDetail(name, variety);
};

async function renderDetail(name, variety) {
  const tasks = await getAll('tasks');
  const subTasks = await getAll('subTasks');
  const plantTasks = tasks.filter(t => t.plantName === name && t.variety === (variety || '')).sort((a, b) => a.startMonth - b.startMonth);

  const incomplete = plantTasks.filter(t => !t.isCompleted || (t.cadence && isTaskCadenceDue(t)));
  const completed = plantTasks.filter(t => t.isCompleted && !(t.cadence && isTaskCadenceDue(t)));

  let html = `<button class="btn btn-outline" style="width:100%;margin-bottom:12px;font-size:13px" onclick="showAddTaskToPlant()">+ Add task to this plant</button>`;

  if (incomplete.length > 0) {
    html += '<div class="section-header">To Do</div>';
    html += incomplete.map(t => renderTaskCard(t, subTasks)).join('');
  }
  if (completed.length > 0) {
    html += '<div class="section-header">Completed</div>';
    html += completed.map(t => renderTaskCard(t, subTasks)).join('');
  }
  if (plantTasks.length === 0) {
    html += '<div class="empty-state"><p>No tasks for this plant. Tap the button above to add one.</p></div>';
  }

  document.getElementById('detailTasks').innerHTML = html;
}

window.showAddTaskToPlant = function() {
  const { name, variety } = window._detailPlant || {};
  if (!name) return;
  const taskTypes = ['Sow Indoors','Sow Outdoors','Plant Out','Harvest','Flowering','Prune','Cut Back','Divide','Overwinter'];
  const currentMo = new Date().getMonth() + 1;
  document.getElementById('modalContainer').innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" onclick="event.stopPropagation()">
        <h3>Add Task to ${name} ${variety || ''}</h3>
        <div class="form-group"><label>Task Type</label><select id="detailTaskType" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px">
          ${taskTypes.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>From Month</label><select id="detailStart" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px">${MONTH_FULL.map((m, i) => `<option value="${i+1}" ${i+1===currentMo?'selected':''}>${m}</option>`).join('')}</select></div>
        <div class="form-group"><label>To Month</label><select id="detailEnd" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px">${MONTH_FULL.map((m, i) => `<option value="${i+1}" ${i+1===currentMo?'selected':''}>${m}</option>`).join('')}</select></div>
        <div class="form-group"><label>Notes (optional)</label><input id="detailNotes" placeholder="Any notes..." style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px"></div>
        <div class="modal-actions">
          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-green" onclick="saveTaskToPlant()">Add</button>
        </div>
      </div>
    </div>`;
};

window.saveTaskToPlant = async function() {
  const { name, variety } = window._detailPlant || {};
  if (!name) return;

  const taskType = document.getElementById('detailTaskType').value;
  const startMonth = parseInt(document.getElementById('detailStart').value);
  const endMonth = parseInt(document.getElementById('detailEnd').value);
  const notes = document.getElementById('detailNotes').value.trim();

  const task = {
    id: crypto.randomUUID(),
    plantId: '',
    plantName: name,
    variety: variety || '',
    taskType,
    startMonth,
    endMonth,
    year: currentYear,
    isCompleted: false,
    notes,
  };
  await put('tasks', task);
  await generateSubTasksForTask(task, name);

  closeModal();
  renderDetail(name, variety || '');
};

// Reminders
async function renderReminders() {
  const recurring = await getAll('recurringTasks');
  const now = new Date();
  const currentMo = now.getMonth() + 1;

  if (recurring.length === 0) {
    document.getElementById('remindersList').innerHTML = '<div class="empty-state"><div class="icon">🔄</div><p>No recurring tasks. Tap + to add one (e.g. fertilise every 2 weeks).</p></div>';
    return;
  }

  const html = recurring.map(r => {
    const active = monthRange(r.activeStartMonth, r.activeEndMonth).includes(currentMo);
    const due = isDue(r);
    return `<div class="recurring-card">
      <div style="font-size:20px">🔄</div>
      <div class="recurring-info">
        <div class="recurring-title">${r.title}</div>
        <div class="recurring-meta">${r.interval} • ${MONTHS[r.activeStartMonth - 1]}–${MONTHS[r.activeEndMonth - 1]}</div>
        ${due ? '<div class="recurring-due">Due now</div>' : active ? `<div class="recurring-meta">Active</div>` : '<div class="recurring-meta">Inactive</div>'}
      </div>
      ${due ? `<button class="task-check" onclick="completeRecurring('${r.id}')">✓</button>` : ''}
      <button class="task-delete" onclick="deleteRecurring('${r.id}')">×</button>
    </div>`;
  }).join('');

  document.getElementById('remindersList').innerHTML = html;
}

window.showAddRecurringModal = function() {
  document.getElementById('modalContainer').innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" onclick="event.stopPropagation()">
        <h3>New Recurring Task</h3>
        <div class="form-group"><label>Title</label><input id="recTitle" placeholder="e.g. Fertilise tomatoes"></div>
        <div class="form-group"><label>Notes</label><input id="recNotes" placeholder="Optional notes"></div>
        <div class="form-group"><label>Frequency</label><select id="recInterval"><option value="Weekly">Weekly</option><option value="Every 2 Weeks" selected>Every 2 Weeks</option><option value="Monthly">Monthly</option></select></div>
        <div class="form-group"><label>Active From</label><select id="recStart">${MONTH_FULL.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></div>
        <div class="form-group"><label>Active To</label><select id="recEnd">${MONTH_FULL.map((m, i) => `<option value="${i + 1}" ${i === 11 ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="modal-actions">
          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-green" onclick="saveRecurring()">Save</button>
        </div>
      </div>
    </div>`;
};

window.saveRecurring = async function() {
  const title = document.getElementById('recTitle').value.trim();
  if (!title) return;
  await put('recurringTasks', {
    id: crypto.randomUUID(),
    title,
    notes: document.getElementById('recNotes').value.trim(),
    interval: document.getElementById('recInterval').value,
    activeStartMonth: parseInt(document.getElementById('recStart').value),
    activeEndMonth: parseInt(document.getElementById('recEnd').value),
    lastCompleted: null,
  });
  closeModal();
  renderReminders();
};

window.deleteRecurring = async function(id) {
  await remove('recurringTasks', id);
  renderReminders();
};

let manualTasks = [];

window.showAddManualModal = function() {
  manualTasks = [];
  const taskTypes = ['Sow Indoors','Sow Outdoors','Plant Out','Harvest','Flowering','Prune','Cut Back','Divide','Overwinter'];
  document.getElementById('modalContainer').innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" onclick="event.stopPropagation()">
        <h3>Add Plant Manually</h3>
        <div class="form-group"><label>Plant Name</label><input id="manName" placeholder="e.g. Dahlia"></div>
        <div class="form-group"><label>Variety (optional)</label><input id="manVariety" placeholder="e.g. Bishop of Llandaff"></div>
        <div class="form-group"><label>Category</label><select id="manCategory"><option>Vegetable</option><option>Herb</option><option>Fruit</option><option selected>Flower</option></select></div>

        <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--gray-light)">
          <label style="font-size:13px;font-weight:700;display:block;margin-bottom:8px">Tasks</label>
          <div id="manualTasksList"></div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:8px">
            <select id="addTaskType" style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px">
              ${taskTypes.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
            <button class="btn btn-outline" style="padding:8px 12px;font-size:13px" onclick="addManualTaskRow()">+ Add</button>
          </div>
        </div>

        <div class="form-group" style="margin-top:14px"><label>Notes (optional)</label><input id="manNotes" placeholder="Any notes..."></div>
        <div class="modal-actions">
          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-green" onclick="saveManualPlant()">Add to Garden</button>
        </div>
      </div>
    </div>`;
};

window.addManualTaskRow = function() {
  const taskType = document.getElementById('addTaskType').value;
  const currentMo = new Date().getMonth() + 1;
  manualTasks.push({ taskType, startMonth: currentMo, endMonth: currentMo });
  renderManualTasksList();
};

function renderManualTasksList() {
  const container = document.getElementById('manualTasksList');
  if (manualTasks.length === 0) {
    container.innerHTML = '<p style="font-size:12px;color:var(--gray);margin:4px 0">No tasks added yet. Select a type and tap + Add.</p>';
    return;
  }
  container.innerHTML = manualTasks.map((t, i) => `
    <div style="background:var(--gray-light);border-radius:8px;padding:10px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:13px;font-weight:600">${taskIcon(t.taskType)} ${t.taskType}</span>
        <button onclick="removeManualTask(${i})" style="background:none;border:none;color:var(--red);font-size:16px;cursor:pointer">×</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <select onchange="updateManualTask(${i},'startMonth',this.value)" style="flex:1;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:12px">
          ${MONTH_FULL.map((m, mi) => `<option value="${mi+1}" ${mi+1===t.startMonth?'selected':''}>${m}</option>`).join('')}
        </select>
        <span style="font-size:12px;color:var(--gray)">to</span>
        <select onchange="updateManualTask(${i},'endMonth',this.value)" style="flex:1;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:12px">
          ${MONTH_FULL.map((m, mi) => `<option value="${mi+1}" ${mi+1===t.endMonth?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
    </div>
  `).join('');
}

window.updateManualTask = function(index, field, value) {
  manualTasks[index][field] = parseInt(value);
};

window.removeManualTask = function(index) {
  manualTasks.splice(index, 1);
  renderManualTasksList();
};

window.saveManualPlant = async function() {
  const name = document.getElementById('manName').value.trim();
  if (!name) return;
  if (manualTasks.length === 0) { alert('Add at least one task'); return; }

  const variety = document.getElementById('manVariety').value.trim();
  const category = document.getElementById('manCategory').value;
  const notes = document.getElementById('manNotes').value.trim();
  const year = currentYear;
  const plantId = crypto.randomUUID();

  // Add to garden
  const gardenPlants = await getAll('gardenPlants');
  const existing = gardenPlants.find(g => g.name === name && g.variety === variety);
  if (!existing) {
    await put('gardenPlants', { id: crypto.randomUUID(), plantId, name, variety, addedDate: new Date().toISOString() });
  }

  // Add all tasks
  for (const t of manualTasks) {
    const task = {
      id: crypto.randomUUID(),
      plantId,
      plantName: name,
      variety,
      taskType: t.taskType,
      startMonth: t.startMonth,
      endMonth: t.endMonth,
      year,
      isCompleted: false,
      notes,
    };
    await put('tasks', task);
    await generateSubTasksForTask(task, name);
  }

  // Submit to community database (if worker is available)
  try {
    await fetch(PUSH_SERVER + '/plants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, variety, category, tasks: manualTasks }),
    });
  } catch(e) {}

  const taskCount = manualTasks.length;
  closeModal();
  manualTasks = [];
  document.getElementById('searchResults').innerHTML = `<div class="empty-state"><p>✓ Added ${name} ${variety || ''} with ${taskCount} tasks</p></div>`;
};

window.closeModal = function(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modalContainer').innerHTML = '';
};

// Helpers
function monthRange(start, end) {
  if (start <= end) return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  return [...Array.from({ length: 12 - start + 1 }, (_, i) => start + i), ...Array.from({ length: end }, (_, i) => i + 1)];
}

function isDue(task) {
  const currentMo = new Date().getMonth() + 1;
  if (!monthRange(task.activeStartMonth, task.activeEndMonth).includes(currentMo)) return false;
  if (!task.lastCompleted) return true;
  const last = new Date(task.lastCompleted);
  const days = Math.floor((Date.now() - last.getTime()) / 86400000);
  const interval = task.interval === 'Weekly' ? 7 : task.interval === 'Every 2 Weeks' ? 14 : 30;
  return days >= interval;
}

function generateTasks(plant, year) {
  const tasks = [];
  const add = (type, start, end, notes) => {
    if (start && end) tasks.push({ id: crypto.randomUUID(), plantId: plant.id, plantName: plant.name, variety: plant.variety || '', taskType: type, startMonth: start, endMonth: end, year, isCompleted: false, notes: notes || '' });
  };

  add('Sow Indoors', plant.sowIndoorsStart, plant.sowIndoorsEnd, `Start ${plant.name} seeds indoors`);
  add('Sow Outdoors', plant.sowOutdoorsStart, plant.sowOutdoorsEnd, `Direct sow ${plant.name} outdoors`);
  add('Plant Out', plant.plantOutStart, plant.plantOutEnd, `Plant out ${plant.name}`);

  const isFlower = plant.category === 'Flower';
  add(isFlower ? 'Flowering' : 'Harvest', plant.harvestStart, plant.harvestEnd, isFlower ? `${plant.name} in flower` : `Harvest ${plant.name}`);
  add('Prune', plant.pruneStart, plant.pruneEnd, `Prune ${plant.name}`);
  add('Cut Back', plant.cutBackStart, plant.cutBackEnd, `Cut back ${plant.name}`);
  add('Divide', plant.divideStart, plant.divideEnd, `Divide ${plant.name}`);
  add('Overwinter', plant.overwinterStart, plant.overwinterEnd, `Lift and store ${plant.name}`);

  return tasks;
}

async function generateSubTasksForTask(task, plantName) {
  const key = `${plantName.toLowerCase()}_${task.taskType}`;
  const steps = SUBTASK_DEFAULTS[key];
  if (!steps) return;
  for (let i = 0; i < steps.length; i++) {
    await put('subTasks', { id: crypto.randomUUID(), taskId: task.id, title: steps[i], sortOrder: i, isCompleted: false });
  }
}

function taskIcon(type) {
  const icons = { 'Sow Indoors': '🌱', 'Sow Outdoors': '☀️', 'Plant Out': '🪴', 'Harvest': '🧺', 'Flowering': '🌸', 'Prune': '✂️', 'Cut Back': '✂️', 'Divide': '🔀', 'Overwinter': '❄️' };
  return icons[type] || '🌿';
}

function taskColor(type) {
  const colors = { 'Sow Indoors': 'var(--green)', 'Sow Outdoors': 'var(--orange)', 'Plant Out': 'var(--blue)', 'Harvest': 'var(--red)', 'Flowering': 'var(--pink)', 'Prune': 'var(--brown)', 'Cut Back': 'var(--brown)', 'Divide': 'var(--teal)', 'Overwinter': 'var(--purple)' };
  return colors[type] || 'var(--gray)';
}

function scheduleWeeklyReminder() {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    const now = new Date();
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + (7 - now.getDay()));
    nextSunday.setHours(9, 0, 0, 0);
    const delay = nextSunday.getTime() - now.getTime();

    navigator.serviceWorker.controller.postMessage({
      type: 'SCHEDULE_NOTIFICATION',
      title: 'Garden Tasks This Week',
      body: 'Check your garden planner for outstanding tasks!',
      delay: Math.max(delay, 60000),
    });
  }
}

init();
