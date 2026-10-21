const INITIAL_WORK_ORDERS = [
  {
    id: 'WO-1038',
    title: 'Lobby thermostat not responding',
    site: 'Riverton Commons',
    status: 'New',
    priority: 'Normal',
    owner: 'Leo Brooks',
    window: '9:00–11:00 AM',
    requester: 'Alex Morgan · Facilities',
    category: 'Climate control',
    asset: 'HVAC-214',
    description:
      'The lobby thermostat display is blank. Check the wall unit and confirm the temperature schedule before the afternoon occupancy period.',
    notes: 'Front desk can provide access to the mechanical room.',
    urgent: false,
  },
  {
    id: 'WO-1039',
    title: 'Loading dock door alignment',
    site: 'Northline Distribution',
    status: 'In progress',
    priority: 'High',
    owner: 'Nia Patel',
    window: '9:00 AM–12:00 PM',
    requester: 'Jordan Ellis · Site lead',
    category: 'Building access',
    asset: 'DOOR-089',
    description:
      'Door three catches on its lower guide. Inspect the track and verify the safety stop after adjustment.',
    notes:
      'Use the east service entrance. Deliveries continue at doors one and two.',
    urgent: false,
  },
  {
    id: 'WO-1040',
    title: 'Water pressure at kitchenette',
    site: 'Maple Street Studios',
    status: 'Waiting',
    priority: 'Normal',
    owner: 'Owen Rivera',
    window: '10:00 AM–12:00 PM',
    requester: 'Riley Scott · Office manager',
    category: 'Plumbing',
    asset: 'WTR-042',
    description:
      'Low cold-water pressure reported in the second-floor kitchenette. Replacement aerator is on order.',
    notes: 'Waiting on parts delivery; expected before noon.',
    urgent: false,
  },
  {
    id: 'WO-1041',
    title: 'Emergency lighting inspection',
    site: 'Cedar Point Center',
    status: 'New',
    priority: 'Urgent',
    owner: 'Unassigned',
    window: '11:00 AM–1:00 PM',
    requester: 'Casey Lane · Facilities',
    category: 'Electrical',
    asset: 'ELEC-117',
    description:
      'The west corridor emergency light failed the weekly test. Inspect the battery pack and record the follow-up test result.',
    notes: 'Replacement battery is available in the site supply cabinet.',
    urgent: true,
  },
  {
    id: 'WO-1042',
    title: 'Air handling unit service',
    site: 'Westbrook Business Park',
    status: 'New',
    priority: 'High',
    owner: 'Unassigned',
    window: '1:00–3:00 PM',
    requester: 'Sam Taylor · Site coordinator',
    category: 'Preventive maintenance',
    asset: 'AHU-306',
    description:
      'Scheduled filter replacement and belt inspection for the building C air handling unit. Coordinate rooftop access with the site coordinator.',
    notes: 'Verify replacement filter dimensions before dispatch.',
    urgent: false,
  },
  {
    id: 'WO-1043',
    title: 'Conference room power outlet',
    site: 'Harbor View Offices',
    status: 'In progress',
    priority: 'Normal',
    owner: 'Maya Chen',
    window: '12:00–2:00 PM',
    requester: 'Jamie Park · Office manager',
    category: 'Electrical',
    asset: 'ELEC-052',
    description:
      'The floor outlet in meeting room four is intermittent. Check the connection and verify operation with the site coordinator.',
    notes: 'Room is available until the 2:00 PM meeting.',
    urgent: false,
  },
  {
    id: 'WO-1044',
    title: 'Access reader diagnostic',
    site: 'Pine Grove Campus',
    status: 'Waiting',
    priority: 'Urgent',
    owner: 'Leo Brooks',
    window: '1:00–3:00 PM',
    requester: 'Avery Reed · Security desk',
    category: 'Building access',
    asset: 'ACS-203',
    description:
      'The visitor entrance reader responds inconsistently. Collect diagnostic information before replacing the reader.',
    notes: 'Site security has arranged a temporary staffed entrance.',
    urgent: true,
  },
  {
    id: 'WO-1045',
    title: 'Meeting room temperature check',
    site: 'Juniper House',
    status: 'Resolved',
    priority: 'Normal',
    owner: 'Nia Patel',
    window: '8:00–10:00 AM',
    requester: 'Taylor Quinn · Facilities',
    category: 'Climate control',
    asset: 'HVAC-118',
    description:
      'The south meeting room was warmer than its setpoint. Inspect the zone damper and confirm stable operation.',
    notes:
      'Damper adjusted. Room temperature is holding at the scheduled setpoint.',
    urgent: false,
  },
  {
    id: 'WO-1046',
    title: 'Exterior drainage review',
    site: 'Brookside Works',
    status: 'New',
    priority: 'High',
    owner: 'Owen Rivera',
    window: '2:00–4:00 PM',
    requester: 'Drew Harper · Site lead',
    category: 'Grounds',
    asset: 'DRN-031',
    description:
      'Standing water was reported near the loading approach. Inspect the catch basin and clear accessible debris.',
    notes: 'Bring a drain camera if available.',
    urgent: false,
  },
  {
    id: 'WO-1047',
    title: 'Main entrance closer adjustment',
    site: 'Oakfield Exchange',
    status: 'Resolved',
    priority: 'Normal',
    owner: 'Maya Chen',
    window: '8:00–10:00 AM',
    requester: 'Parker Blake · Reception',
    category: 'Building access',
    asset: 'DOOR-061',
    description:
      'The main entrance door closes too quickly. Adjust the closer and confirm smooth operation.',
    notes: 'Closer adjusted and checked with reception.',
    urgent: false,
  },
];

const clone = (value) => JSON.parse(JSON.stringify(value));
const editableFields = ['owner', 'status', 'notes', 'urgent'];
const statusClass = (status) =>
  `status-${status.toLowerCase().replaceAll(' ', '-')}`;
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ],
  );

/** Initialize the local fictional work-order UI. It never calls a service. */
export function initSamplePage() {
  const root = document.getElementById('operations-app');
  if (!root) throw new Error('The operations sample requires #operations-app');
  const element = (id) => root.querySelector(`#${id}`);
  const rows = element('work-order-rows');
  const dialog = element('save-confirmation');
  const fields = {
    owner: element('work-order-owner'),
    status: element('work-order-status'),
    notes: element('work-order-notes'),
    urgent: element('work-order-urgent'),
  };
  let workOrders;
  let selectedId;
  let filters;
  let draft;
  let pendingChanges;
  let activity;
  let saveSequence;

  function selectedOrder() {
    return workOrders.find((order) => order.id === selectedId);
  }
  function isDirty() {
    return editableFields.some((key) => draft[key] !== selectedOrder()[key]);
  }
  function updateDirtyIndicator() {
    const dirty = isDirty();
    element('dirty-indicator').textContent = dirty
      ? 'Unsaved changes'
      : 'Saved';
    element('dirty-indicator').classList.toggle('is-dirty', dirty);
  }
  function readDraft() {
    draft = {
      owner: fields.owner.value,
      status: fields.status.value,
      notes: fields.notes.value,
      urgent: fields.urgent.checked,
    };
    updateDirtyIndicator();
  }
  function renderSummary() {
    element('metric-open').textContent = workOrders.filter(
      (order) => order.status !== 'Resolved',
    ).length;
    element('metric-progress').textContent = workOrders.filter(
      (order) => order.status === 'In progress',
    ).length;
    element('metric-urgent').textContent = workOrders.filter(
      (order) => order.urgent && order.status !== 'Resolved',
    ).length;
    element('metric-resolved').textContent = workOrders.filter(
      (order) => order.status === 'Resolved',
    ).length;
    element('queue-total').textContent = workOrders.length;
  }
  function renderQueue() {
    const search = filters.search.toLowerCase().trim();
    const visible = workOrders.filter((order) => {
      const priority = order.urgent ? 'Urgent' : order.priority;
      return (
        (!search ||
          `${order.id} ${order.title} ${order.site}`
            .toLowerCase()
            .includes(search)) &&
        (filters.status === 'all' || order.status === filters.status) &&
        (filters.priority === 'all' || priority === filters.priority) &&
        (filters.owner === 'all' || order.owner === filters.owner)
      );
    });
    rows.innerHTML = visible
      .map((order) => {
        const priority = order.urgent ? 'Urgent' : order.priority;
        const initials =
          order.owner === 'Unassigned'
            ? '—'
            : order.owner
                .split(' ')
                .map((part) => part[0])
                .join('');
        const shortOwner =
          order.owner === 'Unassigned'
            ? 'Unassigned'
            : `${order.owner.split(' ')[0]} ${order.owner.split(' ')[1][0]}.`;
        return `<tr class="${order.id === selectedId ? 'selected' : ''}" data-work-order="${order.id}"><td><button type="button" class="order-id-button" data-order-id="${order.id}" data-testid="open-${order.id}" aria-label="Open ${order.id}" aria-pressed="${order.id === selectedId}">${order.id} <span aria-hidden="true">↗</span></button><span class="order-subject">${escapeHtml(order.title)}</span><span class="order-site">${escapeHtml(order.site)}</span></td><td><span class="status-pill ${statusClass(order.status)}">${order.status}</span></td><td><span class="priority-pill priority-${priority.toLowerCase()}">${priority}</span></td><td><span class="owner-chip" title="${order.owner}"><span class="owner-avatar" aria-hidden="true">${initials}</span>${shortOwner}</span></td><td>${order.window}</td></tr>`;
      })
      .join('');
    element('queue-empty').hidden = visible.length !== 0;
    element('queue-count').textContent =
      `Showing ${visible.length} of ${workOrders.length} work orders`;
  }
  function renderActivity() {
    element('activity-history').innerHTML = activity
      .filter((entry) => entry.workOrderId === selectedId)
      .map(
        (entry) =>
          `<li><span>${escapeHtml(entry.message)}</span><time>${escapeHtml(entry.time)}</time></li>`,
      )
      .join('');
  }
  function renderDetails() {
    const order = selectedOrder();
    draft = Object.fromEntries(editableFields.map((key) => [key, order[key]]));
    for (const key of [
      'id',
      'site',
      'title',
      'description',
      'window',
      'requester',
      'category',
      'asset',
    ])
      element(`detail-${key}`).textContent = order[key];
    const status = element('detail-status');
    status.textContent = order.status;
    status.className = `status-pill ${statusClass(order.status)}`;
    for (const key of ['owner', 'status', 'notes'])
      fields[key].value = draft[key];
    fields.urgent.checked = draft.urgent;
    updateDirtyIndicator();
    renderActivity();
  }
  function reset() {
    dialog.close();
    workOrders = clone(INITIAL_WORK_ORDERS);
    selectedId = 'WO-1038';
    filters = { search: '', status: 'all', priority: 'all', owner: 'all' };
    pendingChanges = null;
    saveSequence = 0;
    activity = workOrders.flatMap((order) => [
      {
        workOrderId: order.id,
        message:
          order.status === 'Resolved'
            ? 'Service completed and checked with the site contact.'
            : 'Service window confirmed with the site contact.',
        time: 'Today · 8:10 AM',
      },
      {
        workOrderId: order.id,
        message: 'Work order added to the central region queue.',
        time: 'Yesterday · 4:35 PM',
      },
    ]);
    element('work-order-search').value = '';
    for (const key of ['status', 'priority', 'owner'])
      element(`${key}-filter`).value = 'all';
    renderSummary();
    renderQueue();
    renderDetails();
    element('save-status').textContent =
      'Select a work order to review or update.';
  }

  rows.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-order-id]');
    if (!button) return;
    selectedId = button.dataset.orderId;
    pendingChanges = null;
    renderQueue();
    renderDetails();
    element('save-status').textContent =
      `${selectedId} selected. Changes stay in this local sample.`;
  });
  element('work-order-search').addEventListener('input', (event) => {
    filters.search = event.target.value;
    renderQueue();
  });
  for (const key of ['status', 'priority', 'owner'])
    element(`${key}-filter`).addEventListener('change', (event) => {
      filters[key] = event.target.value;
      renderQueue();
    });
  for (const field of Object.values(fields)) {
    field.addEventListener('input', readDraft);
    field.addEventListener('change', readDraft);
  }
  element('work-order-form').addEventListener('submit', (event) =>
    event.preventDefault(),
  );
  element('save-work-order').addEventListener('click', () => {
    readDraft();
    if (!isDirty()) {
      element('save-status').textContent =
        'Everything is up to date. Edit a field before saving.';
      return;
    }
    pendingChanges = { workOrderId: selectedId, ...clone(draft) };
    element('confirmation-id').textContent = selectedId;
    element('confirmation-summary').innerHTML = [
      ['Owner', draft.owner],
      ['Status', draft.status],
      ['Priority', draft.urgent ? 'Urgent' : selectedOrder().priority],
      ['Notes', draft.notes || 'No dispatch notes'],
    ]
      .map(
        ([label, value]) =>
          `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`,
      )
      .join('');
    dialog.showModal();
  });
  element('cancel-save').addEventListener('click', () => {
    pendingChanges = null;
    dialog.close();
  });
  dialog.addEventListener('cancel', () => {
    pendingChanges = null;
  });
  element('confirm-save').addEventListener('click', () => {
    if (!pendingChanges) return;
    const order = workOrders.find(
      (candidate) => candidate.id === pendingChanges.workOrderId,
    );
    for (const key of editableFields) order[key] = pendingChanges[key];
    saveSequence += 1;
    activity.unshift({
      workOrderId: order.id,
      message: `Dispatch updated: ${order.owner}, ${order.status}${order.urgent ? ', urgent priority' : ''}.`,
      time: `This session · update ${saveSequence}`,
    });
    pendingChanges = null;
    dialog.close();
    renderSummary();
    renderQueue();
    renderDetails();
    element('save-status').textContent =
      `${order.id} updated. Changes are saved in this session.`;
    root.dispatchEvent(
      new CustomEvent('sample-work-order-saved', {
        detail: clone(order),
        bubbles: true,
      }),
    );
  });

  reset();
  return {
    reset,
    getState() {
      readDraft();
      return clone({
        selectedId,
        workOrders,
        activity,
        filters,
        draft,
        pendingChanges,
      });
    },
  };
}
